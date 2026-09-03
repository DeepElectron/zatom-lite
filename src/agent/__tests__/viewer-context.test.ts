import { assertDeepEqual, assertEqual, assertTrue } from '../../testing/assert'
import { getActiveViewportStoreApi } from '../../orchestration/ViewportContext'
import { useViewportManager } from '../../orchestration/viewportManager'
import { selectPendingReview, useAgentOperationReview } from '../../orchestration/agentOperationReviewStore'
import { useAgentProposalStore } from '../../orchestration/agentProposalStore'
import { abortChoreography, awaitChoreographyIdle } from '../../orchestration/modelingChoreographer'
import type { ZatomStructure, ZatomTrajectory } from '../contracts'
import { ZATOM_STRUCTURE_SCHEMA, ZATOM_TRAJECTORY_SCHEMA } from '../contracts'
import { fingerprintStructure } from '../structure-math'
import { buildStructureChangeSet } from '../operations'
import { fingerprintTrajectory } from '../trajectory'
import { applyStructureCandidate, applyTrajectoryCandidate, finalizeStructureCandidate } from '../candidate-tool'
import { buildLinearPolymer } from '../polymer'
import { ZATOM_OVITO_PTM_ANNOTATION_SCHEMA } from '../ovito-ptm-annotation'
import {
  ZATOM_SPGLIB_SYMMETRY_ANNOTATION_SCHEMA,
  ZATOM_SPGLIB_SYMMETRY_METADATA_KEY,
} from '../spglib-symmetry-annotation'
import {
  activeViewportToolContext,
  applyPendingProposal,
  clearActiveViewportWorkspace,
  commitActiveViewportStructure,
  discardPendingProposal,
  readActiveViewportStructure,
  readActiveViewportTrajectory,
  readActiveViewportWorkspaceIdentity,
  writeActiveViewportStructure,
  writeActiveViewportTrajectory,
} from '../viewer-context'

async function waitForReview(timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const review = selectPendingReview(useAgentOperationReview.getState())
    if (review) return review
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('Timed out waiting for Agent review')
}

async function waitForControlPhase(
  phase: 'idle' | 'animating' | 'awaiting_review' | 'manual_control',
  timeoutMs = 3_000,
) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const control = useAgentOperationReview.getState().control
    if (control.phase === phase) return control
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`Timed out waiting for Agent control phase ${phase}`)
}

async function testGuardedCommitRejectsStaleSourceBeforeWrite() {
  const source: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    atoms: [{ id: 'guarded', element: 'C', position: [0, 0, 0] }],
  }
  await writeActiveViewportStructure(source)
  const before = fingerprintStructure(readActiveViewportStructure()!)
  await getActiveViewportStoreApi().getState().updateAtomPosition('guarded', [0.2, 0, 0])
  const externallyEdited = fingerprintStructure(readActiveViewportStructure()!)
  let rejected = false
  try {
    await commitActiveViewportStructure({
      ...source,
      atoms: [{ id: 'guarded', element: 'C', position: [1, 0, 0] }],
    }, {
      expectedViewportId: useViewportManager.getState().activeViewportId,
      expectedStructureFingerprint: before,
    })
  } catch {
    rejected = true
  }
  assertTrue(rejected)
  assertEqual(fingerprintStructure(readActiveViewportStructure()!), externallyEdited)
}

async function testCancelledCameraFlightStopsImmediately() {
  useAgentOperationReview.setState({ control: { phase: 'idle' }, takeover: null })
  const structure: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    atoms: [{ id: 'camera-cancel', element: 'C', position: [0, 0, 0] }],
  }
  await writeActiveViewportStructure(structure)
  const controller = new AbortController()
  const flight = activeViewportToolContext.camera!.lookAt({
    target: { atomIds: ['camera-cancel'] },
    durationMs: 5_000,
  }, controller.signal)
  controller.abort(new Error('camera cancelled by caller'))
  let rejected = false
  try {
    await flight
  } catch (error) {
    rejected = error instanceof Error && error.message === 'camera cancelled by caller'
  }
  assertTrue(rejected)
  assertEqual(getActiveViewportStoreApi().getState().isAnimatingCamera, false)
  assertEqual(getActiveViewportStoreApi().getState().cameraTarget, null)
}

async function testGuardedCommitRechecksAtTheActualReplacementBoundary() {
  const source: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    atoms: [{ id: 'late-guarded', element: 'C', position: [0, 0, 0] }],
  }
  await writeActiveViewportStructure(source)
  const api = getActiveViewportStoreApi()
  const originalLoadFromXYZ = api.getState().loadFromXYZ
  const expectedFingerprint = fingerprintStructure(readActiveViewportStructure()!)
  api.setState({
    loadFromXYZ: async (content, options) => {
      await api.getState().updateAtomPosition('late-guarded', [0.3, 0, 0])
      return originalLoadFromXYZ(content, options)
    },
  })
  let rejected = false
  try {
    await commitActiveViewportStructure({
      ...source,
      atoms: [{ id: 'late-guarded', element: 'C', position: [2, 0, 0] }],
    }, {
      expectedViewportId: useViewportManager.getState().activeViewportId,
      expectedStructureFingerprint: expectedFingerprint,
    })
  } catch {
    rejected = true
  } finally {
    api.setState({ loadFromXYZ: originalLoadFromXYZ })
  }
  assertTrue(rejected)
  assertDeepEqual(readActiveViewportStructure()?.atoms[0].position, [0.3, 0, 0])
}

async function testCancellationWinsAtTheActualReplacementBoundary() {
  const source: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    atoms: [{ id: 'cancel-at-cas', element: 'C', position: [0, 0, 0] }],
  }
  await writeActiveViewportStructure(source)
  const api = getActiveViewportStoreApi()
  const originalLoadFromXYZ = api.getState().loadFromXYZ
  const controller = new AbortController()
  api.setState({
    loadFromXYZ: async (content, options) => {
      controller.abort(new Error('cancelled at compare-and-set'))
      return originalLoadFromXYZ(content, options)
    },
  })
  let rejected = false
  try {
    await commitActiveViewportStructure({
      ...source,
      atoms: [{ id: 'cancel-at-cas', element: 'N', position: [2, 0, 0] }],
    }, { signal: controller.signal })
  } catch (error) {
    rejected = error instanceof Error && error.message.includes('cancelled at compare-and-set')
  } finally {
    api.setState({ loadFromXYZ: originalLoadFromXYZ })
  }
  assertTrue(rejected, 'cancellation must be rechecked in loadFromXYZ beforeStructureReplace')
  assertDeepEqual(readActiveViewportStructure()?.atoms[0], source.atoms[0])
}

