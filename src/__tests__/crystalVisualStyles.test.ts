import {
  STYLE_PRESET_BASE,
  STYLE_PRESETS,
  VESTA_ELEMENT_VISUALS,
  getDefaultCrystalElementVisual,
  resolvePolyhedronColor,
} from '../lib/render/crystal-visuals'
import { createVestaMaterial } from '../lib/render/stylized-material'
import type { CrystalStore } from '../orchestration/crystal-store-types'
import { createCrystalStore } from '../orchestration/crystalStore'
import { assertDeepEqual, assertEqual, assertTrue } from '../testing/assert'

const EXPECTED_PRESET_IDS = [
  'vesta', 'studio', 'flat', 'cel', 'glossy', 'qc-soft', 'qc-vivid', 'qc-fourlight',
  'matte', 'metal', 'dark', 'print', 'cpk',
  'pressed-space-fill', 'textbook', 'glasspoly', 'paperpoly', 'blueprint', 'neon', 'chalk', 'gooch',
  'hatch', 'manga', 'pearl', 'xray', 'thermal', 'toy', 'tron', 'watercolor',
  'crt', 'goochpoly', 'holopoly', 'gempoly', 'neonpoly', 'gempaper',
  'thermalpoly', 'obradinn', 'pixel8', 'riso', 'velvet', 'clay', 'risopoly',
]

function visualSnapshot(state: CrystalStore) {
  return {
    stylePresetId: state.stylePresetId,
    renderStyle: state.renderStyle,
    background: state.background,
    outline: state.outline,
    outlineWidth: state.outlineWidth,
    outlineColor: state.outlineColor,
    viewMode: state.viewMode,
    atomScale: state.atomScale,
    showBonds: state.showBonds,
    showCoordinationPolyhedra: state.showCoordinationPolyhedra,
    polyStyle: state.polyStyle,
    lightAzimuth: state.lightAzimuth,
    lightElevation: state.lightElevation,
  }
}

