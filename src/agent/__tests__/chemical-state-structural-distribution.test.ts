import { assertDeepEqual, assertEqual, assertTrue } from '../../testing/assert'
import {
  parseZatomChemicalStateEnsemble,
  type ZatomChemicalStateEnsemble,
  ZATOM_CHEMICAL_STATE_ENSEMBLE_SCHEMA,
} from '../chemical-state-ensemble'
import {
  composeZatomChemicalStateStructuralDistribution,
  fingerprintChemicalStateStructuralDistribution,
  parseZatomChemicalStateStructuralDistribution,
  type ZatomChemicalStateStructuralDistribution,
  ZatomChemicalStateStructuralDistributionInputError,
  ZATOM_CHEMICAL_STATE_STRUCTURAL_DISTRIBUTION_SCHEMA,
} from '../chemical-state-structural-distribution'
import type { ZatomStructure } from '../contracts'
import { ZATOM_STRUCTURE_SCHEMA } from '../contracts'
import { fingerprintForceFieldTopology } from '../force-field-package'
import { callZatomMcpTool } from '../mcp-adapter'
import {
  createZatomProviderRegistry,
  ZATOM_PROVIDER_SCHEMA,
  type ZatomModelingProvider,
  ZatomProviderError,
} from '../provider'
import { registerZatomModelingProvider } from '../provider-tools'
import {
  parseZatomStructureEnsemble,
  type ZatomStructureEnsemble,
  ZatomStructureEnsembleInputError,
  ZATOM_STRUCTURE_ENSEMBLE_SCHEMA,
} from '../structure-ensemble'
import { fingerprintStructure } from '../structure-math'

type StateKind = 'state-keto' | 'state-enol'

function stateStructure(stateId: StateKind, distorted = false): ZatomStructure {
  const enol = stateId === 'state-enol'
  const stateSmiles = enol ? 'C=CO' : 'CC=O'
  const atoms: ZatomStructure['atoms'] = [
    { id: 'c1', element: 'C', position: [-1.2, 0, 0], properties: { formalCharge: 0 } },
    { id: 'c2', element: 'C', position: [0.1, 0, 0], properties: { formalCharge: 0 } },
    { id: 'o1', element: 'O', position: [1.3, 0, 0], properties: { formalCharge: 0 } },
    { id: 'h1', element: 'H', position: [-1.6, 1, 0], properties: { formalCharge: 0 } },
    {
      id: 'h2',
      element: 'H',
      position: distorted ? [-1.82, -0.62, 0.96] : [-1.7, -0.5, 0.85],
      properties: { formalCharge: 0 },
    },
    { id: 'h3', element: 'H', position: [-1.7, -0.5, -0.85], properties: { formalCharge: 0 } },
    {
      id: 'h4',
      element: 'H',
      position: enol ? [2.25, 0, 0] : [0.1, -1, 0],
      properties: { formalCharge: 0 },
    },
  ]
  return {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    label: `acetaldehyde ${stateId}`,
    atoms,
    bonds: enol ? [
      { id: 'b1', atomIds: ['c1', 'c2'], order: 2 },
      { id: 'b2', atomIds: ['c2', 'o1'], order: 1 },
      { id: 'b3', atomIds: ['c1', 'h1'], order: 1 },
      { id: 'b4', atomIds: ['c1', 'h2'], order: 1 },
      { id: 'b5', atomIds: ['c1', 'h3'], order: 1 },
      { id: 'b6', atomIds: ['o1', 'h4'], order: 1 },
    ] : [
      { id: 'b1', atomIds: ['c1', 'c2'], order: 1 },
      { id: 'b2', atomIds: ['c2', 'o1'], order: 2 },
      { id: 'b3', atomIds: ['c1', 'h1'], order: 1 },
      { id: 'b4', atomIds: ['c1', 'h2'], order: 1 },
      { id: 'b5', atomIds: ['c1', 'h3'], order: 1 },
      { id: 'b6', atomIds: ['c2', 'h4'], order: 1 },
    ],
    metadata: {
      'zatom.chemical.stateId': stateId,
      'zatom.chemical.canonicalIsomericSmiles': stateSmiles,
      'zatom.chemical.formula': 'C2H4O',
      'zatom.chemical.formalCharge': 0,
      'zatom.chemical.enumerationKind': 'tautomer',
    },
  }
}