async function testCanonicalWritesOwnCompleteHistoryBoundary() {
  const first: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    atoms: [{ id: 'history-first', element: 'C', position: [0, 0, 0] }],
  }
  const second: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    atoms: [{ id: 'history-second', element: 'N', position: [1, 0, 0] }],
  }
  await writeActiveViewportStructure(first)
  const api = getActiveViewportStoreApi()
  api.getState().pushHistory()
  assertTrue(api.getState().history.length > 0)
  await writeActiveViewportStructure(second)
  assertEqual(api.getState().history.length, 0)
  assertEqual(api.getState().historyIndex, -1)

  const frames: ZatomTrajectory = {
    schemaVersion: ZATOM_TRAJECTORY_SCHEMA,
    atomIds: ['history-second'],
    coordinateMode: 'cartesian',
    frames: [
      { step: 0, timePs: 0, positions: [[1.1, 0, 0]] },
      { step: 1, timePs: 0.001, positions: [[1, 0, 0]] },
    ],
  }
  api.getState().pushHistory()
  await writeActiveViewportTrajectory(frames)
  assertEqual(api.getState().history.length, 0)
  assertEqual(api.getState().historyIndex, -1)

  clearActiveViewportWorkspace()
  assertEqual(readActiveViewportStructure(), null)
  assertEqual(readActiveViewportTrajectory(), null)
  assertEqual(api.getState().atoms.length, 0)
  assertEqual(api.getState().bonds.length, 0)
  assertEqual(api.getState().history.length, 0)
}

async function testArtifactIdsSurviveBrowserWrite() {
  const molecule: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    label: 'agent H2',
    atoms: [
      {
        id: 'agent-h-left',
        element: 'H',
        position: [0, 0, 0],
        properties: {
          charge: { kind: 'scalar', value: 0.1 },
          formalCharge: -1,
          'zatom.bio.chainId': 'A',
          'zatom.bio.residueName': 'H2',
          'zatom.bio.residueId': '1',
          'zatom.bio.atomName': 'H1',
          nested: { source: 'canonical-sidecar', values: [1, true, null] },
        },
      },
      {
        id: 'agent-h-right',
        element: 'H',
        position: [0.74, 0, 0],
        properties: {
          formalCharge: 0,
          'zatom.bio.chainId': 'A',
          'zatom.bio.residueName': 'H2',
          'zatom.bio.residueId': '1',
          'zatom.bio.atomName': 'H2',
        },
      },
    ],
    bonds: [{
      id: 'agent-h-bond',
      atomIds: ['agent-h-left', 'agent-h-right'],
      order: 1,
      properties: { source: 'explicit', constrained: true },
    }],
    metadata: { 'zatom.test.provenance': { engine: 'viewer-sidecar', version: 1 } },
  }
  await writeActiveViewportStructure(molecule)
  const roundTrip = readActiveViewportStructure()
  assertTrue(roundTrip !== null)
  assertDeepEqual(roundTrip?.atoms.map((atom) => atom.id), ['agent-h-left', 'agent-h-right'])
  assertEqual(roundTrip?.label, 'agent H2')
  assertDeepEqual(roundTrip?.atoms[0].properties, molecule.atoms[0].properties)
  assertDeepEqual(roundTrip?.atoms[1].properties, molecule.atoms[1].properties)
  assertDeepEqual(roundTrip?.bonds, molecule.bonds)
  assertDeepEqual(roundTrip?.metadata?.['zatom.test.provenance'], molecule.metadata?.['zatom.test.provenance'])
  assertEqual(fingerprintStructure(roundTrip!), fingerprintStructure(molecule))

  const changedProperty: ZatomStructure = {
    ...molecule,
    atoms: molecule.atoms.map((atom, index) => index === 0
      ? { ...atom, properties: { ...atom.properties, 'zatom.bio.atomName': 'changed' } }
      : atom),
  }
  assertTrue(fingerprintStructure(changedProperty) !== fingerprintStructure(molecule))
}

async function testCanonicalPtmAnnotationDrivesViewportOverlay() {
  const source: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    label: 'PTM source',
    atoms: [
      { id: 'ptm-a', element: 'Cu', position: [0, 0, 0] },
      { id: 'ptm-b', element: 'Cu', position: [2.55, 0, 0] },
    ],
  }
  await writeActiveViewportStructure(source)
  getActiveViewportStoreApi().setState({
    atomAttributes: {
      'ptm-a': { bader_charge: 0.2, ptmAnalyzed: true, ptmStructureType: 'bcc', ptmRmsd: 0.9 },
    },
  })
  const annotated: ZatomStructure = {
    ...source,
    label: 'PTM result',
    atoms: source.atoms.map((atom, index) => ({
      ...atom,
      properties: {
        'zatom.analysis.ptm.analyzed': true,
        'zatom.analysis.ptm.structureTypeId': index === 0 ? 1 : 0,
        'zatom.analysis.ptm.structureType': index === 0 ? 'fcc' : 'other',
        'zatom.analysis.ptm.rmsd': index === 0 ? 0.01 : 0.14,
        'zatom.analysis.ptm.orderingTypeId': index === 0 ? 1 : 0,
        'zatom.analysis.ptm.orderingType': index === 0 ? 'pure' : 'other',
        ...(index === 0 ? {
          'zatom.analysis.ptm.interatomicDistanceA': 2.55,
          'zatom.analysis.ptm.orientationXyzw': [0, 0, 0, 1],
          'zatom.analysis.ptm.elasticDeformationGradientColumnMajor': [1, 0, 0, 0, 1, 0, 0, 0, 1],
          'zatom.analysis.ptm.elasticGreenLagrangeStrainMagnitude': 0,
          'zatom.analysis.ptm.elasticVolumeRatio': 1,
        } : {}),
      },
    })),
    metadata: {
      'zatom.analysis.ptm': {
        schemaVersion: ZATOM_OVITO_PTM_ANNOTATION_SCHEMA,
        engine: 'OVITO',
        engineVersion: '3.15.5',
        numpyVersion: '2.4.6',
        packageSha256: `sha256:${'b'.repeat(64)}`,
        rmsdCutoff: 0.1,
        enabledStructureTypes: ['fcc', 'hcp', 'bcc'],
        analyzedAtomCount: 2,
        counts: {
          other: 1, fcc: 1, hcp: 0, bcc: 0, ico: 0, sc: 0,
          'cubic-diamond': 0, 'hexagonal-diamond': 0, graphene: 0,
        },
        recognizedFraction: 0.5,
        otherFraction: 0.5,
        maximumOtherFraction: 0.6,
        orderingEnabled: true,
        orderingCounts: {
          other: 1,
          pure: 1,
          l10: 0,
          'l12-a': 0,
          'l12-b': 0,
          b2: 0,
          'zincblende-wurtzite': 0,
          'boron-nitride': 0,
        },
        deformationGradientEnabled: true,
        deformationGradientAtomCount: 1,
        maximumElasticStrainMagnitude: 0,
        maximumElasticStrainAtomId: 'ptm-a',
        scopeWarning: 'Other is unmatched, not a named defect.',
        citations: ['OVITO PTM'],
      },
    },
  }
  await writeActiveViewportStructure(annotated)
  const state = getActiveViewportStoreApi().getState()
  assertEqual(state.showPtmColoring, true)
  assertEqual(state.ptmAnalysis?.engineVersion, '3.15.5')
  assertEqual(state.ptmAnalysis?.counts.fcc, 1)
  assertEqual(state.atomAttributes['ptm-a'].bader_charge, 0.2)
  assertEqual(state.atomAttributes['ptm-a'].ptmStructureType, 'fcc')
  assertEqual(state.atomAttributes['ptm-a'].ptmRmsd, 0.01)
  assertEqual(state.atomAttributes['ptm-a'].ptmOrderingType, 'pure')
  assertEqual(state.atomAttributes['ptm-a'].ptmElasticStrainMagnitude, 0)
  assertEqual(state.atomAttributes['ptm-a'].ptmElasticVolumeRatio, 1)
  assertEqual(state.atomAttributes['ptm-b'].ptmStructureType, 'other')
  assertEqual(fingerprintStructure(readActiveViewportStructure()!), fingerprintStructure(annotated))

  await state.updateAtomPosition('ptm-a', [0.1, 0, 0])
  const invalidated = getActiveViewportStoreApi().getState()
  assertEqual(invalidated.showPtmColoring, false)
  assertEqual(invalidated.ptmAnalysis, null)
  assertEqual(invalidated.atomAttributes['ptm-a'].bader_charge, 0.2)
  assertEqual(invalidated.atomAttributes['ptm-a'].ptmStructureType, undefined)
  assertEqual(readActiveViewportStructure()!.metadata?.['zatom.analysis.ptm'], undefined)
  assertEqual(readActiveViewportStructure()!.atoms[0].properties?.['zatom.analysis.ptm.structureType'], undefined)

  await writeActiveViewportStructure(source)
  const cleared = getActiveViewportStoreApi().getState()
  assertEqual(cleared.showPtmColoring, false)
  assertEqual(cleared.ptmAnalysis, null)
  assertEqual(cleared.atomAttributes['ptm-a'].bader_charge, 0.2)
  assertEqual(cleared.atomAttributes['ptm-a'].ptmStructureType, undefined)
}

