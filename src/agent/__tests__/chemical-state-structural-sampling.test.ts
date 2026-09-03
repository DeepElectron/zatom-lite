import { assertEqual, assertTrue } from '../../testing/assert'
import {
  parseZatomChemicalStateEnsemble,
  type ZatomChemicalStateEnsemble,
  ZATOM_CHEMICAL_STATE_ENSEMBLE_SCHEMA,
} from '../chemical-state-ensemble'
import {
  composeZatomChemicalStateStructureCatalog,
  fingerprintChemicalStateStructureCatalog,
  parseZatomChemicalStateStructureCatalog,
  type ZatomChemicalStateStructureCatalog,
  ZatomChemicalStateStructureCatalogInputError,
} from '../chemical-state-structure-catalog'
import {
  parseZatomChemicalStateStructuralDistribution,
  type ZatomChemicalStateStructuralDistribution,
} from '../chemical-state-structural-distribution'
import type { CapturedImage, ZatomStructure, ZatomToolContext } from '../contracts'
import { ZATOM_STRUCTURE_SCHEMA } from '../contracts'
import { callZatomMcpTool, listZatomMcpTools } from '../mcp-adapter'
import {
  type ZatomModelingProvider,
  type ZatomProviderOutput,
  ZatomProviderError,
  ZATOM_PROVIDER_SCHEMA,
} from '../provider'
import { registerZatomModelingProvider } from '../provider-tools'
import type { ZatomChemicalStateStructuralSamplingResult } from '../chemical-state-structural-sampling-tools'
import { fingerprintForceFieldTopology } from '../force-field-package'
import {
  type ZatomStructureEnsemble,
  ZATOM_STRUCTURE_ENSEMBLE_SCHEMA,
} from '../structure-ensemble'
import { fingerprintStructure } from '../structure-math'
import { ZatomStructureInputError } from '../structure-validation'

const CAPABILITY = 'molecule.sample.fixture-conformers'

type StateId = 'state-neutral' | 'state-cation'

interface SamplingEnvelope {
  result: ZatomChemicalStateStructuralSamplingResult
  appliedToWorkspace: boolean
  applicationBlocked: boolean
  applicationVerified: boolean | null
  visualEvidence: CapturedImage | null
}

interface MemberSelectionEnvelope {
  result: {
    structure: ZatomStructure
    chemicalStateEnsemble: ZatomChemicalStateEnsemble
    chemicalStateStructuralDistribution: ZatomChemicalStateStructuralDistribution
    chemicalStateStructuralDistributionFingerprint: string
    stateId: string
    memberId: string
    stateFraction: number
    conditionalStructureWeight: number
    jointWeight: number
    checks: Array<{ id: string; status: string }>
  }
  appliedToWorkspace: boolean
  applicationBlocked: boolean
  applicationVerified: boolean | null
  visualEvidence: CapturedImage | null
}

function butane(stateId: StateId): ZatomStructure {
  const cation = stateId === 'state-cation'
  const positions: Array<[string, number, number, number]> = [
    ['C', -1.8387, -0.3890, 0.6306], ['C', -0.6194, -0.1600, -0.2482],
    ['C', 0.6194, 0.1600, 0.5859], ['C', 1.8387, 0.3890, -0.2929],
    ['H', -2.0655, 0.5008, 1.2266], ['H', -1.6776, -1.2288, 1.3140],
    ['H', -2.7135, -0.6164, 0.0133], ['H', -0.8251, 0.6643, -0.9411],
    ['H', -0.4394, -1.0556, -0.8542], ['H', 0.8251, -0.6643, 1.2788],
    ['H', 0.4394, 1.0556, 1.1919], ['H', 1.6776, 1.2289, -0.9763],
    ['H', 2.0655, -0.5008, -0.8889], ['H', 2.7135, 0.6164, 0.3244],
  ]
  let carbonIndex = 0
  let hydrogenIndex = 0
  const atoms: ZatomStructure['atoms'] = positions.map(([element, x, y, z]) => {
    const id = element === 'C' ? `c-${++carbonIndex}` : `h-${++hydrogenIndex}`
    return {
      id,
      element,
      position: [x, y, z],
      properties: { formalCharge: cation && id === 'c-1' ? 1 : 0 },
    }
  })
  const pairs: Array<[number, number]> = [
    [0, 1], [1, 2], [2, 3],
    [0, 4], [0, 5], [0, 6],
    [1, 7], [1, 8],
    [2, 9], [2, 10],
    [3, 11], [3, 12], [3, 13],
  ]
  const smiles = cation ? '[CH3][CH2][CH2][CH3+]' : 'CCCC'
  const formula = cation ? 'C4H10+' : 'C4H10'
  return {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    label: cation ? 'n-butane radical cation reference' : 'n-butane neutral reference',
    atoms,
    bonds: pairs.map(([first, second], index) => ({
      id: `bond-${index + 1}`,
      atomIds: [atoms[first].id, atoms[second].id],
      order: 1,
    })),
    metadata: {
      'zatom.chemical.stateId': stateId,
      'zatom.chemical.canonicalIsomericSmiles': smiles,
      'zatom.chemical.formula': formula,
      'zatom.chemical.formalCharge': cation ? 1 : 0,
      'zatom.chemical.enumerationKind': 'custom',
    },
  }
}

