import { assertEqual, assertTrue } from '../testing/assert'
import { createCrystalStore } from '../orchestration/crystalStore'

async function testExtendedXyzConvertsCartesianWithRowVectorLattice() {
  const store = createCrystalStore()
  const xyz = [
    '1',
    'Lattice="2 0 0 1 2 0 0 0 3" Label="skew"',
    'Si 1.0 1.0 1.5',
  ].join('\n')
  store.setState({
    measurementMode: 'distance',
    measurements: [{ id: 'old-measurement', type: 'distance', atomIds: ['old-a', 'old-b'], value: 99 }],
    pendingMeasurementAtoms: ['old-a'],
    pendingBondAtomId: 'old-a',
    constructedPlane: {
      id: 'old-plane',
      points: [],
      normal: [1, 0, 0],
      d: 0,
      center: [0, 0, 0],
      method: 'miller',
      sourceIds: ['miller-1-0-0'],
    },
    show2DPlaneView: true,
    clippingEnabled: true,
    clippingAxis: 'x',
    clippingOffset: 7,
    clippingNormal: [1, 0, 0],
    volumeField: 'density',
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
    savedCameraState: { position: [99, 98, 97], target: [1, 2, 3], zoom: 11 },
    initialCameraPosition: [90, 80, 70],
    initialCameraLookAt: [1, 1, 1],
    initialCameraZoom: 12,
    cameraTarget: { position: [8, 9, 10], lookAt: [1, 2, 3], distance: 4 },
    isAnimatingCamera: true,
  })
  const previousCameraDocument = store.getState().cameraAutoResetVersion

  const result = await store.getState().loadFromXYZ(xyz)

  assertEqual(result.success, true)
  const atom = store.getState().unitCellAtoms[0]
  assertTrue(Math.abs(atom.position[0] - 0.25) < 1e-6, `fx=${atom.position[0]}`)
  assertTrue(Math.abs(atom.position[1] - 0.5) < 1e-6, `fy=${atom.position[1]}`)
  assertTrue(Math.abs(atom.position[2] - 0.5) < 1e-6, `fz=${atom.position[2]}`)
  assertEqual(store.getState().measurementMode, 'none', 'loading a structure must exit measurement mode')
  assertEqual(store.getState().measurements.length, 0, 'loading a structure must clear measurements from the previous document')
  assertEqual(store.getState().pendingBondAtomId, null, 'loading a structure must clear pending bond state')
  assertEqual(store.getState().constructedPlane, null, 'loading a structure must clear the previous document plane')
  assertEqual(store.getState().show2DPlaneView, false, 'loading a structure must close the old plane view')
  assertEqual(store.getState().clippingEnabled, false, 'loading a structure must stop old plane clipping')
  assertEqual(store.getState().clippingAxis, 'z', 'loading a structure must restore the default clipping axis')
  assertEqual(store.getState().clippingOffset, 0, 'loading a structure must clear the old clipping offset')
  assertEqual(store.getState().clippingNormal, null, 'loading a structure must clear the old clipping normal')
  assertEqual(store.getState().volumeField, 'none', 'loading a raw structure must clear the old volume field')
  assertEqual(store.getState().sliceEnabled, false, 'loading a raw structure must stop the old scalar slice')
  assertEqual(store.getState().sliceClip, 'none', 'loading a raw structure must stop old scalar clipping')
  assertEqual(store.getState().sliceIsolate, false, 'loading a raw structure must stop old slice isolation')
  assertEqual(store.getState().regionSeeds, null, 'loading a raw structure must clear old region geometry')
  assertEqual(store.getState().showRegionSolids, false, 'loading a raw structure must stop old region rendering')
  assertEqual(store.getState().hideAtomsInRegionView, false, 'loading a raw structure must reveal the new atoms')
  assertEqual(store.getState().showGrainColoring, false, 'loading a raw structure must clear old grain coloring')
  assertEqual(store.getState().molecularOrbital.sourceType, null, 'loading a raw structure must clear old orbital data')
  assertEqual(store.getState().savedCameraState, null, 'loading a structure must not restore the previous document camera')
  assertEqual(store.getState().initialCameraPosition, null, 'loading a structure must discard the previous framing extent')
  assertEqual(store.getState().initialCameraLookAt, null, 'loading a structure must discard the previous framing target')
  assertEqual(store.getState().initialCameraZoom, null, 'loading a structure must discard the previous orthographic framing')
  assertEqual(store.getState().cameraTarget, null, 'loading a structure must clear an in-flight focus target')
  assertEqual(store.getState().isAnimatingCamera, false, 'loading a structure must stop an in-flight focus animation')
  assertTrue(store.getState().cameraAutoResetVersion > previousCameraDocument, 'loading a structure must request fresh framing')
}