async function testSpglibAnnotationInvalidatesOnGeometryChange() {
  const annotated: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    label: 'spglib annotated cell',
    atoms: [{
      id: 'spglib-si',
      element: 'Si',
      position: [0, 0, 0],
      properties: {
        source: 'preserved',
        'zatom.analysis.spglib.wyckoffLetter': 'a',
        'zatom.analysis.spglib.siteSymmetrySymbol': '-43m',
      },
    }],
    lattice: { vectors: [[5.43, 0, 0], [0, 5.43, 0], [0, 0, 5.43]], periodic: [true, true, true] },
    metadata: {
      [ZATOM_SPGLIB_SYMMETRY_METADATA_KEY]: {
        schemaVersion: ZATOM_SPGLIB_SYMMETRY_ANNOTATION_SCHEMA,
        atomIds: ['spglib-si'],
      },
    },
  }
  await writeActiveViewportStructure(annotated)
  assertEqual(fingerprintStructure(readActiveViewportStructure()!), fingerprintStructure(annotated))
  await getActiveViewportStoreApi().getState().updateAtomPosition('spglib-si', [0.1, 0, 0])
  const changed = readActiveViewportStructure()!
  assertEqual(changed.atoms[0].properties?.source, 'preserved')
  assertEqual(changed.atoms[0].properties?.['zatom.analysis.spglib.wyckoffLetter'], undefined)
  assertEqual(changed.metadata?.[ZATOM_SPGLIB_SYMMETRY_METADATA_KEY], undefined)
}

async function testMixedPbcUsesFiniteRenderingAndExactCanonicalReadback() {
  const linePeriodic: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    lattice: { vectors: [[12, 0, 0], [0, 12, 0], [0, 0, 3]], periodic: [false, false, true] },
    atoms: [{ id: 'line-site', element: 'Si', position: [6, 6, 1] }],
  }
  await writeActiveViewportStructure(linePeriodic)
  assertEqual(getActiveViewportStoreApi().getState().periodic, false)
  assertDeepEqual(readActiveViewportStructure()?.lattice, linePeriodic.lattice)
  assertEqual(fingerprintStructure(readActiveViewportStructure()!), fingerprintStructure(linePeriodic))

  const trajectory: ZatomTrajectory = {
    schemaVersion: ZATOM_TRAJECTORY_SCHEMA,
    atomIds: ['line-site'],
    coordinateMode: 'unwrapped-cartesian',
    lattice: linePeriodic.lattice,
    frames: [
      { step: 0, timePs: 0, positions: [[6, 6, 0.9]] },
      { step: 1, timePs: 0.001, positions: [[6, 6, 1]] },
    ],
  }
  await writeActiveViewportTrajectory(trajectory)
  const state = getActiveViewportStoreApi().getState()
  assertEqual(state.periodic, false)
  assertTrue(state.trajectoryFrames!.every((frame) => frame.latticeVectors === undefined))
  assertDeepEqual(readActiveViewportTrajectory()?.lattice, linePeriodic.lattice)
  assertEqual(fingerprintTrajectory(readActiveViewportTrajectory()!), fingerprintTrajectory(trajectory))
  getActiveViewportStoreApi().setState({
    atoms: state.atoms.map((atom, index) => index ? atom : { ...atom, id: 'identity-drift' }),
  })
  assertEqual(readActiveViewportTrajectory(), null)
}

async function testFiniteReferenceCellSurvivesBrowserWrite() {
  const finiteCell: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    label: 'finite defect with reference cell',
    lattice: { vectors: [[8, 0, 0], [0, 9, 0], [0, 0, 10]], periodic: [false, false, false] },
    atoms: [
      { id: 'finite-a', element: 'Fe', position: [1, 1, 1] },
      { id: 'finite-b', element: 'Fe', position: [3, 3, 3] },
    ],
  }
  await writeActiveViewportStructure(finiteCell)
  const roundTrip = readActiveViewportStructure()
  assertTrue(roundTrip !== null)
  assertDeepEqual(roundTrip?.lattice, finiteCell.lattice)
  assertEqual(fingerprintStructure(roundTrip!), fingerprintStructure(finiteCell))

  const trajectory: ZatomTrajectory = {
    schemaVersion: ZATOM_TRAJECTORY_SCHEMA,
    atomIds: finiteCell.atoms.map((atom) => atom.id),
    coordinateMode: 'cartesian',
    lattice: finiteCell.lattice,
    metadata: { boundaryIntent: 'finite-reference-cell' },
    frames: [
      { step: 0, timePs: 0, positions: [[0.9, 1, 1], [3.1, 3, 3]] },
      { step: 1, timePs: 0.001, positions: finiteCell.atoms.map((atom) => [...atom.position] as [number, number, number]) },
    ],
  }
  await writeActiveViewportTrajectory(trajectory)
  assertDeepEqual(readActiveViewportTrajectory()?.lattice, finiteCell.lattice)
  assertDeepEqual(readActiveViewportTrajectory()?.metadata, trajectory.metadata)
}

async function testPolymerIdentityAndTopologySurviveBrowserWrite() {
  const repeatUnit: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    label: 'minimal explicit-port repeat',
    atoms: [
      { id: 'head-c', element: 'C', position: [-0.76, 0, 0], properties: { formalCharge: 0 } },
      { id: 'tail-c', element: 'C', position: [0.76, 0, 0], properties: { formalCharge: 0 } },
      { id: 'head-h', element: 'H', position: [-1.85, 0, 0], properties: { formalCharge: 0 } },
      { id: 'tail-h', element: 'H', position: [1.85, 0, 0], properties: { formalCharge: 0 } },
    ],
    bonds: [
      { id: 'cc', atomIds: ['head-c', 'tail-c'], order: 1 },
      { id: 'head-cap', atomIds: ['head-c', 'head-h'], order: 1 },
      { id: 'tail-cap', atomIds: ['tail-c', 'tail-h'], order: 1 },
    ],
  }
  const result = buildLinearPolymer({
    structure: repeatUnit,
    head: { anchorAtomId: 'head-c', directionAtomId: 'head-h', removeAtomIds: ['head-h'] },
    tail: { anchorAtomId: 'tail-c', directionAtomId: 'tail-h', removeAtomIds: ['tail-h'] },
    repeatCount: 2,
    targetBondLengthA: 1.52,
    maxInterrepeatPairChecks: 100,
  })
  assertTrue(result.checks.every((check) => check.status !== 'fail'))
  await writeActiveViewportStructure(result.structure)
  const roundTrip = readActiveViewportStructure()
  assertTrue(roundTrip !== null)
  assertEqual(fingerprintStructure(roundTrip!), fingerprintStructure(result.structure))
  assertEqual(roundTrip?.atoms[0].properties?.['zatom.polymer.repeatIndex'], 0)
  assertEqual(roundTrip?.bonds?.find((bond) => bond.id === 'polymer-link-0001')?.properties?.['zatom.polymer.role'], 'repeat-link')
}