function populatedChemicalEnsemble(reference: ZatomStructure): ZatomChemicalStateEnsemble {
  return {
    schemaVersion: ZATOM_CHEMICAL_STATE_ENSEMBLE_SCHEMA,
    selectedStructureFingerprint: fingerprintStructure(reference),
    enumeration: {
      kind: 'custom',
      complete: true,
      status: 'Complete two-state redox fixture universe',
    },
    source: { canonicalIsomericSmiles: 'CCCC', formula: 'C4H10', formalCharge: 0 },
    normalized: {
      canonicalIsomericSmiles: 'CCCC',
      formula: 'C4H10',
      formalCharge: 0,
      method: 'preserve exact fixture source',
    },
    states: [
      {
        id: 'state-cation',
        canonicalIsomericSmiles: '[CH3][CH2][CH2][CH3+]',
        formula: 'C4H10+',
        formalCharge: 1,
        atomCount: 14,
        bondCount: 13,
        heavyAtomCount: 4,
        explicitHydrogenCount: 10,
        assignedStereocenterCount: 0,
        unassignedStereocenterCount: 0,
      },
      {
        id: 'state-neutral',
        canonicalIsomericSmiles: 'CCCC',
        formula: 'C4H10',
        formalCharge: 0,
        atomCount: 14,
        bondCount: 13,
        heavyAtomCount: 4,
        explicitHydrogenCount: 10,
        assignedStereocenterCount: 0,
        unassignedStereocenterCount: 0,
      },
    ],
    selection: {
      selectedStateId: 'state-neutral',
      selectedStateIndex: 0,
      canonicalStateId: 'state-neutral',
      canonicalStateIndex: 0,
      method: 'maximum-population',
      rationale: 'Neutral fixture state has the largest declared marginal population.',
    },
    populationModel: {
      method: 'Exact fixture redox-state marginal distribution',
      conditions: { pH: 7, temperatureK: 298.15, solvent: 'vacuum' },
      populations: [
        { stateId: 'state-cation', fraction: 0.3 },
        { stateId: 'state-neutral', fraction: 0.7 },
      ],
      normalizationScope: { kind: 'complete-state-universe' },
      citations: ['urn:zatom:test:all-state-populations'],
      scopeWarning: 'Regression-only chemical-state populations.',
    },
    provenance: {
      engine: 'fixture-redox-state-enumerator',
      engineVersion: '1.0.0',
      method: 'Declare two exact explicit-hydrogen electronic states',
      parameters: { stateCount: 2 },
      citations: ['urn:zatom:test:all-state-identities'],
      scopeWarning: 'Fixture identities are not a scientific state enumeration.',
    },
  }
}

function catalogComposition(
  ensemble: ZatomChemicalStateEnsemble,
  reference: ZatomStructure,
  cation: ZatomStructure,
): Record<string, unknown> {
  return {
    chemicalStateEnsemble: ensemble,
    chemicalStateReferenceStructure: reference,
    heavyAtomIds: ['c-1', 'c-2', 'c-3', 'c-4'],
    stateStructures: [
      { stateId: 'state-cation', structure: cation },
      { stateId: 'state-neutral', structure: reference },
    ],
    provenance: {
      engine: 'fixture-state-structure-builder',
      engineVersion: '1.0.0',
      method: 'Bind an exact explicit structure to every fixture electronic state',
      artifacts: [{
        id: 'fixture-coordinate-source',
        role: 'Exact controlled all-state coordinate fixture',
        fingerprint: 'sha256:fixture-all-state-coordinate-source',
      }],
      parameters: { mapping: 'ordered-stable-heavy-atom-ids' },
      citations: ['urn:zatom:test:all-state-structure-catalog'],
      scopeWarning: 'Fixture coordinates are not relaxed electronic-state minima.',
    },
  }
}

function stateParameters(unpairedElectrons: number): Record<string, unknown> {
  return { unpairedElectrons }
}

function displacedMember(
  source: ZatomStructure,
  id: string,
  atomId: string,
  delta: [number, number, number],
): ZatomStructure {
  return {
    ...source,
    label: `${source.label ?? 'fixture state'} ${id}`,
    atoms: source.atoms.map((atom) => atom.id === atomId ? {
      ...atom,
      position: [
        atom.position[0] + delta[0],
        atom.position[1] + delta[1],
        atom.position[2] + delta[2],
      ],
    } : atom),
    metadata: { ...source.metadata, 'zatom.fixture.conformer': id },
  }
}

