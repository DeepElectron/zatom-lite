/** Run one fixed-state structural provider over every catalogued chemical state. */

import type {
  InspectionTarget,
  JsonValue,
  ValidationCheck,
  ZatomStructure,
  ZatomToolDefinition,
  ZatomToolResult,
} from './contracts'
import { finalizeStructureCandidate } from './candidate-tool'
import {
  parseZatomChemicalStateEnsemble,
  type ZatomChemicalStateEnsemble,
  type ZatomChemicalStateEnsembleValidation,
  ZatomChemicalStateEnsembleInputError,
} from './chemical-state-ensemble'
import {
  parseZatomChemicalStateStructureCatalog,
  type ZatomChemicalStateStructureCatalog,
  type ZatomChemicalStateStructureCatalogValidation,
  ZatomChemicalStateStructureCatalogInputError,
  ZATOM_CHEMICAL_STATE_STRUCTURE_CATALOG_SCHEMA,
} from './chemical-state-structure-catalog'
import {
  composeZatomChemicalStateStructuralDistribution,
  parseZatomChemicalStateStructuralDistribution,
  type ZatomChemicalStateStructuralDistribution,
  type ZatomChemicalStateStructuralDistributionValidation,
  ZatomChemicalStateStructuralDistributionInputError,
} from './chemical-state-structural-distribution'
import {
  normalizeProviderOutput,
  type ZatomProviderCandidate,
  type ZatomProviderExecutionRequest,
  ZatomProviderError,
} from './provider'
import { defaultZatomProviderRegistry } from './provider-tools'
import { boundsOfPositions, fingerprintCanonicalJson, fingerprintStructure } from './structure-math'
import { parseZatomStructure, ZatomStructureInputError } from './structure-validation'
import { ZatomStructureEnsembleInputError } from './structure-ensemble'

const ORCHESTRATOR_VERSION = '1.0.0'
const REBIND_METADATA_KEY = 'zatom.chemical.selectionRebind'

interface StateRun {
  stateId: string
  parameters: Record<string, unknown>
}

interface StateExecution {
  stateId: string
  seed: number
  sourceStructureFingerprint: string
  inputChemicalStateEnsembleFingerprint: string
  candidate: ZatomProviderCandidate
}

export interface ZatomChemicalStateStructuralSamplingResult {
  structure: ZatomStructure
  chemicalStateEnsemble: ZatomChemicalStateEnsemble
  chemicalStateStructureCatalog: ZatomChemicalStateStructureCatalog
  chemicalStateStructuralDistribution: ZatomChemicalStateStructuralDistribution
  chemicalStateStructuralDistributionFingerprint: string
  stateExecutions: Array<{
    stateId: string
    seed: number
    sourceStructureFingerprint: string
    inputChemicalStateEnsembleFingerprint: string
    resultStructureFingerprint: string
    structureEnsembleFingerprint: string
    selectedMemberId: string
    memberCount: number
    providerDeterministic: boolean
  }>
  /** Targets remain bound to each state's selected output structure and are not applied automatically. */
  stateVisualReviews: Array<{
    stateId: string
    structureFingerprint: string
    inspectionTargets: InspectionTarget[]
  }>
  checks: ValidationCheck[]
  inspectionTargets: InspectionTarget[]
  provenance: {
    engine: 'zatom-provider-orchestrator'
    engineVersion: typeof ORCHESTRATOR_VERSION
    providerId: string
    capability: string
    chemicalStateEnsembleFingerprint: string
    chemicalStateStructureCatalogFingerprint: string
    chemicalStateStructuralDistributionFingerprint: string
    sourceFingerprint: string
    resultFingerprint: string
    baseSeed: number
  }
}

class ZatomChemicalStateStructuralSamplingError extends Error {
  readonly code: string
  readonly details?: JsonValue

  constructor(code: string, message: string, details?: JsonValue) {
    super(message)
    this.name = 'ZatomChemicalStateStructuralSamplingError'
    this.code = code
    this.details = details
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function exactObject(
  value: unknown,
  field: string,
  required: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new ZatomChemicalStateStructuralSamplingError(
      'invalid_chemical_state_structural_sampling_input',
      `${field} must be an object`,
    )
  }
  const allowed = new Set([...required, ...optional])
  const missing = required.filter((key) => !(key in value))
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key))
  if (missing.length || unexpected.length) {
    throw new ZatomChemicalStateStructuralSamplingError(
      'invalid_chemical_state_structural_sampling_input',
      `${field} fields differ (missing=${missing.join(',') || 'none'}, unexpected=${unexpected.join(',') || 'none'})`,
    )
  }
  return value
}

function text(value: unknown, field: string, maximum = 256): string {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0') || value.length > maximum) {
    throw new ZatomChemicalStateStructuralSamplingError(
      'invalid_chemical_state_structural_sampling_input',
      `${field} must be non-empty text of at most ${maximum} characters without NUL bytes`,
    )
  }
  return value.trim()
}

function integer(
  value: unknown,
  field: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const result = value === undefined ? fallback : Number(value)
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) {
    throw new ZatomChemicalStateStructuralSamplingError(
      'invalid_chemical_state_structural_sampling_input',
      `${field} must be an integer from ${minimum} through ${maximum}`,
    )
  }
  return result
}