async function testTrajectoryRoundTripAndFrameSpecificFocusPreserveTopology() {
  const molecule: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    label: 'agent trajectory H2',
    atoms: [
      { id: 'trajectory-h-left', element: 'H', position: [0, 0, 0] },
      { id: 'trajectory-h-right', element: 'H', position: [0.74, 0, 0] },
    ],
    bonds: [{ id: 'trajectory-h-bond', atomIds: ['trajectory-h-left', 'trajectory-h-right'], order: 1 }],
  }
  const trajectory: ZatomTrajectory = {
    schemaVersion: ZATOM_TRAJECTORY_SCHEMA,
    atomIds: molecule.atoms.map((atom) => atom.id),
    coordinateMode: 'cartesian',
    label: 'two-frame H2 evidence',
    metadata: { integrator: 'test-verlet', settings: { timestepFs: 1 } },
    frames: [
      {
        step: 0,
        timePs: 0,
        positions: [[-0.03, 0, 0], [0.8, 0, 0]],
        velocitiesAperPs: [[0.1, 0, 0], [-0.1, 0, 0]],
        forcesEvPerA: [[0.2, 0, 0], [-0.2, 0, 0]],
        scalars: { temperatureK: 120, potentialEnergyEv: -0.9 },
      },
      {
        step: 10,
        timePs: 0.01,
        positions: molecule.atoms.map((atom) => [...atom.position] as [number, number, number]),
        velocitiesAperPs: [[0.01, 0, 0], [-0.01, 0, 0]],
        forcesEvPerA: [[0.001, 0, 0], [-0.001, 0, 0]],
        scalars: { temperatureK: 80, potentialEnergyEv: -1.1 },
      },
    ],
  }
  await writeActiveViewportStructure(molecule)
  await writeActiveViewportTrajectory(trajectory)
  const api = getActiveViewportStoreApi()
  assertEqual(api.getState().trajectoryCurrentFrame, 1)
  assertEqual(fingerprintTrajectory(readActiveViewportTrajectory()!), fingerprintTrajectory(trajectory))
  assertDeepEqual(readActiveViewportTrajectory()?.metadata, trajectory.metadata)
  assertDeepEqual(readActiveViewportStructure()?.bonds, molecule.bonds)

  const focus = activeViewportToolContext.focusInspectionTarget!({
    id: 'initial-stretched-bond',
    reason: 'inspect initial trajectory frame',
    center: [0.385, 0, 0],
    radius: 2,
    atomIds: molecule.atoms.map((atom) => atom.id),
    trajectoryFrameIndex: 0,
  })
  setTimeout(() => api.setState({ isAnimatingCamera: false }), 0)
  await focus
  assertEqual(api.getState().trajectoryCurrentFrame, 0)
  assertDeepEqual(api.getState().atoms.map((atom) => atom.cartesian), trajectory.frames[0].positions)
  assertEqual(fingerprintStructure(readActiveViewportStructure()!), fingerprintStructure(molecule))
  assertDeepEqual(readActiveViewportTrajectory()?.metadata, trajectory.metadata)
  assertDeepEqual(api.getState().bonds.map((bond) => bond.id), ['trajectory-h-bond'])
  assertTrue(molecule.atoms.every((atom) => api.getState().focusedAtomIds.has(atom.id)))
}

async function testVariableCellTrajectoryRoundTripAndFrameSwitch() {
  const structure: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    label: 'variable-cell periodic H2',
    atoms: [
      { id: 'npt-h-left', element: 'H', position: [0.1, 0.1, 0.1] },
      { id: 'npt-h-right', element: 'H', position: [0.85, 0.1, 0.1] },
    ],
    bonds: [{ id: 'npt-h-bond', atomIds: ['npt-h-left', 'npt-h-right'], order: 1 }],
    lattice: { vectors: [[4, 0, 0], [0, 4, 0], [0, 0, 4]], periodic: [true, true, true] },
  }
  const trajectory: ZatomTrajectory = {
    schemaVersion: ZATOM_TRAJECTORY_SCHEMA,
    atomIds: structure.atoms.map((atom) => atom.id),
    coordinateMode: 'unwrapped-cartesian',
    label: 'two-frame variable-cell evidence',
    frames: [
      {
        step: 0,
        timePs: 0,
        positions: [[0, 0, 0], [0.8, 0, 0]],
        lattice: { vectors: [[3.8, 0, 0], [0, 3.8, 0], [0, 0, 3.8]], periodic: [true, true, true] },
      },
      {
        step: 10,
        timePs: 0.01,
        positions: structure.atoms.map((atom) => [...atom.position] as [number, number, number]),
        lattice: structure.lattice!,
      },
    ],
  }
  await writeActiveViewportStructure(structure)
  await writeActiveViewportTrajectory(trajectory)
  const api = getActiveViewportStoreApi()
  assertEqual(api.getState().trajectoryLatticeMode, 'per-frame')
  assertEqual(api.getState().latticeVectors.a[0], 4)
  assertEqual(fingerprintTrajectory(readActiveViewportTrajectory()!), fingerprintTrajectory(trajectory))
  api.getState().setTrajectoryFrame(0)
  assertEqual(api.getState().latticeVectors.a[0], 3.8)
  assertDeepEqual(api.getState().atoms.map((atom) => atom.cartesian), trajectory.frames[0].positions)
  assertTrue(Math.abs(api.getState().atoms[1].position[0] - 0.8 / 3.8) < 1e-12)
  assertEqual(fingerprintStructure(readActiveViewportStructure()!), fingerprintStructure(structure))
  assertEqual(readActiveViewportStructure()!.lattice!.vectors[0][0], 4)
}

async function testTrajectoryWriteCannotBypassManualTakeover() {
  const structure: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    atoms: [{ id: 'takeover-h', element: 'H', position: [0, 0, 0] }],
  }
  const trajectory: ZatomTrajectory = {
    schemaVersion: ZATOM_TRAJECTORY_SCHEMA,
    atomIds: ['takeover-h'],
    coordinateMode: 'cartesian',
    frames: [{ step: 0, timePs: 0, positions: [[0.1, 0, 0]] }],
  }
  useAgentOperationReview.setState({ control: { phase: 'idle' }, takeover: null })
  await writeActiveViewportStructure(structure)
  useAgentOperationReview.getState().takeOver('manual trajectory edit')

  let rejected = false
  try {
    await writeActiveViewportTrajectory(trajectory)
  } catch (error) {
    rejected = error instanceof Error && error.message.includes('editing manually')
  }
  assertTrue(rejected, 'trajectory writes must respect manual takeover')
  assertEqual(readActiveViewportTrajectory(), null)
  useAgentOperationReview.getState().resumeAgent()
}

