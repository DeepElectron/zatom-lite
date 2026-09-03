/** MCP-facing discovery and candidate-gated execution for modeling providers. */

import { BUILTIN_ZATOM_MODELING_PROVIDERS } from './builtin-providers'
import { finalizeStructureCandidate } from './candidate-tool'
import type {
  CapturedImage,
  ZatomStructure,
  ZatomTrajectory,
  ZatomToolContext,
  ZatomToolDefinition,
  ZatomToolManifest,
  ZatomToolResult,
} from './contracts'
import { ZATOM_STRUCTURE_JSON_SCHEMA, ZATOM_TRAJECTORY_JSON_SCHEMA } from './contracts'
import {
  parseZatomChemicalStateEnsemble,
  ZatomChemicalStateEnsembleInputError,
  ZATOM_CHEMICAL_STATE_ENSEMBLE_SCHEMA,
} from './chemical-state-ensemble'
import {
  parseZatomForceFieldPackage,
  ZatomForceFieldPackageInputError,
  ZATOM_FORCE_FIELD_PACKAGE_SCHEMA,
} from './force-field-package'
import {
  createZatomProviderRegistry,
  fingerprintZatomProviderCapability,
  normalizeProviderOutput,
  type ZatomModelingProvider,
  type ZatomProviderCandidate,
  type ZatomProviderContinuationContract,
  type ZatomProviderContinuationState,
  type ZatomProviderManifest,
  ZatomProviderError,
} from './provider'
import { parseZatomStructure, ZatomStructureInputError } from './structure-validation'
import { fingerprintTrajectory, parseZatomTrajectory, ZatomTrajectoryInputError } from './trajectory'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function objectSchema(properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    properties,
    ...(required.length ? { required } : {}),
  }
}

function integerOption(input: Record<string, unknown>, name: string, fallback: number, min: number, max: number): number {
  const value = input[name] === undefined ? fallback : Number(input[name])
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ZatomProviderError('invalid_provider_parameters', `${name} must be an integer from ${min} through ${max}`)
  }
  return value
}

function providerToolError<T>(tool: string, error: unknown): ZatomToolResult<T> {
  if (error instanceof ZatomProviderError || error instanceof ZatomStructureInputError
    || error instanceof ZatomTrajectoryInputError || error instanceof ZatomForceFieldPackageInputError
    || error instanceof ZatomChemicalStateEnsembleInputError) {
    return { ok: false, tool, summary: error.message, error: { code: error.code, message: error.message } }
  }
  const message = error instanceof Error ? error.message : String(error)
  return { ok: false, tool, summary: message, error: { code: 'provider_execution_failed', message } }
}

export const defaultZatomProviderRegistry = createZatomProviderRegistry(BUILTIN_ZATOM_MODELING_PROVIDERS)

export function registerZatomModelingProvider(
  provider: ZatomModelingProvider,
  options?: { replace?: boolean },
): () => void {
  return defaultZatomProviderRegistry.register(provider, options)
}

export function listZatomModelingProviders(): ZatomProviderManifest[] {
  return defaultZatomProviderRegistry.list()
}

const listProvidersManifest: ZatomToolManifest = {
  name: 'modeling_list_providers',
  title: 'Discover specialist modeling providers',
  version: '2.0.0',
  description: 'List the registered computation engines (local or remote) with what each can do, its fidelity and parameter schema. Call before routing work beyond the built-in structure tools.',
  inputSchema: objectSchema({
    providerId: { type: 'string', description: 'Exact provider ID filter' },
    capability: { type: 'string', description: 'Exact capability ID filter' },
    tags: { type: 'array', items: { type: 'string' }, description: 'Require every listed tag' },
    includeSchemas: { type: 'boolean', default: false },
    offset: { type: 'integer', minimum: 0, default: 0 },
    limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
  }),
  effects: { structure: 'none', workspace: 'none', visual: 'none' },
  tags: ['provider', 'capability', 'discovery', 'routing', 'agent'],
}