function jsonValue(value: unknown, field: string): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new ZatomChemicalStateStructuralSamplingError(
        'invalid_chemical_state_structural_sampling_input',
        `${field} contains a non-finite number`,
      )
    }
    return Object.is(value, -0) ? 0 : value
  }
  if (Array.isArray(value)) return value.map((item, index) => jsonValue(item, `${field}[${index}]`))
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      jsonValue(item, `${field}.${key}`),
    ]))
  }
  throw new ZatomChemicalStateStructuralSamplingError(
    'invalid_chemical_state_structural_sampling_input',
    `${field} must be JSON-safe`,
  )
}


function rawCatalogReference(
  catalogValue: unknown,
  ensembleValue: unknown,
): ZatomStructure {
  const ensemble = exactObject(ensembleValue, 'chemicalStateEnsemble', [
    'schemaVersion',
    'selectedStructureFingerprint',
    'enumeration',
    'source',
    'normalized',
    'states',
    'selection',
    'provenance',
  ], ['populationModel', 'metadata'])
  const selection = exactObject(ensemble.selection, 'chemicalStateEnsemble.selection', [
    'selectedStateId', 'selectedStateIndex', 'method', 'rationale',
  ], ['canonicalStateId', 'canonicalStateIndex'])
  const selectedStateId = text(selection.selectedStateId, 'chemicalStateEnsemble.selection.selectedStateId', 128)
  const catalog = exactObject(catalogValue, 'chemicalStateStructureCatalog', [
    'schemaVersion',
    'chemicalStateEnsembleFingerprint',
    'chemicalStateReferenceStructureFingerprint',
    'heavyAtomIds',
    'entries',
    'provenance',
  ], ['metadata'])
  if (!Array.isArray(catalog.entries)) {
    throw new ZatomChemicalStateStructuralSamplingError(
      'invalid_chemical_state_structural_sampling_input',
      'chemicalStateStructureCatalog.entries must be an array',
    )
  }
  const selected = catalog.entries.find((raw) => (
    isRecord(raw) && raw.stateId === selectedStateId
  ))
  if (!isRecord(selected) || selected.structure === undefined) {
    throw new ZatomChemicalStateStructuralSamplingError(
      'chemical_state_structural_sampling_reference_missing',
      `Structure catalog does not expose selected reference state ${selectedStateId}`,
    )
  }
  return parseZatomStructure(selected.structure)
}

function parseStateRuns(
  value: unknown,
  catalog: ZatomChemicalStateStructureCatalog,
  maxParameterBytes: number,
): StateRun[] {
  if (!Array.isArray(value) || value.length !== catalog.entries.length) {
    throw new ZatomChemicalStateStructuralSamplingError(
      'chemical_state_structural_sampling_state_run_coverage_mismatch',
      'stateRuns must cover every catalog state exactly once',
    )
  }
  const byState = new Map<string, Record<string, unknown>>()
  value.forEach((raw, index) => {
    const field = `stateRuns[${index}]`
    const record = exactObject(raw, field, ['stateId', 'parameters'])
    const stateId = text(record.stateId, `${field}.stateId`, 128)
    if (!isRecord(record.parameters)) {
      throw new ZatomChemicalStateStructuralSamplingError(
        'invalid_chemical_state_structural_sampling_input',
        `${field}.parameters must be an object`,
      )
    }
    if (byState.has(stateId)) {
      throw new ZatomChemicalStateStructuralSamplingError(
        'chemical_state_structural_sampling_state_run_coverage_mismatch',
        `stateRuns repeats ${stateId}`,
      )
    }
    byState.set(stateId, record.parameters)
  })
  const result = catalog.entries.map((entry) => {
    const parameters = byState.get(entry.stateId)
    if (!parameters) {
      throw new ZatomChemicalStateStructuralSamplingError(
        'chemical_state_structural_sampling_state_run_coverage_mismatch',
        `stateRuns omits ${entry.stateId}`,
      )
    }
    return {
      stateId: entry.stateId,
      parameters: jsonValue(parameters, `stateRuns.${entry.stateId}.parameters`) as Record<string, unknown>,
    }
  })
  if ([...byState.keys()].some((stateId) => !catalog.entries.some((entry) => entry.stateId === stateId))) {
    throw new ZatomChemicalStateStructuralSamplingError(
      'chemical_state_structural_sampling_state_run_coverage_mismatch',
      'stateRuns contains a state outside the structure catalog',
    )
  }
  const parameterBytes = new TextEncoder().encode(JSON.stringify(result)).length
  if (parameterBytes > maxParameterBytes) {
    throw new ZatomChemicalStateStructuralSamplingError(
      'chemical_state_structural_sampling_budget_exceeded',
      `stateRuns use ${parameterBytes} JSON bytes; limit is ${maxParameterBytes}`,
    )
  }
  return result
}

function deriveDistinctSeeds(
  baseSeed: number,
  ensembleFingerprint: string,
  providerId: string,
  capability: string,
  stateIds: string[],
): Map<string, number> {
  const used = new Set<number>()
  const result = new Map<string, number>()
  for (const stateId of stateIds) {
    const identity = `${baseSeed}\0${ensembleFingerprint}\0${providerId}\0${capability}\0${stateId}`
    let hash = 0x811c9dc5
    for (let index = 0; index < identity.length; index++) {
      hash ^= identity.charCodeAt(index)
      hash = Math.imul(hash, 0x01000193) >>> 0
    }
    while (used.has(hash)) hash = (hash + 1) >>> 0
    used.add(hash)
    result.set(stateId, hash)
  }
  return result
}