function stateEnsemble(stateId: StateKind): {
  selected: ZatomStructure
  ensemble: ZatomStructureEnsemble
  fingerprint: string
} {
  const selected = stateStructure(stateId)
  const alternate = stateStructure(stateId, true)
  const prefix = stateId === 'state-keto' ? 'keto' : 'enol'
  const ensemble: ZatomStructureEnsemble = {
    schemaVersion: ZATOM_STRUCTURE_ENSEMBLE_SCHEMA,
    topologyFingerprint: fingerprintForceFieldTopology(selected),
    members: [
      {
        id: `${prefix}-b`,
        weight: 0.3,
        structureFingerprint: fingerprintStructure(alternate),
        structure: alternate,
        evidenceSourceIds: [`${prefix}-sampler`],
      },
      {
        id: `${prefix}-a`,
        weight: 0.7,
        structureFingerprint: fingerprintStructure(selected),
        structure: selected,
        evidenceSourceIds: [`${prefix}-sampler`],
      },
    ],
    selection: {
      selectedMemberId: `${prefix}-a`,
      method: 'maximum-weight',
      rationale: 'Select the maximum conditional fixture probability.',
    },
    weightModel: {
      kind: 'posterior-probability',
      method: 'Fixture conditional conformer posterior',
      assumptions: ['The two retained conformers exhaust this state-conditioned fixture support.'],
      applicability: {
        assessment: 'in-domain',
        domain: `Exact ${stateId} regression fixture`,
        reasons: ['Constructed to exercise a conditional fixed-topology distribution.'],
      },
      scopeWarning: 'Fixture conditional weights are not scientific predictions.',
    },
    acceptance: { minimumWeightEffectiveMemberCount: 1.5 },
    evidenceSources: [{
      id: `${prefix}-sampler`,
      engine: 'fixture-state-conditioned-sampler',
      engineVersion: '1.0.0',
      method: `Generate two fixed-topology geometries for ${stateId}`,
      artifacts: [{
        id: `${prefix}-draws`,
        role: 'Exact state-conditioned structural draws',
        fingerprint: `sha256:fixture-${prefix}-draws`,
      }],
      citations: [`urn:zatom:test:${prefix}-structure-source`],
      scopeWarning: 'Fixture-only conditional structural evidence.',
    }],
    provenance: {
      engine: 'fixture-state-conditioned-ensemble',
      engineVersion: '1.0.0',
      method: `Assemble the ${stateId} conditional structural distribution`,
      artifacts: [{
        id: `${prefix}-ensemble-manifest`,
        role: 'Exact conditional weights and member identities',
        fingerprint: `sha256:fixture-${prefix}-ensemble-manifest`,
      }],
      parameters: { stateId, memberCount: 2 },
      citations: [`urn:zatom:test:${prefix}-structure-ensemble`],
      scopeWarning: 'This fixed-topology artifact excludes other chemical identities.',
    },
  }
  const fingerprint = parseZatomStructureEnsemble(ensemble, { selectedStructure: selected }).fingerprint
  return { selected, ensemble, fingerprint }
}