function fixtureStructureEnsemble(source: ZatomStructure): {
  selected: ZatomStructure
  ensemble: ZatomStructureEnsemble
} {
  const candidates = [
    { id: 'conformer-a', weight: 0.5, structure: displacedMember(source, 'conformer-a', 'h-1', [0.07, 0.03, 0]) },
    { id: 'conformer-b', weight: 0.3, structure: displacedMember(source, 'conformer-b', 'h-2', [-0.04, 0.05, 0.03]) },
    { id: 'conformer-c', weight: 0.2, structure: displacedMember(source, 'conformer-c', 'h-3', [0, -0.06, 0.05]) },
  ]
  const members = candidates.map((candidate) => ({
    ...candidate,
    structureFingerprint: fingerprintStructure(candidate.structure),
    evidenceSourceIds: ['fixture-browser-sampler'],
  }))
  return {
    selected: candidates[0].structure,
    ensemble: {
      schemaVersion: ZATOM_STRUCTURE_ENSEMBLE_SCHEMA,
      topologyFingerprint: fingerprintForceFieldTopology(source),
      members,
      selection: {
        selectedMemberId: 'conformer-a',
        method: 'maximum-weight',
        rationale: 'Select the highest-weight browser fixture member.',
      },
      weightModel: {
        kind: 'posterior-probability',
        method: 'Controlled browser fixture distribution',
        assumptions: ['The three members are the complete fixture support.'],
        applicability: {
          assessment: 'in-domain',
          domain: 'This exact regression fixture.',
          reasons: ['Coordinates and weights are controlled test inputs.'],
        },
        scopeWarning: 'Fixture weights are not scientific predictions.',
      },
      acceptance: { minimumWeightEffectiveMemberCount: 2 },
      evidenceSources: [{
        id: 'fixture-browser-sampler',
        engine: 'fixture-browser-sampler',
        engineVersion: '1.0.0',
        method: 'Apply three deterministic local coordinate perturbations',
        artifacts: [{
          id: 'fixture-member-definitions',
          role: 'Controlled conformer coordinates and weights',
          fingerprint: 'sha256:fixture-browser-structural-sampler',
        }],
        citations: ['urn:zatom:test:browser-structural-sampler'],
        scopeWarning: 'Fixture-only structural evidence.',
      }],
      provenance: {
        engine: 'fixture-browser-sampler',
        engineVersion: '1.0.0',
        method: 'Build a bounded fixed-topology conformer fixture',
        artifacts: [{
          id: 'fixture-sampling-definition',
          role: 'Exact regression sampling definition',
          fingerprint: 'sha256:fixture-browser-sampling-definition',
        }],
        parameters: { memberCount: 3 },
        citations: ['urn:zatom:test:browser-structural-sampler'],
        scopeWarning: 'No physical sampling claim is made.',
      },
    },
  }
}

function fixtureStructuralSamplerProvider(id: string): ZatomModelingProvider {
  return {
    manifest: {
      schemaVersion: ZATOM_PROVIDER_SCHEMA,
      id,
      title: 'Browser structural sampler fixture',
      description: 'Return a bounded conformer ensemble without a host process.',
      adapterVersion: '1.0.0',
      engine: { name: 'fixture-browser-sampler', version: '1.0.0' },
      execution: 'browser',
      capabilities: [{
        id: CAPABILITY,
        title: 'Fixture conformer sampling',
        description: 'Sample three controlled fixed-topology conformer fixtures.',
        fidelity: 'statistical',
        source: 'required',
        deterministic: false,
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['unpairedElectrons'],
          properties: {
            unpairedElectrons: { type: 'integer', minimum: 0, maximum: 1 },
          },
        },
        inputArtifacts: [{ artifact: 'chemical-state-ensemble', mode: 'required' }],
        requiredCheckIds: ['fixture.structure_ensemble'],
        outputArtifacts: ['structure-ensemble'],
        tags: ['fixture', 'structure-ensemble', 'chemical-state-conditioned'],
      }],
    },
    execute: (request) => {
      if (!request.source || !request.chemicalStateEnsemble) {
        throw new ZatomProviderError('fixture_input_missing', 'Fixture sampling requires a source and chemical-state ensemble')
      }
      const stateId = request.source.metadata?.['zatom.chemical.stateId']
      const expectedSpin = stateId === 'state-cation' ? 1 : 0
      if (request.parameters.unpairedElectrons !== expectedSpin) {
        throw new ZatomProviderError(
          'fixture_invalid_electronic_state',
          `Fixture state ${String(stateId)} requires unpairedElectrons=${expectedSpin}`,
        )
      }
      const { selected, ensemble } = fixtureStructureEnsemble(request.source)
      return {
        structure: selected,
        structureEnsemble: ensemble,
        checks: [{
          id: 'fixture.structure_ensemble',
          status: 'pass',
          message: 'Browser fixture returned three valid fixed-topology members.',
        }],
      }
    },
  }
}

function samplingRequest(
  providerId: string,
  ensemble: ZatomChemicalStateEnsemble,
  catalog: ZatomChemicalStateStructureCatalog,
): Record<string, unknown> {
  return {
    providerId,
    capability: CAPABILITY,
    chemicalStateEnsemble: ensemble,
    structureCatalog: catalog,
    stateRuns: [
      { stateId: 'state-cation', parameters: stateParameters(1) },
      { stateId: 'state-neutral', parameters: stateParameters(0) },
    ],
    acceptance: { minimumJointWeightEffectiveMemberCount: 3 },
    baseSeed: 20260804,
    maxConcurrency: 2,
    maximumStates: 2,
    maximumTotalMembers: 8,
    maximumTotalMemberAtoms: 128,
    applyToWorkspace: false,
  }
}

