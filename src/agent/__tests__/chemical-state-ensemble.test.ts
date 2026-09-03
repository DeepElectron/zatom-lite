import { assertEqual, assertTrue } from '../../testing/assert'
import {
  parseZatomChemicalStateEnsemble,
  type ZatomChemicalStateEnsemble,
  ZatomChemicalStateEnsembleInputError,
  ZATOM_CHEMICAL_STATE_ENSEMBLE_SCHEMA,
} from '../chemical-state-ensemble'
import type { ZatomStructure } from '../contracts'
import { ZATOM_STRUCTURE_SCHEMA } from '../contracts'
import { callZatomMcpTool } from '../mcp-adapter'
import { ZATOM_PROVIDER_SCHEMA, type ZatomModelingProvider } from '../provider'
import { registerZatomModelingProvider } from '../provider-tools'
import { fingerprintStructure } from '../structure-math'

function selectedStructure(): ZatomStructure {
  return {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    label: 'explicit acetaldehyde tautomer selection',
    atoms: [
      { id: 'c1', element: 'C', position: [-1.2, 0, 0], properties: { formalCharge: 0 } },
      { id: 'c2', element: 'C', position: [0.1, 0, 0], properties: { formalCharge: 0 } },
      { id: 'o1', element: 'O', position: [1.2, 0.2, 0], properties: { formalCharge: 0 } },
      { id: 'h1', element: 'H', position: [-1.6, 1, 0], properties: { formalCharge: 0 } },
      { id: 'h2', element: 'H', position: [-1.6, -0.5, 0.9], properties: { formalCharge: 0 } },
      { id: 'h3', element: 'H', position: [-1.6, -0.5, -0.9], properties: { formalCharge: 0 } },
      { id: 'h4', element: 'H', position: [0.1, -1, 0], properties: { formalCharge: 0 } },
    ],
    bonds: [
      { id: 'b1', atomIds: ['c1', 'c2'], order: 1 },
      { id: 'b2', atomIds: ['c2', 'o1'], order: 2 },
      { id: 'b3', atomIds: ['c1', 'h1'], order: 1 },
      { id: 'b4', atomIds: ['c1', 'h2'], order: 1 },
      { id: 'b5', atomIds: ['c1', 'h3'], order: 1 },
      { id: 'b6', atomIds: ['c2', 'h4'], order: 1 },
    ],
    metadata: {
      'zatom.chemical.stateId': 'state-keto',
      'zatom.chemical.canonicalIsomericSmiles': 'CC=O',
      'zatom.chemical.formula': 'C2H4O',
      'zatom.chemical.formalCharge': 0,
      'zatom.chemical.enumerationKind': 'tautomer',
    },
  }
}

function ensemble(structure: ZatomStructure): ZatomChemicalStateEnsemble {
  return {
    schemaVersion: ZATOM_CHEMICAL_STATE_ENSEMBLE_SCHEMA,
    selectedStructureFingerprint: fingerprintStructure(structure),
    enumeration: { kind: 'tautomer', complete: true, status: 'Completed' },
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
        annotations: { ruleScore: 5, isCanonical: true },
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
        annotations: { ruleScore: 1, isCanonical: false },
      },
    ],
    selection: {
      selectedStateId: 'state-keto',
      selectedStateIndex: 1,
      canonicalStateId: 'state-keto',
      canonicalStateIndex: 1,
      method: 'canonical-rule',
      rationale: 'Deterministic fixture canonical rule',
    },
    provenance: {
      engine: 'fixture-state-enumerator',
      engineVersion: '1.0.0',
      method: 'explicit regression candidates',
      parameters: { maximumStates: 2 },
      citations: ['urn:zatom:test:chemical-state-ensemble'],
      scopeWarning: 'Fixture states and rule scores are not pKa, populations, or energies.',
    },
    metadata: { rawStateCount: 2 },
  }
}