async function testXyzEditPreservesViewportComposition() {
  const inputs = [
    '1\nrebuilt molecule\nHe 2 3 4\n',
    '1\nLattice="5 0 0 0 5 0 0 0 5" Label="rebuilt crystal"\nHe 2 3 4\n',
  ]

  for (const xyz of inputs) {
    const store = createCrystalStore()
    const savedCameraState = {
      position: [20, 21, 22] as [number, number, number],
      target: [1, 2, 3] as [number, number, number],
      zoom: 6,
    }
    const cameraTarget = {
      position: [10, 11, 12] as [number, number, number],
      lookAt: [1, 2, 3] as [number, number, number],
      distance: 8,
    }
    const constructedPlane = {
      id: 'edit-plane',
      points: [],
      normal: [0, 1, 0] as [number, number, number],
      d: 0,
      center: [0, 0, 0] as [number, number, number],
      method: 'miller' as const,
      sourceIds: ['miller-0-1-0'],
    }
    store.setState({
      savedCameraState,
      initialCameraPosition: [30, 31, 32],
      initialCameraLookAt: [3, 4, 5],
      initialCameraZoom: 9,
      cameraTarget,
      isAnimatingCamera: true,
      cameraAutoResetVersion: 17,
      presentationFrame: 11,
      presentationFrames: 40,
      cameraKeyframes: [{ id: 'edit-camera', frame: 3, position: [2, 3, 4], target: [0, 0, 0], easing: 'smooth' }],
      constructedPlane,
      show2DPlaneView: true,
      clippingEnabled: true,
      clippingAxis: 'y',
      clippingOffset: -4,
      clippingNormal: [0, 1, 0],
      volumeField: 'elf',
      sliceEnabled: true,
      sliceClip: 'back',
      sliceIsolate: true,
    })
    const historyLength = store.getState().history.length

    const result = await store.getState().loadFromXYZ(xyz, { documentMode: 'edit' })

    assertEqual(result.success, true, 'valid XYZ rebuild must succeed')
    assertEqual(store.getState().savedCameraState, savedCameraState, 'an XYZ edit must preserve the live camera pose')
    assertEqual(store.getState().initialCameraPosition?.[0], 30, 'an XYZ edit must preserve the Home pose')
    assertEqual(store.getState().initialCameraZoom, 9, 'an XYZ edit must preserve the Home zoom')
    assertEqual(store.getState().cameraTarget, cameraTarget, 'an XYZ edit must not replace an in-flight camera target')
    assertEqual(store.getState().isAnimatingCamera, true, 'an XYZ edit must not stop current camera motion')
    assertEqual(store.getState().cameraAutoResetVersion, 17, 'an XYZ edit must not request a document fit')
    assertEqual(store.getState().constructedPlane, constructedPlane, 'an XYZ edit must preserve the active plane')
    assertEqual(store.getState().show2DPlaneView, true, 'an XYZ edit must preserve the plane view')
    assertEqual(store.getState().clippingEnabled, true, 'an XYZ edit must preserve global clipping')
    assertEqual(store.getState().clippingAxis, 'y', 'an XYZ edit must preserve the clipping axis')
    assertEqual(store.getState().clippingOffset, -4, 'an XYZ edit must preserve the clipping offset')
    assertEqual(store.getState().volumeField, 'elf', 'an XYZ edit must preserve the volume field')
    assertEqual(store.getState().sliceEnabled, true, 'an XYZ edit must preserve the scalar slice')
    assertEqual(store.getState().sliceClip, 'back', 'an XYZ edit must preserve scalar clipping')
    assertEqual(store.getState().sliceIsolate, true, 'an XYZ edit must preserve slice isolation')
    assertEqual(store.getState().presentationFrame, 11, 'an XYZ edit must preserve the presentation playhead')
    assertEqual(store.getState().cameraKeyframes[0]?.id, 'edit-camera', 'an XYZ edit must preserve presentation tracks')
    assertEqual(store.getState().history.length, historyLength + 1, 'an XYZ edit must create exactly one Undo entry')
  }
}