function populatedChemicalEnsemble(selected: ZatomStructure): ZatomChemicalStateEnsemble {
  return {
    schemaVersion: ZATOM_CHEMICAL_STATE_ENSEMBLE_SCHEMA,
    selectedStructureFingerprint: fingerprintStructure(selected),
    enumeration: { kind: 'tautomer', complete: true, status: 'Completed fixture enumeration' },
    source: { canonicalIsomericSmiles: 'CC=O', formula: 'C2H4O', formalCharge: 0 },
    normalized: {
      canonicalIsomericSmiles: 'CC=O',
      formula: 'C2H4O',
      formalCharge: 0,
      method: 'preserve',
    },
    states: [
      {
        id: 'state-keto',
        canonicalIsomericSmiles: 'CC=O',
        formula: 'C2H4O',
        formalCharge: 0,
        atomCount: 7,
        bondCount: 6,
        heavyAtomCount: 3,
        explicitHydrogenCount: 4,
        assignedStereocenterCount: 0,
        unassignedStereocenterCount: 0,
      },
      {
        id: 'state-enol',
        canonicalIsomericSmiles: 'C=CO',
        formula: 'C2H4O',
        formalCharge: 0,
        atomCount: 7,
        bondCount: 6,
        heavyAtomCount: 3,
        explicitHydrogenCount: 4,
        assignedStereocenterCount: 0,
        unassignedStereocenterCount: 0,
      },
    ],
    selection: {
      selectedStateId: 'state-keto',
      selectedStateIndex: 1,
      canonicalStateId: 'state-keto',
      canonicalStateIndex: 1,
      method: 'maximum-population',
      rationale: 'Select the maximum populated fixture state.',
    },
    populationModel: {
      method: 'Fixture joint tautomer population model',
      conditions: { pH: 7, temperatureK: 298.15, solvent: 'water' },
      populations: [
        { stateId: 'state-keto', fraction: 0.6 },
        { stateId: 'state-enol', fraction: 0.4 },
      ],
      normalizationScope: { kind: 'complete-state-universe' },
      citations: ['urn:zatom:test:joint-state-populations'],
      scopeWarning: 'Fixture state fractions are not scientific predictions.',
    },
    provenance: {
      engine: 'fixture-populated-state-enumerator',
      engineVersion: '1.0.0',
      method: 'Enumerate and populate two exact tautomer fixtures',
      parameters: { stateCount: 2 },
      citations: ['urn:zatom:test:populated-chemical-states'],
      scopeWarning: 'Fixture-only identity and population evidence.',
    },
  }
}

function fixture(): {
  selected: ZatomStructure
  chemicalEnsemble: ZatomChemicalStateEnsemble
  distribution: ZatomChemicalStateStructuralDistribution
} {
  const keto = stateEnsemble('state-keto')
  const enol = stateEnsemble('state-enol')
  const chemicalEnsemble = populatedChemicalEnsemble(keto.selected)
  const chemicalFingerprint = parseZatomChemicalStateEnsemble(
    chemicalEnsemble,
    { structure: keto.selected },
  ).fingerprint
  return {
    selected: keto.selected,
    chemicalEnsemble,
    distribution: {
      schemaVersion: ZATOM_CHEMICAL_STATE_STRUCTURAL_DISTRIBUTION_SCHEMA,
      chemicalStateEnsembleFingerprint: chemicalFingerprint,
      conditions: { pH: 7, temperatureK: 298.15, solvent: 'water' },
      heavyAtomIds: ['c1', 'c2', 'o1'],
      stateStructureEnsembles: [
        {
          stateId: 'state-keto',
          structureEnsembleFingerprint: keto.fingerprint,
          structureEnsemble: keto.ensemble,
        },
        {
          stateId: 'state-enol',
          structureEnsembleFingerprint: enol.fingerprint,
          structureEnsemble: enol.ensemble,
        },
      ],
      acceptance: { minimumJointWeightEffectiveMemberCount: 3 },
      provenance: {
        engine: 'fixture-joint-identity-structure-model',
        engineVersion: '1.0.0',
        method: 'Compose populated chemical identities with conditional conformer distributions',
        artifacts: [{
          id: 'fixture-joint-model',
          role: 'Exact joint model and conditional sampling specification',
          fingerprint: 'sha256:fixture-joint-identity-structure-model',
        }],
        parameters: { stateCount: 2, conditionalMemberCountPerState: 2 },
        citations: ['urn:zatom:test:chemical-state-structural-distribution'],
        scopeWarning: 'Fixture joint weights are not scientific predictions.',
      },
    },
  }
}