function approximate(actual: number, expected: number, tolerance = 1e-12): void {
  assertTrue(Math.abs(actual - expected) <= tolerance, `Expected ${expected} ± ${tolerance}; got ${actual}`)
}

function expectCatalogError(run: () => unknown, code: string): void {
  let observed: unknown
  try {
    run()
  } catch (error) {
    observed = error
  }
  assertTrue(observed instanceof ZatomChemicalStateStructureCatalogInputError)
  assertEqual((observed as ZatomChemicalStateStructureCatalogInputError).code, code)
}

async function testCatalogContract(): Promise<{
  reference: ZatomStructure
  cation: ZatomStructure
  ensemble: ZatomChemicalStateEnsemble
  catalog: ZatomChemicalStateStructureCatalog
}> {
  const reference = butane('state-neutral')
  const cation = butane('state-cation')
  const rawEnsemble = populatedChemicalEnsemble(reference)
  const parsedEnsemble = parseZatomChemicalStateEnsemble(rawEnsemble, { structure: reference })
  const composition = catalogComposition(parsedEnsemble.ensemble, reference, cation)
  const catalogValidation = composeZatomChemicalStateStructureCatalog(composition)

  assertEqual(catalogValidation.catalog.entries.length, 2)
  assertEqual(
    catalogValidation.catalog.entries.map((entry) => entry.stateId).join(','),
    'state-neutral,state-cation',
  )
  assertEqual(
    catalogValidation.catalog.chemicalStateEnsembleFingerprint,
    parsedEnsemble.fingerprint,
  )
  assertEqual(
    catalogValidation.catalog.chemicalStateReferenceStructureFingerprint,
    fingerprintStructure(reference),
  )
  assertEqual(catalogValidation.identityVariableHeavyAtomIds.join(','), 'c-1')
  assertTrue(catalogValidation.checks.every((check) => check.status !== 'fail'))
  assertTrue(catalogValidation.inspectionTargets.some((target) => (
    target.id === 'chemical-state-catalog-identity-variable-atoms'
    && target.atomIds?.includes('c-1')
  )))

  const composedByTool = await callZatomMcpTool('chemical_state_compose_structure_catalog', {
    ...composition,
    chemicalStateReferenceStructure: reference,
    useActiveStructure: false,
  })
  assertTrue(composedByTool.structuredContent.ok, composedByTool.structuredContent.summary)
  const composedByToolData = composedByTool.structuredContent.data as { fingerprint: string }
  assertEqual(composedByToolData.fingerprint, catalogValidation.fingerprint)

  const validatedByTool = await callZatomMcpTool('chemical_state_validate_structure_catalog', {
    catalog: catalogValidation.catalog,
    chemicalStateEnsemble: parsedEnsemble.ensemble,
    chemicalStateReferenceStructure: reference,
    useActiveStructure: false,
  })
  assertTrue(validatedByTool.structuredContent.ok, validatedByTool.structuredContent.summary)
  const validatedByToolData = validatedByTool.structuredContent.data as { fingerprint: string }
  assertEqual(validatedByToolData.fingerprint, catalogValidation.fingerprint)

  expectCatalogError(
    () => composeZatomChemicalStateStructureCatalog({
      ...composition,
      stateStructures: [{ stateId: 'state-neutral', structure: reference }],
    }),
    'chemical_state_structure_catalog_state_coverage_mismatch',
  )

  const mappingDrift: ZatomStructure = {
    ...cation,
    atoms: [cation.atoms[1], cation.atoms[0], ...cation.atoms.slice(2)],
  }
  expectCatalogError(
    () => composeZatomChemicalStateStructureCatalog({
      ...composition,
      stateStructures: [
        { stateId: 'state-neutral', structure: reference },
        { stateId: 'state-cation', structure: mappingDrift },
      ],
    }),
    'chemical_state_structure_catalog_heavy_atom_mapping_mismatch',
  )

  expectCatalogError(
    () => composeZatomChemicalStateStructureCatalog({
      ...composition,
      heavyAtomIds: ['c-1', 'c-1', 'c-3', 'c-4'],
    }),
    'invalid_chemical_state_structure_catalog',
  )

  const identityDrift: ZatomStructure = {
    ...cation,
    metadata: {
      ...cation.metadata,
      'zatom.chemical.formalCharge': 0,
    },
  }
  expectCatalogError(
    () => composeZatomChemicalStateStructureCatalog({
      ...composition,
      stateStructures: [
        { stateId: 'state-neutral', structure: reference },
        { stateId: 'state-cation', structure: identityDrift },
      ],
    }),
    'chemical_state_structure_catalog_member_identity_mismatch',
  )

  expectCatalogError(
    () => parseZatomChemicalStateStructureCatalog(catalogValidation.catalog, {
      chemicalStateEnsemble: parsedEnsemble.ensemble,
      chemicalStateReferenceStructure: reference,
      maxTotalAtoms: 27,
    }),
    'chemical_state_structure_catalog_budget_exceeded',
  )

  const mutatedCatalog = {
    ...catalogValidation.catalog,
    provenance: {
      ...catalogValidation.catalog.provenance,
      artifacts: catalogValidation.catalog.provenance.artifacts.map((artifact) => (
        artifact.id === 'state-structures'
          ? { ...artifact, fingerprint: 'fnv1a64:tampered' }
          : artifact
      )),
    },
  }
  const mutated = await callZatomMcpTool('chemical_state_validate_structure_catalog', {
    catalog: mutatedCatalog,
    chemicalStateEnsemble: parsedEnsemble.ensemble,
    chemicalStateReferenceStructure: reference,
    useActiveStructure: false,
  })
  assertEqual(mutated.structuredContent.ok, false)
  assertEqual(mutated.structuredContent.error?.code, 'chemical_state_structure_catalog_provenance_mismatch')

  return {
    reference,
    cation,
    ensemble: parsedEnsemble.ensemble,
    catalog: catalogValidation.catalog,
  }
}

