import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseLegacyPdb } from '../lib/biomolecule/pdb'
import { RCSB_BIOMOLECULE_EXAMPLES } from '../lib/biomolecule/examples'
import type { BioLayer } from '../lib/biomolecule/types'
import { getActiveViewportStoreApi } from '../orchestration/ViewportContext'
import { createCrystalStore } from '../orchestration/crystalStore'
import { useViewportManager } from '../orchestration/viewportManager'
import {
  fetchRcsbPdbStructure,
  importBundledBiomoleculePdb,
  importRcsbPdb,
  importUnifiedStructureText,
  RCSB_PDB_MAX_BYTES,
} from '../services/unified-file-import'

function atomLine(options: {
  serial: number
  name: string
  residue: string
  chain: string
  sequence: number
  x: number
  y: number
  z: number
  occupancy?: number
  bFactor?: number
  element: string
}): string {
  const coordinate = (value: number) => value.toFixed(3).padStart(8)
  return [
    'ATOM  ',
    String(options.serial).padStart(5),
    ' ',
    options.name.padStart(4),
    ' ',
    options.residue.padStart(3),
    ' ',
    options.chain,
    String(options.sequence).padStart(4),
    '    ',
    coordinate(options.x),
    coordinate(options.y),
    coordinate(options.z),
    (options.occupancy ?? 1).toFixed(2).padStart(6),
    (options.bFactor ?? 0).toFixed(2).padStart(6),
    '          ',
    options.element.padStart(2),
  ].join('')
}

const FIRST_MODEL = [
  atomLine({ serial: 1, name: 'N', residue: 'ALA', chain: 'A', sequence: 1, x: 0, y: 0, z: 0, occupancy: 0.5, bFactor: 12, element: 'N' }),
  atomLine({ serial: 2, name: 'CA', residue: 'ALA', chain: 'A', sequence: 1, x: 1, y: 0, z: 0, bFactor: 18, element: 'C' }),
]

const SECOND_MODEL = [
  atomLine({ serial: 1, name: 'N', residue: 'ALA', chain: 'A', sequence: 1, x: 0, y: 1, z: 0, occupancy: 0.5, bFactor: 12, element: 'N' }),
  atomLine({ serial: 2, name: 'CA', residue: 'ALA', chain: 'A', sequence: 1, x: 1, y: 1, z: 0, bFactor: 18, element: 'C' }),
]

const PDB = [
  'TITLE     STORE IMPORT FIXTURE',
  'MODEL        1',
  ...FIRST_MODEL,
  'ENDMDL',
  'MODEL        2',
  ...SECOND_MODEL,
  'ENDMDL',
  'CONECT    1    2',
  'END',
].join('\n')

function layer(name: string): Omit<BioLayer, 'id'> {
  return {
    name,
    selection: 'chain A',
    representation: 'cartoon',
    color: { mode: 'scheme', scheme: 'chain' },
    visible: true,
    opacity: 0.7,
    scale: 1,
    bondScale: 1,
    shading: null,
    materialPresetId: null,
  }
}