function rebindChemicalStateSelection(
  ensembleValidation: ZatomChemicalStateEnsembleValidation,
  catalogFingerprint: string,
  stateId: string,
  structure: ZatomStructure,
): ZatomChemicalStateEnsembleValidation {
  const ensemble = ensembleValidation.ensemble
  if (ensemble.metadata?.[REBIND_METADATA_KEY] !== undefined) {
    throw new ZatomChemicalStateStructuralSamplingError(
      'chemical_state_structural_sampling_rebind_collision',
      `Chemical-state metadata already contains reserved ${REBIND_METADATA_KEY}`,
    )
  }
  const selectedStateIndex = ensemble.states.findIndex((state) => state.id === stateId)
  if (selectedStateIndex < 0) {
    throw new ZatomChemicalStateStructuralSamplingError(
      'chemical_state_structural_sampling_state_run_coverage_mismatch',
      `Cannot rebind absent state ${stateId}`,
    )
  }
  const structureFingerprint = fingerprintStructure(structure)
  return parseZatomChemicalStateEnsemble({
    ...ensemble,
    selectedStructureFingerprint: structureFingerprint,
    selection: {
      ...ensemble.selection,
      selectedStateId: stateId,
      selectedStateIndex,
      method: 'explicit',
      rationale: `Condition structural sampling on catalog state ${stateId}; parent ensemble ${ensembleValidation.fingerprint}.`,
    },
    metadata: {
      ...(ensemble.metadata ?? {}),
      [REBIND_METADATA_KEY]: {
        parentChemicalStateEnsembleFingerprint: ensembleValidation.fingerprint,
        chemicalStateStructureCatalogFingerprint: catalogFingerprint,
        selectedStateId: stateId,
        selectedStructureFingerprint: structureFingerprint,
        method: 'exact-catalog-state-selection',
      },
    },
  }, { structure })
}

async function mapConcurrent<T, U>(
  values: readonly T[],
  concurrency: number,
  task: (value: T, index: number) => Promise<U>,
): Promise<Array<PromiseSettledResult<U>>> {
  const results = new Array<PromiseSettledResult<U>>(values.length)
  let nextIndex = 0
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (true) {
      const index = nextIndex++
      if (index >= values.length) return
      try {
        results[index] = { status: 'fulfilled', value: await task(values[index], index) }
      } catch (reason) {
        results[index] = { status: 'rejected', reason }
      }
    }
  })
  await Promise.all(workers)
  return results
}

function prefixedChecks(stateId: string, stateIndex: number, checks: ValidationCheck[]): ValidationCheck[] {
  return checks.map((check) => ({
    ...check,
    id: `chemical_state_sampling.state_${stateIndex + 1}.${check.id}`,
    message: `State ${stateId}: ${check.message}`,
    metrics: { ...(check.metrics ?? {}), stateId },
  }))
}

function errorIdentity(error: unknown): { code: string; message: string } {
  if (error && typeof error === 'object') {
    const candidate = error as { code?: unknown; message?: unknown }
    return {
      code: typeof candidate.code === 'string' ? candidate.code : 'provider_execution_failed',
      message: typeof candidate.message === 'string' ? candidate.message : String(error),
    }
  }
  return { code: 'provider_execution_failed', message: String(error) }
}