function run() {
  assertEqual(STYLE_PRESETS.length, 42, 'the migrated style catalog must remain complete')
  assertDeepEqual(STYLE_PRESETS.map((preset) => preset.id), EXPECTED_PRESET_IDS)
  assertEqual(new Set(STYLE_PRESETS.map((preset) => preset.id)).size, STYLE_PRESETS.length, 'preset ids must be unique')
  assertDeepEqual(VESTA_ELEMENT_VISUALS.Ti, { color: '#78caff', radius: 1.47 }, 'VESTA element visuals must stay independent of chemistry radii')
  assertEqual(getDefaultCrystalElementVisual('not-an-element').color, '#ff1493', 'unknown elements must retain the source visualizer fallback color')

  const material = createVestaMaterial({ color: '#ffffff', vertexColors: true })
  assertEqual(material.vertexColors, true, 'the shared style material must enable BufferGeometry vertex colors')
  assertTrue(
    !Object.prototype.hasOwnProperty.call(material.defines, 'USE_INSTANCING_COLOR'),
    'ordinary vertex colors must not be misbound to the instanceColor attribute',
  )
  assertTrue(
    Object.prototype.hasOwnProperty.call(material.defines, 'USE_VERTEX_COLOR'),
    'ordinary vertex colors must have a shader contract distinct from instance colors',
  )
  assertTrue(material.vertexShader.includes('#ifdef USE_VERTEX_COLOR'), 'the vertex shader must guard BufferGeometry colors independently')
  assertTrue(material.vertexShader.includes('vVertexColor = color.rgb'), 'the vertex shader must forward BufferGeometry color attributes')
  assertTrue(material.fragmentShader.includes('baseColor *= vVertexColor'), 'all stylized modes must receive ordinary vertex colors')
  assertEqual(material.clipping, true, 'the shared style material must participate in Three global and local clipping')
  assertEqual(material.vertexShader.includes('clipping_planes_vertex'), true, 'the vertex shader must forward clipping coordinates')
  assertEqual(material.fragmentShader.includes('clipping_planes_fragment'), true, 'the fragment shader must apply all active clipping planes')
  material.dispose()

  const instancedMaterial = createVestaMaterial({ color: '#ffffff', instanceColors: true })
  assertEqual(instancedMaterial.vertexColors, false, 'instance colors must not require a missing geometry color attribute')
  assertTrue(
    Object.prototype.hasOwnProperty.call(instancedMaterial.defines, 'USE_INSTANCING_COLOR'),
    'instance colors must select the colored shader before the first demand render',
  )
  assertTrue(instancedMaterial.vertexShader.includes('vInstanceColor = instanceColor'), 'the instance-color shader must forward instanceColor')
  assertTrue(instancedMaterial.fragmentShader.includes('baseColor *= vInstanceColor'), 'all stylized modes must receive instance colors')
  instancedMaterial.dispose()

  const store = createCrystalStore()
  const atoms = store.getState().atoms
  const bonds = store.getState().bonds
  const history = store.getState().history
  store.getState().setCrystalVisualSettings({ bondRadius: 0.24 })
  for (const preset of STYLE_PRESETS) {
    assertTrue(store.getState().applyCrystalStylePreset(preset.id), `${preset.id} must be applicable`)
    const state = store.getState()
    const expected = { ...STYLE_PRESET_BASE, ...preset.patch, stylePresetId: preset.id }
    const viewMode = expected.atomStyle === 'spacefill'
      ? 'space-fill'
      : expected.atomStyle === 'stick'
        ? 'stick'
        : expected.atomStyle === 'wireframe'
          ? 'wireframe'
          : 'ball-stick'
    assertDeepEqual({
      stylePresetId: state.stylePresetId,
      radiusScale: state.radiusScale,
      bondRadius: state.bondRadius,
      shadingMode: state.renderStyle,
      background: state.background,
      outline: state.outline,
      outlineWidth: state.outlineWidth,
      outlineColor: state.outlineColor,
      atomShininess: state.atomShininess,
      bondBicolor: state.bondBicolor,
      bondColor: state.bondColor,
      polyStyle: state.polyStyle,
      polyColorSource: state.polyColorSource,
      polyElementColors: state.polyElementColors,
      polyColor: state.polyColor,
      showPolyEdges: state.showPolyEdges,
      polyEdgeColor: state.polyEdgeColor,
      polyEdgeOpacity: state.polyEdgeOpacity,
      polySpecular: state.polySpecular,
      polyShininess: state.polyShininess,
      polyFresnel: state.polyFresnel,
      cellColor: state.cellColor,
      ambientIntensity: state.ambientIntensity,
      diffuseIntensity: state.diffuseIntensity,
      specularIntensity: state.specularIntensity,
      rimIntensity: state.rimIntensity,
      viewMode: state.viewMode,
      atomScale: state.atomScale,
      elementRadiusVariance: state.elementRadiusVariance,
      showBonds: state.showBonds,
      fusedAtomSurface: state.fusedAtomSurface,
      showPolyhedra: state.showCoordinationPolyhedra,
      polyOpacity: state.polyhedraOpacity,
      lightAzimuth: state.lightAzimuth,
      lightElevation: state.lightElevation,
    }, {
      stylePresetId: preset.id,
      radiusScale: expected.radiusScale,
      bondRadius: 0.24,
      shadingMode: expected.shadingMode,
      background: expected.background,
      outline: expected.outline,
      outlineWidth: expected.outlineWidth,
      outlineColor: expected.outlineColor,
      atomShininess: expected.atomShininess,
      bondBicolor: expected.bondBicolor,
      bondColor: expected.bondColor,
      polyStyle: expected.polyStyle,
      polyColorSource: expected.polyColorSource,
      polyElementColors: expected.polyElementColors,
      polyColor: expected.polyColor,
      showPolyEdges: expected.showPolyEdges,
      polyEdgeColor: expected.polyEdgeColor,
      polyEdgeOpacity: expected.polyEdgeOpacity,
      polySpecular: expected.polySpecular,
      polyShininess: expected.polyShininess,
      polyFresnel: expected.polyFresnel,
      cellColor: expected.cellColor,
      ambientIntensity: expected.ambientIntensity,
      diffuseIntensity: expected.diffuseIntensity,
      specularIntensity: expected.specularIntensity,
      rimIntensity: expected.rimIntensity,
      viewMode,
      atomScale: expected.atomStyle === 'spacefill' ? 0.8 : 2 * expected.radiusScale,
      elementRadiusVariance: 1,
      showBonds: expected.showBonds,
      fusedAtomSurface: expected.fusedAtomSurface,
      showPolyhedra: expected.showPolyhedra,
      polyOpacity: expected.polyOpacity,
      lightAzimuth: expected.lightAzimuth,
      lightElevation: expected.lightElevation,
    }, `${preset.id} must apply every migrated preset field`)
    assertTrue(state.atoms === atoms, `${preset.id} must not replace structure atoms`)
    assertTrue(state.bonds === bonds, `${preset.id} must not replace structure bonds`)
    assertTrue(state.history === history, `${preset.id} must not dirty model history`)
  }
  const beforeUnknown = visualSnapshot(store.getState())
  assertEqual(store.getState().applyCrystalStylePreset('not-a-preset'), false, 'unknown presets must fail explicitly')
  assertDeepEqual(visualSnapshot(store.getState()), beforeUnknown, 'unknown presets must leave visual state unchanged')

  store.getState().applyCrystalStylePreset('vesta')
  store.getState().setRenderStyle('cel')
  assertEqual(store.getState().stylePresetId, 'custom', 'manual shader changes must invalidate the preset label')

  const manualPresetEdits: Array<() => void> = [
    () => store.getState().setViewMode('space-fill'),
    () => store.getState().setAtomScale(0.7),
    () => store.getState().setElementRadiusVariance(0.4),
    () => store.getState().setBondScale(0.8),
    () => store.getState().setShowBonds(false),
    () => store.getState().setShowCoordinationPolyhedra(true),
    () => store.getState().setPolyhedraOpacity(0.5),
    () => store.getState().setLightAzimuth(80),
    () => store.getState().setLightElevation(10),
  ]
  for (const edit of manualPresetEdits) {
    store.getState().applyCrystalStylePreset('vesta')
    edit()
    assertEqual(store.getState().stylePresetId, 'custom', 'manual migrated settings must invalidate the preset label')
  }

  store.getState().setLightAmbient(0.2)
  store.getState().setLightKey(0.3)
  store.getState().setLightFill(0.4)
  store.getState().applyCrystalStylePreset('vesta')
  assertEqual(store.getState().lightAmbient, null, 'a preset must clear legacy ambient overrides')
  assertEqual(store.getState().lightKey, null, 'a preset must clear legacy key-light overrides')
  assertEqual(store.getState().lightFill, null, 'a preset must clear legacy fill-light overrides')

  store.getState().applyCrystalStylePreset('vesta')
  const firstVesta = visualSnapshot(store.getState())
  store.getState().applyCrystalStylePreset('thermalpoly')
  store.getState().applyCrystalStylePreset('vesta')
  assertDeepEqual(visualSnapshot(store.getState()), firstVesta, 'preset application must be deterministic')

  store.getState().applyCrystalStylePreset('textbook')
  store.getState().setElementVisualOverride('Ti', { color: '#123456', radius: 1.23 })
  store.getState().setPolyhedronElementColor('Ti', '#abcdef')
  assertEqual(
    resolvePolyhedronColor('Ti', 'atom', store.getState().elementOverrides, store.getState().polyElementColors, '#000000'),
    '#123456',
    'atom-linked polyhedra must follow the atom override palette',
  )
  assertEqual(
    resolvePolyhedronColor('Ti', 'element', store.getState().elementOverrides, store.getState().polyElementColors, '#000000'),
    '#abcdef',
    'the independent polyhedron palette must not overwrite atom colors',
  )
  assertEqual(
    resolvePolyhedronColor('Ti', 'uniform', store.getState().elementOverrides, store.getState().polyElementColors, '#fedcba'),
    '#fedcba',
    'uniform polyhedron color must ignore per-element palettes',
  )
  store.getState().setCrystalVisualSettings({
    radiusScale: 99,
    bondRadius: -1,
    polyEdgeOpacity: 2,
    polySpecular: -1,
    polyShininess: 500,
    polyFresnel: Number.NaN,
  })
  assertEqual(store.getState().polyEdgeOpacity, 1, 'edge opacity must clamp to the material range')
  assertEqual(store.getState().radiusScale, 1.2, 'source atom radius scale must clamp to its source UI range')
  assertEqual(store.getState().bondRadius, 0.02, 'source bond radius must clamp to its source UI range')
  assertEqual(store.getState().polySpecular, 0, 'polyhedron specular must clamp to the material range')
  assertEqual(store.getState().polyShininess, 100, 'polyhedron shininess must clamp to the supported range')
  assertEqual(store.getState().polyFresnel, 0, 'non-finite Fresnel input must preserve the prior finite value')
  store.getState().setCrystalVisualSettings({ bondRadius: 0.24 })
  store.getState().applyCrystalStylePreset('flat')
  assertEqual(store.getState().bondRadius, 0.24, 'source style presets must preserve the independently controlled bond radius')
  store.getState().resetCrystalVisualSettings()
  assertEqual(store.getState().stylePresetId, 'vesta')
  assertEqual(store.getState().renderStyle, 'vesta')
  assertEqual(store.getState().showCoordinationPolyhedra, false)
  assertEqual(store.getState().atomScale, 0.9)
  assertEqual(store.getState().radiusScale, 0.45)
  assertEqual(store.getState().bondRadius, 0.12)
  assertEqual(store.getState().showCellGrid, false)
  assertEqual(store.getState().elementRadiusVariance, 1)
  assertEqual(store.getState().bondScale, 1.5)
  assertEqual(store.getState().lightAmbient, null)
  assertEqual(Object.keys(store.getState().elementOverrides).length, 0)
  assertEqual(Object.keys(store.getState().polyElementColors).length, 0)
  store.getState().setViewMode('stick')
  assertEqual(store.getState().viewMode, 'stick', 'ordinary structures expose the source stick mode independently of HyperStick')
  store.getState().setCompactStructure({
    positions: new Float32Array([0, 0, 0]), elementIndex: new Uint8Array([0]), elements: ['C'], count: 1,
    bbox: { min: [0, 0, 0], max: [0, 0, 0] },
  })
  assertEqual(store.getState().viewMode, 'ball-stick', 'compact point clouds reject stick because they have no bond graph')
  store.getState().setViewMode('stick')
  assertEqual(store.getState().viewMode, 'ball-stick', 'direct compact-mode changes cannot bypass the no-bond guard')
  console.log('crystal visual style tests passed')
}

run()
