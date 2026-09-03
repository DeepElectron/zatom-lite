import { assertEqual, assertTrue } from '../../testing/assert'
import type { Vec3, ZatomStructure } from '../contracts'
import { callZatomMcpTool } from '../mcp-adapter'
import {
  composeZatomPeriodicDislocationDipoleEvidence,
  fingerprintPeriodicDislocationDipoleEvidence,
  PERIODIC_DISLOCATION_PROBE_FRACTIONS,
  type ZatomPeriodicDislocationDipoleEvidence,
} from '../periodic-dislocation-dipole-evidence'
import type { ZatomModelingProvider } from '../provider'
import { ZATOM_PROVIDER_SCHEMA } from '../provider'
import { registerZatomModelingProvider } from '../provider-tools'
import { fractionalToCartesian } from '../structure-math'

const source: ZatomStructure = {
  schemaVersion: 'zatom.structure/v1',
  label: 'synthetic primitive Fe template',
  atoms: [{ id: 'source-fe', element: 'Fe', position: [0, 0, 0] }],
  lattice: { vectors: [[2, 0, 0], [0, 2, 0], [0, 0, 2]], periodic: [true, true, true] },
}

const referenceCell: NonNullable<ZatomStructure['lattice']> = {
  vectors: [[2, 0, 0], [0, 8, 4], [0, 0, 8]],
  periodic: [true, true, true],
}

const resultCell: NonNullable<ZatomStructure['lattice']> = {
  vectors: [[2, 0, 0], [-1, 8, 4], [0, 0, 8]],
  periodic: [true, true, true],
}

const reference: ZatomStructure = {
  schemaVersion: 'zatom.structure/v1',
  label: 'synthetic perfect quadripole reference',
  atoms: [
    { id: 'periodic-dipole-000001', element: 'Fe', position: [0, 0, 0] },
    { id: 'periodic-dipole-000002', element: 'Fe', position: fractionalToCartesian([0.5, 0.5, 0.5], referenceCell.vectors) },
  ],
  lattice: referenceCell,
}

const result: ZatomStructure = {
  schemaVersion: 'zatom.structure/v1',
  label: 'synthetic periodic screw dipole',
  atoms: [
    { id: 'periodic-dipole-000001', element: 'Fe', position: [0, 0, 0] },
    { id: 'periodic-dipole-000002', element: 'Fe', position: fractionalToCartesian([0.5, 0.5, 0.5], resultCell.vectors) },
  ],
  lattice: resultCell,
}

const zero: Vec3 = [0, 0, 0]
const seamRows = ([0, 1, 2] as const).flatMap((axis) => (
  PERIODIC_DISLOCATION_PROBE_FRACTIONS.map((fractionalPointA, probeIndex) => {
    const pointA = fractionalToCartesian(fractionalPointA, referenceCell.vectors)
    return {
      axis,
      probeIndex,
      fractionalPointA: [...fractionalPointA] as Vec3,
      pointA,
      pointB: [
        pointA[0] + referenceCell.vectors[axis][0],
        pointA[1] + referenceCell.vectors[axis][1],
        pointA[2] + referenceCell.vectors[axis][2],
      ] as Vec3,
      displacementA: [...zero] as Vec3,
      displacementB: [...zero] as Vec3,
      residualVectorA: [...zero] as Vec3,
      residualA: 0,
    }
  })
))

const convergenceRows = PERIODIC_DISLOCATION_PROBE_FRACTIONS.map((fractionalPointA, probeIndex) => ({
  probeIndex,
  fractionalPointA: [...fractionalPointA] as Vec3,
  pointA: fractionalToCartesian(fractionalPointA, referenceCell.vectors),
  currentDisplacementA: [...zero] as Vec3,
  comparisonDisplacementA: [...zero] as Vec3,
  gaugeCorrectedDifferenceA: [...zero] as Vec3,
  residualA: 0,
}))