async function testXyzPreviewDoesNotCreateUndoHistory() {
  const store = createCrystalStore()
  store.setState({
    atoms: [{ id: 'old', element: 'He', position: [0, 0, 0], cartesian: [0, 0, 0] }],
    savedCameraState: { position: [20, 21, 22], target: [1, 2, 3], zoom: 6 },
    clippingEnabled: true,
    volumeField: 'elf',
    presentationFrame: 7,
    cameraKeyframes: [{ id: 'preview-camera', frame: 2, position: [1, 2, 3], target: [0, 0, 0], easing: 'smooth' }],
  })
  const history = store.getState().history
  const cameraVersion = store.getState().cameraAutoResetVersion

  const result = await store.getState().loadFromXYZ(
    '1\nslab preview\nHe 2 3 4\n',
    { documentMode: 'preview' },
  )

  assertEqual(result.success, true, 'valid XYZ preview must succeed')
  assertEqual(store.getState().history, history, 'an XYZ preview must not create Undo history')
  assertEqual(store.getState().cameraAutoResetVersion, cameraVersion, 'an XYZ preview must not fit the camera')
  assertEqual(store.getState().clippingEnabled, true, 'an XYZ preview must preserve clipping')
  assertEqual(store.getState().volumeField, 'elf', 'an XYZ preview must preserve the volume composition')
  assertEqual(store.getState().presentationFrame, 7, 'an XYZ preview must preserve the presentation playhead')
  assertEqual(store.getState().cameraKeyframes[0]?.id, 'preview-camera', 'an XYZ preview must preserve presentation tracks')
}

async function testXyzRebuildRejectsNonOrdinaryDocumentsAtomically() {
  const compactStore = createCrystalStore()
  const compact = {
    positions: new Float32Array([0, 0, 0]),
    elementIndex: new Uint8Array([0]),
    elements: ['He'],
    count: 1,
    bbox: { min: [0, 0, 0] as [number, number, number], max: [0, 0, 0] as [number, number, number] },
  }
  compactStore.setState({
    compactStructure: compact,
    savedCameraState: { position: [3, 4, 5], target: [0, 0, 0] },
    clippingEnabled: true,
  })
  const compactResult = await compactStore.getState().loadFromXYZ(
    '1\ninvalid compact edit boundary\nHe 1 2 3\n',
    { documentMode: 'edit' },
  )
  assertEqual(compactResult.success, false, 'compact documents must reject an XYZ edit')
  assertEqual(compactStore.getState().compactStructure, compact, 'a rejected compact edit must preserve its document')
  assertEqual(compactStore.getState().savedCameraState?.position[0], 3, 'a rejected compact edit must preserve its camera')
  assertEqual(compactStore.getState().clippingEnabled, true, 'a rejected compact edit must preserve clipping')
}

async function testTemplateFitsItsFinalDefaultSupercell() {
  const store = createCrystalStore()
  const previousCameraDocument = store.getState().cameraAutoResetVersion

  const result = await store.getState().loadTemplate('diamond')

  assertEqual(result.success, true, 'the bundled diamond template must load')
  assertEqual(store.getState().supercellParams.nx, 2, 'diamond must install its 2x default supercell')
  assertEqual(store.getState().supercellParams.ny, 2, 'diamond must install its 2y default supercell')
  assertEqual(store.getState().supercellParams.nz, 2, 'diamond must install its 2z default supercell')
  assertEqual(
    store.getState().cameraAutoResetVersion,
    previousCameraDocument + 1,
    'the template must begin exactly one camera document after its final supercell is materialized',
  )
}

