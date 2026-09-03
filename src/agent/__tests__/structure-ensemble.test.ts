import { assertEqual, assertTrue } from '../../testing/assert'
import type { ZatomStructure } from '../contracts'
import { ZATOM_STRUCTURE_SCHEMA } from '../contracts'
import { fingerprintForceFieldTopology } from '../force-field-package'
import { callZatomMcpTool } from '../mcp-adapter'
import { ZATOM_PROVIDER_SCHEMA, type ZatomModelingProvider } from '../provider'
import { registerZatomModelingProvider } from '../provider-tools'
import {
  fingerprintStructureEnsemble,
  parseZatomStructureEnsemble,
  type ZatomStructureEnsemble,
  ZatomStructureEnsembleInputError,
  ZATOM_STRUCTURE_ENSEMBLE_SCHEMA,
} from '../structure-ensemble'
import { fingerprintStructure } from '../structure-math'

const GAS_CONSTANT_KCAL_PER_MOL_K = 0.00198720425864083

function structure(
  id: string,
  transform: (position: [number, number, number], atomIndex: number) => [number, number, number] = (
    position,
  ) => position,
): ZatomStructure {
  const positions: Array<[number, number, number]> = [
    [0, 0, 0],
    [1.35, 0, 0],
    [-0.55, 0.92, 0],
    [-0.55, -0.46, 0.8],
  ]
  return {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    label: `formaldehyde-like fixture ${id}`,
    atoms: [
      { id: 'c', element: 'C', position: transform(positions[0], 0), properties: { formalCharge: 0 } },
      { id: 'o', element: 'O', position: transform(positions[1], 1), properties: { formalCharge: 0 } },
      { id: 'h-1', element: 'H', position: transform(positions[2], 2), properties: { formalCharge: 0 } },
      { id: 'h-2', element: 'H', position: transform(positions[3], 3), properties: { formalCharge: 0 } },
    ],
    bonds: [
      { id: 'b-co', atomIds: ['c', 'o'], order: 2 },
      { id: 'b-ch-1', atomIds: ['c', 'h-1'], order: 1 },
      { id: 'b-ch-2', atomIds: ['c', 'h-2'], order: 1 },
    ],
    metadata: { fixtureMemberId: id },
  }
}