function composeEvidence(): ZatomPeriodicDislocationDipoleEvidence {
  return composeZatomPeriodicDislocationDipoleEvidence({
    sourceStructure: source,
    referenceStructure: reference,
    resultStructure: result,
    elasticity: {
      model: 'anisotropic-linear-elasticity',
      coordinateFrame: 'source-cell-cartesian',
      voigtOrder: ['xx', 'yy', 'zz', 'yz', 'xz', 'xy'],
      stiffnessMatrixGPa: [
        [200, 100, 100, 0, 0, 0],
        [100, 200, 100, 0, 0, 0],
        [100, 100, 200, 0, 0, 0],
        [0, 0, 0, 50, 0, 0],
        [0, 0, 0, 0, 50, 0],
        [0, 0, 0, 0, 0, 50],
      ],
    },
    crystallography: {
      conventionalSetting: 'p',
      burgersMiller: [1, 0, 0],
      lineMiller: [1, 0, 0],
      slipPlaneMiller: [0, 1, 0],
      primitiveBurgersCoefficients: [1, 0, 0],
      rotatedBurgersVectorA: [2, 0, 0],
      rotatedLineUnitVector: [1, 0, 0],
      rotatedSlipPlaneNormalUnitVector: [0, 1, 0],
      mAxis: 'z',
      nAxis: 'y',
    },
    construction: {
      sizeMultipliers: [1, 4, 4],
      imageReplicaCount: 11,
      shiftIndex: 0,
      atommanIndices: { motion: 2, cut: 1, line: 0 },
      cores: [
        { id: 'positive', sign: 1, positionA: fractionalToCartesian([0.5, 0.5, 0.25], resultCell.vectors) },
        { id: 'negative', sign: -1, positionA: fractionalToCartesian([0.5, 0.5, 0.75], resultCell.vectors) },
      ],
    },
    mapping: { mode: 'atomman-oriented-supercell-order' },
    periodicityProbes: {
      field: 'cai-regularized-volterra-displacement-before-balancing-strain',
      rows: seamRows,
    },
    imageConvergence: {
      comparison: 'current-versus-two-fewer-image-replicas',
      rigidGaugeA: [0, 0, 0],
      rows: convergenceRows,
    },
    acceptance: {
      maximumTensorSymmetryResidualGPa: 1e-8,
      minimumStiffnessEigenvalueGPa: 1,
      maximumStiffnessConditionNumber: 100,
      maximumScrewCharacterAngleDeg: 1e-8,
      maximumSlipPlaneResidual: 1e-8,
      minimumTransverseCellVectorPerBurgers: 1,
      minimumCoreSeparationPerBurgers: 1,
      minimumCoreClearanceA: 0.1,
      maximumPeriodicSeamResidualA: 1e-8,
      maximumImageConvergenceDisplacementA: 1e-8,
      maximumBalancingPrincipalStrain: 1,
      maximumVolumeChangeFraction: 1e-8,
      maximumNonaffineDisplacementA: 1e-8,
      minimumPairDistanceA: 0.1,
    },
    provenance: {
      engine: 'atomman',
      engineVersion: 'fixture-1.5.2',
      dependencies: { numpyVersion: 'fixture', scipyVersion: 'fixture' },
      method: 'Synthetic arithmetic fixture for canonical contract replay',
      package: { realPath: '/opt/pinned/atomman', fileCount: 4, totalBytes: 1024, sha256: `sha256:${'a'.repeat(64)}` },
      artifacts: [{ id: 'fixture', role: 'synthetic contract fixture', fingerprint: `sha256:${'b'.repeat(64)}` }],
      parameters: { fixture: true },
      citations: ['https://doi.org/10.1080/0141861021000051109'],
      scopeWarning: 'Synthetic contract fixture; no independently solved elasticity field or physical stability claim.',
    },
  }).evidence
}

async function testStandaloneReplayAndTamper(): Promise<void> {
  const evidence = composeEvidence()
  assertEqual(evidence.metrics.acceptancePassed, true)
  assertEqual(evidence.metrics.quadripoleTiltResidualA, 0)
  const replay = await callZatomMcpTool('periodic_dislocation_validate_dipole_evidence', {
    evidence,
    sourceStructure: source,
    resultStructure: result,
    useActiveResult: false,
  })
  assertTrue(replay.structuredContent.ok, replay.structuredContent.summary)

  const tampered = structuredClone(evidence)
  tampered.referenceStructure.lattice!.vectors[1][2] += 0.1
  const rejected = await callZatomMcpTool('periodic_dislocation_validate_dipole_evidence', {
    evidence: tampered,
    sourceStructure: source,
    resultStructure: result,
    useActiveResult: false,
  })
  assertEqual(rejected.structuredContent.ok, false)
}

async function testBrokerArtifactContract(): Promise<void> {
  const evidence = composeEvidence()
  const provider: ZatomModelingProvider = {
    manifest: {
      schemaVersion: ZATOM_PROVIDER_SCHEMA,
      id: 'test.synthetic-periodic-dislocation-evidence',
      title: 'synthetic periodic dislocation evidence fixture',
      description: 'Exercise broker artifact binding without an external atomman installation.',
      adapterVersion: '1.0.0',
      engine: { name: 'atomman', version: 'fixture-1.5.2' },
      execution: 'remote',
      capabilities: [{
        id: 'test.periodic-dislocation-evidence',
        title: 'Return synthetic periodic-dislocation evidence',
        description: 'Testing only.',
        fidelity: 'continuum',
        source: 'required',
        deterministic: true,
        inputSchema: { type: 'object', additionalProperties: false },
        outputArtifacts: ['periodic-dislocation-dipole-evidence'],
        requiredCheckIds: ['fixture.contract'],
        tags: ['test'],
      }],
    },
    execute: () => ({
      structure: result,
      periodicDislocationDipoleEvidence: evidence,
      checks: [{ id: 'fixture.contract', status: 'pass', message: 'Synthetic producer completed' }],
    }),
  }
  const unregister = registerZatomModelingProvider(provider)
  try {
    const response = await callZatomMcpTool('modeling_run_provider', {
      providerId: provider.manifest.id,
      capability: 'test.periodic-dislocation-evidence',
      structure: source,
      useActiveStructure: false,
      parameters: {},
      applyToWorkspace: false,
    })
    assertTrue(response.structuredContent.ok, response.structuredContent.summary)
    const data = response.structuredContent.data as {
      applicationBlocked: boolean
      result: {
        checks: Array<{ id: string; status: string }>
        provenance: { periodicDislocationDipoleEvidenceFingerprint: string }
      }
    }
    assertEqual(data.applicationBlocked, false)
    assertEqual(data.result.provenance.periodicDislocationDipoleEvidenceFingerprint, fingerprintPeriodicDislocationDipoleEvidence(evidence))
    assertTrue(data.result.checks.some((check) => check.id === 'provider.periodic_dislocation_dipole_evidence_contract' && check.status === 'pass'))
  } finally {
    unregister()
  }
}

void testStandaloneReplayAndTamper().then(testBrokerArtifactContract).then(() => {
  console.log('agent periodic-dislocation dipole evidence tests passed')
})