async function testCifStartsWithCleanDocumentViewportState() {
  const store = createCrystalStore()
  store.setState({
    clippingEnabled: true,
    clippingAxis: 'y',
    clippingOffset: -12,
    clippingNormal: [0, 1, 0],
    volumeField: 'bonding',
    sliceEnabled: true,
    sliceClip: 'back',
    sliceIsolate: true,
    savedCameraState: { position: [40, 50, 60], target: [4, 5, 6], zoom: 13 },
    initialCameraPosition: [12, 13, 14],
    initialCameraLookAt: [2, 3, 4],
    initialCameraZoom: 7,
  })
  const previousCameraDocument = store.getState().cameraAutoResetVersion
  const cif = `data_clean_document
_symmetry_space_group_name_H-M 'P 1'
_cell_length_a 4
_cell_length_b 4
_cell_length_c 4
_cell_angle_alpha 90
_cell_angle_beta 90
_cell_angle_gamma 90
loop_
 _symmetry_equiv_pos_site_id
 _symmetry_equiv_pos_as_xyz
  1 'x, y, z'
loop_
 _atom_site_type_symbol
 _atom_site_label
 _atom_site_fract_x
 _atom_site_fract_y
 _atom_site_fract_z
 _atom_site_occupancy
  He He0 0 0 0 1
`

  const result = await store.getState().loadFromCIF(cif)

  assertEqual(result.success, true, 'valid CIF must load')
  assertEqual(store.getState().clippingEnabled, false, 'CIF must stop inherited global clipping')
  assertEqual(store.getState().clippingAxis, 'z', 'CIF must restore the default clipping axis')
  assertEqual(store.getState().clippingOffset, 0, 'CIF must clear the inherited clipping offset')
  assertEqual(store.getState().clippingNormal, null, 'CIF must clear an arbitrary clipping normal')
  assertEqual(store.getState().volumeField, 'none', 'CIF must clear an inherited volume field')
  assertEqual(store.getState().sliceEnabled, false, 'CIF must stop an inherited scalar slice')
  assertEqual(store.getState().sliceClip, 'none', 'CIF must stop inherited scalar clipping')
  assertEqual(store.getState().sliceIsolate, false, 'CIF must stop inherited slice isolation')
  assertEqual(store.getState().savedCameraState, null, 'CIF must not restore the previous document camera')
  assertEqual(store.getState().initialCameraPosition, null, 'CIF must discard the previous document framing')
  assertEqual(store.getState().initialCameraZoom, null, 'CIF must discard the previous orthographic framing')
  assertTrue(store.getState().cameraAutoResetVersion > previousCameraDocument, 'CIF must request fresh framing')
}

async function testInvalidImportsDoNotDestroyCurrentCompactStructure() {
  const store = createCrystalStore()
  const compact = {
    positions: new Float32Array([0, 0, 0]),
    elementIndex: new Uint8Array([0]),
    elements: ['Cu'],
    count: 1,
    bbox: { min: [0, 0, 0] as [number, number, number], max: [0, 0, 0] as [number, number, number] },
  }
  const atom = {
    id: 'Cu-1',
    element: 'Cu',
    position: [0, 0, 0] as [number, number, number],
    cartesian: [0, 0, 0] as [number, number, number],
  }
  store.setState({ compactStructure: compact, atoms: [atom] })

  const xyzResult = await store.getState().loadFromXYZ('not an xyz file')
  assertEqual(xyzResult.success, false, 'invalid XYZ must fail')
  assertEqual(store.getState().compactStructure, compact, 'invalid XYZ must preserve the active compact structure')
  assertEqual(store.getState().atoms[0], atom, 'invalid XYZ must preserve the current atom structure')

  const cifResult = await store.getState().loadFromCIF('not a cif file')
  assertEqual(cifResult.success, false, 'invalid CIF must fail')
  assertEqual(store.getState().compactStructure, compact, 'invalid CIF must preserve the active compact structure')
  assertEqual(store.getState().atoms[0], atom, 'invalid CIF must preserve the current atom structure')
}

async function run() {
  await testExtendedXyzConvertsCartesianWithRowVectorLattice()
  await testXyzEditPreservesViewportComposition()
  await testXyzPreviewDoesNotCreateUndoHistory()
  await testXyzRebuildRejectsNonOrdinaryDocumentsAtomically()
  await testTemplateFitsItsFinalDefaultSupercell()
  await testCifStartsWithCleanDocumentViewportState()
  await testInvalidImportsDoNotDestroyCurrentCompactStructure()
  console.log('loaders XYZ tests passed')
}

void run()