const modelingListProvidersTool: ZatomToolDefinition = {
  manifest: listProvidersManifest,
  execute: async (input) => {
    try {
      const providerId = typeof input.providerId === 'string' ? input.providerId : null
      const capabilityId = typeof input.capability === 'string' ? input.capability : null
      const tags = Array.isArray(input.tags) ? input.tags.map(String) : []
      const includeSchemas = input.includeSchemas === true
      const offset = integerOption(input, 'offset', 0, 0, Number.MAX_SAFE_INTEGER)
      const limit = integerOption(input, 'limit', 25, 1, 100)
      const matches = defaultZatomProviderRegistry.list()
        .filter((provider) => !providerId || provider.id === providerId)
        .map((provider) => ({
          ...provider,
          capabilities: provider.capabilities.filter((capability) => (
            (!capabilityId || capability.id === capabilityId)
            && tags.every((tag) => capability.tags.includes(tag))
          )),
        }))
        .filter((provider) => provider.capabilities.length > 0)
      const page = matches.slice(offset, offset + limit).map((provider) => ({
        ...provider,
        capabilities: provider.capabilities.map((capability) => ({
          ...capability,
          fingerprint: fingerprintZatomProviderCapability(provider, capability),
          ...(includeSchemas ? {} : { inputSchema: '[call again with includeSchemas=true]' }),
        })),
      }))
      return {
        ok: true,
        tool: listProvidersManifest.name,
        summary: `Found ${matches.length} registered provider${matches.length === 1 ? '' : 's'}; returned ${page.length} from offset ${offset}`,
        data: {
          providers: page,
          matchedCount: matches.length,
          returnedCount: page.length,
          truncated: offset + page.length < matches.length,
          nextOffset: offset + page.length < matches.length ? offset + page.length : null,
        },
      }
    } catch (error) {
      return providerToolError(listProvidersManifest.name, error)
    }
  },
}

const runProviderManifest: ZatomToolManifest = {
  name: 'modeling_run_provider',
  title: 'Run a specialist modeling provider',
  version: '2.0.0',
  description: 'Execute a registered specialist engine through the canonical provider contract with optional exact discovery-identity and capability-tag gates. The broker validates source structures, optional fingerprint-bound final-frame continuation, force-field-package and chemical-state-ensemble input artifacts, returned structures, bounded trajectories, finite fixed-topology and periodic-cell structure ensembles, populated chemical-state/conditional-structure distributions, declared chemical-state/force-field/SQS-quality/single-line continuum-dislocation/fully-periodic dislocation-dipole/fixed-cell-relaxation output artifacts, required domain checks, change sets, and frame-aware inspection targets before workspace application.',
  inputSchema: objectSchema({
    providerId: { type: 'string' },
    capability: { type: 'string' },
    expectedProviderCapabilityFingerprint: {
      type: 'string',
      pattern: '^fnv1a64:[0-9a-f]{16}$',
      description: 'Optional discovery identity gate. Route-bound Agent plans require this exact capability fingerprint.',
    },
    requiredProviderCapabilityTags: {
      type: 'array',
      minItems: 1,
      maxItems: 12,
      uniqueItems: true,
      items: { type: 'string', minLength: 1, maxLength: 48, pattern: '^[a-z][a-z0-9-]*$' },
      description: 'Optional capability coverage gate. Route-bound Agent plans require the exact tags from their route stage.',
    },
    parameters: { type: 'object', description: 'Validate against the capability inputSchema returned by modeling_list_providers' },
    structure: ZATOM_STRUCTURE_JSON_SCHEMA,
    useActiveStructure: { type: 'boolean', description: 'Default true for source-required capabilities and false for source-optional capabilities' },
    sourceTrajectory: ZATOM_TRAJECTORY_JSON_SCHEMA,
    forceFieldPackage: {
      type: 'object',
      description: `Canonical ${ZATOM_FORCE_FIELD_PACKAGE_SCHEMA} input artifact when the selected capability declares it in inputArtifacts.`,
      required: ['schemaVersion', 'structureFingerprint', 'topologyFingerprint', 'atomIds', 'template', 'nonbonded', 'atoms', 'bonds', 'angles', 'properTorsions', 'improperTorsions', 'provenance'],
      properties: { schemaVersion: { const: ZATOM_FORCE_FIELD_PACKAGE_SCHEMA } },
    },
    chemicalStateEnsemble: {
      type: 'object',
      description: `Canonical ${ZATOM_CHEMICAL_STATE_ENSEMBLE_SCHEMA} input artifact bound to the exact source structure when the selected capability declares it in inputArtifacts.`,
      required: ['schemaVersion', 'selectedStructureFingerprint', 'enumeration', 'source', 'normalized', 'states', 'selection', 'provenance'],
      properties: { schemaVersion: { const: ZATOM_CHEMICAL_STATE_ENSEMBLE_SCHEMA } },
    },
    useActiveTrajectory: {
      type: 'boolean',
      description: 'Read and continue from the active canonical trajectory final frame. Default true only for continuation-required capabilities; false for optional capabilities.',
    },
    seed: { type: 'integer', minimum: 0, maximum: 4294967295, default: 42 },
    applyToWorkspace: { type: 'boolean', default: false },
    captureAfter: { type: 'boolean', description: 'Default true when applying to the active workspace in a visual host' },
  }, ['providerId', 'capability', 'parameters']),
  effects: { structure: 'create', workspace: 'write', visual: 'read' },
  tags: ['provider', 'capability', 'candidate', 'trajectory', 'structure-ensemble', 'chemical-state', 'sqs', 'dislocation', 'relaxation', 'validation', 'visual-validation', 'agent'],
}