async function executeStructuralSampling(
  input: Record<string, unknown>,
): Promise<ZatomChemicalStateStructuralSamplingResult> {
  const providerId = text(input.providerId, 'providerId', 96)
  const capabilityId = text(input.capability, 'capability', 96)
  const provider = defaultZatomProviderRegistry.get(providerId)
  if (!provider) {
    throw new ZatomChemicalStateStructuralSamplingError(
      'unknown_provider',
      `Unknown modeling provider ${providerId}`,
    )
  }
  const capability = provider.manifest.capabilities.find((item) => item.id === capabilityId)
  if (!capability) {
    throw new ZatomChemicalStateStructuralSamplingError(
      'unsupported_capability',
      `Provider ${providerId} does not implement ${capabilityId}`,
    )
  }
  const chemicalInput = capability.inputArtifacts?.find((contract) => (
    contract.artifact === 'chemical-state-ensemble'
  ))
  const unsupportedRequiredInputs = (capability.inputArtifacts ?? []).filter((contract) => (
    contract.mode === 'required' && contract.artifact !== 'chemical-state-ensemble'
  ))
  if (capability.source !== 'required'
    || chemicalInput?.mode !== 'required'
    || !capability.outputArtifacts?.includes('structure-ensemble')
    || capability.continuation?.mode === 'required'
    || unsupportedRequiredInputs.length) {
    throw new ZatomChemicalStateStructuralSamplingError(
      'chemical_state_structural_sampling_provider_incompatible',
      'Selected capability must require a source and chemical-state-ensemble input, return a structure-ensemble, require no continuation, and require no unsupported input artifact',
    )
  }

  const reference = rawCatalogReference(input.structureCatalog, input.chemicalStateEnsemble)
  const catalogValidation = parseZatomChemicalStateStructureCatalog(input.structureCatalog, {
    chemicalStateEnsemble: input.chemicalStateEnsemble as ZatomChemicalStateEnsemble,
    chemicalStateReferenceStructure: reference,
  })
  const ensembleValidation = catalogValidation.chemicalStateEnsembleValidation
  const ensemble = ensembleValidation.ensemble
  if (!ensemble.populationModel) {
    throw new ZatomChemicalStateStructuralSamplingError(
      'chemical_state_structural_sampling_population_required',
      'All-state structural sampling requires a validated chemical-state population model for joint composition',
    )
  }
  const maximumStates = integer(input.maximumStates, 'maximumStates', 32, 1, 128)
  const maximumTotalMembers = integer(input.maximumTotalMembers, 'maximumTotalMembers', 4096, 2, 32768)
  const maximumTotalMemberAtoms = integer(
    input.maximumTotalMemberAtoms,
    'maximumTotalMemberAtoms',
    2_000_000,
    2,
    10_000_000,
  )
  const maxConcurrency = integer(input.maxConcurrency, 'maxConcurrency', 1, 1, 8)
  const maxParameterBytes = integer(
    input.maxParameterBytes,
    'maxParameterBytes',
    8 * 1024 * 1024,
    1024,
    64 * 1024 * 1024,
  )
  if (catalogValidation.catalog.entries.length > maximumStates) {
    throw new ZatomChemicalStateStructuralSamplingError(
      'chemical_state_structural_sampling_budget_exceeded',
      `Catalog has ${catalogValidation.catalog.entries.length} states; request maximumStates is ${maximumStates}`,
    )
  }
  if (catalogValidation.catalog.entries.length * 2 > maximumTotalMembers) {
    throw new ZatomChemicalStateStructuralSamplingError(
      'chemical_state_structural_sampling_budget_exceeded',
      `At least two members per state require ${catalogValidation.catalog.entries.length * 2} total members; request limit is ${maximumTotalMembers}`,
    )
  }
  const stateRuns = parseStateRuns(input.stateRuns, catalogValidation.catalog, maxParameterBytes)
  const baseSeed = integer(input.baseSeed, 'baseSeed', 42, 0, 0xffffffff)
  const seeds = deriveDistinctSeeds(
    baseSeed,
    ensembleValidation.fingerprint,
    providerId,
    capabilityId,
    stateRuns.map((run) => run.stateId),
  )
  const runByState = new Map(stateRuns.map((run) => [run.stateId, run]))
  const settled = await mapConcurrent(
    catalogValidation.catalog.entries,
    maxConcurrency,
    async (entry): Promise<StateExecution> => {
      const reselected = rebindChemicalStateSelection(
        ensembleValidation,
        catalogValidation.fingerprint,
        entry.stateId,
        entry.structure,
      )
      const request: ZatomProviderExecutionRequest = {
        capability: capabilityId,
        source: entry.structure,
        continuation: null,
        chemicalStateEnsemble: {
          schemaVersion: 'zatom.provider-chemical-state-ensemble/v1',
          fingerprint: reselected.fingerprint,
          ensemble: reselected.ensemble,
        },
        parameters: runByState.get(entry.stateId)!.parameters,
        seed: seeds.get(entry.stateId)!,
      }
      const execution = await defaultZatomProviderRegistry.execute(providerId, request, {})
      const candidate = normalizeProviderOutput({
        provider: execution.provider,
        capability: execution.capability,
        request,
        output: execution.output,
      })
      if (!candidate.structureEnsemble
        || candidate.provenance.inputChemicalStateEnsembleFingerprint !== reselected.fingerprint
        || candidate.provenance.structureEnsembleFingerprint === undefined) {
        throw new ZatomChemicalStateStructuralSamplingError(
          'chemical_state_structural_sampling_provider_contract_mismatch',
          `State ${entry.stateId} did not preserve exact chemical input and structure-ensemble provenance bindings`,
        )
      }
      return {
        stateId: entry.stateId,
        seed: seeds.get(entry.stateId)!,
        sourceStructureFingerprint: entry.structureFingerprint,
        inputChemicalStateEnsembleFingerprint: reselected.fingerprint,
        candidate,
      }
    },
  )
  const failures: Array<Record<string, JsonValue>> = []
  const executions: StateExecution[] = []
  settled.forEach((result, index) => {
    const stateId = catalogValidation.catalog.entries[index].stateId
    if (result.status === 'rejected') {
      failures.push({ stateId, ...errorIdentity(result.reason) })
      return
    }
    const failedCheckIds = result.value.candidate.checks
      .filter((check) => check.status === 'fail')
      .map((check) => check.id)
    if (failedCheckIds.length) {
      failures.push({ stateId, code: 'provider_candidate_failed_checks', failedCheckIds })
      return
    }
    executions.push(result.value)
  })
  if (failures.length) {
    throw new ZatomChemicalStateStructuralSamplingError(
      'chemical_state_structural_sampling_state_failed',
      `${failures.length} of ${stateRuns.length} state-conditioned provider run(s) failed; no partial joint distribution was created`,
      { failures },
    )
  }

  const totalMembers = executions.reduce((sum, execution) => (
    sum + execution.candidate.structureEnsemble!.members.length
  ), 0)
  const totalMemberAtoms = executions.reduce((sum, execution) => (
    sum + execution.candidate.structureEnsemble!.members.reduce((memberSum, member) => (
      memberSum + member.structure.atoms.length
    ), 0)
  ), 0)
  if (totalMembers > maximumTotalMembers || totalMemberAtoms > maximumTotalMemberAtoms) {
    throw new ZatomChemicalStateStructuralSamplingError(
      'chemical_state_structural_sampling_budget_exceeded',
      `State runs returned ${totalMembers} members and ${totalMemberAtoms} member-atoms; limits are ${maximumTotalMembers} and ${maximumTotalMemberAtoms}`,
    )
  }
  const executionByState = new Map(executions.map((execution) => [execution.stateId, execution]))
  const selectedExecution = executionByState.get(ensemble.selection.selectedStateId)!
  const selectedStructure = selectedExecution.candidate.structure
  const stateEnsembleBindings = executions.map((execution) => ({
    stateId: execution.stateId,
    inputChemicalStateEnsembleFingerprint: execution.inputChemicalStateEnsembleFingerprint,
    structureEnsembleFingerprint: execution.candidate.provenance.structureEnsembleFingerprint!,
    seed: execution.seed,
  }))
  const stateInputAggregateFingerprint = fingerprintCanonicalJson(stateEnsembleBindings.map((binding) => ({
    stateId: binding.stateId,
    inputChemicalStateEnsembleFingerprint: binding.inputChemicalStateEnsembleFingerprint,
    seed: binding.seed,
  })))
  const stateOutputAggregateFingerprint = fingerprintCanonicalJson(stateEnsembleBindings.map((binding) => ({
    stateId: binding.stateId,
    structureEnsembleFingerprint: binding.structureEnsembleFingerprint,
  })))
  const providerManifestFingerprint = fingerprintCanonicalJson({
    provider: provider.manifest,
    capability,
  })
  const distributionValidation = composeZatomChemicalStateStructuralDistribution({
    chemicalStateEnsemble: ensemble,
    heavyAtomIds: catalogValidation.catalog.heavyAtomIds,
    stateStructureEnsembles: catalogValidation.catalog.entries.map((entry) => ({
      stateId: entry.stateId,
      structureEnsemble: executionByState.get(entry.stateId)!.candidate.structureEnsemble!,
    })),
    acceptance: input.acceptance,
    provenance: {
      engine: 'zatom-provider-orchestrator',
      engineVersion: ORCHESTRATOR_VERSION,
      method: `Execute ${providerId}/${capabilityId} independently for every exact catalog state and compose state marginal × conditional structure weights`,
      artifacts: [
        {
          id: 'chemical-state-ensemble',
          role: 'Exact populated chemical-state marginal dependency',
          fingerprint: ensembleValidation.fingerprint,
        },
        {
          id: 'chemical-state-structure-catalog',
          role: 'Exact all-state source structures and heavy-atom correspondence',
          fingerprint: catalogValidation.fingerprint,
        },
        {
          id: 'provider-manifest',
          role: 'Exact selected provider manifest and capability contract',
          fingerprint: providerManifestFingerprint,
        },
        {
          id: 'state-conditioned-input-ensembles',
          role: 'Aggregate exact per-state chemical-selection rebindings and derived seeds',
          fingerprint: stateInputAggregateFingerprint,
        },
        {
          id: 'state-conditioned-structure-ensembles',
          role: 'Aggregate canonical per-state structure-ensemble outputs',
          fingerprint: stateOutputAggregateFingerprint,
        },
      ],
      parameters: {
        providerId,
        capability: capabilityId,
        baseSeed,
        maxConcurrency,
        maximumStates,
        maximumTotalMembers,
        maximumTotalMemberAtoms,
        stateExecutions: stateEnsembleBindings,
      },
      citations: [...ensemble.populationModel.citations],
      scopeWarning: `${ensemble.populationModel.scopeWarning} State-conditioned provider outputs retain their own applicability and model-scope evidence. Orchestration proves dependency binding and joint arithmetic, not state/conformer completeness, free-energy accuracy, cross-state kinetics, or sampling convergence.`,
    },
    metadata: {
      chemicalStateStructureCatalogFingerprint: catalogValidation.fingerprint,
      providerId,
      capability: capabilityId,
      providerManifestFingerprint,
      stateInputAggregateFingerprint,
      stateOutputAggregateFingerprint,
    },
  }, {
    chemicalStateReferenceStructure: reference,
    selectedStructure,
    maxJointMembers: maximumTotalMembers,
    maxMemberAtoms: maximumTotalMemberAtoms,
  })

  const stateChecks = executions.flatMap((execution, index) => (
    prefixedChecks(execution.stateId, index, execution.candidate.checks)
  ))
  const checks: ValidationCheck[] = [
    ...catalogValidation.checks,
    {
      id: 'chemical_state_structural_sampling.provider_contract',
      status: 'pass',
      message: `${providerId}/${capabilityId} requires exact chemical-state input and returns a canonical finite structure ensemble without required continuation or unsupported required artifacts`,
      metrics: {
        providerId,
        capability: capabilityId,
        providerDeterministic: capability.deterministic,
      },
    },
    {
      id: 'chemical_state_structural_sampling.state_coverage',
      status: 'pass',
      message: `All ${executions.length} catalog states completed one independently broker-validated provider run`,
      metrics: { stateCount: executions.length },
    },
    {
      id: 'chemical_state_structural_sampling.seed_schedule',
      status: 'pass',
      message: `Derived ${seeds.size} stable, distinct per-state broker seeds from base seed ${baseSeed}`,
      metrics: { baseSeed, derivedSeedCount: seeds.size, distinctSeedCount: new Set(seeds.values()).size },
    },
    ...stateChecks,
    {
      id: 'chemical_state_structural_sampling.total_budget',
      status: 'pass',
      message: `Collected ${totalMembers} members and ${totalMemberAtoms} member-atoms within explicit joint budgets`,
      metrics: { totalMembers, totalMemberAtoms, maximumTotalMembers, maximumTotalMemberAtoms },
    },
    ...distributionValidation.checks,
    {
      id: 'chemical_state_structural_sampling.model_scope',
      status: 'warn',
      message: `The joint distribution preserves the chemical population's ${ensemble.populationModel.normalizationScope?.kind ?? (ensemble.enumeration.complete ? 'complete-state-universe' : 'conditional-on-returned-states')} scope and every conditional ensemble's evidence. Distinct broker seeds do not prove independent engine streams, and successful finite runs do not prove omitted-state/conformer completeness, convergence, barriers, kinetics, or calibrated cross-family uncertainty.`,
      metrics: { providerDeterministic: capability.deterministic },
    },
  ]
  return {
    structure: selectedStructure,
    chemicalStateEnsemble: ensemble,
    chemicalStateStructureCatalog: catalogValidation.catalog,
    chemicalStateStructuralDistribution: distributionValidation.distribution,
    chemicalStateStructuralDistributionFingerprint: distributionValidation.fingerprint,
    stateExecutions: executions.map((execution) => ({
      stateId: execution.stateId,
      seed: execution.seed,
      sourceStructureFingerprint: execution.sourceStructureFingerprint,
      inputChemicalStateEnsembleFingerprint: execution.inputChemicalStateEnsembleFingerprint,
      resultStructureFingerprint: execution.candidate.provenance.resultFingerprint,
      structureEnsembleFingerprint: execution.candidate.provenance.structureEnsembleFingerprint!,
      selectedMemberId: execution.candidate.structureEnsemble!.selection.selectedMemberId,
      memberCount: execution.candidate.structureEnsemble!.members.length,
      providerDeterministic: capability.deterministic,
    })),
    stateVisualReviews: executions.map((execution) => ({
      stateId: execution.stateId,
      structureFingerprint: execution.candidate.provenance.resultFingerprint,
      inspectionTargets: execution.candidate.inspectionTargets.map((target) => ({ ...target })),
    })),
    checks,
    inspectionTargets: distributionValidation.inspectionTargets,
    provenance: {
      engine: 'zatom-provider-orchestrator',
      engineVersion: ORCHESTRATOR_VERSION,
      providerId,
      capability: capabilityId,
      chemicalStateEnsembleFingerprint: ensembleValidation.fingerprint,
      chemicalStateStructureCatalogFingerprint: catalogValidation.fingerprint,
      chemicalStateStructuralDistributionFingerprint: distributionValidation.fingerprint,
      sourceFingerprint: fingerprintStructure(reference),
      resultFingerprint: fingerprintStructure(selectedStructure),
      baseSeed,
    },
  }
}