describe('biomolecule viewport store', () => {
  it('clears only biomolecule-owned state when an ordinary edit converts the document', () => {
    const store = createCrystalStore()
    store.getState().loadBiomolecule(parseLegacyPdb(PDB, { inferBonds: false }))
    store.getState().addBioLayer(layer('Bio-only layer'))
    store.setState({
      presentationFrame: 9,
      presentationFrames: 30,
      cameraKeyframes: [{ id: 'shared-camera', frame: 3, position: [1, 2, 3], target: [0, 0, 0], easing: 'smooth' }],
    })

    store.getState().updateAtomElement(store.getState().atoms[0].id, 'C')

    expect(store.getState().bioStructure).toBeNull()
    expect(store.getState().bioLayers).toEqual([])
    expect(store.getState().presentationFrame).toBe(9)
    expect(store.getState().presentationFrames).toBe(30)
    expect(store.getState().cameraKeyframes.map((keyframe) => keyframe.id)).toEqual(['shared-camera'])
  })

  it('preserves shared presentation tracks across ordinary crystal atom and bond edits', () => {
    const store = createCrystalStore()
    store.setState({
      atoms: [
        { id: 'a', element: 'C', position: [0, 0, 0], cartesian: [0, 0, 0] },
        { id: 'b', element: 'C', position: [1.5, 0, 0], cartesian: [1.5, 0, 0] },
      ],
      presentationFrame: 8,
      presentationFrames: 24,
      cameraKeyframes: [{ id: 'crystal-camera', frame: 4, position: [3, 4, 5], target: [0, 0, 0], easing: 'smooth' }],
    })

    store.getState().updateAtomElement('a', 'N')
    store.getState().createBondBetweenAtoms('a', 'b')

    expect(store.getState().presentationFrame).toBe(8)
    expect(store.getState().presentationFrames).toBe(24)
    expect(store.getState().cameraKeyframes.map((keyframe) => keyframe.id)).toEqual(['crystal-camera'])
  })

  it('starts a biomolecule document without inherited camera or clipping state', () => {
    const store = createCrystalStore()
    store.setState({
      clippingEnabled: true,
      clippingAxis: 'x',
      clippingOffset: 14,
      clippingNormal: [1, 1, 0],
      volumeField: 'density',
      sliceEnabled: true,
      sliceClip: 'back',
      sliceIsolate: true,
      savedCameraState: { position: [80, 90, 100], target: [5, 6, 7], zoom: 3 },
      initialCameraPosition: [70, 60, 50],
      initialCameraLookAt: [7, 6, 5],
      initialCameraZoom: 6,
      cameraTarget: { position: [20, 21, 22], lookAt: [1, 2, 3], distance: 9 },
      isAnimatingCamera: true,
      focusedAtomIds: new Set(['old-atom']),
      massiveSceneVisualFocusAtomIds: new Set(['old-atom']),
      massiveSceneVisualFocusCenter: [3, 4, 5],
      massiveSceneVisualFocusDistance: 17,
    })
    const previousCameraDocument = store.getState().cameraAutoResetVersion

    store.getState().loadBiomolecule(parseLegacyPdb(PDB, { inferBonds: false }))

    expect(store.getState()).toMatchObject({
      clippingEnabled: false,
      clippingAxis: 'z',
      clippingOffset: 0,
      clippingNormal: null,
      volumeField: 'none',
      sliceEnabled: false,
      sliceClip: 'none',
      sliceIsolate: false,
      savedCameraState: null,
      initialCameraPosition: null,
      initialCameraLookAt: null,
      initialCameraZoom: null,
      cameraTarget: null,
      isAnimatingCamera: false,
      massiveSceneVisualFocusCenter: null,
      massiveSceneVisualFocusDistance: null,
    })
    expect(store.getState().focusedAtomIds).toEqual(new Set())
    expect(store.getState().massiveSceneVisualFocusAtomIds).toEqual(new Set())
    expect(store.getState().cameraAutoResetVersion).toBe(previousCameraDocument + 1)

    store.setState({
      clippingEnabled: true,
      clippingAxis: 'y',
      clippingOffset: 8,
      clippingNormal: [0, 1, 0],
      savedCameraState: { position: [71, 72, 73], target: [7, 8, 9], zoom: 12 },
      initialCameraPosition: [81, 82, 83],
      initialCameraLookAt: [8, 9, 10],
      initialCameraZoom: 13,
    })
    const sameDocumentCameraVersion = store.getState().cameraAutoResetVersion
    store.getState().setCompactStructure({
      positions: new Float32Array([1, 0, 0]),
      elementIndex: new Uint8Array([0]),
      elements: ['He'],
      count: 1,
      bbox: { min: [1, 0, 0], max: [1, 0, 0] },
    })
    expect(store.getState()).toMatchObject({
      clippingEnabled: true,
      clippingAxis: 'y',
      clippingOffset: 8,
      clippingNormal: [0, 1, 0],
      savedCameraState: { position: [71, 72, 73], target: [7, 8, 9], zoom: 12 },
      initialCameraPosition: [81, 82, 83],
      initialCameraLookAt: [8, 9, 10],
      initialCameraZoom: 13,
    })
    expect(store.getState().cameraAutoResetVersion).toBe(sameDocumentCameraVersion)
  })

  it('installs source-compatible subsystem defaults and normalizes numeric settings', () => {
    const store = createCrystalStore()
    expect(store.getState()).toMatchObject({
      bioShowCartoon: true,
      bioShowSticks: false,
      bioShowSpacefill: false,
      bioShowSurface: false,
      bioPolymerRepresentation: 'sticks',
      bioPolymerColor: { mode: 'inherit' },
      bioPolymerScale: 1.5,
      bioShowLigand: true,
      bioLigandRepresentation: 'ball-and-stick',
      bioLigandColor: { mode: 'scheme', scheme: 'element' },
      bioLigandScale: 2.2,
      bioShowIons: true,
      bioIonRepresentation: 'space-filling',
      bioIonColor: { mode: 'scheme', scheme: 'element' },
      bioIonScale: .55,
      bioShowPocket: false,
      bioPocketRadius: 5,
      bioPocketRepresentation: 'sticks',
      bioPocketColor: { mode: 'inherit' },
      bioPocketScale: 1,
      bioHideWater: true,
      bioShowSSBonds: false,
    })

    const color = { mode: 'custom' as const, value: '#123456' }
    store.getState().updateBioSettings({
      bioLigandColor: color,
      bioLigandScale: 100,
      bioIonScale: -1,
      bioPocketRadius: 100,
      bioPocketScale: Number.NaN,
      bioPolymerScale: 100,
    })
    color.value = '#ffffff'
    expect(store.getState()).toMatchObject({
      bioLigandColor: { mode: 'custom', value: '#123456' },
      bioLigandScale: 10,
      bioIonScale: .05,
      bioPocketRadius: 20,
      bioPocketScale: 1,
      bioPolymerScale: 10,
    })

    store.getState().updateBioSettings({
      bioCartoonQuality: 100,
      bioRibbonWidth: 0,
      bioRibbonThickness: 100,
    })
    expect(store.getState()).toMatchObject({
      bioCartoonQuality: 24,
      bioRibbonWidth: .4,
      bioRibbonThickness: 2.5,
    })

    // A temperature-factor PDB must never retain a pLDDT authoring choice:
    // the coloring implementation deliberately rejects that provenance error.
    store.getState().loadBiomolecule(parseLegacyPdb(PDB, { inferBonds: false }))
    expect(() => store.getState().updateBioSettings({ bioColorScheme: 'plddt' })).toThrow(/pLDDT/)
    expect(() => store.getState().updateBioSettings({
      bioLigandColor: { mode: 'scheme', scheme: 'plddt' },
    })).toThrow(/pLDDT/)
    expect(store.getState().bioColorScheme).toBe('viridis')
    expect(store.getState().bioLigandColor).toEqual({ mode: 'custom', value: '#123456' })
    expect(() => store.getState().addBioLayer({
      ...layer('Invalid pLDDT'),
      color: { mode: 'scheme', scheme: 'plddt' },
    })).toThrow(/pLDDT/)
    const layerId = store.getState().addBioLayer(layer('Provenance guard'))
    expect(() => store.getState().updateBioLayer(layerId, {
      color: { mode: 'scheme', scheme: 'plddt' },
    })).toThrow(/pLDDT/)
    expect(() => store.getState().updateBioLayer(layerId, {
      styleTrack: [{
        id: 'invalid-key', frame: 0, easing: 'smooth',
        patch: { color: { mode: 'scheme', scheme: 'plddt' } },
      }],
    })).toThrow(/pLDDT/)
    expect(store.getState().bioLayers[0].color).toEqual({ mode: 'scheme', scheme: 'chain' })

    // Explicit AlphaFold provenance enables the same choices; navigating back
    // to an experimental structure clears document-specific pLDDT state.
    store.getState().loadBiomolecule(parseLegacyPdb(PDB, { id: 'AF-TEST', inferBonds: false }))
    store.getState().updateBioSettings({
      bioColorScheme: 'plddt',
      bioLigandColor: { mode: 'scheme', scheme: 'plddt' },
    })
    store.getState().addBioLayer({
      ...layer('Valid pLDDT'),
      color: { mode: 'scheme', scheme: 'plddt' },
      styleTrack: [{
        id: 'valid-key', frame: 0, easing: 'smooth',
        patch: { color: { mode: 'scheme', scheme: 'plddt' } },
      }],
    })
    expect(store.getState().bioLayers[0].styleTrack?.[0].patch.color).toEqual({ mode: 'scheme', scheme: 'plddt' })
    store.getState().loadBiomolecule(parseLegacyPdb(PDB, { inferBonds: false }))
    expect(store.getState().bioColorScheme).toBe('viridis')
    expect(store.getState().bioLigandColor).toEqual({ mode: 'inherit' })
    expect(store.getState().bioLayers).toEqual([])
    store.getState().updateBioSettings({
      bioCartoonQuality: -100,
      bioRibbonWidth: 100,
      bioRibbonThickness: 0,
    })
    expect(store.getState()).toMatchObject({
      bioCartoonQuality: 4,
      bioRibbonWidth: 2,
      bioRibbonThickness: .3,
    })
  })

  it('installs parsed topology, explicit bonds and immutable canonical MODEL frames together', () => {
    const store = createCrystalStore()
    const structure = parseLegacyPdb(PDB, { id: 'fixture', inferBonds: false })

    store.getState().loadBiomolecule(structure)
    const state = store.getState()

    expect(state.bioStructure).toBe(structure)
    expect(state.periodic).toBe(false)
    expect(state.atoms.map((atom) => atom.id)).toEqual(structure.atoms.map((atom) => atom.id))
    expect(state.bonds).toEqual([{
      id: structure.bonds[0].id,
      atom1Id: structure.atoms[0].id,
      atom2Id: structure.atoms[1].id,
      type: 'single',
    }])
    expect(state.atoms[0].props?.occupancy).toEqual({ kind: 'scalar', value: 0.5 })
    expect(state.atoms[0].props?.bFactor).toEqual({ kind: 'scalar', value: 12 })
    expect(state.atoms[0].props?.['zatom.explicitBondTopology']).toEqual({ kind: 'scalar', value: 1 })
    expect(state.trajectoryTotalFrames).toBe(2)
    expect(state.trajectoryFormatLabel).toBe('PDB MODEL')
    expect(state.presentationFrames).toBe(2)
    expect(state.presentationFps).toBe(10)

    const canonicalFrames = structure.frames
    const canonicalDocument = structuredClone(structure)
    const canonicalPositions = structure.frames.map((frame) => [...frame.positions])
    const renderFrames = state.trajectoryFrames
    const renderFrameAtoms = structuredClone(renderFrames?.map((frame) => frame.atoms))
    const firstPosition = [...state.atoms[0].cartesian!]
    store.getState().setTrajectoryFrame(1)
    const second = store.getState()
    expect(second.atoms[0].cartesian).not.toEqual(firstPosition)
    expect(second.atoms[0].cartesian).toEqual([
      structure.frames[1].positions[0],
      structure.frames[1].positions[1],
      structure.frames[1].positions[2],
    ])
    expect(second.bonds).toEqual(state.bonds)
    expect(second.bioStructure).toBe(structure)
    expect(second.bioStructure?.frames).toBe(canonicalFrames)
    expect(second.bioStructure).toEqual(canonicalDocument)
    expect(second.bioStructure?.frames.map((frame) => [...frame.positions])).toEqual(canonicalPositions)
    expect(second.trajectoryFrames).toBe(renderFrames)
    expect(second.trajectoryFrames?.map((frame) => frame.atoms)).toEqual(renderFrameAtoms)

    store.getState().setPresentationFrames(11)
    store.getState().setPresentationFrame(0)
    expect(store.getState().trajectoryCurrentFrame).toBe(0)
    store.getState().setPresentationFrame(10)
    expect(store.getState().trajectoryCurrentFrame).toBe(1)
  })

  it('auto-sizes only on document load and restores static timeline defaults', () => {
    const store = createCrystalStore()
    store.getState().loadBiomolecule(parseLegacyPdb(PDB, { inferBonds: false }))
    expect(store.getState()).toMatchObject({ presentationFrames: 2, presentationFps: 10 })

    store.getState().setPresentationFrames(77)
    store.getState().setPresentationFps(42)
    store.getState().setTrajectoryFrame(1)
    expect(store.getState()).toMatchObject({ presentationFrames: 77, presentationFps: 42 })

    store.getState().loadBiomolecule(parseLegacyPdb(FIRST_MODEL.join('\n'), { inferBonds: false }))
    expect(store.getState()).toMatchObject({
      presentationFrame: 0,
      presentationFrames: 120,
      presentationFps: 24,
      trajectoryTotalFrames: 0,
    })
  })

  it('plays MODEL render frames without writing playback coordinates into the canonical document', () => {
    vi.useFakeTimers()
    try {
      const store = createCrystalStore()
      const structure = parseLegacyPdb(PDB, { id: 'playback-fixture', inferBonds: false })
      store.getState().loadBiomolecule(structure)
      store.getState().setPresentationFrames(2)

      const canonicalDocument = structuredClone(structure)
      const canonicalPositions = structure.frames.map((frame) => [...frame.positions])
      const renderFrames = store.getState().trajectoryFrames
      const renderFrameAtoms = structuredClone(renderFrames?.map((frame) => frame.atoms))
      store.getState().playTrajectory()
      // MODEL document initialization follows the source contract (10 fps).
      vi.advanceTimersByTime(100)

      const state = store.getState()
      expect(state.presentationFrame).toBe(1)
      expect(state.trajectoryCurrentFrame).toBe(1)
      expect(state.atoms[0].cartesian).toEqual([
        structure.frames[1].positions[0],
        structure.frames[1].positions[1],
        structure.frames[1].positions[2],
      ])
      expect(state.bioStructure).toBe(structure)
      expect(state.bioStructure).toEqual(canonicalDocument)
      expect(state.bioStructure?.frames.map((frame) => [...frame.positions])).toEqual(canonicalPositions)
      expect(state.trajectoryFrames).toBe(renderFrames)
      expect(state.trajectoryFrames?.map((frame) => frame.atoms)).toEqual(renderFrameAtoms)
      state.pausePresentation()
    } finally {
      vi.useRealTimers()
    }
  })

  it('records and evaluates camera plus global visual style as one presentation event', () => {
    const store = createCrystalStore()
    store.getState().setPresentationFrames(11)
    store.getState().setPresentationFrame(0)
    store.getState().setCrystalVisualSettings({ background: '#000000', ambientIntensity: 0.2 })
    store.getState().recordCameraAndBaseStyle({ position: [10, 0, 0], target: [0, 0, 0] })

    store.getState().setPresentationFrame(10)
    store.getState().setRenderStyle('cel')
    store.getState().setCrystalVisualSettings({ background: '#ffffff', ambientIntensity: 0.8 })
    store.getState().recordCameraAndBaseStyle({ position: [0, 10, 0], target: [0, 0, 0] })

    expect(store.getState().cameraKeyframes).toHaveLength(2)
    expect(store.getState().baseStyleKeyframes).toHaveLength(2)
    store.getState().setPresentationFrame(5)
    expect(store.getState().presentationStylePreview?.background.toLowerCase()).toBe('#000000')
    expect(store.getState().presentationStylePreview?.ambientIntensity).toBeCloseTo(0.5)
    expect(store.getState().presentationStylePreview?.renderStyle).toBe('vesta')
    store.getState().setPresentationFrame(10)
    expect(store.getState().presentationStylePreview?.background.toLowerCase()).toBe('#ffffff')
    expect(store.getState().presentationStylePreview?.renderStyle).toBe('cel')
  })

  it('hands MODEL playback ownership to the presentation timer before playing', () => {
    vi.useFakeTimers()
    const store = createCrystalStore()
    const trajectoryIntervalId = setInterval(() => undefined, 100)
    store.setState({ trajectoryPlaying: true, trajectoryIntervalId })

    store.getState().playPresentation()

    expect(store.getState().trajectoryPlaying).toBe(false)
    expect(store.getState().trajectoryIntervalId).toBeNull()
    expect(store.getState().presentationPlaying).toBe(true)
    store.getState().pausePresentation()
    vi.useRealTimers()
  })

  it('persists edits in the active MODEL frame and keeps undo in sync with biomolecular coordinates', () => {
    const store = createCrystalStore()
    const structure = parseLegacyPdb(PDB, { inferBonds: false })
    store.getState().loadBiomolecule(structure)
    store.getState().setTrajectoryFrame(1)

    const edited = store.getState().atoms.map((atom, index) => index === 0
      ? { ...atom, cartesian: [0, 2, 0] as [number, number, number] }
      : atom)
    store.getState().setAtomsDirectly(edited)
    expect(store.getState().bioStructure?.atoms[0].position).toEqual([0, 2, 0])
    expect(store.getState().bioStructure?.frames[0].positions[1]).toBe(0)
    expect(store.getState().bioStructure?.frames[1].positions[1]).toBe(2)
    expect(store.getState().trajectoryFrames?.[1].atoms[0].cartesian).toEqual([0, 2, 0])

    store.getState().setTrajectoryFrame(0)
    store.getState().setTrajectoryFrame(1)
    expect(store.getState().atoms[0].cartesian).toEqual([0, 2, 0])

    store.getState().undo()
    expect(store.getState().atoms[0].cartesian).toEqual([-0.5, 1, 0])
    expect(store.getState().bioStructure?.atoms[0].position).toEqual([-0.5, 0, 0])
    expect(store.getState().bioStructure?.frames[1].positions[1]).toBe(1)
    store.getState().redo()
    expect(store.getState().atoms[0].cartesian).toEqual([0, 2, 0])
    expect(store.getState().bioStructure?.atoms[0].position).toEqual([0, 2, 0])
    expect(store.getState().bioStructure?.frames[1].positions[1]).toBe(2)
  })

  it('restores the MODEL frame that owns an edit even after the playhead moves', () => {
    const store = createCrystalStore()
    store.getState().loadBiomolecule(parseLegacyPdb(PDB, { inferBonds: false }))
    store.getState().setTrajectoryFrame(1)
    const originalModelTwo = [...store.getState().atoms[0].cartesian!] as [number, number, number]
    const edited = store.getState().atoms.map((atom, index) => index === 0
      ? { ...atom, cartesian: [0, 3, 0] as [number, number, number] }
      : atom)
    store.getState().setAtomsDirectly(edited)

    store.getState().setTrajectoryFrame(0)
    store.getState().undo()

    expect(store.getState().trajectoryCurrentFrame).toBe(1)
    expect(store.getState().atoms[0].cartesian).toEqual(originalModelTwo)
    expect(store.getState().bioStructure?.frames[0].positions[1]).toBe(0)
    expect(store.getState().bioStructure?.frames[1].positions[1]).toBe(1)
    expect(store.getState().history[1].trajectoryCurrentFrame).toBe(1)
    expect(store.getState().history[1].biomoleculePresentation?.structure.frames[1].positions[1]).toBe(3)
    store.getState().redo()
    expect(store.getState().trajectoryCurrentFrame).toBe(1)
    expect(store.getState().atoms[0].cartesian).toEqual([0, 3, 0])
    expect(store.getState().canUndo()).toBe(true)

    store.getState().undo()
    expect(store.getState().trajectoryCurrentFrame).toBe(1)
    expect(store.getState().atoms[0].cartesian).toEqual(originalModelTwo)
    expect(store.getState().canRedo()).toBe(true)
  })

  it('undoes a biomolecular topology edit as one complete document transaction', () => {
    const store = createCrystalStore()
    store.getState().loadBiomolecule(parseLegacyPdb(PDB, { inferBonds: false }))
    store.getState().addBioLayer(layer('Identity-bound layer'))
    const atomId = store.getState().atoms[0].id

    store.getState().updateAtomElement(atomId, 'O')
    expect(store.getState().bioStructure).toBeNull()
    expect(store.getState().atoms[0].element).toBe('O')

    store.getState().undo()
    expect(store.getState().atoms[0].element).toBe('N')
    expect(store.getState().bioStructure?.atoms[0].element).toBe('N')
    expect(store.getState().bioLayers[0].name).toBe('Identity-bound layer')
    store.getState().redo()
    expect(store.getState().bioStructure).toBeNull()
    expect(store.getState().atoms[0].element).toBe('O')
  })

  it('offers durable layer CRUD without aliasing nested override objects', () => {
    const store = createCrystalStore()
    const first = store.getState().addBioLayer(layer('Focus'))
    const second = store.getState().duplicateBioLayer(first)

    expect(second).not.toBeNull()
    expect(store.getState().bioLayers.map((candidate) => candidate.name)).toEqual(['Focus', 'Focus copy'])
    expect(store.getState().bioLayers[0].color).not.toBe(store.getState().bioLayers[1].color)

    store.getState().updateBioLayer(first, { opacity: 5, name: '  Active  ' })
    expect(store.getState().bioLayers[0].opacity).toBe(1)
    expect(store.getState().bioLayers[0].name).toBe('Active')

    store.getState().moveBioLayer(1, 0)
    expect(store.getState().bioLayers[0].id).toBe(second)
    store.getState().removeBioLayer(first)
    expect(store.getState().bioLayers.map((candidate) => candidate.id)).toEqual([second])
  })

  it('clears biomolecular topology on document replacement but not same-document atom updates', async () => {
    const store = createCrystalStore()
    const structure = parseLegacyPdb(PDB, { inferBonds: false })
    store.getState().loadBiomolecule(structure)
    store.getState().addBioLayer(layer('Keep only while same document'))
    store.setState({
      presentationFrames: 20,
      presentationFrame: 17,
      cameraKeyframes: [{ id: 'old-camera', frame: 4, position: [1, 2, 3], target: [0, 0, 0], easing: 'smooth' }],
      savedCameraState: { position: [31, 32, 33], target: [1, 2, 3], zoom: 8 },
      initialCameraPosition: [21, 22, 23],
      initialCameraLookAt: [2, 3, 4],
      initialCameraZoom: 7,
    })
    const sameDocumentCameraVersion = store.getState().cameraAutoResetVersion

    store.getState().setAtomsDirectly(store.getState().atoms.map((atom) => ({ ...atom })))
    expect(store.getState().bioStructure).toBe(structure)
    expect(store.getState().bioLayers).toHaveLength(1)
    expect(store.getState().savedCameraState).toEqual({ position: [31, 32, 33], target: [1, 2, 3], zoom: 8 })
    expect(store.getState().initialCameraPosition).toEqual([21, 22, 23])
    expect(store.getState().initialCameraZoom).toBe(7)
    expect(store.getState().cameraAutoResetVersion).toBe(sameDocumentCameraVersion)

    const result = await store.getState().loadFromXYZ('1\nnew molecule\nHe 0 0 0\n')
    expect(result.success).toBe(true)
    expect(store.getState().bioStructure).toBeNull()
    expect(store.getState().bioLayers).toEqual([])
    expect(store.getState().presentationFrame).toBe(0)
    expect(store.getState().cameraKeyframes).toEqual([])
    expect(store.getState().trajectoryFrames).toBeNull()
    expect(store.getState().trajectoryFormatLabel).toBeNull()
    expect(store.getState().trajectoryMetadata).toEqual([])

    store.getState().loadBiomolecule(structure)
    store.getState().addBioLayer(layer('Old bio layer'))
    store.getState().addCrystalLayer({ name: 'Old crystal layer' })
    store.setState({ presentationFrames: 20, presentationFrame: 19, cameraKeyframes: [{
      id: 'replacement-camera', frame: 3, position: [2, 3, 4], target: [0, 0, 0], easing: 'smooth',
    }],
      clippingEnabled: true,
      clippingAxis: 'y',
      clippingOffset: -6,
      clippingNormal: [0, 1, 0],
      volumeField: 'elf',
      sliceEnabled: true,
      sliceClip: 'front',
      sliceIsolate: true,
      regionSeeds: new Float32Array([1, 2, 3]),
      showRegionSolids: true,
      hideAtomsInRegionView: true,
      showGrainColoring: true,
      molecularOrbital: {
        ...store.getState().molecularOrbital,
        sourceType: 'cub',
        sourceName: 'old.cub',
        cubData: {} as never,
      },
      savedCameraState: { position: [41, 42, 43], target: [4, 5, 6], zoom: 9 },
      initialCameraPosition: [11, 12, 13],
      initialCameraLookAt: [1, 2, 3],
      initialCameraZoom: 10,
    })
    const replacementCameraVersion = store.getState().cameraAutoResetVersion
    store.getState().replaceAtomsDirectly([])
    expect(store.getState().bioStructure).toBeNull()
    expect(store.getState().bioLayers).toEqual([])
    expect(store.getState().crystalLayers).toEqual([])
    expect(store.getState().trajectoryFrames).toBeNull()
    expect(store.getState().presentationFrame).toBe(0)
    expect(store.getState().cameraKeyframes).toEqual([])
    expect(store.getState()).toMatchObject({
      clippingEnabled: false,
      clippingAxis: 'z',
      clippingOffset: 0,
      clippingNormal: null,
      volumeField: 'none',
      sliceEnabled: false,
      sliceClip: 'none',
      sliceIsolate: false,
      savedCameraState: null,
      initialCameraPosition: null,
      initialCameraLookAt: null,
      initialCameraZoom: null,
    })
    expect(store.getState().regionSeeds).toBeNull()
    expect(store.getState().showRegionSolids).toBe(false)
    expect(store.getState().hideAtomsInRegionView).toBe(false)
    expect(store.getState().showGrainColoring).toBe(false)
    expect(store.getState().molecularOrbital.sourceType).toBeNull()
    expect(store.getState().cameraAutoResetVersion).toBe(replacementCameraVersion + 1)
  })

  it('clears biomolecular presentation state when a compact document replaces it', () => {
    const store = createCrystalStore()
    store.getState().loadBiomolecule(parseLegacyPdb(PDB, { inferBonds: false }))
    store.getState().addBioLayer(layer('Old layer'))
    store.setState({ presentationFrame: 23, cameraKeyframes: [{
      id: 'old-camera', frame: 2, position: [1, 2, 3], target: [0, 0, 0], easing: 'smooth',
    }],
      clippingEnabled: true,
      clippingAxis: 'x',
      clippingOffset: 19,
      clippingNormal: [1, 0, 0],
      volumeField: 'bonding',
      sliceEnabled: true,
      sliceClip: 'back',
      sliceIsolate: true,
      regionSeeds: new Float32Array([4, 5, 6]),
      showRegionSolids: true,
      hideAtomsInRegionView: true,
      showGrainColoring: true,
      molecularOrbital: {
        ...store.getState().molecularOrbital,
        sourceType: 'molden',
        sourceName: 'old.molden',
        moldenData: {} as never,
      },
      savedCameraState: { position: [51, 52, 53], target: [5, 6, 7], zoom: 4 },
      initialCameraPosition: [61, 62, 63],
      initialCameraLookAt: [6, 7, 8],
      initialCameraZoom: 5,
    })
    const previousCameraDocument = store.getState().cameraAutoResetVersion

    store.getState().replaceCompactStructure({
      positions: new Float32Array([0, 0, 0]),
      elementIndex: new Uint8Array([0]),
      elements: ['He'],
      count: 1,
      bbox: { min: [0, 0, 0], max: [0, 0, 0] },
    })

    expect(store.getState().bioStructure).toBeNull()
    expect(store.getState().periodic).toBe(false)
    expect(store.getState().atoms).toEqual([])
    expect(store.getState().unitCellAtoms).toEqual([])
    expect(store.getState().bonds).toEqual([])
    expect(store.getState().bioLayers).toEqual([])
    expect(store.getState().presentationFrame).toBe(0)
    expect(store.getState().cameraKeyframes).toEqual([])
    expect(store.getState()).toMatchObject({
      clippingEnabled: false,
      clippingAxis: 'z',
      clippingOffset: 0,
      clippingNormal: null,
      volumeField: 'none',
      sliceEnabled: false,
      sliceClip: 'none',
      sliceIsolate: false,
      savedCameraState: null,
      initialCameraPosition: null,
      initialCameraLookAt: null,
      initialCameraZoom: null,
    })
    expect(store.getState().regionSeeds).toBeNull()
    expect(store.getState().showRegionSolids).toBe(false)
    expect(store.getState().hideAtomsInRegionView).toBe(false)
    expect(store.getState().showGrainColoring).toBe(false)
    expect(store.getState().molecularOrbital.sourceType).toBeNull()
    expect(store.getState().cameraAutoResetVersion).toBe(previousCameraDocument + 1)
  })
})