function expectDistributionError(run: () => unknown, code: string): void {
  let observed: unknown
  try {
    run()
  } catch (error) {
    observed = error
  }
  assertTrue(observed instanceof ZatomChemicalStateStructuralDistributionInputError)
  assertEqual((observed as ZatomChemicalStateStructuralDistributionInputError).code, code)
}

function assertApprox(actual: number, expected: number, tolerance = 1e-12): void {
  assertTrue(Math.abs(actual - expected) <= tolerance, `Expected ${expected} ± ${tolerance}, got ${actual}`)
}

async function testCanonicalJointDistributionAndMcp(): Promise<void> {
  const { selected, chemicalEnsemble, distribution } = fixture()
  const parsed = parseZatomChemicalStateStructuralDistribution(distribution, {
    chemicalStateEnsemble: chemicalEnsemble,
    chemicalStateReferenceStructure: selected,
    selectedStructure: selected,
  })
  const composition = {
    chemicalStateEnsemble: chemicalEnsemble,
    heavyAtomIds: distribution.heavyAtomIds,
    stateStructureEnsembles: [...distribution.stateStructureEnsembles].reverse().map((entry) => ({
      stateId: entry.stateId,
      structureEnsemble: {
        ...entry.structureEnsemble,
        members: [...entry.structureEnsemble.members].reverse(),
      },
    })),
    acceptance: distribution.acceptance,
    provenance: distribution.provenance,
  }
  const composed = composeZatomChemicalStateStructuralDistribution(composition, {
    chemicalStateReferenceStructure: selected,
    selectedStructure: selected,
  })
  assertEqual(composed.fingerprint, parsed.fingerprint)
  assertEqual(
    composed.distribution.chemicalStateEnsembleFingerprint,
    parsed.chemicalStateEnsembleValidation.fingerprint,
  )
  assertDeepEqual(
    composed.distribution.conditions,
    parsed.distribution.conditions,
  )
  assertEqual(parsed.distribution.stateStructureEnsembles.map((entry) => entry.stateId).join(','), (
    'state-enol,state-keto'
  ))
  assertEqual(fingerprintChemicalStateStructuralDistribution(parsed.distribution), parsed.fingerprint)
  assertEqual(parsed.jointMembers.length, 4)
  assertApprox(parsed.jointMembers.reduce((sum, member) => sum + member.jointWeight, 0), 1)
  assertApprox(
    parsed.jointMembers.filter((member) => member.stateId === 'state-keto')
      .reduce((sum, member) => sum + member.jointWeight, 0),
    0.6,
  )
  assertApprox(
    parsed.jointMembers.filter((member) => member.stateId === 'state-enol')
      .reduce((sum, member) => sum + member.jointWeight, 0),
    0.4,
  )
  assertTrue(parsed.jointWeightEffectiveMemberCount > 3)
  assertEqual(parsed.identityVariableHeavyAtomIds.join(','), 'c1,c2,o1')
  assertTrue(parsed.inspectionTargets.some((target) => (
    target.id === 'chemical-state-distribution-identity-variable-atoms'
  )))
  assertTrue(parsed.checks.some((check) => (
    check.id === 'chemical_state_structural_distribution.normalization_scope' && check.status === 'pass'
  )))

  const reordered: ZatomChemicalStateStructuralDistribution = {
    ...distribution,
    stateStructureEnsembles: [...distribution.stateStructureEnsembles].reverse().map((entry) => ({
      ...entry,
      structureEnsemble: {
        ...entry.structureEnsemble,
        members: [...entry.structureEnsemble.members].reverse(),
      },
    })),
  }
  assertEqual(
    parseZatomChemicalStateStructuralDistribution(reordered, {
      chemicalStateEnsemble: chemicalEnsemble,
      chemicalStateReferenceStructure: selected,
      selectedStructure: selected,
    }).fingerprint,
    parsed.fingerprint,
  )

  const tool = await callZatomMcpTool('chemical_state_validate_structural_distribution', {
    distribution,
    chemicalStateEnsemble: chemicalEnsemble,
    chemicalStateReferenceStructure: selected,
    structure: selected,
    useActiveStructure: false,
  })
  assertTrue(tool.structuredContent.ok, tool.structuredContent.summary)
  const toolData = tool.structuredContent.data as { fingerprint: string }
  assertEqual(toolData.fingerprint, parsed.fingerprint)

  const composeTool = await callZatomMcpTool('chemical_state_compose_structural_distribution', {
    ...composition,
    chemicalStateReferenceStructure: selected,
    structure: selected,
    useActiveStructure: false,
  })
  assertTrue(composeTool.structuredContent.ok, composeTool.structuredContent.summary)
  const composeToolData = composeTool.structuredContent.data as { fingerprint: string }
  assertEqual(composeToolData.fingerprint, parsed.fingerprint)

  const conditionalChemicalEnsemble: ZatomChemicalStateEnsemble = {
    ...chemicalEnsemble,
    enumeration: {
      ...chemicalEnsemble.enumeration,
      complete: false,
      status: 'Returned-state-conditional fixture enumeration',
    },
    populationModel: {
      ...chemicalEnsemble.populationModel!,
      normalizationScope: { kind: 'conditional-on-returned-states' },
      scopeWarning: 'Fixture fractions are normalized only across returned states.',
    },
  }
  const conditionalFingerprint = parseZatomChemicalStateEnsemble(
    conditionalChemicalEnsemble,
    { structure: selected },
  ).fingerprint
  const conditional = parseZatomChemicalStateStructuralDistribution({
    ...distribution,
    chemicalStateEnsembleFingerprint: conditionalFingerprint,
  }, {
    chemicalStateEnsemble: conditionalChemicalEnsemble,
    chemicalStateReferenceStructure: selected,
    selectedStructure: selected,
  })
  assertTrue(conditional.checks.some((check) => (
    check.id === 'chemical_state_structural_distribution.normalization_scope'
    && check.status === 'warn'
  )))
  const conditionalComposed = composeZatomChemicalStateStructuralDistribution({
    ...composition,
    chemicalStateEnsemble: conditionalChemicalEnsemble,
  }, { chemicalStateReferenceStructure: selected, selectedStructure: selected })
  assertTrue(conditionalComposed.checks.some((check) => (
    check.id === 'chemical_state_structural_distribution.normalization_scope'
    && check.status === 'warn'
  )))
}