function samplingToolError<T>(tool: string, error: unknown): ZatomToolResult<T> {
  if (error instanceof ZatomChemicalStateStructuralSamplingError) {
    return {
      ok: false,
      tool,
      summary: error.message,
      error: { code: error.code, message: error.message, ...(error.details === undefined ? {} : { details: error.details }) },
    }
  }
  if (error instanceof ZatomChemicalStateStructureCatalogInputError
    || error instanceof ZatomChemicalStateEnsembleInputError
    || error instanceof ZatomChemicalStateStructuralDistributionInputError
    || error instanceof ZatomStructureEnsembleInputError
    || error instanceof ZatomStructureInputError
    || error instanceof ZatomProviderError) {
    return { ok: false, tool, summary: error.message, error: { code: error.code, message: error.message } }
  }
  const message = error instanceof Error ? error.message : String(error)
  return {
    ok: false,
    tool,
    summary: message,
    error: { code: 'chemical_state_structural_sampling_failed', message },
  }
}

const sampleStructuralDistributionTool: ZatomToolDefinition = {
  manifest: {
    name: 'chemical_state_sample_structural_distribution',
    title: 'Sample every chemical state and compose a joint structural distribution',
    version: ORCHESTRATOR_VERSION,
    description: 'Run one compatible registered fixed-state structural provider independently over every exact state structure in a canonical catalog, using immutable per-state chemical-selection rebindings and distinct derived seeds. Reject partial state coverage or any failed provider candidate, then compose and independently validate marginal×conditional joint weights, return the original identity/population evidence, and expose selected plus per-state visual review targets.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: [
        'providerId',
        'capability',
        'chemicalStateEnsemble',
        'structureCatalog',
        'stateRuns',
        'acceptance',
        'maximumStates',
        'maximumTotalMembers',
        'maximumTotalMemberAtoms',
      ],
      properties: {
        providerId: { type: 'string', minLength: 2, maxLength: 96 },
        capability: { type: 'string', minLength: 2, maxLength: 96 },
        chemicalStateEnsemble: { type: 'object' },
        structureCatalog: {
          type: 'object',
          required: [
            'schemaVersion',
            'chemicalStateEnsembleFingerprint',
            'chemicalStateReferenceStructureFingerprint',
            'heavyAtomIds',
            'entries',
            'provenance',
          ],
          properties: { schemaVersion: { const: ZATOM_CHEMICAL_STATE_STRUCTURE_CATALOG_SCHEMA } },
        },
        stateRuns: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['stateId', 'parameters'],
            properties: {
              stateId: { type: 'string', minLength: 1, maxLength: 128 },
              parameters: { type: 'object' },
            },
          },
        },
        acceptance: {
          type: 'object',
          additionalProperties: false,
          required: ['minimumJointWeightEffectiveMemberCount'],
          properties: { minimumJointWeightEffectiveMemberCount: { type: 'number', minimum: 1 } },
        },
        baseSeed: { type: 'integer', minimum: 0, maximum: 4294967295, default: 42 },
        maxConcurrency: { type: 'integer', minimum: 1, maximum: 8, default: 1 },
        maximumStates: { type: 'integer', minimum: 1, maximum: 128 },
        maximumTotalMembers: { type: 'integer', minimum: 2, maximum: 32768 },
        maximumTotalMemberAtoms: { type: 'integer', minimum: 2, maximum: 10000000 },
        maxParameterBytes: { type: 'integer', minimum: 1024, maximum: 67108864, default: 8388608 },
        applyToWorkspace: { type: 'boolean', default: false },
        captureAfter: { type: 'boolean', description: 'Default true only when applying the selected joint member.' },
      },
    },
    effects: { structure: 'create', workspace: 'write', visual: 'read' },
    tags: [
      'molecule',
      'chemical-state',
      'structure-catalog',
      'structure-ensemble',
      'joint-distribution',
      'provider',
      'orchestration',
      'candidate',
      'visual-validation',
    ],
  },
  execute: async (input, context) => {
    try {
      const result = await executeStructuralSampling(input)
      const requestedApply = input.applyToWorkspace === true
      const captureAfter = typeof input.captureAfter === 'boolean' ? input.captureAfter : requestedApply
      return await finalizeStructureCandidate({
        tool: 'chemical_state_sample_structural_distribution',
        result,
        requestedApply,
        captureAfter,
        context,
        summary: (applied, blocked, verified) => (
          `Sampled ${result.stateExecutions.length} chemical states into ${result.chemicalStateStructuralDistribution.stateStructureEnsembles.reduce((sum, entry) => sum + entry.structureEnsemble.members.length, 0)} joint members; distribution ${result.chemicalStateStructuralDistributionFingerprint}`
          + (applied
            ? verified === true ? '; selected joint member applied and fingerprint-verified' : '; selected joint member applied without verified readback'
            : blocked ? '; selected-member application blocked' : '; candidate only')
        ),
      })
    } catch (error) {
      return samplingToolError('chemical_state_sample_structural_distribution', error)
    }
  },
}