function expectInputError(run: () => unknown, code: string): void {
  let observed: unknown
  try {
    run()
  } catch (error) {
    observed = error
  }
  assertTrue(observed instanceof ZatomChemicalStateEnsembleInputError)
  assertEqual((observed as ZatomChemicalStateEnsembleInputError).code, code)
}

async function testCanonicalValidationAndBrokerContract() {
  const structure = selectedStructure()
  const artifact = ensemble(structure)
  const parsed = parseZatomChemicalStateEnsemble(artifact, { structure })
  assertEqual(parsed.ensemble.states.length, 2)
  assertEqual(parsed.ensemble.selection.selectedStateIndex, 1)
  assertTrue(parsed.fingerprint.startsWith('fnv1a64:'))
  assertTrue(parsed.checks.some((check) => check.id === 'chemical_state_ensemble.identity' && check.status === 'pass'))
  assertTrue(parsed.checks.some((check) => check.id === 'chemical_state_ensemble.population' && check.status === 'skipped'))
  assertEqual(parsed.inspectionTargets[0].id, 'chemical-state-selected-structure')

  const reordered = {
    ...artifact,
    states: [...artifact.states].reverse(),
  }
  assertEqual(parseZatomChemicalStateEnsemble(reordered, { structure }).fingerprint, parsed.fingerprint)

  const tool = await callZatomMcpTool('chemical_state_validate_ensemble', {
    structure,
    ensemble: artifact,
    useActiveStructure: false,
  })
  assertTrue(tool.structuredContent.ok, tool.structuredContent.summary)

  const provider: ZatomModelingProvider = {
    manifest: {
      schemaVersion: ZATOM_PROVIDER_SCHEMA,
      id: 'test.chemical-state-output',
      title: 'Chemical-state output fixture',
      description: 'Exercise broker validation of a canonical chemical-state ensemble.',
      adapterVersion: '1.0.0',
      engine: { name: 'fixture-state-enumerator', version: '1.0.0' },
      execution: 'browser',
      capabilities: [{
        id: 'molecule.enumerate.fixture-states',
        title: 'Enumerate fixture states',
        description: 'Return a selected structure plus a canonical state ensemble.',
        fidelity: 'empirical',
        source: 'none',
        deterministic: true,
        inputSchema: { type: 'object', additionalProperties: false },
        requiredCheckIds: ['fixture.enumeration'],
        outputArtifacts: ['chemical-state-ensemble'],
        tags: ['chemical-state'],
      }],
    },
    execute: () => ({
      structure,
      chemicalStateEnsemble: artifact,
      checks: [{ id: 'fixture.enumeration', status: 'pass', message: 'Fixture enumeration completed' }],
    }),
  }
  const unregister = registerZatomModelingProvider(provider)
  try {
    const result = await callZatomMcpTool('modeling_run_provider', {
      providerId: provider.manifest.id,
      capability: 'molecule.enumerate.fixture-states',
      parameters: {},
      applyToWorkspace: false,
    })
    assertTrue(result.structuredContent.ok, result.structuredContent.summary)
    const data = result.structuredContent.data as {
      result: {
        chemicalStateEnsemble: ZatomChemicalStateEnsemble
        provenance: { chemicalStateEnsembleFingerprint: string }
        checks: Array<{ id: string; status: string }>
      }
    }
    assertEqual(data.result.chemicalStateEnsemble.selection.selectedStateId, 'state-keto')
    assertTrue(data.result.provenance.chemicalStateEnsembleFingerprint.startsWith('fnv1a64:'))
    assertTrue(data.result.checks.some((check) => (
      check.id === 'provider.chemical_state_ensemble_contract' && check.status === 'pass'
    )))
  } finally {
    unregister()
  }
}

