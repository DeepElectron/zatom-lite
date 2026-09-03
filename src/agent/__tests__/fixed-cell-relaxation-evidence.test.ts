import { assertEqual, assertTrue } from '../../testing/assert'
import type { ZatomStructure } from '../contracts'
import {
  composeZatomFixedCellRelaxationEvidence,
  fingerprintFixedCellRelaxationEvidence,
  fingerprintLammpsPotentialCommands,
  type ZatomFixedCellRelaxationEvidence,
} from '../fixed-cell-relaxation-evidence'
import { callZatomMcpTool } from '../mcp-adapter'
import type { ZatomModelingProvider } from '../provider'
import { ZATOM_PROVIDER_SCHEMA } from '../provider'
import { registerZatomModelingProvider } from '../provider-tools'
import { certifiedMinimumImageVector, fractionalToCartesian } from '../structure-math'

const source: ZatomStructure = {
  schemaVersion: 'zatom.structure/v1',
  label: 'synthetic periodic pair before relaxation',
  atoms: [
    { id: 'fe-1', element: 'Fe', position: [0, 0, 0], properties: { site: 1 } },
    { id: 'fe-2', element: 'Fe', position: [2, 0, 0], properties: { site: 2 } },
  ],
  lattice: { vectors: [[5, 0, 0], [0, 5, 0], [0, 0, 5]], periodic: [true, true, true] },
}

const result: ZatomStructure = {
  schemaVersion: 'zatom.structure/v1',
  label: 'synthetic periodic pair after relaxation',
  atoms: [
    {
      id: 'fe-1',
      element: 'Fe',
      position: [0.1, 0, 0],
      properties: {
        site: 1,
        'zatom.lammps.forceEvPerA': [0.01, 0.002, 0],
        'zatom.lammps.forceMagnitudeEvPerA': Math.hypot(0.01, 0.002),
      },
    },
    {
      id: 'fe-2',
      element: 'Fe',
      position: [1.9, 0, 0],
      properties: {
        site: 2,
        'zatom.lammps.forceEvPerA': [-0.01, -0.002, 0],
        'zatom.lammps.forceMagnitudeEvPerA': Math.hypot(0.01, 0.002),
      },
    },
  ],
  lattice: { vectors: [[5, 0, 0], [0, 5, 0], [0, 0, 5]], periodic: [true, true, true] },
  metadata: {
    'zatom.lammps.potential': 'fixture-fe',
    'zatom.lammps.potentialVersion': '1',
    'zatom.lammps.engineVersion': 'fixture',
    'zatom.lammps.geometricState': 'position-minimized-fixed-cell',
  },
}

function stress(pressureBar: number) {
  return {
    pressureBar,
    tensorBar: { xx: pressureBar + 10, yy: pressureBar, zz: pressureBar - 10, xy: 2, xz: -1, yz: 3 },
    volumeA3: 125,
    quantity: 'pressure-tensor' as const,
    signConvention: 'positive-compression' as const,
    coordinateFrame: 'source-cartesian' as const,
  }
}

function composeEvidence(resultStructure: ZatomStructure = result): ZatomFixedCellRelaxationEvidence {
  return composeZatomFixedCellRelaxationEvidence({
    sourceStructure: source,
    resultStructure,
    method: {
      kind: 'position-minimization',
      cellConstraint: 'fixed',
      temperatureK: 0,
      engine: 'LAMMPS',
      engineVersion: 'fixture',
    },
    model: {
      id: 'fixture-fe',
      version: '1',
      description: 'Synthetic Fe potential contract fixture',
      elements: ['Fe'],
      commandsFingerprint: fingerprintLammpsPotentialCommands(['pair_style zero 10.0']),
      artifacts: [],
      citations: [],
      scopeWarning: 'Synthetic model; no scientific applicability claim.',
    },
    settings: {
      maxIterations: 100,
      maxEvaluations: 1000,
      energyTolerance: 1e-10,
      forceToleranceEvPerA: 1e-6,
      minStyle: 'cg',
      fixedAtomIds: [],
    },
    observations: {
      initial: {
        potentialEnergyEv: -10,
        reportedMaxForceComponentRestrictedEvPerA: 0.2,
        step: 0,
        stress: stress(100),
      },
      final: {
        potentialEnergyEv: -10.5,
        reportedMaxForceComponentRestrictedEvPerA: 0.01,
        step: 8,
        stress: stress(20),
      },
    },
    acceptance: {
      maximumEnergyIncreaseEv: 1e-9,
      maximumForceEvPerA: 0.02,
      maximumDisplacementA: 0.2,
      maximumFixedAtomDisplacementA: 0,
      minimumPairDistanceA: 1,
    },
    provenance: {
      providerId: 'test.fixture-lammps',
      adapterVersion: '1.4.0',
      executable: { realPath: '/opt/pinned/lmp', totalBytes: 1024, sha256: `sha256:${'a'.repeat(64)}` },
      parameters: { fixture: true },
      citations: ['https://docs.lammps.org/minimize.html'],
      scopeWarning: 'Synthetic fixed-cell relaxation fixture.',
    },
  }).evidence
}