async function testStructureAndTrajectoryCandidateIsOneReviewableTransaction() {
  const before: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    atoms: [{ id: 'transaction-before', element: 'C', position: [0, 0, 0] }],
  }
  const after: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    label: 'structure and trajectory transaction',
    atoms: [{ id: 'transaction-after', element: 'N', position: [1, 0, 0] }],
  }
  const trajectory: ZatomTrajectory = {
    schemaVersion: ZATOM_TRAJECTORY_SCHEMA,
    atomIds: ['transaction-after'],
    coordinateMode: 'cartesian',
    frames: [
      { step: 0, timePs: 0, positions: [[0.8, 0, 0]] },
      { step: 1, timePs: 0.01, positions: [[1, 0, 0]] },
    ],
  }
  useAgentOperationReview.setState({ control: { phase: 'idle' }, takeover: null })
  await writeActiveViewportStructure(before)
  const envelope = await applyStructureCandidate({
    result: { structure: after, trajectory, checks: [] },
    requestedApply: true,
    captureAfter: false,
    context: activeViewportToolContext,
  })
  assertTrue(envelope.appliedToWorkspace, 'combined candidate should not deadlock behind its own animation')
  assertTrue(envelope.applicationVerified === true)
  assertEqual(fingerprintStructure(readActiveViewportStructure()!), fingerprintStructure(after))
  assertEqual(fingerprintTrajectory(readActiveViewportTrajectory()!), fingerprintTrajectory(trajectory))

  abortChoreography()
  await awaitChoreographyIdle()
  const review = await waitForReview()
  if (review.subject.kind !== 'structure' || !review.subject.revert) {
    throw new Error('combined candidate did not produce an exact structure review')
  }
  await review.subject.revert()
  assertEqual(fingerprintStructure(readActiveViewportStructure()!), fingerprintStructure(before))
  assertEqual(readActiveViewportTrajectory(), null)
  useAgentOperationReview.getState().dismissReview()
}

async function testTrajectoryFailureRestoresTheExactPreCandidateWorkspace() {
  const before: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    atoms: [{ id: 'atomic-before', element: 'C', position: [0, 0, 0] }],
  }
  const beforeTrajectory: ZatomTrajectory = {
    schemaVersion: ZATOM_TRAJECTORY_SCHEMA,
    atomIds: ['atomic-before'],
    coordinateMode: 'cartesian',
    frames: [
      { step: 0, timePs: 0, positions: [[0.1, 0, 0]] },
      { step: 1, timePs: 0.01, positions: [[0, 0, 0]] },
    ],
  }
  const after: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    atoms: [{ id: 'atomic-after', element: 'N', position: [1, 0, 0] }],
  }
  const afterTrajectory: ZatomTrajectory = {
    schemaVersion: ZATOM_TRAJECTORY_SCHEMA,
    atomIds: ['atomic-after'],
    coordinateMode: 'cartesian',
    frames: [
      { step: 0, timePs: 0, positions: [[1.1, 0, 0]] },
      { step: 1, timePs: 0.01, positions: [[1, 0, 0]] },
    ],
  }
  useAgentOperationReview.setState({ control: { phase: 'idle' }, takeover: null })
  await writeActiveViewportStructure(before)
  await writeActiveViewportTrajectory(beforeTrajectory)
  const api = getActiveViewportStoreApi()
  const originalSetTrajectoryFrame = api.getState().setTrajectoryFrame
  let rejectNextFrameInstall = true
  api.setState({
    setTrajectoryFrame: (frameIndex) => {
      if (rejectNextFrameInstall) {
        rejectNextFrameInstall = false
        throw new Error('fixture trajectory renderer rejected the frame')
      }
      originalSetTrajectoryFrame(frameIndex)
    },
  })
  try {
    const envelope = await applyStructureCandidate({
      result: { structure: after, trajectory: afterTrajectory, checks: [] },
      requestedApply: true,
      captureAfter: false,
      context: activeViewportToolContext,
    })
    assertTrue(!envelope.appliedToWorkspace)
    assertTrue(envelope.applicationBlocked)
    assertTrue((envelope.result.checks as Array<{ id: string; status: string }>).some((check) => (
      check.id === 'candidate.workspace_write' && check.status === 'fail'
    )))
    assertEqual(fingerprintStructure(readActiveViewportStructure()!), fingerprintStructure(before))
    assertEqual(fingerprintTrajectory(readActiveViewportTrajectory()!), fingerprintTrajectory(beforeTrajectory))
    assertEqual(useAgentOperationReview.getState().control.phase, 'idle')
  } finally {
    api.setState({ setTrajectoryFrame: originalSetTrajectoryFrame })
  }
}

async function testCancellationAfterStructureWriteRollsBackAndRejectsFinalize() {
  const before: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    atoms: [{ id: 'atomic-cancel-before', element: 'C', position: [0, 0, 0] }],
  }
  const after: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    atoms: [{ id: 'atomic-cancel-after', element: 'O', position: [2, 0, 0] }],
  }
  const afterTrajectory: ZatomTrajectory = {
    schemaVersion: ZATOM_TRAJECTORY_SCHEMA,
    atomIds: ['atomic-cancel-after'],
    coordinateMode: 'cartesian',
    frames: [
      { step: 0, timePs: 0, positions: [[2.1, 0, 0]] },
      { step: 1, timePs: 0.01, positions: [[2, 0, 0]] },
    ],
  }
  useAgentOperationReview.setState({ control: { phase: 'idle' }, takeover: null })
  await writeActiveViewportStructure(before)
  const api = getActiveViewportStoreApi()
  const originalLoadFromXYZ = api.getState().loadFromXYZ
  const controller = new AbortController()
  let abortAfterNextLoad = true
  api.setState({
    loadFromXYZ: async (content, options) => {
      const result = await originalLoadFromXYZ(content, options)
      if (abortAfterNextLoad) {
        abortAfterNextLoad = false
        controller.abort(new Error('cancelled after structure replacement'))
      }
      return result
    },
  })
  let rejected: unknown = null
  try {
    await finalizeStructureCandidate({
      tool: 'test_atomic_cancel',
      result: { structure: after, trajectory: afterTrajectory, checks: [] },
      requestedApply: true,
      captureAfter: false,
      context: { ...activeViewportToolContext, signal: controller.signal },
      summary: () => 'must not report ok',
    })
  } catch (error) {
    rejected = error
  } finally {
    api.setState({ loadFromXYZ: originalLoadFromXYZ })
  }
  assertTrue(rejected instanceof Error && rejected.message === 'cancelled after structure replacement')
  assertEqual(fingerprintStructure(readActiveViewportStructure()!), fingerprintStructure(before))
  assertEqual(readActiveViewportTrajectory(), null)
  assertEqual(useAgentOperationReview.getState().control.phase, 'idle')
}

/**
 * While a review card is open, the next agent commit must wait outside the
 * gate. Otherwise Keep/Revert would target a structure that has already been
 * replaced. The operation waits rather than fails and resumes after the answer.
 */