function testFailureModesAndPopulationNormalization() {
  const structure = selectedStructure()
  const artifact = ensemble(structure)
  expectInputError(
    () => parseZatomChemicalStateEnsemble({
      ...artifact,
      selectedStructureFingerprint: 'changed',
    }, { structure }),
    'chemical_state_ensemble_structure_mismatch',
  )
  expectInputError(
    () => parseZatomChemicalStateEnsemble({
      ...artifact,
      states: [artifact.states[0], { ...artifact.states[1], canonicalIsomericSmiles: 'CC=O' }],
    }, { structure }),
    'invalid_chemical_state_ensemble',
  )
  expectInputError(
    () => parseZatomChemicalStateEnsemble({
      ...artifact,
      selection: { ...artifact.selection, selectedStateIndex: 0 },
    }, { structure }),
    'chemical_state_selection_mismatch',
  )
  expectInputError(
    () => parseZatomChemicalStateEnsemble({
      ...artifact,
      states: artifact.states.map((state) => (
        state.id === 'state-keto' ? { ...state, formula: 'C2H6O' } : state
      )),
    }, { structure }),
    'chemical_state_selected_structure_mismatch',
  )
  const populationArtifact: ZatomChemicalStateEnsemble = {
    ...artifact,
    selection: {
      ...artifact.selection,
      method: 'maximum-population',
      rationale: 'Fixture population table selects the largest fraction',
    },
    populationModel: {
      method: 'fixture Henderson-Hasselbalch approximation',
      conditions: { pH: 7, temperatureK: 298.15, solvent: 'water' },
      populations: [
        { stateId: 'state-keto', fraction: 0.8 },
        { stateId: 'state-enol', fraction: 0.2 },
      ],
      citations: ['urn:zatom:test:valid-population'],
      scopeWarning: 'Fixture fractions test contract mechanics, not physical populations.',
    },
  }
  const parsedPopulation = parseZatomChemicalStateEnsemble(populationArtifact, { structure })
  assertTrue(parsedPopulation.checks.some((check) => (
    check.id === 'chemical_state_ensemble.population' && check.status === 'pass'
  )))
  assertTrue(parsedPopulation.checks.some((check) => (
    check.id === 'chemical_state_ensemble.population_scope' && check.status === 'pass'
  )))
  expectInputError(
    () => parseZatomChemicalStateEnsemble({
      ...populationArtifact,
      enumeration: {
        ...populationArtifact.enumeration,
        complete: false,
        status: 'Stopped at the fixture state budget',
      },
      populationModel: {
        ...populationArtifact.populationModel!,
        normalizationScope: { kind: 'complete-state-universe' },
      },
    }, { structure }),
    'chemical_state_population_scope_mismatch',
  )
  const conditionalPopulation = parseZatomChemicalStateEnsemble({
    ...populationArtifact,
    enumeration: {
      ...populationArtifact.enumeration,
      complete: false,
      status: 'Stopped at the fixture state budget',
    },
    populationModel: {
      ...populationArtifact.populationModel!,
      normalizationScope: { kind: 'conditional-on-returned-states' },
    },
  }, { structure })
  assertTrue(conditionalPopulation.checks.some((check) => (
    check.id === 'chemical_state_ensemble.population_scope' && check.status === 'warn'
  )))
  expectInputError(
    () => parseZatomChemicalStateEnsemble({
      ...artifact,
      selection: {
        selectedStateId: 'state-keto',
        selectedStateIndex: 1,
        canonicalStateId: 'state-keto',
        canonicalStateIndex: 1,
        method: 'maximum-population',
        rationale: 'Invalid non-maximum fixture selection',
      },
      populationModel: {
        method: 'fixture Henderson-Hasselbalch approximation',
        conditions: { pH: 7, temperatureK: 298.15, solvent: 'water' },
        populations: [
          { stateId: 'state-keto', fraction: 0.2 },
          { stateId: 'state-enol', fraction: 0.7 },
        ],
        citations: ['urn:zatom:test:invalid-population'],
        scopeWarning: 'Fixture only.',
      },
    }, { structure }),
    'chemical_state_population_mismatch',
  )
}

async function main() {
  await testCanonicalValidationAndBrokerContract()
  testFailureModesAndPopulationNormalization()
  console.log('agent chemical-state ensemble tests passed')
}

void main()