interface RunProviderData {
  result: ZatomProviderCandidate
  appliedToWorkspace: boolean
  applicationBlocked: boolean
  applicationVerified: boolean | null
  visualEvidence: CapturedImage | null
}

async function resolveProviderSource(
  input: Record<string, unknown>,
  sourceMode: 'none' | 'optional' | 'required',
  context: ZatomToolContext,
): Promise<ZatomStructure | null> {
  if (input.structure !== undefined) return parseZatomStructure(input.structure)
  const useActive = typeof input.useActiveStructure === 'boolean'
    ? input.useActiveStructure
    : sourceMode === 'required'
  if (!useActive || sourceMode === 'none') return null
  const source = await context.readStructure?.()
  return source ? parseZatomStructure(source) : null
}

function continuationMode(contract: ZatomProviderContinuationContract | undefined): 'none' | 'optional' | 'required' {
  return contract?.mode ?? 'none'
}

function compactContinuationState(trajectory: ZatomTrajectory): ZatomProviderContinuationState {
  const frameIndex = trajectory.frames.length - 1
  const sourceFrame = trajectory.frames[frameIndex]
  const effectiveLattice = sourceFrame.lattice ?? trajectory.lattice
  return {
    schemaVersion: 'zatom.provider-continuation/v1',
    sourceTrajectoryFingerprint: fingerprintTrajectory(trajectory),
    sourceFrameCount: trajectory.frames.length,
    frameIndex,
    atomIds: [...trajectory.atomIds],
    coordinateMode: trajectory.coordinateMode,
    frame: {
      step: sourceFrame.step,
      timePs: sourceFrame.timePs,
      positions: sourceFrame.positions.map((position) => [...position]),
      ...(sourceFrame.velocitiesAperPs ? {
        velocitiesAperPs: sourceFrame.velocitiesAperPs.map((velocity) => [...velocity]),
      } : {}),
      ...(sourceFrame.forcesEvPerA ? {
        forcesEvPerA: sourceFrame.forcesEvPerA.map((force) => [...force]),
      } : {}),
      ...(effectiveLattice ? {
        lattice: {
          vectors: effectiveLattice.vectors.map((row) => [...row]) as typeof effectiveLattice.vectors,
          periodic: [...effectiveLattice.periodic],
        },
      } : {}),
      ...(sourceFrame.scalars ? { scalars: { ...sourceFrame.scalars } } : {}),
    },
  }
}

