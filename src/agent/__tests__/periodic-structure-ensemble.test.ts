import { assertEqual, assertTrue } from '../../testing/assert'
import type { Mat3, ZatomStructure } from '../contracts'
import { ZATOM_STRUCTURE_SCHEMA } from '../contracts'
import { callZatomMcpTool } from '../mcp-adapter'
import {
  fingerprintPeriodicStructureEnsemble,
  fingerprintPeriodicStructureIdentity,
  parseZatomPeriodicStructureEnsemble,
  type ZatomPeriodicStructureEnsemble,
  ZatomPeriodicStructureEnsembleInputError,
  ZATOM_PERIODIC_STRUCTURE_ENSEMBLE_SCHEMA,
} from '../periodic-structure-ensemble'
import { ZATOM_PROVIDER_SCHEMA, type ZatomModelingProvider, ZatomProviderError } from '../provider'
import { registerZatomModelingProvider } from '../provider-tools'
import { fingerprintStructure } from '../structure-math'

type MemberKind = 'selected' | 'rotated' | 'distorted'

function structure(kind: MemberKind): ZatomStructure {
  if (kind === 'rotated') {
    return {
      schemaVersion: ZATOM_STRUCTURE_SCHEMA,
      label: 'rotated periodic fixture',
      lattice: {
        vectors: [[0, 3, 0], [-3, 0, 0], [0, 0, 3]],
        periodic: [true, true, true],
      },
      atoms: [
        { id: 'a', element: 'Si', position: [0, 0, 0] },
        { id: 'b', element: 'Si', position: [-1.5, 1.5, 1.5] },
      ],
      metadata: { fixtureKind: kind },
    }
  }
  if (kind === 'distorted') {
    return {
      schemaVersion: ZATOM_STRUCTURE_SCHEMA,
      label: 'strained and internally distorted periodic fixture',
      lattice: {
        vectors: [[3.06, 0, 0], [0, 2.97, 0], [0, 0, 3.03]],
        periodic: [true, true, true],
      },
      atoms: [
        { id: 'a', element: 'Si', position: [0, 0, 0] },
        { id: 'b', element: 'Si', position: [3.06 * 0.52, 2.97 * 0.48, 3.03 * 0.5] },
      ],
      metadata: { fixtureKind: kind },
    }
  }
  return {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    label: 'selected periodic fixture',
    lattice: {
      vectors: [[3, 0, 0], [0, 3, 0], [0, 0, 3]],
      periodic: [true, true, true],
    },
    atoms: [
      { id: 'a', element: 'Si', position: [0, 0, 0] },
      { id: 'b', element: 'Si', position: [1.5, 1.5, 1.5] },
    ],
    metadata: { fixtureKind: kind },
  }
}

function fixture(): { selected: ZatomStructure; ensemble: ZatomPeriodicStructureEnsemble } {
  const selected = structure('selected')
  const rotated = structure('rotated')
  const distorted = structure('distorted')
  const members = [
    { id: 'member-c', weight: 0.3, structure: distorted },
    { id: 'member-a', weight: 0.5, structure: selected },
    { id: 'member-b', weight: 0.2, structure: rotated },
  ].map((member) => ({
    ...member,
    structureFingerprint: fingerprintStructure(member.structure),
    evidenceSourceIds: ['fixture-periodic-sampler'],
  }))
  return {
    selected,
    ensemble: {
      schemaVersion: ZATOM_PERIODIC_STRUCTURE_ENSEMBLE_SCHEMA,
      identityFingerprint: fingerprintPeriodicStructureIdentity(selected),
      periodic: [true, true, true],
      members,
      selection: {
        selectedMemberId: 'member-a',
        method: 'maximum-weight',
        rationale: 'Select the maximum calibrated fixture weight.',
      },
      weightModel: {
        kind: 'posterior-probability',
        method: 'Fixture posterior over cell and fractional internal coordinates',
        assumptions: [
          'The three retained periodic structures exhaust fixture support.',
          'Weights are calibrated fixture probabilities.',
        ],
        applicability: {
          assessment: 'in-domain',
          domain: 'This exact two-atom periodic regression fixture.',
          reasons: ['Constructed to exercise periodic cell and fractional-coordinate uncertainty.'],
        },
        scopeWarning: 'Fixture weights and cells are not scientific predictions.',
      },
      acceptance: {
        minimumWeightEffectiveMemberCount: 2.5,
        maximumPeriodicCellConditionNumber: 2,
        maximumFullCellConditionNumber: 2,
      },
      evidenceSources: [{
        id: 'fixture-periodic-sampler',
        engine: 'fixture-periodic-sampler',
        engineVersion: '1.0.0',
        method: 'Generate selected, globally rotated, and strained/distorted periodic members',
        artifacts: [{
          id: 'fixture-periodic-draws',
          role: 'Exact periodic cell and coordinate draws',
          fingerprint: 'sha256:fixture-periodic-draws',
        }],
        citations: ['urn:zatom:test:periodic-structure-source'],
        scopeWarning: 'Fixture-only periodic structural evidence.',
      }],
      provenance: {
        engine: 'fixture-periodic-ensemble',
        engineVersion: '1.0.0',
        method: 'Assemble a calibrated periodic structural ensemble',
        artifacts: [{
          id: 'fixture-periodic-manifest',
          role: 'Exact periodic member weights and selection',
          fingerprint: 'sha256:fixture-periodic-manifest',
        }],
        parameters: { memberCount: 3 },
        citations: ['urn:zatom:test:periodic-structure-ensemble'],
        scopeWarning: 'No phase-completeness or convergence claim is represented.',
      },
    },
  }
}