function rawDistributionSelectedStructure(
  distributionValue: unknown,
  ensemble: ZatomChemicalStateEnsemble,
): ZatomStructure {
  const distribution = exactObject(distributionValue, 'chemicalStateStructuralDistribution', [
    'schemaVersion',
    'chemicalStateEnsembleFingerprint',
    'conditions',
    'heavyAtomIds',
    'stateStructureEnsembles',
    'acceptance',
    'provenance',
  ], ['metadata'])
  if (!Array.isArray(distribution.stateStructureEnsembles)) {
    throw new ZatomChemicalStateStructuralSamplingError(
      'invalid_chemical_state_structural_sampling_input',
      'chemicalStateStructuralDistribution.stateStructureEnsembles must be an array',
    )
  }
  const stateEntry = distribution.stateStructureEnsembles.find((raw) => (
    isRecord(raw) && raw.stateId === ensemble.selection.selectedStateId
  ))
  if (!isRecord(stateEntry) || !isRecord(stateEntry.structureEnsemble)) {
    throw new ZatomChemicalStateStructuralSamplingError(
      'chemical_state_structural_member_not_found',
      `Distribution does not expose selected state ${ensemble.selection.selectedStateId}`,
    )
  }
  const structureEnsemble = stateEntry.structureEnsemble
  if (!isRecord(structureEnsemble.selection) || !Array.isArray(structureEnsemble.members)) {
    throw new ZatomChemicalStateStructuralSamplingError(
      'invalid_chemical_state_structural_sampling_input',
      'Selected state structure ensemble is malformed',
    )
  }
  const selectedMemberId = structureEnsemble.selection.selectedMemberId
  const member = structureEnsemble.members.find((raw) => (
    isRecord(raw) && raw.id === selectedMemberId
  ))
  if (!isRecord(member) || member.structure === undefined) {
    throw new ZatomChemicalStateStructuralSamplingError(
      'chemical_state_structural_member_not_found',
      'Distribution selected structural member does not resolve',
    )
  }
  return parseZatomStructure(member.structure)
}

