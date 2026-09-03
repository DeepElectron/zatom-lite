import { describe, expect, it } from 'vitest'
import type { Atom, Bond } from '../lib/crystal/types'
import type { LayerShadingSnapshotContext } from '../lib/biomolecule/shading'
import {
  bondsWithinAtomIds,
  crystalLayerRepresentationHasBonds,
  crystalReplaceBaseAtomIds,
  evaluateCrystalLayerSelection,
  evaluateCrystalLayerStyle,
  snapshotCrystalLayerStyle,
  resolveCrystalLayerStickRadius,
  type CrystalLayer,
} from '../lib/crystal/semantic-layers'
import { createCrystalStore } from '../orchestration/crystalStore'
import {
  HYPER_STICK_FRAGMENT_SHADER,
  hyperStickBondedAtomIds,
  resolveHyperStickAtomRadius,
  resolveHyperStickAtomMeshScale,
  resolveHyperStickPresentation,
  resolveHyperStickShadingMode,
} from '../ui/components/crystal-viewer/hyper-stick-bonds'
import { SHADING_MODE_MAP } from '../lib/render/stylized-material'
import { resolveLayerShadingRenderOverride } from '../ui/components/crystal-viewer/layer-render-override'
import { BIO_DEMO_STYLE_TRACKS, instantiateCrystalDemoTrack } from '../lib/biomolecule/layer-materials'
import { analyzeCoordinationEnvironments } from '../lib/crystal/polyhedra'
import { createCrystalLayerSurfaceJob } from '../ui/components/crystal-viewer/crystal-layer-surface'
import { buildBioSurfaceGeometryFromJob } from '../lib/biomolecule/surface-geometry'
import {
  buildCrystalLayerSelectionPresetGroups,
  crystalAtomIdsToSelectionExpression,
} from '../lib/crystal/layer-selection'
import { crystalBaseAtomRadii, crystalBaseBondRadius } from '../lib/crystal/base-presentation'

const atoms: Atom[] = [
  { id: 'o-low', element: 'O', position: [0, 0, -1], cartesian: [0, 0, -1] },
  { id: 'o-high', element: 'O', position: [0, 0, 2], cartesian: [0, 0, 2] },
  { id: 'ti', element: 'Ti', position: [1, 0, 2], cartesian: [1, 0, 2] },
]

const bonds: Bond[] = [
  { id: 'b1', atom1Id: 'o-low', atom2Id: 'ti', type: 'single' },
  { id: 'b2', atom1Id: 'o-high', atom2Id: 'ti', type: 'single' },
]

function layer(patch: Partial<CrystalLayer> = {}): CrystalLayer {
  return {
    id: 'layer',
    name: 'Oxygen cap',
    selection: 'elem O and z > 0',
    representation: 'space-fill',
    color: { mode: 'custom', value: '#ff0000' },
    materialPresetId: null,
    shading: null,
    visible: true,
    opacity: 0.7,
    scale: 1.4,
    bondScale: 0.8,
    replaceBase: true,
    ...patch,
  }
}

const shadingDefaults: LayerShadingSnapshotContext = {
  renderStyle: 'vesta', ambient: .55, diffuse: .47, specular: .6,
  shininess: 100, rim: 0, lightAmbient: null, lightKey: null,
}