function expectError(run: () => unknown, code: string): void {
  let observed: unknown
  try {
    run()
  } catch (error) {
    observed = error
  }
  assertTrue(observed instanceof ZatomPeriodicStructureEnsembleInputError)
  assertEqual((observed as ZatomPeriodicStructureEnsembleInputError).code, code)
}

async function testCanonicalDiagnosticsAndMcp(): Promise<void> {
  const { selected, ensemble } = fixture()
  const parsed = parseZatomPeriodicStructureEnsemble(ensemble, { selectedStructure: selected })
  assertEqual(parsed.ensemble.members.map((member) => member.id).join(','), 'member-a,member-b,member-c')
  assertEqual(fingerprintPeriodicStructureEnsemble(parsed.ensemble), parsed.fingerprint)
  assertEqual(parsed.diagnostics.periodicDimension, 3)
  assertEqual(parsed.diagnostics.periodicMeasureUnit, 'angstrom^3')
  assertTrue(parsed.diagnostics.expectedPairwisePeriodicMetricRms > 0)
  assertTrue(parsed.diagnostics.expectedPairwiseFullCellMetricRms > 0)
  assertTrue(parsed.diagnostics.expectedPairwiseFractionalInternalDistanceMatrixRmsA > 0)
  assertTrue(parsed.diagnostics.minimumMemberPairDistanceA! > 2)
  assertTrue(parsed.diagnostics.minimumImageCandidateEvaluationCount > 0)
  assertEqual(parsed.diagnostics.periodicGaugeDuplicateGroups.length, 1)
  assertEqual(parsed.diagnostics.periodicGaugeDuplicateGroups[0].join(','), 'member-a,member-b')
  assertTrue(parsed.checks.some((check) => (
    check.id === 'periodic_structure_ensemble.periodic_gauge_duplicates' && check.status === 'warn'
  )))
  assertTrue(parsed.inspectionTargets.some((target) => (
    target.id === 'periodic-structure-ensemble-largest-internal-spread'
  )))

  const reordered: ZatomPeriodicStructureEnsemble = {
    ...ensemble,
    members: [...ensemble.members].reverse(),
  }
  assertEqual(
    parseZatomPeriodicStructureEnsemble(reordered, { selectedStructure: selected }).fingerprint,
    parsed.fingerprint,
  )

  const tool = await callZatomMcpTool('structure_validate_periodic_ensemble', {
    ensemble,
    structure: selected,
    useActiveStructure: false,
  })
  assertTrue(tool.structuredContent.ok, tool.structuredContent.summary)
  const toolData = tool.structuredContent.data as { fingerprint: string }
  assertEqual(toolData.fingerprint, parsed.fingerprint)
}