async function testCommitQueuesBehindAPendingUserReview() {
  const base: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    atoms: [{ id: 'queued-base', element: 'C', position: [0, 0, 0] }],
  }
  useAgentOperationReview.setState({ control: { phase: 'idle' }, takeover: null })
  await writeActiveViewportStructure(base)
  useAgentOperationReview.getState().openReview({ label: 'awaiting answer', subject: { kind: 'structure', atomDelta: 0, revert: () => undefined } })

  let settled = false
  const commit = commitActiveViewportStructure({
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    atoms: [{ id: 'queued-next', element: 'N', position: [1, 0, 0] }],
  }).then(() => { settled = true })

  await new Promise((resolve) => setTimeout(resolve, 60))
  // Before the answer, the commit remains pending and the reviewed version stays visible.
  assertTrue(!settled)
  assertEqual(readActiveViewportStructure()?.atoms[0].id, 'queued-base')

  useAgentOperationReview.getState().dismissReview()
  await commit
  assertTrue(settled)

  // Settle the fire-and-forget replay so later tests never inherit an animation intermediate.
  abortChoreography()
  await awaitChoreographyIdle()
  assertEqual(readActiveViewportStructure()?.atoms[0].id, 'queued-next')
  const resultingReview = await waitForReview()
  assertEqual(resultingReview.label, 'Agent operation')
  useAgentOperationReview.getState().dismissReview()
}

async function testCancelledCandidateNeverLeavesTheReviewQueueAndWritesLater() {
  const base: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    atoms: [{ id: 'cancel-queued-base', element: 'C', position: [0, 0, 0] }],
  }
  const candidate: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    atoms: [{ id: 'cancel-queued-next', element: 'N', position: [1, 0, 0] }],
  }
  useAgentOperationReview.setState({ control: { phase: 'idle' }, takeover: null })
  await writeActiveViewportStructure(base)
  useAgentOperationReview.getState().openReview({
    label: 'Hold the queue',
    subject: { kind: 'structure', atomDelta: 0, revert: () => undefined },
  })

  const controller = new AbortController()
  const applying = applyStructureCandidate({
    result: { structure: candidate, checks: [] },
    requestedApply: true,
    captureAfter: false,
    context: { ...activeViewportToolContext, signal: controller.signal },
  })
  await new Promise((resolve) => setTimeout(resolve, 20))
  controller.abort(new Error('WebMCP caller cancelled'))
  let cancelled: unknown = null
  try {
    await applying
  } catch (error) {
    cancelled = error
  }
  assertTrue(cancelled instanceof Error && cancelled.message === 'WebMCP caller cancelled')
  assertEqual(readActiveViewportStructure()?.atoms[0].id, 'cancel-queued-base')

  // Releasing the review later must not resurrect the abandoned queue entry.
  useAgentOperationReview.getState().dismissReview()
  await new Promise((resolve) => setTimeout(resolve, 40))
  assertEqual(readActiveViewportStructure()?.atoms[0].id, 'cancel-queued-base')
  assertEqual(useAgentOperationReview.getState().pendingOperations, 0)

  useAgentOperationReview.getState().openReview({
    label: 'Hold a trajectory write',
    subject: { kind: 'structure', atomDelta: 0, revert: () => undefined },
  })
  const trajectoryController = new AbortController()
  const trajectoryApplying = applyTrajectoryCandidate({
    result: {
      trajectory: {
        schemaVersion: ZATOM_TRAJECTORY_SCHEMA,
        atomIds: ['cancel-queued-base'],
        coordinateMode: 'cartesian',
        frames: [
          { step: 0, timePs: 0, positions: [[0.1, 0, 0]] },
          { step: 1, timePs: 0.01, positions: [[0, 0, 0]] },
        ],
      },
      checks: [],
    },
    requestedApply: true,
    captureAfter: false,
    context: { ...activeViewportToolContext, signal: trajectoryController.signal },
  })
  await new Promise((resolve) => setTimeout(resolve, 20))
  trajectoryController.abort(new Error('trajectory WebMCP caller cancelled'))
  let trajectoryCancelled: unknown = null
  try {
    await trajectoryApplying
  } catch (error) {
    trajectoryCancelled = error
  }
  assertTrue(trajectoryCancelled instanceof Error && trajectoryCancelled.message === 'trajectory WebMCP caller cancelled')
  useAgentOperationReview.getState().dismissReview()
  await new Promise((resolve) => setTimeout(resolve, 40))
  assertEqual(readActiveViewportTrajectory(), null)
}

async function testImmediateAnimationAbortStillProducesTheExactReview() {
  const before: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    atoms: [{ id: 'immediate-abort', element: 'C', position: [0, 0, 0] }],
  }
  const after: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    label: 'Immediate animation abort',
    atoms: [{ id: 'immediate-abort', element: 'C', position: [1, 0, 0] }],
  }
  useAgentOperationReview.setState({ control: { phase: 'idle' }, takeover: null })
  await writeActiveViewportStructure(before)
  await commitActiveViewportStructure(after)
  assertEqual(useAgentOperationReview.getState().control.phase, 'animating')
  // This happens before the reveal's setTimeout(0) continuation. Previously
  // performAppliedResultReveal reset a module boolean and lost this interrupt.
  abortChoreography()
  await awaitChoreographyIdle()
  const review = await waitForReview()
  if (review.subject.kind !== 'structure' || !review.subject.revert) throw new Error('missing exact rollback')
  await review.subject.revert()
  assertEqual(fingerprintStructure(readActiveViewportStructure()!), fingerprintStructure(before))
  useAgentOperationReview.getState().dismissReview()
}

async function testTakeoverDuringAnimationPreservesKeepOrExactRevertDecision() {
  const before: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    atoms: [{ id: 'animation-takeover', element: 'O', position: [0, 0, 0] }],
  }
  const after: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    label: 'Animation takeover result',
    atoms: [{ id: 'animation-takeover', element: 'O', position: [0, 1, 0] }],
  }
  useAgentOperationReview.setState({ control: { phase: 'idle' }, takeover: null })
  await writeActiveViewportStructure(before)
  await commitActiveViewportStructure(after)
  useAgentOperationReview.getState().takeOver('Animation takeover result')
  const interrupted = useAgentOperationReview.getState().control
  assertEqual(interrupted.phase, 'animating')
  assertTrue(
    interrupted.phase === 'animating' && interrupted.operation.decisionRequested,
    'animation takeover must retain the pending exact decision instead of entering blind manual mode',
  )
  abortChoreography()
  await awaitChoreographyIdle()
  const review = await waitForReview()
  assertEqual(review.label, 'Animation takeover result')
  assertEqual(selectPendingReview(useAgentOperationReview.getState())?.label, 'Animation takeover result')
  if (review.subject.kind !== 'structure' || !review.subject.revert) throw new Error('missing exact rollback')
  await review.subject.revert()
  assertEqual(fingerprintStructure(readActiveViewportStructure()!), fingerprintStructure(before))
  useAgentOperationReview.getState().revertAndTakeOver('user_took_over')
  assertEqual(useAgentOperationReview.getState().control.phase, 'manual_control')
  useAgentOperationReview.getState().resumeAgent()
}