async function resolveProviderContinuation(
  input: Record<string, unknown>,
  contract: ZatomProviderContinuationContract | undefined,
  source: ZatomStructure | null,
  context: ZatomToolContext,
): Promise<ZatomProviderContinuationState | null> {
  const mode = continuationMode(contract)
  const explicit = input.sourceTrajectory !== undefined
  const useActive = typeof input.useActiveTrajectory === 'boolean'
    ? input.useActiveTrajectory
    : mode === 'required'
  if (mode === 'none') {
    if (explicit || useActive) {
      throw new ZatomProviderError('continuation_not_allowed', 'The selected capability does not accept trajectory continuation state')
    }
    return null
  }
  let raw: unknown = explicit ? input.sourceTrajectory : null
  if (!explicit && useActive) raw = await context.readTrajectory?.() ?? null
  if (raw === null) {
    if (mode === 'required' || useActive) {
      throw new ZatomProviderError('continuation_required', 'No canonical source trajectory is available for the requested continuation')
    }
    return null
  }
  if (!source) {
    throw new ZatomProviderError('continuation_source_required', 'A canonical source structure is required to bind trajectory continuation state')
  }
  const trajectory = parseZatomTrajectory(raw, { structure: source })
  const state = compactContinuationState(trajectory)
  const missing = (contract?.requiredFrameFields ?? []).filter((field) => state.frame[field] === undefined)
  if (missing.length) {
    throw new ZatomProviderError(
      'continuation_frame_field_required',
      `Trajectory final frame is missing continuation field(s): ${missing.join(', ')}`,
    )
  }
  return state
}

function resolveProviderForceFieldPackage(
  input: Record<string, unknown>,
  capability: ZatomProviderManifest['capabilities'][number],
  source: ZatomStructure | null,
): NonNullable<import('./provider').ZatomProviderExecutionRequest['forceFieldPackage']> | null {
  const contract = capability.inputArtifacts?.find((item) => item.artifact === 'force-field-package')
  const supplied = input.forceFieldPackage !== undefined
  if (!contract) {
    if (supplied) {
      throw new ZatomProviderError(
        'force_field_package_input_not_allowed',
        'The selected capability does not accept a force-field-package input artifact',
      )
    }
    return null
  }
  if (!supplied) {
    if (contract.mode === 'required') {
      throw new ZatomProviderError(
        'force_field_package_input_required',
        'The selected capability requires a force-field-package input artifact',
      )
    }
    return null
  }
  if (!source) {
    throw new ZatomProviderError(
      'force_field_package_source_required',
      'A canonical source structure is required to bind the force-field-package input artifact',
    )
  }
  const parsed = parseZatomForceFieldPackage(input.forceFieldPackage, {
    structure: source,
    allowCompatibleGeometry: true,
  })
  return {
    schemaVersion: 'zatom.provider-force-field-package/v1',
    fingerprint: parsed.fingerprint,
    package: parsed.package,
  }
}

function resolveProviderChemicalStateEnsemble(
  input: Record<string, unknown>,
  capability: ZatomProviderManifest['capabilities'][number],
  source: ZatomStructure | null,
): NonNullable<import('./provider').ZatomProviderExecutionRequest['chemicalStateEnsemble']> | null {
  const contract = capability.inputArtifacts?.find((item) => item.artifact === 'chemical-state-ensemble')
  const supplied = input.chemicalStateEnsemble !== undefined
  if (!contract) {
    if (supplied) {
      throw new ZatomProviderError(
        'chemical_state_ensemble_input_not_allowed',
        'The selected capability does not accept a chemical-state-ensemble input artifact',
      )
    }
    return null
  }
  if (!supplied) {
    if (contract.mode === 'required') {
      throw new ZatomProviderError(
        'chemical_state_ensemble_input_required',
        'The selected capability requires a chemical-state-ensemble input artifact',
      )
    }
    return null
  }
  if (!source) {
    throw new ZatomProviderError(
      'chemical_state_ensemble_source_required',
      'A canonical source structure is required to bind the chemical-state-ensemble input artifact',
    )
  }
  const parsed = parseZatomChemicalStateEnsemble(input.chemicalStateEnsemble, { structure: source })
  return {
    schemaVersion: 'zatom.provider-chemical-state-ensemble/v1',
    fingerprint: parsed.fingerprint,
    ensemble: parsed.ensemble,
  }
}