function testFailureModesAndPartialPeriodicity(): void {
  const { selected, ensemble } = fixture()
  expectError(
    () => parseZatomPeriodicStructureEnsemble(ensemble, {
      selectedStructure: structure('rotated'),
    }),
    'periodic_structure_ensemble_selected_structure_mismatch',
  )

  const identityDrift: ZatomStructure = {
    ...ensemble.members[0].structure,
    atoms: ensemble.members[0].structure.atoms.map((atom, index) => (
      index === 0 ? { ...atom, element: 'Ge' } : atom
    )),
  }
  expectError(
    () => parseZatomPeriodicStructureEnsemble({
      ...ensemble,
      members: ensemble.members.map((member, index) => index === 0 ? {
        ...member,
        structure: identityDrift,
        structureFingerprint: fingerprintStructure(identityDrift),
      } : member),
    }, { selectedStructure: selected }),
    'periodic_structure_ensemble_identity_mismatch',
  )

  const periodicityDrift: ZatomStructure = {
    ...ensemble.members[0].structure,
    lattice: { ...ensemble.members[0].structure.lattice!, periodic: [true, true, false] },
  }
  expectError(
    () => parseZatomPeriodicStructureEnsemble({
      ...ensemble,
      members: ensemble.members.map((member, index) => index === 0 ? {
        ...member,
        structure: periodicityDrift,
        structureFingerprint: fingerprintStructure(periodicityDrift),
      } : member),
    }, { selectedStructure: selected }),
    'periodic_structure_ensemble_periodicity_mismatch',
  )

  const leftHanded: ZatomStructure = {
    ...ensemble.members[0].structure,
    lattice: {
      ...ensemble.members[0].structure.lattice!,
      vectors: ensemble.members[0].structure.lattice!.vectors.map((vector, index) => (
        index === 2 ? vector.map((value) => -value) : vector
      )) as Mat3,
    },
  }
  expectError(
    () => parseZatomPeriodicStructureEnsemble({
      ...ensemble,
      members: ensemble.members.map((member, index) => index === 0 ? {
        ...member,
        structure: leftHanded,
        structureFingerprint: fingerprintStructure(leftHanded),
      } : member),
    }, { selectedStructure: selected }),
    'periodic_structure_ensemble_cell_orientation_mismatch',
  )

  expectError(
    () => parseZatomPeriodicStructureEnsemble({
      ...ensemble,
      members: ensemble.members.map((member, index) => ({
        ...member,
        weight: index === 0 ? member.weight + 0.1 : member.weight,
      })),
    }, { selectedStructure: selected }),
    'periodic_structure_ensemble_weight_mismatch',
  )
  expectError(
    () => parseZatomPeriodicStructureEnsemble({
      ...ensemble,
      acceptance: { ...ensemble.acceptance, minimumWeightEffectiveMemberCount: 3 },
    }, { selectedStructure: selected }),
    'periodic_structure_ensemble_weight_effective_size_failed',
  )
  expectError(
    () => parseZatomPeriodicStructureEnsemble(ensemble, {
      selectedStructure: selected,
      maxMemberAtomPairs: 2,
    }),
    'periodic_structure_ensemble_budget_exceeded',
  )
  expectError(
    () => parseZatomPeriodicStructureEnsemble(ensemble, {
      selectedStructure: selected,
      maxMinimumImageCandidateEvaluations: 10,
    }),
    'periodic_structure_ensemble_budget_exceeded',
  )

  const illConditioned: ZatomStructure = {
    ...ensemble.members[0].structure,
    lattice: {
      ...ensemble.members[0].structure.lattice!,
      vectors: [[0.001, 0, 0], [0, 3, 0], [0, 0, 3]],
    },
  }
  expectError(
    () => parseZatomPeriodicStructureEnsemble({
      ...ensemble,
      members: ensemble.members.map((member, index) => index === 0 ? {
        ...member,
        structure: illConditioned,
        structureFingerprint: fingerprintStructure(illConditioned),
      } : member),
    }, { selectedStructure: selected }),
    'periodic_structure_ensemble_cell_condition_failed',
  )

  const selected2d: ZatomStructure = {
    ...selected,
    lattice: { ...selected.lattice!, periodic: [true, true, false] },
  }
  const distortedMember = ensemble.members.find((member) => member.id === 'member-c')!
  const distorted2d: ZatomStructure = {
    ...distortedMember.structure,
    lattice: {
      ...distortedMember.structure.lattice!,
      vectors: [
        distortedMember.structure.lattice!.vectors[0],
        distortedMember.structure.lattice!.vectors[1],
        [0, 0, 3],
      ],
      periodic: [true, true, false],
    },
  }
  const ensemble2d: ZatomPeriodicStructureEnsemble = {
    ...ensemble,
    identityFingerprint: fingerprintPeriodicStructureIdentity(selected2d),
    periodic: [true, true, false],
    members: [
      {
        ...ensemble.members.find((member) => member.id === 'member-a')!,
        id: 'member-a',
        weight: 0.6,
        structure: selected2d,
        structureFingerprint: fingerprintStructure(selected2d),
      },
      {
        ...distortedMember,
        id: 'member-c',
        weight: 0.4,
        structure: distorted2d,
        structureFingerprint: fingerprintStructure(distorted2d),
      },
    ],
    acceptance: {
      minimumWeightEffectiveMemberCount: 1.5,
      maximumPeriodicCellConditionNumber: 2,
      maximumFullCellConditionNumber: 2,
    },
  }
  const parsed2d = parseZatomPeriodicStructureEnsemble(ensemble2d, { selectedStructure: selected2d })
  assertEqual(parsed2d.diagnostics.periodicDimension, 2)
  assertEqual(parsed2d.diagnostics.periodicMeasureUnit, 'angstrom^2')
  assertTrue(parsed2d.checks.some((check) => (
    check.id === 'periodic_structure_ensemble.nonperiodic_cell_scope' && check.status === 'pass'
  )))

  const tiltedA = Math.sqrt(3 ** 2 - 0.5 ** 2)
  const tilted2d: ZatomStructure = {
    ...selected2d,
    label: 'partial-PBC cross-metric tilt fixture',
    lattice: {
      vectors: [[tiltedA, 0, 0.5], [0, 3, 0], [0, 0, 3]],
      periodic: [true, true, false],
    },
    atoms: [
      { ...selected2d.atoms[0], position: [0, 0, 0] },
      { ...selected2d.atoms[1], position: [tiltedA / 2, 1.5, 1.75] },
    ],
  }
  const tiltedEnsemble: ZatomPeriodicStructureEnsemble = {
    ...ensemble2d,
    members: [
      { ...ensemble2d.members[0], weight: 0.5 },
      {
        ...ensemble2d.members[1],
        weight: 0.5,
        structure: tilted2d,
        structureFingerprint: fingerprintStructure(tilted2d),
      },
    ],
  }
  const tiltedParsed = parseZatomPeriodicStructureEnsemble(tiltedEnsemble, {
    selectedStructure: selected2d,
  })
  assertTrue(tiltedParsed.diagnostics.expectedPairwisePeriodicMetricRms < 1e-12)
  assertTrue(tiltedParsed.diagnostics.expectedPairwiseFullCellMetricRms > 0)

  const nonperiodicDrift: ZatomStructure = {
    ...distorted2d,
    lattice: {
      ...distorted2d.lattice!,
      vectors: [distorted2d.lattice!.vectors[0], distorted2d.lattice!.vectors[1], [0, 0, 3.2]],
    },
  }
  expectError(
    () => parseZatomPeriodicStructureEnsemble({
      ...ensemble2d,
      members: ensemble2d.members.map((member) => member.id === 'member-c' ? {
        ...member,
        structure: nonperiodicDrift,
        structureFingerprint: fingerprintStructure(nonperiodicDrift),
      } : member),
    }, { selectedStructure: selected2d }),
    'periodic_structure_ensemble_nonperiodic_cell_mismatch',
  )

  const temperatureK = 300
  const gasConstantKcalPerMolK = 0.00198720425864083
  const maximumWeight = Math.max(...ensemble.members.map((member) => member.weight))
  const boltzmann: ZatomPeriodicStructureEnsemble = {
    ...ensemble,
    members: ensemble.members.map((member) => ({
      ...member,
      relativeFreeEnergyKcalMol:
        -gasConstantKcalPerMolK * temperatureK * Math.log(member.weight / maximumWeight),
    })),
    weightModel: {
      ...ensemble.weightModel,
      kind: 'boltzmann-free-energy',
      temperatureK,
      method: 'Fixture Boltzmann probabilities from periodic free energies',
    },
  }
  const parsedBoltzmann = parseZatomPeriodicStructureEnsemble(boltzmann, {
    selectedStructure: selected,
  })
  assertEqual(Math.min(...parsedBoltzmann.ensemble.members.map((member) => (
    member.relativeFreeEnergyKcalMol!
  ))), 0)
  const potentialBoltzmann: ZatomPeriodicStructureEnsemble = {
    ...boltzmann,
    members: boltzmann.members.map((member) => {
      const { relativeFreeEnergyKcalMol, ...rest } = member
      return { ...rest, relativePotentialEnergyKcalMol: relativeFreeEnergyKcalMol! }
    }),
    weightModel: {
      ...boltzmann.weightModel,
      kind: 'boltzmann-potential-energy',
      method: 'Fixture Boltzmann probabilities from periodic potential energies',
    },
  }
  const parsedPotentialBoltzmann = parseZatomPeriodicStructureEnsemble(potentialBoltzmann, {
    selectedStructure: selected,
  })
  assertEqual(parsedPotentialBoltzmann.ensemble.weightModel.kind, 'boltzmann-potential-energy')
  assertEqual(Math.min(...parsedPotentialBoltzmann.ensemble.members.map((member) => (
    member.relativePotentialEnergyKcalMol!
  ))), 0)
  expectError(
    () => parseZatomPeriodicStructureEnsemble({
      ...boltzmann,
      members: boltzmann.members.map((member, index) => ({
        ...member,
        weight: index === 0 ? member.weight + 1e-4
          : index === 1 ? member.weight - 1e-4
            : member.weight,
      })),
    }, { selectedStructure: selected }),
    'periodic_structure_ensemble_boltzmann_weight_mismatch',
  )
}