async function testClearOrEditDuringRevealCannotStrandAnimating() {
  const before: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    atoms: [{ id: 'reveal-clear', element: 'Si', position: [0, 0, 0] }],
  }
  const after: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    label: 'Clear during reveal',
    atoms: [{ id: 'reveal-clear', element: 'Si', position: [1, 0, 0] }],
  }
  useAgentOperationReview.setState({ control: { phase: 'idle' }, takeover: null })
  await writeActiveViewportStructure(before)
  await commitActiveViewportStructure(after)
  clearActiveViewportWorkspace()
  await awaitChoreographyIdle()
  await waitForControlPhase('manual_control')
  assertEqual(readActiveViewportStructure(), null)
  useAgentOperationReview.getState().resumeAgent()

  await writeActiveViewportStructure(before)
  await commitActiveViewportStructure({ ...after, label: 'Edit during reveal' })
  await getActiveViewportStoreApi().getState().updateAtomPosition('reveal-clear', [2, 0, 0])
  await awaitChoreographyIdle()
  await waitForControlPhase('manual_control')
  assertDeepEqual(readActiveViewportStructure()?.atoms[0].position, [2, 0, 0])
  useAgentOperationReview.getState().resumeAgent()
}

async function testDetachingTheTargetDuringRevealCannotOpenAnUnreachableReview() {
  useViewportManager.getState().setLayout('1x2')
  useViewportManager.getState().setActive('vp-2')
  useAgentOperationReview.setState({ control: { phase: 'idle' }, takeover: null })
  const before: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    atoms: [{ id: 'detached-reveal', element: 'Cu', position: [0, 0, 0] }],
  }
  const after: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    label: 'Detach during reveal',
    atoms: [{ id: 'detached-reveal', element: 'Cu', position: [1, 0, 0] }],
  }
  await writeActiveViewportStructure(before)
  await commitActiveViewportStructure(after)
  useViewportManager.getState().setLayout('1x1')
  await awaitChoreographyIdle()
  await waitForControlPhase('manual_control')
  assertEqual(selectPendingReview(useAgentOperationReview.getState()), null)

  // Restoring the pane proves the detached result was preserved, while the
  // global queue is no longer wedged in an invisible awaiting-review state.
  useAgentOperationReview.getState().resumeAgent()
  useViewportManager.getState().setLayout('1x2')
  useViewportManager.getState().setActive('vp-2')
  assertEqual(fingerprintStructure(readActiveViewportStructure()!), fingerprintStructure(after))
  useViewportManager.getState().setLayout('1x1')
}

async function testCanonicalReviewRevertsTheExactBoundViewport() {
  useViewportManager.getState().setLayout('1x1')
  useViewportManager.getState().setActive('vp-1')
  useAgentOperationReview.setState({ control: { phase: 'idle' }, takeover: null })
  const before: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    label: 'review-before',
    atoms: [{ id: 'review-c', element: 'C', position: [0, 0, 0] }],
  }
  const after: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    label: 'review-after',
    atoms: [{ id: 'review-n', element: 'N', position: [1, 0, 0] }],
  }
  await writeActiveViewportStructure(before)
  await commitActiveViewportStructure(after)
  const review = await waitForReview()
  assertEqual(review.subject.kind, 'structure')
  if (review.subject.kind !== 'structure' || !review.subject.revert) throw new Error('missing exact rollback')
  assertEqual(review.subject.viewportId, 'vp-1')
  await review.subject.revert()
  assertEqual(fingerprintStructure(readActiveViewportStructure()!), fingerprintStructure(before))
  useAgentOperationReview.getState().dismissReview()
}

async function testReviewRollbackRefusesToOverwriteNewerUserEdit() {
  useAgentOperationReview.setState({ control: { phase: 'idle' }, takeover: null })
  const before: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    atoms: [{ id: 'review-edit', element: 'C', position: [0, 0, 0] }],
  }
  const after: ZatomStructure = {
    ...before,
    atoms: [{ id: 'review-edit', element: 'C', position: [1, 0, 0] }],
  }
  await writeActiveViewportStructure(before)
  await commitActiveViewportStructure(after)
  const review = await waitForReview()
  if (review.subject.kind !== 'structure' || !review.subject.revert) throw new Error('missing exact rollback')
  await getActiveViewportStoreApi().getState().updateAtomPosition('review-edit', [2, 0, 0])
  let rejected = false
  try {
    await review.subject.revert()
  } catch {
    rejected = true
  }
  assertTrue(rejected, 'review rollback must reject after a newer user edit')
  assertDeepEqual(readActiveViewportStructure()?.atoms[0].position, [2, 0, 0])
  useAgentOperationReview.getState().dismissReview()
}

async function testCanonicalHistoryIsPartitionedByViewport() {
  useViewportManager.getState().setLayout('1x2')
  useAgentOperationReview.setState({ control: { phase: 'idle' }, takeover: null })
  const structure = (id: string, element: string): ZatomStructure => ({
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    atoms: [{ id, element, position: [0, 0, 0] }],
  })
  useViewportManager.getState().setActive('vp-1')
  await writeActiveViewportStructure(structure('vp1-a', 'C'))
  await writeActiveViewportStructure(structure('vp1-a2', 'N'))
  useViewportManager.getState().setActive('vp-2')
  await writeActiveViewportStructure(structure('vp2-b', 'O'))
  await writeActiveViewportStructure(structure('vp2-b2', 'F'))

  useViewportManager.getState().setActive('vp-1')
  await activeViewportToolContext.history!.undo()
  assertEqual(readActiveViewportStructure()?.atoms[0].id, 'vp1-a')
  useViewportManager.getState().setActive('vp-2')
  assertEqual(readActiveViewportStructure()?.atoms[0].id, 'vp2-b2')
  await activeViewportToolContext.history!.undo()
  assertEqual(readActiveViewportStructure()?.atoms[0].id, 'vp2-b')
  useViewportManager.getState().setLayout('1x1')
}

async function testCanonicalHistoryRestoresTrajectoryExactly() {
  useViewportManager.getState().setLayout('1x1')
  useViewportManager.getState().setActive('vp-1')
  useAgentOperationReview.setState({ control: { phase: 'idle' }, takeover: null })
  useAgentProposalStore.setState({ current: null, history: [] })
  const first: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    atoms: [{ id: 'history-trajectory-a', element: 'C', position: [0, 0, 0] }],
  }
  const trajectory: ZatomTrajectory = {
    schemaVersion: ZATOM_TRAJECTORY_SCHEMA,
    atomIds: ['history-trajectory-a'],
    coordinateMode: 'cartesian',
    frames: [
      { step: 0, timePs: 0, positions: [[0.2, 0, 0]] },
      { step: 1, timePs: 0.01, positions: [[0, 0, 0]] },
    ],
  }
  const second: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    atoms: [{ id: 'history-trajectory-b', element: 'N', position: [1, 0, 0] }],
  }
  await writeActiveViewportStructure(first)
  await writeActiveViewportTrajectory(trajectory)
  await writeActiveViewportStructure(second)
  assertEqual(readActiveViewportTrajectory(), null)

  await activeViewportToolContext.history!.undo()
  assertEqual(fingerprintStructure(readActiveViewportStructure()!), fingerprintStructure(first))
  assertEqual(fingerprintTrajectory(readActiveViewportTrajectory()!), fingerprintTrajectory(trajectory))
  await activeViewportToolContext.history!.redo()
  assertEqual(fingerprintStructure(readActiveViewportStructure()!), fingerprintStructure(second))
  assertEqual(readActiveViewportTrajectory(), null)
}