function fixture(): { selected: ZatomStructure; ensemble: ZatomStructureEnsemble } {
  const selected = structure('member-a')
  const translated = structure('member-b', ([x, y, z]) => [x + 5, y - 2, z + 1])
  const distorted = structure('member-c', ([x, y, z], atomIndex) => (
    atomIndex === 3 ? [x - 0.2, y + 0.35, z + 0.15] : [x, y, z]
  ))
  const members = [
    { id: 'member-c', weight: 0.2, structure: distorted },
    { id: 'member-a', weight: 0.5, structure: selected },
    { id: 'member-b', weight: 0.3, structure: translated },
  ].map((member) => ({
    ...member,
    structureFingerprint: fingerprintStructure(member.structure),
    evidenceSourceIds: ['fixture-sampler'],
  }))
  return {
    selected,
    ensemble: {
      schemaVersion: ZATOM_STRUCTURE_ENSEMBLE_SCHEMA,
      topologyFingerprint: fingerprintForceFieldTopology(selected),
      members,
      selection: {
        selectedMemberId: 'member-a',
        method: 'maximum-weight',
        rationale: 'Select the maximum calibrated posterior-weight fixture member.',
      },
      weightModel: {
        kind: 'posterior-probability',
        method: 'Fixture discrete posterior over a fixed molecular topology',
        assumptions: [
          'The three retained geometries exhaust the fixture posterior support.',
          'Member weights are calibrated posterior probabilities.',
        ],
        applicability: {
          assessment: 'in-domain',
          domain: 'This exact four-atom regression fixture.',
          reasons: ['Constructed to exercise fixed-topology structural uncertainty.'],
        },
        scopeWarning: 'Fixture weights and structures are not scientific predictions.',
      },
      acceptance: { minimumWeightEffectiveMemberCount: 2 },
      evidenceSources: [{
        id: 'fixture-sampler',
        engine: 'fixture-structural-sampler',
        engineVersion: '1.0.0',
        method: 'Construct one selected, one rigidly translated, and one internally distorted geometry',
        artifacts: [{
          id: 'fixture-structural-draws',
          role: 'Exact structural regression inputs',
          fingerprint: 'sha256:fixture-structural-draws',
        }],
        citations: ['urn:zatom:test:structure-ensemble-source'],
        scopeWarning: 'Fixture-only member evidence.',
      }],
      provenance: {
        engine: 'fixture-structure-ensemble',
        engineVersion: '1.0.0',
        method: 'Assemble a calibrated fixed-topology structural hypothesis ensemble',
        artifacts: [{
          id: 'fixture-ensemble-manifest',
          role: 'Exact weight and selection manifest',
          fingerprint: 'sha256:fixture-structure-ensemble-manifest',
        }],
        parameters: { memberCount: 3 },
        citations: ['urn:zatom:test:structure-ensemble'],
        scopeWarning: 'No omitted conformer or chemical-identity uncertainty is represented.',
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
  assertTrue(observed instanceof ZatomStructureEnsembleInputError)
  assertEqual((observed as ZatomStructureEnsembleInputError).code, code)
}

function assertApprox(actual: number, expected: number, tolerance = 1e-12): void {
  assertTrue(Math.abs(actual - expected) <= tolerance, `Expected ${expected} ± ${tolerance}, got ${actual}`)
}

function boltzmannFixture(base: ZatomStructureEnsemble): ZatomStructureEnsemble {
  const temperatureK = 300
  const energies = new Map([
    ['member-a', 0],
    ['member-b', 0.5],
    ['member-c', 1],
  ])
  const unnormalized = base.members.map((member) => (
    Math.exp(-energies.get(member.id)! / (GAS_CONSTANT_KCAL_PER_MOL_K * temperatureK))
  ))
  const sum = unnormalized.reduce((total, value) => total + value, 0)
  return {
    ...base,
    members: base.members.map((member, index) => ({
      ...member,
      weight: unnormalized[index] / sum,
      relativeFreeEnergyKcalMol: energies.get(member.id)!,
    })),
    selection: {
      selectedMemberId: 'member-a',
      method: 'maximum-weight',
      rationale: 'Select the maximum Boltzmann probability member.',
    },
    weightModel: {
      ...base.weightModel,
      kind: 'boltzmann-free-energy',
      temperatureK,
      method: 'Independently normalized Boltzmann probabilities from relative free energies',
      assumptions: ['Relative free energies are exact fixture values at 300 K.'],
    },
    acceptance: { minimumWeightEffectiveMemberCount: 1 },
  }
}

async function testCanonicalValidationAndMcp(): Promise<void> {
  const { selected, ensemble } = fixture()
  const parsed = parseZatomStructureEnsemble(ensemble, { selectedStructure: selected })
  assertEqual(parsed.ensemble.members.map((member) => member.id).join(','), 'member-a,member-b,member-c')
  assertEqual(fingerprintStructureEnsemble(parsed.ensemble), parsed.fingerprint)
  assertTrue(parsed.weightEffectiveMemberCount > 2.6)
  assertTrue(parsed.geometryDiagnostics.expectedPairwiseMemberDistanceMatrixRmsdA > 0)
  assertEqual(parsed.geometryDiagnostics.rigidTransformDuplicateGroups.length, 1)
  assertEqual(parsed.geometryDiagnostics.rigidTransformDuplicateGroups[0].join(','), 'member-a,member-b')
  assertTrue(parsed.checks.some((check) => (
    check.id === 'structure_ensemble.rigid_transform_duplicates' && check.status === 'warn'
  )))
  assertTrue(parsed.inspectionTargets.some((target) => target.id === 'structure-ensemble-largest-internal-spread'))

  const reordered: ZatomStructureEnsemble = {
    ...ensemble,
    members: [...ensemble.members].reverse(),
  }
  assertEqual(
    parseZatomStructureEnsemble(reordered, { selectedStructure: selected }).fingerprint,
    parsed.fingerprint,
  )

  const tool = await callZatomMcpTool('structure_validate_ensemble', {
    ensemble,
    structure: selected,
    useActiveStructure: false,
  })
  assertTrue(tool.structuredContent.ok, tool.structuredContent.summary)
  const toolData = tool.structuredContent.data as { fingerprint: string }
  assertEqual(toolData.fingerprint, parsed.fingerprint)
}

function testFailureModesAndBoltzmannWeights(): void {
  const { selected, ensemble } = fixture()
  expectError(
    () => parseZatomStructureEnsemble(ensemble, {
      selectedStructure: ensemble.members.find((member) => member.id === 'member-b')!.structure,
    }),
    'structure_ensemble_selected_structure_mismatch',
  )

  const topologyDrift = {
    ...ensemble.members[0].structure,
    atoms: ensemble.members[0].structure.atoms.map((atom, index) => (
      index === 0 ? { ...atom, element: 'N' } : atom
    )),
  }
  expectError(
    () => parseZatomStructureEnsemble({
      ...ensemble,
      members: ensemble.members.map((member, index) => index === 0 ? {
        ...member,
        structure: topologyDrift,
        structureFingerprint: fingerprintStructure(topologyDrift),
      } : member),
    }, { selectedStructure: selected }),
    'structure_ensemble_topology_mismatch',
  )

  expectError(
    () => parseZatomStructureEnsemble({
      ...ensemble,
      members: ensemble.members.map((member, index) => ({
        ...member,
        weight: index === 0 ? member.weight + 0.1 : member.weight,
      })),
    }, { selectedStructure: selected }),
    'structure_ensemble_weight_mismatch',
  )
  expectError(
    () => parseZatomStructureEnsemble({
      ...ensemble,
      acceptance: { minimumWeightEffectiveMemberCount: 3 },
    }, { selectedStructure: selected }),
    'structure_ensemble_weight_effective_size_failed',
  )
  expectError(
    () => parseZatomStructureEnsemble(ensemble, {
      selectedStructure: selected,
      maxPairDistanceEvaluations: 1,
    }),
    'structure_ensemble_budget_exceeded',
  )
  expectError(
    () => parseZatomStructureEnsemble({
      ...ensemble,
      members: ensemble.members.map((member) => member.id === 'member-b' ? {
        ...member,
        structure: selected,
        structureFingerprint: fingerprintStructure(selected),
      } : member),
    }, { selectedStructure: selected }),
    'invalid_structure_ensemble',
  )
  expectError(
    () => parseZatomStructureEnsemble({
      ...ensemble,
      members: ensemble.members.map((member, index) => index === 0
        ? { ...member, evidenceSourceIds: ['missing-source'] }
        : member),
    }, { selectedStructure: selected }),
    'structure_ensemble_evidence_mismatch',
  )

  const boltzmann = boltzmannFixture(ensemble)
  const parsed = parseZatomStructureEnsemble(boltzmann, { selectedStructure: selected })
  assertEqual(parsed.ensemble.weightModel.kind, 'boltzmann-free-energy')
  assertEqual(Math.min(...parsed.ensemble.members.map((member) => member.relativeFreeEnergyKcalMol!)), 0)
  assertApprox(parsed.ensemble.members.reduce((sum, member) => sum + member.weight, 0), 1)
  const shifted: ZatomStructureEnsemble = {
    ...boltzmann,
    members: boltzmann.members.map((member) => ({
      ...member,
      relativeFreeEnergyKcalMol: member.relativeFreeEnergyKcalMol! + 10,
    })),
  }
  assertEqual(
    parseZatomStructureEnsemble(shifted, { selectedStructure: selected }).fingerprint,
    parsed.fingerprint,
  )
  const potentialEnergy: ZatomStructureEnsemble = {
    ...boltzmann,
    members: boltzmann.members.map((member) => {
      const { relativeFreeEnergyKcalMol, ...rest } = member
      return {
        ...rest,
        relativePotentialEnergyKcalMol: relativeFreeEnergyKcalMol!,
      }
    }),
    weightModel: {
      ...boltzmann.weightModel,
      kind: 'boltzmann-potential-energy',
      method: 'Boltzmann approximation from fixture potential-energy differences',
      assumptions: ['Potential-energy differences omit rovibrational free-energy corrections.'],
    },
  }
  const parsedPotentialEnergy = parseZatomStructureEnsemble(potentialEnergy, {
    selectedStructure: selected,
  })
  assertEqual(parsedPotentialEnergy.ensemble.weightModel.kind, 'boltzmann-potential-energy')
  assertEqual(Math.min(...parsedPotentialEnergy.ensemble.members.map(
    (member) => member.relativePotentialEnergyKcalMol!,
  )), 0)
  const shiftedPotentialEnergy: ZatomStructureEnsemble = {
    ...potentialEnergy,
    members: potentialEnergy.members.map((member) => ({
      ...member,
      relativePotentialEnergyKcalMol: member.relativePotentialEnergyKcalMol! + 7,
    })),
  }
  assertEqual(
    parseZatomStructureEnsemble(shiftedPotentialEnergy, { selectedStructure: selected }).fingerprint,
    parsedPotentialEnergy.fingerprint,
  )
  expectError(
    () => parseZatomStructureEnsemble({
      ...potentialEnergy,
      members: potentialEnergy.members.map((member) => ({
        ...member,
        relativeFreeEnergyKcalMol: member.relativePotentialEnergyKcalMol,
      })),
    }, { selectedStructure: selected }),
    'invalid_structure_ensemble',
  )
  expectError(
    () => parseZatomStructureEnsemble({
      ...boltzmann,
      members: boltzmann.members.map((member, index) => ({
        ...member,
        weight: index === 0 ? member.weight + 1e-4
          : index === 1 ? member.weight - 1e-4
            : member.weight,
      })),
    }, { selectedStructure: selected }),
    'structure_ensemble_boltzmann_weight_mismatch',
  )
  expectError(
    () => parseZatomStructureEnsemble({
      ...boltzmann,
      weightModel: { ...boltzmann.weightModel, temperatureK: 1 },
      members: boltzmann.members.map((member, index) => ({
        ...member,
        relativeFreeEnergyKcalMol: index * 1000,
      })),
    }, { selectedStructure: selected }),
    'structure_ensemble_boltzmann_weight_underflow',
  )

  const overlapStructure: ZatomStructure = {
    ...ensemble.members[0].structure,
    atoms: ensemble.members[0].structure.atoms.map((atom, index, atoms) => (
      index === 3 ? { ...atom, position: [...atoms[2].position] } : atom
    )),
  }
  const overlapValidation = parseZatomStructureEnsemble({
    ...ensemble,
    members: ensemble.members.map((member, index) => index === 0 ? {
      ...member,
      structure: overlapStructure,
      structureFingerprint: fingerprintStructure(overlapStructure),
    } : member),
  }, { selectedStructure: selected })
  assertTrue(overlapValidation.checks.some((check) => (
    check.id === 'structure_ensemble.minimum_distance' && check.status === 'fail'
  )))
  assertTrue(overlapValidation.inspectionTargets.some((target) => (
    target.id === 'structure-ensemble-closest-member-pair'
  )))
}

async function testProviderBrokerIntegration(): Promise<void> {
  const { selected, ensemble } = fixture()
  const provider: ZatomModelingProvider = {
    manifest: {
      schemaVersion: ZATOM_PROVIDER_SCHEMA,
      id: 'test.structure-ensemble-output',
      title: 'Structure ensemble fixture provider',
      description: 'Return a selected structure and its calibrated fixed-topology alternatives.',
      adapterVersion: '1.0.0',
      engine: { name: 'fixture-structure-ensemble', version: '1.0.0' },
      execution: 'browser',
      capabilities: [{
        id: 'molecule.sample.fixture-structure-ensemble',
        title: 'Fixture structural ensemble',
        description: 'Return a bounded structural ensemble fixture.',
        fidelity: 'statistical',
        source: 'none',
        deterministic: true,
        inputSchema: { type: 'object', additionalProperties: false },
        requiredCheckIds: ['fixture.structure_ensemble'],
        outputArtifacts: ['structure-ensemble'],
        tags: ['structure', 'ensemble'],
      }],
    },
    execute: () => ({
      structure: selected,
      structureEnsemble: ensemble,
      checks: [{
        id: 'fixture.structure_ensemble',
        status: 'pass',
        message: 'Fixture structural ensemble completed',
      }],
    }),
  }
  const unregister = registerZatomModelingProvider(provider)
  try {
    const result = await callZatomMcpTool('modeling_run_provider', {
      providerId: provider.manifest.id,
      capability: provider.manifest.capabilities[0].id,
      parameters: {},
      applyToWorkspace: false,
    })
    assertTrue(result.structuredContent.ok, result.structuredContent.summary)
    const data = result.structuredContent.data as {
      result: {
        structureEnsemble: ZatomStructureEnsemble
        provenance: { structureEnsembleFingerprint: string }
        checks: Array<{ id: string; status: string }>
      }
    }
    assertEqual(data.result.structureEnsemble.members.length, 3)
    assertTrue(data.result.provenance.structureEnsembleFingerprint.startsWith('fnv1a64:'))
    assertTrue(data.result.checks.some((check) => (
      check.id === 'provider.structure_ensemble_contract' && check.status === 'pass'
    )))
  } finally {
    unregister()
  }
}

async function main(): Promise<void> {
  await testCanonicalValidationAndMcp()
  testFailureModesAndBoltzmannWeights()
  await testProviderBrokerIntegration()
  console.log('agent structure ensemble tests passed')
}

void main()