async function testProviderBrokerIntegration(): Promise<void> {
  const { selected, ensemble } = fixture()
  const provider: ZatomModelingProvider = {
    manifest: {
      schemaVersion: ZATOM_PROVIDER_SCHEMA,
      id: 'test.periodic-structure-ensemble',
      title: 'Periodic structure ensemble fixture provider',
      description: 'Return calibrated periodic cell and fractional-coordinate alternatives.',
      adapterVersion: '1.0.0',
      engine: { name: 'fixture-periodic-ensemble', version: '1.0.0' },
      execution: 'browser',
      capabilities: [{
        id: 'crystal.sample.fixture-periodic-ensemble',
        title: 'Fixture periodic ensemble',
        description: 'Return a bounded periodic structural ensemble fixture.',
        fidelity: 'statistical',
        source: 'none',
        deterministic: true,
        inputSchema: { type: 'object', additionalProperties: false },
        requiredCheckIds: ['fixture.periodic_ensemble'],
        outputArtifacts: ['periodic-structure-ensemble'],
        tags: ['periodic', 'cell-uncertainty'],
      }],
    },
    execute: () => ({
      structure: selected,
      periodicStructureEnsemble: ensemble,
      checks: [{
        id: 'fixture.periodic_ensemble',
        status: 'pass',
        message: 'Fixture periodic ensemble completed',
      }],
    }),
  }
  const unregister = registerZatomModelingProvider(provider)
  try {
    const response = await callZatomMcpTool('modeling_run_provider', {
      providerId: provider.manifest.id,
      capability: provider.manifest.capabilities[0].id,
      parameters: {},
      applyToWorkspace: false,
    })
    assertTrue(response.structuredContent.ok, response.structuredContent.summary)
    const data = response.structuredContent.data as {
      result: {
        periodicStructureEnsemble: ZatomPeriodicStructureEnsemble
        provenance: { periodicStructureEnsembleFingerprint: string }
        checks: Array<{ id: string; status: string }>
      }
    }
    assertEqual(data.result.periodicStructureEnsemble.members.length, 3)
    assertTrue(data.result.provenance.periodicStructureEnsembleFingerprint.startsWith('fnv1a64:'))
    assertTrue(data.result.checks.some((check) => (
      check.id === 'provider.periodic_structure_ensemble_contract' && check.status === 'pass'
    )))
  } finally {
    unregister()
  }

  const invalidProvider: ZatomModelingProvider = {
    ...provider,
    manifest: {
      ...provider.manifest,
      id: 'test.invalid-periodic-ensemble-manifest',
      capabilities: [{
        ...provider.manifest.capabilities[0],
        outputArtifacts: ['structure-ensemble', 'periodic-structure-ensemble'],
      }],
    },
  }
  let manifestError: unknown
  try {
    registerZatomModelingProvider(invalidProvider)
  } catch (error) {
    manifestError = error
  }
  assertTrue(manifestError instanceof ZatomProviderError)
  assertEqual((manifestError as ZatomProviderError).code, 'invalid_provider_manifest')
}

async function main(): Promise<void> {
  await testCanonicalDiagnosticsAndMcp()
  testFailureModesAndPartialPeriodicity()
  await testProviderBrokerIntegration()
  console.log('agent periodic structure ensemble tests passed')
}

void main()