function memberTarget(
  structure: ZatomStructure,
  stateId: string,
  memberId: string,
): InspectionTarget {
  const bounds = boundsOfPositions(structure.atoms.map((atom) => atom.position))!
  return {
    id: 'chemical-state-structural-member-overview',
    reason: `Inspect explicit joint-distribution member ${stateId}/${memberId}`,
    center: bounds.center,
    radius: Math.max(1, bounds.radius * 1.25),
    atomIds: structure.atoms.slice(0, 256).map((atom) => atom.id),
    ...(structure.atoms.length > 256 ? { atomIdsTruncated: true } : {}),
  }
}

const selectStructuralMemberTool: ZatomToolDefinition = {
  manifest: {
    name: 'chemical_state_select_structural_member',
    title: 'Materialize and inspect one joint chemical-state/structure member',
    version: '1.0.0',
    description: 'Independently validate a canonical chemical-state structure catalog and joint structural distribution, resolve one explicit state/member pair, report its marginal, conditional, and joint weight without changing the artifact selection, and optionally apply/capture that exact structure for visual inspection.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['chemicalStateEnsemble', 'structureCatalog', 'distribution', 'stateId', 'memberId'],
      properties: {
        chemicalStateEnsemble: { type: 'object' },
        structureCatalog: { type: 'object' },
        distribution: { type: 'object' },
        stateId: { type: 'string', minLength: 1, maxLength: 128 },
        memberId: { type: 'string', minLength: 1, maxLength: 128 },
        applyToWorkspace: { type: 'boolean', default: false },
        captureAfter: { type: 'boolean', description: 'Default true when applying.' },
      },
    },
    effects: { structure: 'create', workspace: 'write', visual: 'read' },
    tags: [
      'molecule',
      'chemical-state',
      'structure-ensemble',
      'joint-distribution',
      'member-selection',
      'candidate',
      'visual-validation',
    ],
  },
  execute: async (input, context) => {
    try {
      const reference = rawCatalogReference(input.structureCatalog, input.chemicalStateEnsemble)
      const catalogValidation: ZatomChemicalStateStructureCatalogValidation =
        parseZatomChemicalStateStructureCatalog(input.structureCatalog, {
          chemicalStateEnsemble: input.chemicalStateEnsemble as ZatomChemicalStateEnsemble,
          chemicalStateReferenceStructure: reference,
        })
      const ensemble = catalogValidation.chemicalStateEnsembleValidation.ensemble
      const originalSelectedStructure = rawDistributionSelectedStructure(input.distribution, ensemble)
      const distributionValidation: ZatomChemicalStateStructuralDistributionValidation =
        parseZatomChemicalStateStructuralDistribution(input.distribution, {
          chemicalStateEnsemble: ensemble,
          chemicalStateReferenceStructure: reference,
          selectedStructure: originalSelectedStructure,
        })
      const stateId = text(input.stateId, 'stateId', 128)
      const memberId = text(input.memberId, 'memberId', 128)
      const stateEntry = distributionValidation.distribution.stateStructureEnsembles.find((entry) => (
        entry.stateId === stateId
      ))
      const member = stateEntry?.structureEnsemble.members.find((candidate) => candidate.id === memberId)
      if (!stateEntry || !member) {
        throw new ZatomChemicalStateStructuralSamplingError(
          'chemical_state_structural_member_not_found',
          `Joint distribution does not contain ${stateId}/${memberId}`,
        )
      }
      const jointMember = distributionValidation.jointMembers.find((candidate) => (
        candidate.stateId === stateId && candidate.memberId === memberId
      ))!
      const variableIds = distributionValidation.identityVariableHeavyAtomIds
        .filter((atomId) => member.structure.atoms.some((atom) => atom.id === atomId))
      const targets = [memberTarget(member.structure, stateId, memberId)]
      if (variableIds.length) {
        const atomById = new Map(member.structure.atoms.map((atom) => [atom.id, atom]))
        const bounds = boundsOfPositions(variableIds.map((atomId) => atomById.get(atomId)!.position))!
        targets.push({
          id: 'chemical-state-structural-member-identity-variable-atoms',
          reason: `Inspect mapped heavy atoms whose chemical identity signature varies across states for ${stateId}/${memberId}`,
          center: bounds.center,
          radius: Math.max(1, bounds.radius * 2),
          atomIds: variableIds.slice(0, 256),
          ...(variableIds.length > 256 ? { atomIdsTruncated: true } : {}),
        })
      }
      const checks: ValidationCheck[] = [
        ...catalogValidation.checks,
        ...distributionValidation.checks,
        {
          id: 'chemical_state_structural_member.selection',
          status: 'pass',
          message: `Resolved exact member ${stateId}/${memberId} with structure fingerprint ${member.structureFingerprint}`,
          metrics: { stateId, memberId, structureFingerprint: member.structureFingerprint },
        },
        {
          id: 'chemical_state_structural_member.joint_weight',
          status: 'pass',
          message: `Joint weight ${jointMember.jointWeight} equals state fraction ${jointMember.stateFraction} × conditional weight ${jointMember.conditionalStructureWeight}`,
          metrics: {
            stateFraction: jointMember.stateFraction,
            conditionalStructureWeight: jointMember.conditionalStructureWeight,
            jointWeight: jointMember.jointWeight,
          },
        },
        {
          id: 'chemical_state_structural_member.selection_scope',
          status: 'warn',
          message: 'Materializing this member does not mutate the canonical chemical-state or structure-ensemble selections and does not make it the maximum-probability, most stable, or globally complete state.',
          metrics: { stateId, memberId },
        },
      ]
      const result = {
        structure: member.structure,
        chemicalStateEnsemble: ensemble,
        chemicalStateStructureCatalog: catalogValidation.catalog,
        chemicalStateStructuralDistribution: distributionValidation.distribution,
        chemicalStateStructuralDistributionFingerprint: distributionValidation.fingerprint,
        stateId,
        memberId,
        stateFraction: jointMember.stateFraction,
        conditionalStructureWeight: jointMember.conditionalStructureWeight,
        jointWeight: jointMember.jointWeight,
        checks,
        inspectionTargets: targets,
        provenance: {
          engine: 'zatom-structural-member-selector',
          engineVersion: '1.0.0',
          sourceFingerprint: fingerprintStructure(originalSelectedStructure),
          resultFingerprint: member.structureFingerprint,
          chemicalStateStructuralDistributionFingerprint: distributionValidation.fingerprint,
          stateId,
          memberId,
        },
      }
      const requestedApply = input.applyToWorkspace === true
      const captureAfter = typeof input.captureAfter === 'boolean' ? input.captureAfter : requestedApply
      return await finalizeStructureCandidate({
        tool: 'chemical_state_select_structural_member',
        result,
        requestedApply,
        captureAfter,
        context,
        summary: (applied, blocked, verified) => (
          `Resolved ${stateId}/${memberId} at joint weight ${jointMember.jointWeight}`
          + (applied
            ? verified === true ? '; applied and fingerprint-verified' : '; applied without verified readback'
            : blocked ? '; workspace application blocked' : '; candidate only')
        ),
      })
    } catch (error) {
      return samplingToolError('chemical_state_select_structural_member', error)
    }
  },
}

export const CHEMICAL_STATE_STRUCTURAL_SAMPLING_ZATOM_AGENT_TOOLS:
readonly ZatomToolDefinition[] = [
  sampleStructuralDistributionTool,
  selectStructuralMemberTool,
]