function fixtureCatalogProvider(
  id: string,
  outputArtifacts: Array<'chemical-state-ensemble' | 'chemical-state-structure-catalog'>,
  output: ZatomProviderOutput,
): ZatomModelingProvider {
  return {
    manifest: {
      schemaVersion: ZATOM_PROVIDER_SCHEMA,
      id,
      title: 'Fixture chemical-state structure catalog provider',
      description: 'Exercises broker validation of exact all-state structures and atom mappings.',
      adapterVersion: '1.0.0',
      engine: { name: 'fixture-state-structure-materializer', version: '1.0.0' },
      execution: 'browser',
      capabilities: [{
        id: 'molecule.enumerate.fixture-state-structures',
        title: 'Fixture all-state structure materialization',
        description: 'Return two exact chemical states and their mapped explicit structures.',
        fidelity: 'empirical',
        source: 'none',
        deterministic: true,
        inputSchema: { type: 'object', additionalProperties: false },
        requiredCheckIds: ['fixture.state_structure_catalog'],
        outputArtifacts,
        tags: ['fixture', 'chemical-state', 'atom-mapping'],
      }],
    },
    execute: () => output,
  }
}

async function runFixtureCatalogProvider(provider: ZatomModelingProvider) {
  const unregister = registerZatomModelingProvider(provider)
  try {
    return await callZatomMcpTool('modeling_run_provider', {
      providerId: provider.manifest.id,
      capability: provider.manifest.capabilities[0].id,
      parameters: {},
      applyToWorkspace: false,
    })
  } finally {
    unregister()
  }
}