const modelingRunProviderTool: ZatomToolDefinition<RunProviderData> = {
  manifest: runProviderManifest,
  execute: async (input, context) => {
    try {
      if (typeof input.providerId !== 'string' || !input.providerId.trim()) {
        throw new ZatomProviderError('provider_required', 'providerId is required')
      }
      if (typeof input.capability !== 'string' || !input.capability.trim()) {
        throw new ZatomProviderError('capability_required', 'capability is required')
      }
      if (!isRecord(input.parameters)) {
        throw new ZatomProviderError('invalid_provider_parameters', 'parameters must be an object')
      }
      const provider = defaultZatomProviderRegistry.get(input.providerId)
      if (!provider) throw new ZatomProviderError('unknown_provider', `Unknown modeling provider ${input.providerId}`)
      const capability = provider.manifest.capabilities.find((item) => item.id === input.capability)
      if (!capability) {
        throw new ZatomProviderError('unsupported_capability', `Provider ${input.providerId} does not implement ${input.capability}`)
      }
      if (input.expectedProviderCapabilityFingerprint !== undefined) {
        const actualCapabilityFingerprint = fingerprintZatomProviderCapability(provider.manifest, capability)
        if (input.expectedProviderCapabilityFingerprint !== actualCapabilityFingerprint) {
          throw new ZatomProviderError(
            'provider_capability_identity_mismatch',
            `Provider capability ${input.providerId}/${input.capability} is ${actualCapabilityFingerprint}; expected ${String(input.expectedProviderCapabilityFingerprint)}`,
          )
        }
      }
      if (input.requiredProviderCapabilityTags !== undefined) {
        const requiredTags = Array.isArray(input.requiredProviderCapabilityTags)
          ? input.requiredProviderCapabilityTags.map(String)
          : []
        const missingTags = requiredTags.filter((tag) => !capability.tags.includes(tag))
        if (missingTags.length) {
          throw new ZatomProviderError(
            'provider_capability_coverage_mismatch',
            `Provider capability ${input.providerId}/${input.capability} does not cover required tag(s): ${missingTags.join(', ')}`,
          )
        }
      }
      const source = await resolveProviderSource(input, capability.source, context)
      const continuation = await resolveProviderContinuation(input, capability.continuation, source, context)
      const forceFieldPackage = resolveProviderForceFieldPackage(input, capability, source)
      const chemicalStateEnsemble = resolveProviderChemicalStateEnsemble(input, capability, source)
      const seed = integerOption(input, 'seed', 42, 0, 0xffffffff)
      const request = {
        capability: input.capability,
        source,
        continuation,
        ...(forceFieldPackage ? { forceFieldPackage } : {}),
        ...(chemicalStateEnsemble ? { chemicalStateEnsemble } : {}),
        parameters: input.parameters,
        seed,
      }
      const execution = await defaultZatomProviderRegistry.execute(input.providerId, request, context)
      const candidate = normalizeProviderOutput({
        provider: execution.provider,
        capability: execution.capability,
        request,
        output: execution.output,
      })
      const requestedApply = input.applyToWorkspace === true
      const captureAfter = typeof input.captureAfter === 'boolean' ? input.captureAfter : requestedApply
      return await finalizeStructureCandidate({
        tool: runProviderManifest.name,
        result: candidate,
        requestedApply,
        captureAfter,
        context,
        summary: (applied, blocked, verified) => {
          const providerSummary = execution.output.summary ?? `Generated ${candidate.structure.atoms.length.toLocaleString()} atoms`
          return `${execution.provider.manifest.id}/${execution.capability.id}: ${providerSummary}${applied ? verified === true ? '; applied and fingerprint-verified in the active workspace' : verified === false ? '; applied, but workspace readback diverged' : '; applied without readback' : blocked ? '; workspace application blocked' : '; candidate only'}`
        },
      })
    } catch (error) {
      return providerToolError<RunProviderData>(runProviderManifest.name, error)
    }
  },
}

export const PROVIDER_ZATOM_AGENT_TOOLS: readonly ZatomToolDefinition[] = [
  modelingListProvidersTool,
  modelingRunProviderTool,
]