function testFailureModes(): void {
  const { selected, chemicalEnsemble, distribution } = fixture()
  const parse = (
    artifact: unknown = distribution,
    ensemble: ZatomChemicalStateEnsemble = chemicalEnsemble,
    options: Record<string, number> = {},
  ) => parseZatomChemicalStateStructuralDistribution(artifact, {
    chemicalStateEnsemble: ensemble,
    chemicalStateReferenceStructure: selected,
    selectedStructure: selected,
    ...options,
  })

  const withoutPopulation: ZatomChemicalStateEnsemble = {
    ...chemicalEnsemble,
    selection: {
      ...chemicalEnsemble.selection,
      method: 'explicit',
      rationale: 'Explicit fixture selection without a population model.',
    },
  }
  delete withoutPopulation.populationModel
  expectDistributionError(
    () => parse(distribution, withoutPopulation),
    'chemical_state_structural_distribution_population_required',
  )
  expectDistributionError(
    () => parse({ ...distribution, chemicalStateEnsembleFingerprint: 'fnv1a64:changed' }),
    'chemical_state_structural_distribution_fingerprint_mismatch',
  )
  expectDistributionError(
    () => parse({ ...distribution, conditions: { ...distribution.conditions, pH: 6 } }),
    'chemical_state_structural_distribution_condition_mismatch',
  )
  const conditionalEntry = distribution.stateStructureEnsembles.find((entry) => (
    entry.stateId === 'state-keto'
  ))!
  const boltzmannTemperatureK = 300
  const gasConstantKcalPerMolK = 0.00198720425864083
  const higherEnergy = gasConstantKcalPerMolK * boltzmannTemperatureK * Math.log(0.7 / 0.3)
  const boltzmannEnsemble: ZatomStructureEnsemble = {
    ...conditionalEntry.structureEnsemble,
    members: conditionalEntry.structureEnsemble.members.map((member) => ({
      ...member,
      relativeFreeEnergyKcalMol: member.id === 'keto-a' ? 0 : higherEnergy,
    })),
    weightModel: {
      ...conditionalEntry.structureEnsemble.weightModel,
      kind: 'boltzmann-free-energy',
      temperatureK: boltzmannTemperatureK,
      method: 'Fixture Boltzmann conditional distribution at a mismatched temperature',
    },
  }
  const boltzmannFingerprint = parseZatomStructureEnsemble(boltzmannEnsemble, {
    selectedStructure: selected,
  }).fingerprint
  expectDistributionError(
    () => parse({
      ...distribution,
      stateStructureEnsembles: distribution.stateStructureEnsembles.map((entry) => (
        entry.stateId === 'state-keto' ? {
          ...entry,
          structureEnsemble: boltzmannEnsemble,
          structureEnsembleFingerprint: boltzmannFingerprint,
        } : entry
      )),
    }),
    'chemical_state_structural_distribution_condition_mismatch',
  )
  expectDistributionError(
    () => parse({
      ...distribution,
      stateStructureEnsembles: distribution.stateStructureEnsembles.slice(0, 1),
    }),
    'chemical_state_structural_distribution_state_coverage_mismatch',
  )
  expectDistributionError(
    () => parse({ ...distribution, heavyAtomIds: ['o1', 'c2', 'c1'] }),
    'chemical_state_structural_distribution_heavy_atom_mapping_mismatch',
  )
  expectDistributionError(
    () => parse({
      ...distribution,
      stateStructureEnsembles: distribution.stateStructureEnsembles.map((entry) => (
        entry.stateId === 'state-enol'
          ? { ...entry, structureEnsembleFingerprint: 'fnv1a64:changed' }
          : entry
      )),
    }),
    'chemical_state_structural_distribution_structure_ensemble_fingerprint_mismatch',
  )

  const identityDriftEntries = distribution.stateStructureEnsembles.map((entry) => {
    if (entry.stateId !== 'state-enol') return entry
    const members = entry.structureEnsemble.members.map((member, index) => {
      if (index !== 0) return member
      const structure: ZatomStructure = {
        ...member.structure,
        metadata: { ...member.structure.metadata, 'zatom.chemical.stateId': 'wrong-state' },
      }
      return { ...member, structure, structureFingerprint: fingerprintStructure(structure) }
    })
    const structureEnsemble = { ...entry.structureEnsemble, members }
    return {
      ...entry,
      structureEnsemble,
      structureEnsembleFingerprint: parseZatomStructureEnsemble(structureEnsemble, {
        selectedStructure: structureEnsemble.members.find((member) => member.id === 'enol-a')!.structure,
      }).fingerprint,
    }
  })
  expectDistributionError(
    () => parse({ ...distribution, stateStructureEnsembles: identityDriftEntries }),
    'chemical_state_structural_distribution_member_identity_mismatch',
  )
  expectDistributionError(
    () => parse({
      ...distribution,
      acceptance: { minimumJointWeightEffectiveMemberCount: 4 },
    }),
    'chemical_state_structural_distribution_weight_effective_size_failed',
  )
  expectDistributionError(
    () => parse(distribution, chemicalEnsemble, { maxJointMembers: 3 }),
    'chemical_state_structural_distribution_budget_exceeded',
  )

  const selectedEntry = distribution.stateStructureEnsembles.find((entry) => entry.stateId === 'state-keto')!
  let selectedMismatch: unknown
  try {
    parse({
      ...distribution,
      stateStructureEnsembles: distribution.stateStructureEnsembles.map((entry) => (
        entry.stateId === 'state-keto' ? {
          ...entry,
          structureEnsemble: {
            ...selectedEntry.structureEnsemble,
            selection: {
              selectedMemberId: 'keto-b',
              method: 'explicit',
              rationale: 'Intentionally inconsistent selected fixture member.',
            },
          },
        } : entry
      )),
    })
  } catch (error) {
    selectedMismatch = error
  }
  assertTrue(selectedMismatch instanceof ZatomStructureEnsembleInputError)
  assertEqual(
    (selectedMismatch as ZatomStructureEnsembleInputError).code,
    'structure_ensemble_selected_structure_mismatch',
  )
}