async function testProviderCatalogBrokerIntegration(fixture: {
  reference: ZatomStructure
  ensemble: ZatomChemicalStateEnsemble
  catalog: ZatomChemicalStateStructureCatalog
}): Promise<void> {
  const canonicalOutput: ZatomProviderOutput = {
    structure: fixture.reference,
    chemicalStateEnsemble: fixture.ensemble,
    chemicalStateStructureCatalog: fixture.catalog,
    checks: [{
      id: 'fixture.state_structure_catalog',
      status: 'pass',
      message: 'Fixture materialized every returned chemical state with a stable heavy-atom mapping.',
    }],
  }
  const provider = fixtureCatalogProvider(
    'test.chemical-state-structure-catalog-broker',
    ['chemical-state-ensemble', 'chemical-state-structure-catalog'],
    canonicalOutput,
  )
  const response = await runFixtureCatalogProvider(provider)
  assertTrue(response.structuredContent.ok, response.structuredContent.summary)
  const data = response.structuredContent.data as {
    result: {
      chemicalStateStructureCatalog: ZatomChemicalStateStructureCatalog
      provenance: { chemicalStateStructureCatalogFingerprint: string }
      checks: Array<{ id: string; status: string }>
      inspectionTargets: Array<{ id: string }>
    }
  }
  assertEqual(data.result.chemicalStateStructureCatalog.entries.length, 2)
  assertEqual(
    data.result.provenance.chemicalStateStructureCatalogFingerprint,
    fingerprintChemicalStateStructureCatalog(fixture.catalog),
  )
  assertTrue(data.result.checks.some((check) => (
    check.id === 'provider.chemical_state_structure_catalog_contract' && check.status === 'pass'
  )))
  assertTrue(data.result.inspectionTargets.some((target) => (
    target.id === 'chemical-state-catalog-identity-variable-atoms'
  )))

  let invalidManifestError: unknown
  try {
    registerZatomModelingProvider(fixtureCatalogProvider(
      'test.invalid-catalog-only-manifest',
      ['chemical-state-structure-catalog'],
      canonicalOutput,
    ))
  } catch (error) {
    invalidManifestError = error
  }
  assertTrue(invalidManifestError instanceof ZatomProviderError)
  assertEqual((invalidManifestError as ZatomProviderError).code, 'invalid_provider_manifest')

  const undeclared = await runFixtureCatalogProvider(fixtureCatalogProvider(
    'test.undeclared-state-structure-catalog',
    ['chemical-state-ensemble'],
    canonicalOutput,
  ))
  assertEqual(undeclared.structuredContent.ok, false)
  assertEqual(undeclared.structuredContent.error?.code, 'invalid_provider_result')

  const missing = await runFixtureCatalogProvider(fixtureCatalogProvider(
    'test.missing-state-structure-catalog',
    ['chemical-state-ensemble', 'chemical-state-structure-catalog'],
    {
      structure: fixture.reference,
      chemicalStateEnsemble: fixture.ensemble,
      checks: canonicalOutput.checks,
    },
  ))
  assertEqual(missing.structuredContent.ok, false)
  assertEqual(missing.structuredContent.error?.code, 'invalid_provider_result')

  const cationEntry = fixture.catalog.entries.find((entry) => entry.stateId === 'state-cation')!
  const mappingDriftStructure: ZatomStructure = {
    ...cationEntry.structure,
    atoms: [
      cationEntry.structure.atoms[1],
      cationEntry.structure.atoms[0],
      ...cationEntry.structure.atoms.slice(2),
    ],
  }
  const mappingDriftCatalog: ZatomChemicalStateStructureCatalog = {
    ...fixture.catalog,
    entries: fixture.catalog.entries.map((entry) => (
      entry.stateId === cationEntry.stateId
        ? {
          ...entry,
          structure: mappingDriftStructure,
          structureFingerprint: fingerprintStructure(mappingDriftStructure),
        }
        : entry
    )),
  }
  const mappingDrift = await runFixtureCatalogProvider(fixtureCatalogProvider(
    'test.drifting-state-structure-mapping',
    ['chemical-state-ensemble', 'chemical-state-structure-catalog'],
    { ...canonicalOutput, chemicalStateStructureCatalog: mappingDriftCatalog },
  ))
  assertEqual(mappingDrift.structuredContent.ok, false)
  assertEqual(mappingDrift.structuredContent.error?.code, 'invalid_provider_result')

  const fingerprintDriftCatalog: ZatomChemicalStateStructureCatalog = {
    ...fixture.catalog,
    entries: fixture.catalog.entries.map((entry) => (
      entry.stateId === cationEntry.stateId
        ? { ...entry, structureFingerprint: 'fnv1a64:tampered' }
        : entry
    )),
  }
  const fingerprintDrift = await runFixtureCatalogProvider(fixtureCatalogProvider(
    'test.drifting-state-structure-fingerprint',
    ['chemical-state-ensemble', 'chemical-state-structure-catalog'],
    { ...canonicalOutput, chemicalStateStructureCatalog: fingerprintDriftCatalog },
  ))
  assertEqual(fingerprintDrift.structuredContent.ok, false)
  assertEqual(fingerprintDrift.structuredContent.error?.code, 'invalid_provider_result')
}