async function testStandaloneReplayAndTamper(): Promise<void> {
  const evidence = composeEvidence()
  assertEqual(evidence.metrics.acceptancePassed, true)
  assertTrue(Math.abs(evidence.metrics.maximumDisplacementA - 0.1) < 1e-12)
  assertTrue(Math.abs(evidence.metrics.minimumPairDistanceA - 1.8) < 1e-12)
  const replay = await callZatomMcpTool('relaxation_validate_fixed_cell_evidence', {
    evidence,
    sourceStructure: source,
    resultStructure: result,
    useActiveResult: false,
  })
  assertTrue(replay.structuredContent.ok, replay.structuredContent.summary)

  const tampered = structuredClone(evidence)
  tampered.observations.final.potentialEnergyEv -= 1
  const rejected = await callZatomMcpTool('relaxation_validate_fixed_cell_evidence', {
    evidence: tampered,
    sourceStructure: source,
    resultStructure: result,
    useActiveResult: false,
  })
  assertEqual(rejected.structuredContent.ok, false)

  const mismatchedResult = structuredClone(result)
  mismatchedResult.metadata!['zatom.lammps.potential'] = 'different-model'
  let metadataRejected = false
  try {
    composeEvidence(mismatchedResult)
  } catch {
    metadataRejected = true
  }
  assertEqual(metadataRejected, true)
}

function testCertifiedMinimumImageBeyondLocalNeighborhood(): void {
  const lattice = {
    vectors: [[1, 0, 0], [3, 1, 0], [0, 0, 1]] as [[number, number, number], [number, number, number], [number, number, number]],
    periodic: [true, true, true] as [true, true, true],
  }
  const delta = fractionalToCartesian([0.49, 0.49, 0], lattice.vectors)
  const certified = certifiedMinimumImageVector(delta, lattice, 1_000_000)
  let brute = Infinity
  for (let first = -20; first <= 20; first++) for (let second = -20; second <= 20; second++) {
    const vector = fractionalToCartesian([0.49 + first, 0.49 + second, 0], lattice.vectors)
    brute = Math.min(brute, Math.hypot(...vector))
  }
  assertTrue(Math.abs(certified.distance - brute) < 1e-12)
  assertTrue(Math.abs(certified.fractionalImage[0]) > 1, 'exact skew-cell image should lie outside a local ±1 neighborhood')
}

async function testBrokerArtifactContract(): Promise<void> {
  const evidence = composeEvidence()
  const provider: ZatomModelingProvider = {
    manifest: {
      schemaVersion: ZATOM_PROVIDER_SCHEMA,
      id: 'test.synthetic-fixed-cell-relaxation',
      title: 'Synthetic fixed-cell relaxation fixture',
      description: 'Exercise broker artifact binding without an external LAMMPS installation.',
      adapterVersion: '1.4.0',
      engine: { name: 'LAMMPS', version: 'fixture' },
      execution: 'remote',
      capabilities: [{
        id: 'test.fixed-cell-relaxation',
        title: 'Return synthetic relaxation evidence',
        description: 'Testing only.',
        fidelity: 'force-field',
        source: 'required',
        deterministic: true,
        inputSchema: { type: 'object', additionalProperties: false },
        outputArtifacts: ['fixed-cell-relaxation-evidence'],
        requiredCheckIds: ['fixture.contract'],
        tags: ['test'],
      }],
    },
    execute: () => ({
      structure: result,
      fixedCellRelaxationEvidence: evidence,
      checks: [{ id: 'fixture.contract', status: 'pass', message: 'Synthetic producer completed' }],
    }),
  }
  const unregister = registerZatomModelingProvider(provider)
  try {
    const response = await callZatomMcpTool('modeling_run_provider', {
      providerId: provider.manifest.id,
      capability: 'test.fixed-cell-relaxation',
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
        provenance: { fixedCellRelaxationEvidenceFingerprint: string }
      }
    }
    assertEqual(data.applicationBlocked, false)
    assertEqual(data.result.provenance.fixedCellRelaxationEvidenceFingerprint, fingerprintFixedCellRelaxationEvidence(evidence))
    assertTrue(data.result.checks.some((check) => check.id === 'provider.fixed_cell_relaxation_evidence_contract' && check.status === 'pass'))
  } finally {
    unregister()
  }
}

async function main(): Promise<void> {
  testCertifiedMinimumImageBeyondLocalNeighborhood()
  await testStandaloneReplayAndTamper()
  await testBrokerArtifactContract()
  console.log('agent fixed-cell relaxation evidence tests passed')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