describe('unified PDB import', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('exposes the authoritative eleven RCSB examples through the canonical importer', () => {
    expect(RCSB_BIOMOLECULE_EXAMPLES.map((example) => example.id)).toEqual([
      '1CRN', '4HHB', '1BNA', '6LU7', '1UBQ', '2PTC',
      '1CA2', '2SOD', '1MBO', '1ZNF', '1AZU',
    ])
  })

  it('writes only the active viewport store', async () => {
    const manager = useViewportManager.getState()
    manager.setLayout('1x2')
    const first = manager.getViewportStore('vp-1')!
    const second = manager.getViewportStore('vp-2')!
    first.getState().clearStructure()
    second.getState().clearStructure()
    manager.setActive('vp-2')

    const result = await importUnifiedStructureText('fixture.pdb', PDB)

    expect(result.success).toBe(true)
    expect(result.success && result.mode).toBe('bio')
    expect(first.getState().bioStructure).toBeNull()
    expect(second.getState().bioStructure?.title).toBe('fixture.pdb')
    expect(getActiveViewportStoreApi()).toBe(second)

    manager.setLayout('1x1')
    manager.setActive('vp-1')
  })

  it('keeps the existing viewport untouched when PDB validation fails', async () => {
    const store = getActiveViewportStoreApi()
    store.getState().replaceAtomsDirectly([{
      id: 'existing',
      element: 'He',
      position: [0, 0, 0],
      cartesian: [0, 0, 0],
    }])

    const result = await importUnifiedStructureText('broken.pdb', 'ATOM malformed')

    expect(result.success).toBe(false)
    expect(store.getState().atoms.map((atom) => atom.id)).toEqual(['existing'])
    expect(store.getState().bioStructure).toBeNull()
  })

  it('rejects invalid RCSB IDs before network access', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchRcsbPdbStructure('1CRN.pdb')).resolves.toEqual({
      success: false,
      error: 'Enter a four-character PDB ID.',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fetches only bounded PDB media and parses a secondary structure without replacing the viewport', async () => {
    const store = getActiveViewportStoreApi()
    store.getState().replaceAtomsDirectly([{
      id: 'active-document',
      element: 'He',
      position: [0, 0, 0],
      cartesian: [0, 0, 0],
    }])
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('<html>gateway</html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }))
      .mockResolvedValueOnce(new Response(PDB, {
        status: 200,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchRcsbPdbStructure('1crn')).resolves.toEqual({
      success: false,
      error: 'RCSB returned unsupported Content-Type text/html.',
    })
    const result = await fetchRcsbPdbStructure('1crn')
    expect(result.success).toBe(true)
    expect(result.success && result.pdbId).toBe('1CRN')
    expect(result.success && result.structure.title).toBe('1CRN.pdb')
    expect(store.getState().atoms.map((atom) => atom.id)).toEqual(['active-document'])
    expect(store.getState().bioStructure).toBeNull()
    expect(fetchMock).toHaveBeenLastCalledWith(
      'https://files.rcsb.org/download/1CRN.pdb',
      { headers: { Accept: 'text/plain' } },
    )
  })

  it('installs the same canonical RCSB result for an ordinary document import', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(PDB, {
      status: 200,
      headers: { 'Content-Type': 'chemical/x-pdb' },
    })))

    const result = await importRcsbPdb('1crn')
    expect(result.success).toBe(true)
    expect(result.success && result.mode).toBe('bio')
    expect(getActiveViewportStoreApi().getState().bioStructure?.title).toBe('1CRN.pdb')
  })

  it('loads the bundled synthetic MODEL demo through the canonical PDB installer', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(PDB, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    })))
    await expect(importBundledBiomoleculePdb('/outside/demo.pdb', 'DEMO')).resolves.toEqual({
      success: false,
      error: 'Unsupported bundled PDB path.',
    })
    const result = await importBundledBiomoleculePdb('/trajectories/demo.pdb', 'DEMO')
    expect(result.success).toBe(true)
    expect(result.success && result.mode).toBe('bio')
    expect(getActiveViewportStoreApi().getState().bioStructure?.id).toBe('DEMO')
  })

  it('rejects an oversized RCSB response before reading its body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(PDB, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain',
        'Content-Length': String(RCSB_PDB_MAX_BYTES + 1),
      },
    })))

    await expect(fetchRcsbPdbStructure('1CRN')).resolves.toEqual({
      success: false,
      error: 'RCSB response exceeds the 50 MB PDB limit.',
    })
  })
})