async function testProviderBrokerIntegration(): Promise<void> {
  const { selected, chemicalEnsemble, distribution } = fixture()
  const provider: ZatomModelingProvider = {
    manifest: {
      schemaVersion: ZATOM_PROVIDER_SCHEMA,
      id: 'test.chemical-state-structural-distribution',
      title: 'Joint chemical-state structural distribution fixture',
      description: 'Return a populated chemical-state ensemble and conditional structural ensembles.',
      adapterVersion: '1.0.0',
      engine: { name: 'fixture-joint-identity-structure-model', version: '1.0.0' },
      execution: 'browser',
      capabilities: [{
        id: 'molecule.sample.fixture-joint-state-structures',
        title: 'Fixture joint identity/structure sampler',
        description: 'Return an exact joint identity and conditional-structure fixture.',
        fidelity: 'statistical',
        source: 'required',
        deterministic: true,
        inputSchema: { type: 'object', additionalProperties: false },
        inputArtifacts: [{ artifact: 'chemical-state-ensemble', mode: 'required' }],
        requiredCheckIds: ['fixture.joint_distribution'],
        outputArtifacts: [
          'chemical-state-ensemble',
          'chemical-state-structural-distribution',
        ],
        tags: ['chemical-state', 'structure-ensemble', 'joint-distribution'],
      }],
    },
    execute: (request) => {
      assertTrue(request.chemicalStateEnsemble !== undefined)
      assertEqual(request.chemicalStateEnsemble?.fingerprint, distribution.chemicalStateEnsembleFingerprint)
      return {
        structure: selected,
        chemicalStateEnsemble: request.chemicalStateEnsemble!.ensemble,
        chemicalStateStructuralDistribution: distribution,
        checks: [{
          id: 'fixture.joint_distribution',
          status: 'pass',
          message: 'Fixture joint identity/structure distribution completed',
        }],
      }
    },
  }
  const unregister = registerZatomModelingProvider(provider)
  try {
    const missingInput = await callZatomMcpTool('modeling_run_provider', {
      providerId: provider.manifest.id,
      capability: provider.manifest.capabilities[0].id,
      structure: selected,
      parameters: {},
      applyToWorkspace: false,
    })
    assertEqual(missingInput.structuredContent.ok, false)
    assertEqual(missingInput.structuredContent.error?.code, 'chemical_state_ensemble_input_required')

    const response = await callZatomMcpTool('modeling_run_provider', {
      providerId: provider.manifest.id,
      capability: provider.manifest.capabilities[0].id,
      structure: selected,
      chemicalStateEnsemble: chemicalEnsemble,
      parameters: {},
      applyToWorkspace: false,
    })
    assertTrue(response.structuredContent.ok, response.structuredContent.summary)
    const data = response.structuredContent.data as {
      result: {
        chemicalStateStructuralDistribution: ZatomChemicalStateStructuralDistribution
        provenance: {
          chemicalStateStructuralDistributionFingerprint: string
          inputChemicalStateEnsembleFingerprint: string
        }
        checks: Array<{ id: string; status: string }>
      }
    }
    assertEqual(data.result.chemicalStateStructuralDistribution.stateStructureEnsembles.length, 2)
    assertTrue(data.result.provenance.chemicalStateStructuralDistributionFingerprint.startsWith('fnv1a64:'))
    assertEqual(
      data.result.provenance.inputChemicalStateEnsembleFingerprint,
      distribution.chemicalStateEnsembleFingerprint,
    )
    assertTrue(data.result.checks.some((check) => (
      check.id === 'provider.chemical_state_ensemble_input_contract'
      && check.status === 'pass'
    )))
    assertTrue(data.result.checks.some((check) => (
      check.id === 'provider.chemical_state_structural_distribution_contract'
      && check.status === 'pass'
    )))
  } finally {
    unregister()
  }

  const driftingProvider: ZatomModelingProvider = {
    ...provider,
    manifest: { ...provider.manifest, id: 'test.drifting-chemical-state-input' },
    execute: (request) => ({
      structure: selected,
      chemicalStateEnsemble: {
        ...request.chemicalStateEnsemble!.ensemble,
        provenance: {
          ...request.chemicalStateEnsemble!.ensemble.provenance,
          method: 'Illegally changed the immutable input ensemble provenance',
        },
      },
      chemicalStateStructuralDistribution: distribution,
      checks: [{
        id: 'fixture.joint_distribution',
        status: 'pass',
        message: 'Fixture attempted to drift its chemical-state input',
      }],
    }),
  }
  const unregisterDrifting = registerZatomModelingProvider(driftingProvider)
  try {
    const drifted = await callZatomMcpTool('modeling_run_provider', {
      providerId: driftingProvider.manifest.id,
      capability: driftingProvider.manifest.capabilities[0].id,
      structure: selected,
      chemicalStateEnsemble: chemicalEnsemble,
      parameters: {},
      applyToWorkspace: false,
    })
    assertEqual(drifted.structuredContent.ok, false)
    assertEqual(drifted.structuredContent.error?.code, 'invalid_provider_result')
  } finally {
    unregisterDrifting()
  }

  const isolatedRegistry = createZatomProviderRegistry([provider])
  const canonicalInput = parseZatomChemicalStateEnsemble(chemicalEnsemble, {
    structure: selected,
  })
  let directInputError: unknown
  try {
    await isolatedRegistry.execute(provider.manifest.id, {
      capability: provider.manifest.capabilities[0].id,
      source: selected,
      continuation: null,
      chemicalStateEnsemble: {
        schemaVersion: 'zatom.provider-chemical-state-ensemble/v1',
        fingerprint: 'fnv1a64:tampered',
        ensemble: canonicalInput.ensemble,
      },
      parameters: {},
      seed: 42,
    })
  } catch (error) {
    directInputError = error
  }
  assertTrue(directInputError instanceof ZatomProviderError)
  assertEqual((directInputError as ZatomProviderError).code, 'provider_input_artifact_mismatch')

  const invalidProvider: ZatomModelingProvider = {
    ...provider,
    manifest: {
      ...provider.manifest,
      id: 'test.invalid-joint-distribution-manifest',
      capabilities: [{
        ...provider.manifest.capabilities[0],
        outputArtifacts: ['chemical-state-structural-distribution'],
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

  const sourceFreeInputProvider: ZatomModelingProvider = {
    ...provider,
    manifest: {
      ...provider.manifest,
      id: 'test.invalid-source-free-artifact-input',
      capabilities: [{
        ...provider.manifest.capabilities[0],
        source: 'none',
      }],
    },
  }
  let sourceFreeManifestError: unknown
  try {
    registerZatomModelingProvider(sourceFreeInputProvider)
  } catch (error) {
    sourceFreeManifestError = error
  }
  assertTrue(sourceFreeManifestError instanceof ZatomProviderError)
  assertEqual((sourceFreeManifestError as ZatomProviderError).code, 'invalid_provider_manifest')
}

async function main(): Promise<void> {
  await testCanonicalJointDistributionAndMcp()
  testFailureModes()
  await testProviderBrokerIntegration()
  console.log('agent chemical-state structural distribution tests passed')
}

void main()