async function testAllStateSamplingAndMemberReview(): Promise<void> {
  const fixture = await testCatalogContract()
  await testProviderCatalogBrokerIntegration(fixture)
  const provider = fixtureStructuralSamplerProvider('test.all-state-browser-sampling')
  const unregister = registerZatomModelingProvider(provider)
  try {
    assertTrue(listZatomMcpTools().some((tool) => (
      tool.name === 'chemical_state_sample_structural_distribution'
    )))
    assertTrue(listZatomMcpTools().some((tool) => (
      tool.name === 'chemical_state_select_structural_member'
    )))

      let active: ZatomStructure | null = null
      let writeCount = 0
      let captureCount = 0
      const context: ZatomToolContext = {
        writeStructure: (structure) => {
          active = structure
          writeCount++
        },
        readStructure: () => active,
        captureViewport: () => {
          captureCount++
          return {
            imageBase64: 'dmlzdWFsLWZpeHR1cmU=',
            mimeType: 'image/jpeg',
            width: 320,
            height: 240,
          }
        },
      }
      const request = samplingRequest(provider.manifest.id, fixture.ensemble, fixture.catalog)
      const sampled = await callZatomMcpTool(
        'chemical_state_sample_structural_distribution',
        { ...request, applyToWorkspace: true, captureAfter: true },
        context,
      )
      assertTrue(sampled.structuredContent.ok, sampled.structuredContent.summary)
      const envelope = sampled.structuredContent.data as SamplingEnvelope
      const result = envelope.result
      assertEqual(envelope.appliedToWorkspace, true)
      assertEqual(envelope.applicationBlocked, false)
      assertEqual(envelope.applicationVerified, true)
      assertEqual(writeCount, 1)
      assertEqual(captureCount, 1)
      assertTrue(sampled.content.some((block) => block.type === 'image'))
      assertEqual(result.stateExecutions.length, 2)
      assertEqual(new Set(result.stateExecutions.map((execution) => execution.seed)).size, 2)
      assertEqual(
        new Set(result.stateExecutions.map((execution) => (
          execution.inputChemicalStateEnsembleFingerprint
        ))).size,
        2,
      )
      assertTrue(result.stateExecutions.every((execution) => execution.memberCount === 3))
      assertTrue(result.stateExecutions.every((execution) => !execution.providerDeterministic))
      assertEqual(
        result.provenance.chemicalStateEnsembleFingerprint,
        fixture.catalog.chemicalStateEnsembleFingerprint,
      )
      assertEqual(
        result.provenance.chemicalStateStructureCatalogFingerprint,
        fingerprintChemicalStateStructureCatalog(fixture.catalog),
      )
      assertEqual(
        result.chemicalStateStructuralDistribution.stateStructureEnsembles.reduce((sum, entry) => (
          sum + entry.structureEnsemble.members.length
        ), 0),
        6,
      )
      assertTrue(
        fingerprintStructure(result.structure) !== fingerprintStructure(fixture.reference),
        'Sampling output must remain distinct from the pre-sampling chemical reference.',
      )

      const parsedDistribution = parseZatomChemicalStateStructuralDistribution(
        result.chemicalStateStructuralDistribution,
        {
          chemicalStateEnsemble: fixture.ensemble,
          chemicalStateReferenceStructure: fixture.reference,
          selectedStructure: result.structure,
        },
      )
      assertEqual(parsedDistribution.fingerprint, result.chemicalStateStructuralDistributionFingerprint)
      assertEqual(parsedDistribution.jointMembers.length, 6)
      approximate(parsedDistribution.jointMembers.reduce((sum, member) => sum + member.jointWeight, 0), 1)
      approximate(parsedDistribution.jointMembers.filter((member) => (
        member.stateId === 'state-neutral'
      )).reduce((sum, member) => sum + member.jointWeight, 0), 0.7)
      approximate(parsedDistribution.jointMembers.filter((member) => (
        member.stateId === 'state-cation'
      )).reduce((sum, member) => sum + member.jointWeight, 0), 0.3)
      assertTrue(result.checks.some((check) => (
        check.id === 'chemical_state_structural_distribution.reference_binding'
        && check.status === 'pass'
        && check.metrics?.selectedMemberDiffersFromChemicalReference === true
      )))
      assertTrue(result.checks.some((check) => (
        check.id === 'chemical_state_structural_sampling.state_coverage'
        && check.status === 'pass'
      )))
      assertTrue(result.checks.some((check) => (
        check.id === 'chemical_state_structural_sampling.model_scope'
        && check.status === 'warn'
      )))
      assertEqual(result.stateVisualReviews.length, 2)
      assertTrue(result.stateVisualReviews.every((review) => review.inspectionTargets.length > 0))

      let missingReferenceError: unknown
      try {
        parseZatomChemicalStateStructuralDistribution(
          result.chemicalStateStructuralDistribution,
          {
            chemicalStateEnsemble: fixture.ensemble,
            selectedStructure: result.structure,
          } as Parameters<typeof parseZatomChemicalStateStructuralDistribution>[1],
        )
      } catch (error) {
        missingReferenceError = error
      }
      assertTrue(missingReferenceError instanceof ZatomStructureInputError)
      assertEqual(
        (missingReferenceError as ZatomStructureInputError).code,
        'invalid_structure',
      )

      const replay = await callZatomMcpTool(
        'chemical_state_sample_structural_distribution',
        request,
      )
      assertTrue(replay.structuredContent.ok, replay.structuredContent.summary)
      const replayEnvelope = replay.structuredContent.data as SamplingEnvelope
      assertEqual(
        replayEnvelope.result.chemicalStateStructuralDistributionFingerprint,
        result.chemicalStateStructuralDistributionFingerprint,
      )
      assertEqual(
        replayEnvelope.result.stateExecutions.map((execution) => execution.seed).join(','),
        result.stateExecutions.map((execution) => execution.seed).join(','),
      )
      assertEqual(writeCount, 1)

      const cationEntry = result.chemicalStateStructuralDistribution.stateStructureEnsembles.find((entry) => (
        entry.stateId === 'state-cation'
      ))!
      const requestedMember = cationEntry.structureEnsemble.members[1]
      const selectedMember = await callZatomMcpTool('chemical_state_select_structural_member', {
        chemicalStateEnsemble: fixture.ensemble,
        structureCatalog: fixture.catalog,
        distribution: result.chemicalStateStructuralDistribution,
        stateId: 'state-cation',
        memberId: requestedMember.id,
        applyToWorkspace: true,
        captureAfter: true,
      }, context)
      assertTrue(selectedMember.structuredContent.ok, selectedMember.structuredContent.summary)
      const selectedEnvelope = selectedMember.structuredContent.data as MemberSelectionEnvelope
      assertEqual(selectedEnvelope.appliedToWorkspace, true)
      assertEqual(selectedEnvelope.applicationVerified, true)
      assertEqual(selectedEnvelope.result.stateId, 'state-cation')
      assertEqual(selectedEnvelope.result.memberId, requestedMember.id)
      assertEqual(
        fingerprintStructure(selectedEnvelope.result.structure),
        requestedMember.structureFingerprint,
      )
      assertEqual(
        selectedEnvelope.result.structure.metadata?.['zatom.chemical.stateId'],
        'state-cation',
      )
      approximate(
        selectedEnvelope.result.jointWeight,
        selectedEnvelope.result.stateFraction * selectedEnvelope.result.conditionalStructureWeight,
      )
      assertEqual(writeCount, 2)
      assertEqual(captureCount, 2)

      const absentMember = await callZatomMcpTool('chemical_state_select_structural_member', {
        chemicalStateEnsemble: fixture.ensemble,
        structureCatalog: fixture.catalog,
        distribution: result.chemicalStateStructuralDistribution,
        stateId: 'state-cation',
        memberId: 'absent-member',
      })
      assertEqual(absentMember.structuredContent.ok, false)
      assertEqual(absentMember.structuredContent.error?.code, 'chemical_state_structural_member_not_found')

    await testSamplingFailures(request, context, () => writeCount)
  } finally {
    unregister()
  }
}

