import { createCrystalStore } from '../orchestration/crystalStore'
import { assertEqual } from '../testing/assert'

async function run() {
  const store = createCrystalStore()
  const molecularOrbital = store.getState().molecularOrbital
  store.setState({
    atoms: [{ id: 'C-1', element: 'C', position: [0, 0, 0], cartesian: [0, 0, 0] }],
    unitCellAtoms: [{ id: 'C-1', element: 'C', position: [0, 0, 0], cartesian: [0, 0, 0] }],
    bonds: [{ id: 'bond-1', atom1Id: 'C-1', atom2Id: 'H-1', type: 'single' }],
    selectedAtomIds: new Set(['C-1']),
    selectedBondIds: new Set(['bond-1']),
    focusedAtomIds: new Set(['C-1']),
    measurementMode: 'distance',
    pendingMeasurementAtoms: ['C-1'],
    measurements: [{ id: 'measurement-1', type: 'distance', atomIds: ['C-1', 'H-1'], value: 1 }],
    pendingBondAtomId: 'C-1',
    atomAttributes: { 'C-1': { bader_charge: -0.2 } },
    clippingEnabled: true,
    clippingAxis: 'x',
    clippingOffset: 5,
    clippingNormal: [1, 0, 0],
    volumeField: 'elf',
    sliceEnabled: true,
    sliceClip: 'front',
    sliceIsolate: true,
    periodic: true,
    molecularOrbital: {
      ...molecularOrbital,
      sourceType: 'cub',
      sourceName: 'density.cube',
      cubData: { values: new Float32Array([0.2]) } as unknown as NonNullable<typeof molecularOrbital.cubData>,
      visible: true,
    },
    constructedPlane: {
      id: 'plane-before-clear',
      points: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
      normal: [0, 0, 1],
      d: 0,
      center: [0, 0, 0],
      method: 'direct',
      sourceIds: ['C-1'],
    },
    savedCameraState: { position: [20, 21, 22], target: [2, 3, 4], zoom: 9 },
    initialCameraPosition: [9, 8, 7],
    initialCameraLookAt: [1, 2, 3],
    initialCameraZoom: 6,
    cameraTarget: { position: [3, 4, 5], lookAt: [1, 2, 3], distance: 4 },
    isAnimatingCamera: true,
  })
  const previousCameraDocument = store.getState().cameraAutoResetVersion
  store.getState().bindToFrame('workspace', 'batch', 'frame')

  store.getState().clearStructure()
  await new Promise<void>((resolve) => queueMicrotask(resolve))

  const state = store.getState()
  assertEqual(state.atoms.length, 0, 'Blank Structure must clear atoms')
  assertEqual(state.unitCellAtoms.length, 0, 'Blank Structure must clear the unit cell')
  assertEqual(state.bonds.length, 0, 'Blank Structure must clear bonds')
  assertEqual(state.measurements.length, 0, 'Blank Structure must clear measurements')
  assertEqual(state.measurementMode, 'none', 'Blank Structure must release the measurement pointer')
  assertEqual(state.selectedAtomIds.size, 0, 'Blank Structure must clear selections')
  assertEqual(state.pendingBondAtomId, null, 'Blank Structure must clear pending bond state')
  assertEqual(state.boundFrameRef, null, 'Blank Structure must detach from the previous Asset')
  assertEqual(state.boundFrameDirty, false, 'Blank Structure must not dirty the previous Asset')
  assertEqual(Object.keys(state.atomAttributes).length, 0, 'Blank Structure must clear per-atom metadata')
  assertEqual(state.supercellParams.nx, 1, 'Blank Structure must restore a 1×1×1 editing cell')
  assertEqual(state.periodic, false, 'Blank Structure must not retain periodicity from the cleared document')
  assertEqual(state.molecularOrbital.cubData, null, 'Blank Structure must clear attached CUBE data')
  assertEqual(state.molecularOrbital.colorField, null, 'Blank Structure must clear attached surface color data')
  assertEqual(state.constructedPlane, null, 'Blank Structure must clear the constructed plane')
  assertEqual(state.clippingEnabled, false, 'Blank Structure must stop inherited global clipping')
  assertEqual(state.clippingAxis, 'z', 'Blank Structure must restore the default clipping axis')
  assertEqual(state.clippingOffset, 0, 'Blank Structure must clear the inherited clipping offset')
  assertEqual(state.clippingNormal, null, 'Blank Structure must clear an arbitrary clipping normal')
  assertEqual(state.volumeField, 'none', 'Blank Structure must clear the inherited volume field')
  assertEqual(state.sliceEnabled, false, 'Blank Structure must stop the inherited scalar slice')
  assertEqual(state.sliceClip, 'none', 'Blank Structure must stop inherited scalar clipping')
  assertEqual(state.sliceIsolate, false, 'Blank Structure must stop inherited slice isolation')
  assertEqual(state.savedCameraState, null, 'Blank Structure must discard the previous document camera')
  assertEqual(state.initialCameraPosition, null, 'Blank Structure must discard the previous document framing')
  assertEqual(state.initialCameraLookAt, null, 'Blank Structure must discard the previous document target')
  assertEqual(state.initialCameraZoom, null, 'Blank Structure must discard the previous orthographic framing')
  assertEqual(state.cameraTarget, null, 'Blank Structure must clear an in-flight focus target')
  assertEqual(state.isAnimatingCamera, false, 'Blank Structure must stop an in-flight focus animation')
  assertEqual(state.cameraAutoResetVersion, previousCameraDocument + 1, 'Blank Structure must request fresh framing once')
  assertEqual(state.canUndo(), true, 'Blank Structure must remain undoable')

  const blankVersion = state.cameraAutoResetVersion
  state.addAtomToSupercell('C', [0, 0, 0])
  assertEqual(
    store.getState().cameraAutoResetVersion,
    blankVersion + 1,
    'the first atom in a blank document must establish a fresh Home framing',
  )
  const populatedVersion = store.getState().cameraAutoResetVersion
  store.getState().addAtomToSupercell('H', [1, 0, 0])
  assertEqual(
    store.getState().cameraAutoResetVersion,
    populatedVersion,
    'editing an already populated document must preserve the current view',
  )
}

run()
  .then(() => console.log('clear structure tests passed'))
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