async function testRevisionRejectsSameFingerprintAba() {
  useViewportManager.getState().setActive('vp-1')
  useAgentOperationReview.setState({ control: { phase: 'idle' }, takeover: null })
  const a: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    atoms: [{ id: 'aba', element: 'C', position: [0, 0, 0] }],
  }
  await writeActiveViewportStructure(a)
  const observed = readActiveViewportWorkspaceIdentity()
  await getActiveViewportStoreApi().getState().updateAtomPosition('aba', [1, 0, 0])
  await getActiveViewportStoreApi().getState().updateAtomPosition('aba', [0, 0, 0])
  assertEqual(fingerprintStructure(readActiveViewportStructure()!), observed.structureFingerprint)
  let rejected = false
  try {
    await commitActiveViewportStructure({
      ...a,
      atoms: [{ id: 'aba', element: 'N', position: [0, 0, 0] }],
    }, {
      expectedViewportId: observed.viewportId,
      expectedStructureFingerprint: observed.structureFingerprint,
      expectedRevision: observed.revision,
    })
  } catch {
    rejected = true
  }
  assertTrue(rejected, 'same-fingerprint ABA must fail the monotonic revision guard')
}

async function testProposalApplyStaysOnItsOriginalViewport() {
  useViewportManager.getState().setLayout('1x2')
  useViewportManager.getState().setActive('vp-1')
  useAgentOperationReview.setState({ control: { phase: 'idle' }, takeover: null })
  useAgentProposalStore.setState({ current: null, history: [] })
  const base: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    atoms: [{ id: 'same', element: 'C', position: [0, 0, 0] }],
  }
  await writeActiveViewportStructure(base)
  useViewportManager.getState().setActive('vp-2')
  await writeActiveViewportStructure(base)
  useViewportManager.getState().setActive('vp-1')
  const identity = readActiveViewportWorkspaceIdentity()
  const candidate: ZatomStructure = {
    ...base,
    atoms: [{ id: 'same', element: 'N', position: [0, 0, 0] }],
  }
  await activeViewportToolContext.proposal!.propose({
    intent: 'Change only the original pane',
    baseFingerprint: identity.structureFingerprint!,
    viewportId: identity.viewportId,
    workspaceRevision: identity.revision,
    candidate,
    changeSet: buildStructureChangeSet(base, candidate),
  })
  useViewportManager.getState().setActive('vp-2')
  const shown = await applyPendingProposal()
  assertTrue(!shown.ok && shown.reason === 'target_hidden')
  assertEqual(useViewportManager.getState().activeViewportId, 'vp-1')
  assertEqual(readActiveViewportStructure()?.atoms[0].element, 'C')
  const applied = await applyPendingProposal()
  assertTrue(applied.ok)
  assertEqual(useViewportManager.getState().activeViewportId, 'vp-1')
  assertEqual(readActiveViewportStructure()?.atoms[0].element, 'N')
  useViewportManager.getState().setActive('vp-2')
  assertEqual(readActiveViewportStructure()?.atoms[0].element, 'C')
  useAgentProposalStore.setState({ current: null, history: [] })
  await waitForReview()
  useAgentOperationReview.getState().dismissReview()
  useViewportManager.getState().setLayout('1x1')
}

async function testApplyClaimCannotBeDiscardedBeforeWriteBoundary() {
  useViewportManager.getState().setLayout('1x1')
  useViewportManager.getState().setActive('vp-1')
  useAgentOperationReview.setState({ control: { phase: 'idle' }, takeover: null })
  useAgentProposalStore.setState({ current: null, history: [] })
  const base: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    atoms: [{ id: 'discard-race', element: 'C', position: [0, 0, 0] }],
  }
  const candidate: ZatomStructure = {
    ...base,
    atoms: [{ id: 'discard-race', element: 'N', position: [1, 0, 0] }],
  }
  await writeActiveViewportStructure(base)
  const identity = readActiveViewportWorkspaceIdentity()
  await activeViewportToolContext.proposal!.propose({
    intent: 'must stay discardable',
    baseFingerprint: identity.structureFingerprint,
    viewportId: identity.viewportId,
    workspaceRevision: identity.revision,
    candidate,
    changeSet: buildStructureChangeSet(base, candidate),
  })

  const api = getActiveViewportStoreApi()
  const originalLoad = api.getState().loadFromXYZ
  let release!: () => void
  let entered!: () => void
  const enteredPromise = new Promise<void>((resolve) => { entered = resolve })
  const blocker = new Promise<void>((resolve) => { release = resolve })
  api.setState({
    loadFromXYZ: async (content, options) => {
      entered()
      await blocker
      return originalLoad(content, options)
    },
  })
  const applying = applyPendingProposal()
  await enteredPromise
  discardPendingProposal()
  release()
  const outcome = await applying
  api.setState({ loadFromXYZ: originalLoad })
  assertTrue(outcome.ok, 'Apply must own the proposal once its atomic claim succeeds')
  assertEqual(fingerprintStructure(readActiveViewportStructure()!), fingerprintStructure(candidate))
  assertEqual(useAgentProposalStore.getState().current?.status, 'applied')
  abortChoreography()
  await awaitChoreographyIdle()
  const review = await waitForReview()
  if (review.subject.kind !== 'structure' || !review.subject.revert) throw new Error('missing proposal review rollback')
  await review.subject.revert()
  useAgentOperationReview.getState().dismissReview()
  assertEqual(fingerprintStructure(readActiveViewportStructure()!), fingerprintStructure(base))
}

async function main() {
  await testCancelledCameraFlightStopsImmediately()
  await testGuardedCommitRejectsStaleSourceBeforeWrite()
  await testGuardedCommitRechecksAtTheActualReplacementBoundary()
  await testCancellationWinsAtTheActualReplacementBoundary()
  await testArtifactIdsSurviveBrowserWrite()
  await testCanonicalPtmAnnotationDrivesViewportOverlay()
  await testSpglibAnnotationInvalidatesOnGeometryChange()
  await testPolymerIdentityAndTopologySurviveBrowserWrite()
  await testTrajectoryRoundTripAndFrameSpecificFocusPreserveTopology()
  await testVariableCellTrajectoryRoundTripAndFrameSwitch()
  await testTrajectoryWriteCannotBypassManualTakeover()
  await testStructureAndTrajectoryCandidateIsOneReviewableTransaction()
  await testTrajectoryFailureRestoresTheExactPreCandidateWorkspace()
  await testCancellationAfterStructureWriteRollsBackAndRejectsFinalize()
  await testFiniteReferenceCellSurvivesBrowserWrite()
  await testMixedPbcUsesFiniteRenderingAndExactCanonicalReadback()
  await testCanonicalWritesOwnCompleteHistoryBoundary()
  await testCommitQueuesBehindAPendingUserReview()
  await testCancelledCandidateNeverLeavesTheReviewQueueAndWritesLater()
  await testImmediateAnimationAbortStillProducesTheExactReview()
  await testTakeoverDuringAnimationPreservesKeepOrExactRevertDecision()
  await testClearOrEditDuringRevealCannotStrandAnimating()
  await testDetachingTheTargetDuringRevealCannotOpenAnUnreachableReview()
  await testCanonicalReviewRevertsTheExactBoundViewport()
  await testReviewRollbackRefusesToOverwriteNewerUserEdit()
  await testCanonicalHistoryIsPartitionedByViewport()
  await testCanonicalHistoryRestoresTrajectoryExactly()
  await testRevisionRejectsSameFingerprintAba()
  await testProposalApplyStaysOnItsOriginalViewport()
  await testApplyClaimCannotBeDiscardedBeforeWriteBoundary()
}

void main()