describe('crystal semantic layers', () => {
  it('records inherited global material as a complete immutable layer snapshot', () => {
    const globals: LayerShadingSnapshotContext = {
      renderStyle: 'pixel8',
      ambient: .2,
      diffuse: .4,
      specular: .6,
      shininess: 70,
      rim: .3,
      lightAmbient: null,
      lightKey: null,
    }
    const patch = snapshotCrystalLayerStyle(layer({ shading: null }), globals)
    expect(patch.shading).toEqual({
      mode: 'pixel', ambient: .2, diffuse: .4, specular: .6, shininess: 70, rim: .3,
    })
    expect(patch.visible).toBeUndefined()

    globals.renderStyle = 'cel'
    globals.ambient = 1.1
    globals.diffuse = 1.2
    globals.specular = 1.3
    globals.shininess = 150
    globals.rim = 1.4
    const recorded = evaluateCrystalLayerStyle(layer({
      shading: null,
      styleTrack: [{ id: 'recorded', frame: 4, easing: 'smooth', patch }],
    }), 4, globals)
    expect(recorded.shading).toEqual({
      mode: 'pixel', ambient: .2, diffuse: .4, specular: .6, shininess: 70, rim: .3,
    })
  })

  it('records the same effective light precedence used by semantic materials', () => {
    const patch = snapshotCrystalLayerStyle(layer({
      shading: { diffuse: .85, rim: .45 },
    }), {
      renderStyle: 'gooch',
      ambient: .2,
      diffuse: .4,
      specular: .6,
      shininess: 70,
      rim: .3,
      lightAmbient: .7,
      lightKey: .8,
    })
    expect(patch.shading).toEqual({
      mode: 'gooch', ambient: .7, diffuse: .85, specular: .6, shininess: 70, rim: .45,
    })
  })

  it('leaves every material renderer input undefined when shading inherits globally', () => {
    expect(resolveLayerShadingRenderOverride(null)).toEqual({
      mode: undefined,
      ambient: undefined,
      diffuse: undefined,
      specularStrength: undefined,
      shininess: undefined,
      fresnel: undefined,
    })
  })

  it('uses the canonical numeric and element expression language', () => {
    const result = evaluateCrystalLayerSelection(atoms, 'elem O and z > 0')
    expect(result.error).toBeNull()
    expect([...result.atomIds]).toEqual(['o-high'])
  })

  it('roundtrips an exact 3D atom selection through a compact crystal layer expression', () => {
    const selectionAtoms: Atom[] = Array.from({ length: 9 }, (_, index) => ({
      id: `atom-${index}`,
      element: index % 2 ? 'O' : 'Ti',
      position: [index / 10, 0, 0],
    }))
    const selected = new Set(['atom-1', 'atom-2', 'atom-3', 'atom-6', 'atom-8'])
    const expression = crystalAtomIdsToSelectionExpression(selectionAtoms, selected)
    expect(expression).toBe('index 1-3+6+8')
    expect([...evaluateCrystalLayerSelection(selectionAtoms, expression).atomIds]).toEqual([
      'atom-1', 'atom-2', 'atom-3', 'atom-6', 'atom-8',
    ])
    expect(() => crystalAtomIdsToSelectionExpression(selectionAtoms, new Set(['atom-1', 'stale-id'])))
      .toThrow('no longer belongs to the active structure')
  })

  it('creates an exact replace-base layer whose keyframes affect only the selected atoms', () => {
    const selectionAtoms: Atom[] = Array.from({ length: 10 }, (_, index) => ({
      id: `atom-${index}`,
      element: index % 2 ? 'O' : 'Ti',
      position: [index / 10, 0, 0],
      siteIndex: index % 2,
      cellIndex: [Math.floor(index / 2), 0, 0],
    }))
    const selected = new Set(['atom-0', 'atom-2', 'atom-3', 'atom-5', 'atom-6', 'atom-8', 'atom-9'])
    const selection = crystalAtomIdsToSelectionExpression(selectionAtoms, selected)
    const store = createCrystalStore()
    const id = store.getState().addCrystalLayer({
      name: 'Selection (7)',
      selection,
      replaceBase: true,
      styleTrack: [
        { id: 'start', frame: 0, easing: 'linear', patch: { opacity: .2 } },
        { id: 'end', frame: 10, easing: 'linear', patch: { opacity: .8 } },
      ],
    })
    const created = store.getState().crystalLayers.find((candidate) => candidate.id === id)!

    expect(evaluateCrystalLayerSelection(selectionAtoms, created.selection).atomIds).toEqual(selected)
    expect(crystalReplaceBaseAtomIds(selectionAtoms, [created])).toEqual(selected)
    expect(evaluateCrystalLayerStyle(created, 5, shadingDefaults).opacity).toBeCloseTo(.5)
    expect(selectionAtoms.filter((atom) => !selected.has(atom.id)).map((atom) => atom.id)).toEqual([
      'atom-1', 'atom-4', 'atom-7',
    ])
  })

  it('preserves the source crystal DSL including site/index/fractional and distance operators', () => {
    const expanded: Atom[] = [
      { id: 'fe-a', element: 'Fe', siteIndex: 0, position: [.1, .1, .1], cartesian: [0, 0, 0], cellIndex: [0, 0, 0] },
      { id: 'o-a', element: 'O', siteIndex: 1, position: [.2, .1, .1], cartesian: [1.8, 0, 0], cellIndex: [0, 0, 0] },
      { id: 'fe-b', element: 'Fe', siteIndex: 0, position: [.6, .1, .1], cartesian: [5, 0, 0], cellIndex: [1, 0, 0] },
    ]
    const supercell = { nx: 2, ny: 1, nz: 1 }
    expect([...evaluateCrystalLayerSelection(expanded, 'site 0', supercell).atomIds]).toEqual(['fe-a', 'fe-b'])
    expect([...evaluateCrystalLayerSelection(expanded, 'index 1-2 and fx > 1', supercell).atomIds]).toEqual(['fe-b'])
    expect([...evaluateCrystalLayerSelection(expanded, 'elem Fe expand 2', supercell).atomIds]).toEqual(['fe-a', 'o-a', 'fe-b'])
    expect([...evaluateCrystalLayerSelection(expanded, 'elem Fe around 2', supercell).atomIds]).toEqual(['o-a'])
    expect(evaluateCrystalLayerSelection(expanded, 'el == "Fe"', supercell).error).toBeTruthy()
  })

  it('offers only structure-reachable crystal presets with source expressions and recommendations', () => {
    const presetAtoms: Atom[] = [
      { id: 'fe', element: 'Fe', position: [0, 0, 0] },
      { id: 'c', element: 'C', position: [.1, 0, 0] },
      { id: 'n', element: 'N', position: [.2, 0, 0] },
      { id: 'h', element: 'H', position: [.3, 0, 0] },
    ]
    const groups = buildCrystalLayerSelectionPresetGroups(presetAtoms)
    expect(groups.map((group) => group.name)).toEqual([
      'Element classes', 'Coordination environments', 'Molecular crystal', 'Spatial slices',
    ])
    const items = groups.flatMap((group) => group.items)
    expect(items.find((item) => item.name === 'Fe shell')).toMatchObject({
      expression: 'elem Fe expand 2.6', recommendedRepresentation: 'polyhedra',
    })
    expect(items.find((item) => item.name === 'Heavy atoms')?.expression).toBe('not elem H')
    expect(items.some((item) => item.name === 'Halogens')).toBe(false)
  })

  it('fails closed for invalid expressions', () => {
    const result = evaluateCrystalLayerSelection(atoms, 'residue 10')
    expect(result.error).toBeTruthy()
    expect(result.atomIds.size).toBe(0)
  })

  it('subtracts only visible replaceBase layers from the base pass', () => {
    expect([...crystalReplaceBaseAtomIds(atoms, [layer()])]).toEqual(['o-high'])
    expect(crystalReplaceBaseAtomIds(atoms, [layer({ visible: false })]).size).toBe(0)
    expect(crystalReplaceBaseAtomIds(atoms, [layer({ replaceBase: false })]).size).toBe(0)
  })

  it('does not render cut bonds across a semantic subset boundary', () => {
    expect(bondsWithinAtomIds(bonds, new Set(['o-high', 'ti'])).map((bond) => bond.id)).toEqual(['b2'])
  })

  it('uses source Licorice geometry independently of atom scale and the base bond gate', () => {
    expect(resolveCrystalLayerStickRadius(.12, 1.5)).toBeCloseTo(.18)
    expect(resolveCrystalLayerStickRadius(.12, .5)).toBeCloseTo(.06)
    expect(resolveCrystalLayerStickRadius(.02, .2)).toBeCloseTo(.004)
    expect(crystalLayerRepresentationHasBonds('stick')).toBe(true)
    expect(crystalLayerRepresentationHasBonds('ball-stick')).toBe(true)
    expect(crystalLayerRepresentationHasBonds('space-fill')).toBe(false)
    expect(crystalLayerRepresentationHasBonds('hyper-stick')).toBe(false)
  })

  it('keeps layer CRUD isolated per viewport store and normalizes user values', () => {
    const first = createCrystalStore()
    const second = createCrystalStore()
    const id = first.getState().addCrystalLayer({ name: '  Oxygen  ', opacity: 2, scale: 0 })

    expect(first.getState().crystalLayers).toHaveLength(1)
    expect(second.getState().crystalLayers).toHaveLength(0)
    expect(first.getState().crystalLayers[0]).toMatchObject({ name: 'Oxygen', opacity: 1, scale: 0.05 })

    const duplicateId = first.getState().duplicateCrystalLayer(id)
    expect(duplicateId).not.toBeNull()
    expect(first.getState().crystalLayers.map((item) => item.name)).toEqual(['Oxygen copy', 'Oxygen'])
    first.getState().moveCrystalLayer(0, 1)
    expect(first.getState().crystalLayers[1].id).toBe(duplicateId)
    first.getState().removeCrystalLayer(id)
    expect(first.getState().crystalLayers).toHaveLength(1)
  })

  it('interpolates numeric style channels and steps visibility', () => {
    const animated = layer({
      visible: false,
      styleTrack: [
        { id: 'start', frame: 0, easing: 'linear', patch: { opacity: 0.2, scale: 1, visible: true, representation: 'ball-stick' } },
        { id: 'end', frame: 10, easing: 'smooth', patch: { opacity: 0.8, scale: 2, visible: false, representation: 'space-fill' } },
      ],
    })
    expect(evaluateCrystalLayerStyle(animated, 5, shadingDefaults)).toMatchObject({
      opacity: 0.5,
      scale: 1.5,
      visible: true,
      representation: 'ball-stick',
    })
    expect(evaluateCrystalLayerStyle(animated, 10, shadingDefaults).visible).toBe(false)
  })

  it('writes layer style keys from current store state and replays without mutating the static baseline', () => {
    const store = createCrystalStore()
    const id = store.getState().addCrystalLayer({ opacity: .7, scale: 1.4, bondScale: .8 })

    store.getState().setPresentationFrame(0)
    store.getState().recordCrystalLayerStyle(id)
    store.getState().setPresentationFrame(10)
    // Consecutive writes before a React rerender must merge against the latest
    // store value instead of letting a stale layer closure restore opacity.
    store.getState().editCrystalLayerStyle(id, { opacity: .5 })
    store.getState().editCrystalLayerStyle(id, { scale: 1.8 })
    store.getState().setPresentationFrame(20)
    store.getState().editCrystalLayerStyle(id, { scale: 2.2 })

    const authored = store.getState().crystalLayers.find((candidate) => candidate.id === id)!
    expect(authored).toMatchObject({ opacity: .7, scale: 1.4, bondScale: .8 })
    expect(authored.styleTrack).toHaveLength(3)
    expect(authored.styleTrack?.find((keyframe) => keyframe.frame === 10)?.patch).toMatchObject({
      opacity: .5,
      scale: 1.8,
      bondScale: .8,
    })
    expect(evaluateCrystalLayerStyle(authored, 0, shadingDefaults)).toMatchObject({ opacity: .7, scale: 1.4 })
    expect(evaluateCrystalLayerStyle(authored, 10, shadingDefaults)).toMatchObject({ opacity: .5, scale: 1.8 })
    expect(evaluateCrystalLayerStyle(authored, 15, shadingDefaults)).toMatchObject({ opacity: .5, scale: 2 })
    expect(evaluateCrystalLayerStyle(authored, 20, shadingDefaults)).toMatchObject({ opacity: .5, scale: 2.2 })
  })

  it('auto-starts a crystal layer track when its first style edit happens after frame zero', () => {
    const store = createCrystalStore()
    const id = store.getState().addCrystalLayer({
      opacity: .7,
      shading: null,
      materialPresetId: null,
    })

    store.getState().setPresentationFrame(61)
    store.getState().editCrystalLayerStyle(id, {
      materialPresetId: null,
      shading: { mode: 'flat' },
    })

    const authored = store.getState().crystalLayers.find((candidate) => candidate.id === id)!
    expect(authored.shading).toBeNull()
    expect(authored.styleTrack?.map((keyframe) => keyframe.frame)).toEqual([0, 61])
    expect(evaluateCrystalLayerStyle(authored, 0, shadingDefaults).shading?.mode).not.toBe('flat')
    expect(evaluateCrystalLayerStyle(authored, 61, shadingDefaults).shading?.mode).toBe('flat')
  })

  it('interpolates material lighting while holding its mode until the destination keyframe', () => {
    const animated = layer({
      styleTrack: [
        { id: 'start', frame: 0, easing: 'linear', patch: {
          shading: { mode: 'flat', ambient: .2, diffuse: .3, specular: .4, shininess: 20, rim: .1 },
        } },
        { id: 'end', frame: 10, easing: 'linear', patch: {
          shading: { mode: 'cel', ambient: .8, diffuse: .9, specular: 1, shininess: 120, rim: .7 },
        } },
      ],
    })
    const before = evaluateCrystalLayerStyle(animated, 4, shadingDefaults).shading!
    expect(before.mode).toBe('flat')
    expect(before.ambient).toBeCloseTo(.44)
    expect(before.diffuse).toBeCloseTo(.54)
    expect(before.specular).toBeCloseTo(.64)
    expect(before.shininess).toBeCloseTo(60)
    expect(before.rim).toBeCloseTo(.34)
    const after = evaluateCrystalLayerStyle(animated, 6, shadingDefaults).shading!
    expect(after.mode).toBe('flat')
    expect(after.ambient).toBeCloseTo(.56)
    expect(after.diffuse).toBeCloseTo(.66)
    expect(after.specular).toBeCloseTo(.76)
    expect(after.shininess).toBeCloseTo(80)
    expect(after.rim).toBeCloseTo(.46)
    expect(evaluateCrystalLayerStyle(animated, 10, shadingDefaults).shading?.mode).toBe('cel')
  })

  it('holds custom colours and representations until the destination keyframe', () => {
    const animated = layer({
      color: { mode: 'custom', value: '#000000' },
      representation: 'polyhedra',
      styleTrack: [
        { id: 'start', frame: 0, easing: 'linear', patch: { color: { mode: 'custom', value: '#000000' }, representation: 'polyhedra' } },
        { id: 'end', frame: 10, easing: 'linear', patch: { color: { mode: 'custom', value: '#ffffff' }, representation: 'surface' } },
      ],
    })
    expect(evaluateCrystalLayerStyle(animated, 2.5, shadingDefaults)).toMatchObject({
      color: { mode: 'custom', value: '#000000' }, representation: 'polyhedra',
    })
    expect(evaluateCrystalLayerStyle(animated, 7.5, shadingDefaults)).toMatchObject({
      color: { mode: 'custom', value: '#000000' }, representation: 'polyhedra',
    })
    expect(evaluateCrystalLayerStyle(animated, 10, shadingDefaults)).toMatchObject({
      color: { mode: 'custom', value: '#ffffff' }, representation: 'surface',
    })
  })

  it('instantiates all six crystal demo tracks across the actual timeline bounds', () => {
    expect(BIO_DEMO_STYLE_TRACKS).toHaveLength(6)
    for (const demo of BIO_DEMO_STYLE_TRACKS) {
      let sequence = 0
      const track = instantiateCrystalDemoTrack(demo, 120, () => `${demo.id}-${++sequence}`)
      expect(track.length).toBe(demo.steps.length)
      expect(track[0].frame).toBe(0)
      expect(Math.max(...track.map((key) => key.frame))).toBeLessThanOrEqual(119)
      expect(track.every((key) => key.patch.shading && key.patch.opacity !== undefined)).toBe(true)
    }
  })

  it('builds real selected-centre polyhedron and Gaussian-surface inputs', () => {
    const octahedral: Atom[] = [
      { id: 'ti', element: 'Ti', position: [0, 0, 0], cartesian: [0, 0, 0] },
      ...([[2, 0, 0], [-2, 0, 0], [0, 2, 0], [0, -2, 0], [0, 0, 2], [0, 0, -2]] as [number, number, number][])
        .map((position, index) => ({ id: `o-${index}`, element: 'O', position, cartesian: position })),
    ]
    const environments = analyzeCoordinationEnvironments(octahedral, { centralElements: new Set(['Ti']) }).environments
    expect(environments).toHaveLength(1)
    expect(environments[0]).toMatchObject({ centralAtomId: 'ti', coordinationNumber: 6, geometry: 'octahedral' })
    expect(environments[0].faces.length).toBeGreaterThan(0)

    const surfaceJob = createCrystalLayerSurfaceJob(
      octahedral,
      new Set(['ti', 'o-0']),
      new Map([['ti', '#123456']]),
      { O: '#ff0000' },
    )
    expect(surfaceJob).not.toBeNull()
    expect(surfaceJob?.positions).toHaveLength(6)
    expect(surfaceJob?.elements).toEqual(['Ti', 'O'])
    expect(surfaceJob?.colors).toEqual(['#123456', '#ff0000'])
    const surface = buildBioSurfaceGeometryFromJob(surfaceJob!)
    expect(surface).not.toBeNull()
    expect(surface?.positions.length).toBeGreaterThan(0)
    expect(surface?.indices.length).toBeGreaterThan(0)
  })

  it('keeps HyperStick atom, bond and opacity overrides independent and bounded', () => {
    expect(resolveHyperStickPresentation(1, { atomScale: 2, bondScale: 1, opacity: 0.35 })).toEqual({
      atomScale: 2,
      stickScale: 0.225,
      bondRadius: null,
      opacity: 0.35,
    })
    expect(resolveHyperStickPresentation(1, { atomScale: 0, bondScale: 100, opacity: 2 })).toEqual({
      atomScale: 0.01,
      stickScale: 1.5,
      bondRadius: null,
      opacity: 1,
    })
    expect(resolveHyperStickPresentation(1, { atomScale: 2, bondRadius: .18, opacity: .16 })).toEqual({
      atomScale: 2,
      stickScale: 1,
      bondRadius: .18,
      opacity: .16,
    })
    const sourceStick = resolveHyperStickPresentation(1, { atomScale: 2, bondRadius: .18 })
    expect(resolveHyperStickAtomRadius(1.2, 2, 'a', sourceStick)).toBe(.18)
    expect(resolveHyperStickAtomRadius(1.2, 2, 'a', sourceStick, new Map([['a', .21]]))).toBe(.21)
    expect(resolveHyperStickAtomMeshScale(sourceStick)).toBe(2)
    expect(resolveHyperStickAtomMeshScale(sourceStick, { atomRadiusByAtomId: new Map([['a', .21]]) })).toBe(1)
  })

  it('keeps isolated HyperStick atoms out of the SDF endpoint set', () => {
    expect([...hyperStickBondedAtomIds(atoms, [bonds[1]])]).toEqual(['o-high', 'ti'])
  })

  it('resolves source-compatible base crystal atom and bond radii independently of legacy scales', () => {
    const settings = {
      radiusScale: .4,
      bondRadius: .18,
      elementRadiusVariance: 1,
      elementOverrides: { O: { color: '#ffffff', radius: 1.2 } },
    }
    expect(crystalBaseAtomRadii([atoms[0]], 'ball-stick', settings).get('o-low')).toBeCloseTo(.48)
    expect(crystalBaseAtomRadii([atoms[0]], 'stick', settings).get('o-low')).toBeCloseTo(.18)
    expect(crystalBaseAtomRadii([atoms[0]], 'space-fill', settings).get('o-low')).toBeCloseTo(1.2)
    expect(crystalBaseAtomRadii([atoms[0]], 'wireframe', settings).size).toBe(0)
    expect(crystalBaseBondRadius(settings)).toBe(.18)
    expect(crystalBaseBondRadius({ bondRadius: Number.NaN })).toBe(.12)
    const hyperStick = resolveHyperStickPresentation(3, {
      atomRadiusByAtomId: crystalBaseAtomRadii([atoms[0]], 'ball-stick', settings),
      bondRadius: crystalBaseBondRadius(settings),
    })
    expect(resolveHyperStickAtomRadius(9, 3, 'o-low', hyperStick, crystalBaseAtomRadii([atoms[0]], 'ball-stick', settings))).toBeCloseTo(.48)
    expect(hyperStick.bondRadius).toBeCloseTo(.18)
  })

  it('applies inherited and layer NPR modes without replacing the SDF surface contract', () => {
    expect(resolveHyperStickShadingMode('hatch')).toBe(SHADING_MODE_MAP.hatch)
    expect(resolveHyperStickShadingMode('hatch', { mode: SHADING_MODE_MAP.xray })).toBe(SHADING_MODE_MAP.xray)
    expect(HYPER_STICK_FRAGMENT_SHADER).toContain('uniform float uBondBicolor, uSpecular, uShininess, uRim, uOpacity, uMode;')
    for (const mode of [...Object.values(SHADING_MODE_MAP), 9, 10, 16]) {
      if (mode === SHADING_MODE_MAP.vesta) continue
      expect(HYPER_STICK_FRAGMENT_SHADER).toContain(`mode==${mode}`)
    }
    expect(HYPER_STICK_FRAGMENT_SHADER).toContain('gl_FragDepth=')
    expect(HYPER_STICK_FRAGMENT_SHADER).toContain('gl_FragColor=shadeNpr(col,n,viewDir,hit)')
    expect(HYPER_STICK_FRAGMENT_SHADER).toContain('float lightStrength=clamp(uAmbient+uKey*ndl+.18*uFill,0.,1.)')
  })

  it('clears semantic layers when assembly expansion replaces the topology', () => {
    const store = createCrystalStore()
    store.getState().addCrystalLayer()
    store.getState().syncAssemblyToAtoms()
    expect(store.getState().crystalLayers).toHaveLength(0)
  })
})