async function testSamplingFailures(
  request: Record<string, unknown>,
  context: ZatomToolContext,
  currentWriteCount: () => number,
): Promise<void> {
  const stateRuns = request.stateRuns as Array<{
    stateId: string
    parameters: Record<string, unknown>
  }>

  const missingStateRun = await callZatomMcpTool(
    'chemical_state_sample_structural_distribution',
    { ...request, stateRuns: stateRuns.slice(0, 1) },
  )
  assertEqual(missingStateRun.structuredContent.ok, false)
  assertEqual(
    missingStateRun.structuredContent.error?.code,
    'chemical_state_structural_sampling_state_run_coverage_mismatch',
  )

  const stateBudget = await callZatomMcpTool(
    'chemical_state_sample_structural_distribution',
    { ...request, maximumStates: 1 },
  )
  assertEqual(stateBudget.structuredContent.ok, false)
  assertEqual(
    stateBudget.structuredContent.error?.code,
    'chemical_state_structural_sampling_budget_exceeded',
  )

  const memberBudget = await callZatomMcpTool(
    'chemical_state_sample_structural_distribution',
    { ...request, maximumTotalMembers: 3 },
  )
  assertEqual(memberBudget.structuredContent.ok, false)
  assertEqual(
    memberBudget.structuredContent.error?.code,
    'chemical_state_structural_sampling_budget_exceeded',
  )

  const writesBeforeSpinFailure = currentWriteCount()
  const wrongSpinRuns = stateRuns.map((run) => (
    run.stateId === 'state-cation'
      ? { ...run, parameters: { ...run.parameters, unpairedElectrons: 0 } }
      : run
  ))
  const wrongSpin = await callZatomMcpTool(
    'chemical_state_sample_structural_distribution',
    {
      ...request,
      stateRuns: wrongSpinRuns,
      applyToWorkspace: true,
      captureAfter: true,
    },
    context,
  )
  assertEqual(wrongSpin.structuredContent.ok, false)
  assertEqual(
    wrongSpin.structuredContent.error?.code,
    'chemical_state_structural_sampling_state_failed',
  )
  const failureDetails = JSON.stringify(wrongSpin.structuredContent.error?.details)
  assertTrue(failureDetails.includes('state-cation'))
  assertTrue(failureDetails.includes('fixture_invalid_electronic_state'))
  assertEqual(currentWriteCount(), writesBeforeSpinFailure)
  assertEqual(wrongSpin.structuredContent.data, undefined)

  const incompatibleProvider: ZatomModelingProvider = {
    manifest: {
      schemaVersion: ZATOM_PROVIDER_SCHEMA,
      id: 'test.incompatible-all-state-sampler',
      title: 'Incompatible all-state sampler fixture',
      description: 'Deliberately omits the required chemical-state input artifact.',
      adapterVersion: '1.0.0',
      engine: { name: 'fixture-incompatible-sampler', version: '1.0.0' },
      execution: 'browser',
      capabilities: [{
        id: 'molecule.sample.incompatible-structures',
        title: 'Incompatible structure sampler',
        description: 'A valid capability intentionally unsuitable for all-state orchestration.',
        fidelity: 'statistical',
        source: 'required',
        deterministic: true,
        inputSchema: { type: 'object', additionalProperties: false },
        requiredCheckIds: ['fixture.incompatible'],
        outputArtifacts: ['structure-ensemble'],
        tags: ['fixture', 'structure-ensemble'],
      }],
    },
    execute: () => {
      throw new Error('The incompatible provider must be rejected before execution')
    },
  }
  const unregisterIncompatible = registerZatomModelingProvider(incompatibleProvider)
  try {
    const incompatible = await callZatomMcpTool(
      'chemical_state_sample_structural_distribution',
      {
        ...request,
        providerId: incompatibleProvider.manifest.id,
        capability: incompatibleProvider.manifest.capabilities[0].id,
      },
    )
    assertEqual(incompatible.structuredContent.ok, false)
    assertEqual(
      incompatible.structuredContent.error?.code,
      'chemical_state_structural_sampling_provider_incompatible',
    )
  } finally {
    unregisterIncompatible()
  }
}

async function main(): Promise<void> {
  await testAllStateSamplingAndMemberReview()
  console.log('agent all-state chemical/structural sampling tests passed')
}

void main()
