/** Agent/MCP tool definitions for slabs and surface adsorption. */

import type {
  GuidanceCandidateInput,
  Vec3,
  ZatomToolDefinition,
  ZatomToolManifest,
} from './contracts'
import { ZATOM_STRUCTURE_JSON_SCHEMA } from './contracts'
import { finalizeStructureCandidate } from './candidate-tool'
import { enumerateAdsorptionConfigurations } from './adsorption-configuration-search'
import {
  BUILTIN_ADSORBATE_FRAGMENTS,
  buildMillerSlab,
  detectAdsorptionSites,
  placeAdsorbate,
  SurfaceInputError,
  type AdsorptionSite,
} from './surface'
import { createDistanceCalculator, fingerprintCanonicalJson, fingerprintStructure } from './structure-math'
import { numberOption, objectSchema, resolveStructure, toolError } from './tool-helpers'
import {
  assessSurface,
  detectSurfaceLayer,
  frameHeight,
  type SurfaceLattice,
} from '../lib/analysis/builders/adsorbate'

const vec3Schema = { type: 'array', minItems: 3, maxItems: 3, items: { type: 'number' } }
/** Bound local-region cropping before the already-bounded Delaunay stage. */
const LOCAL_SURFACE_DISTANCE_PAIR_BUDGET = 250_000

function vec3Option(value: unknown, field: string): Vec3 | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length !== 3) throw new SurfaceInputError('invalid_vector', `${field} must contain three finite numbers`)
  const parsed: Vec3 = [Number(value[0]), Number(value[1]), Number(value[2])]
  if (parsed.some((item) => !Number.isFinite(item))) throw new SurfaceInputError('invalid_vector', `${field} must contain three finite numbers`)
  return parsed
}

function numberArrayOption(value: unknown, field: string): number[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || !value.length) throw new SurfaceInputError('invalid_array', `${field} must be a non-empty number array`)
  const result = value.map(Number)
  if (result.some((item) => !Number.isFinite(item))) throw new SurfaceInputError('invalid_array', `${field} must contain finite numbers`)
  return result
}

function cancellationError(signal: AbortSignal | undefined): SurfaceInputError {
  const message = signal?.reason instanceof Error
    ? signal.reason.message
    : 'Tool execution was cancelled'
  return new SurfaceInputError('tool_execution_aborted', message)
}

function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw cancellationError(signal)
}

/**
 * Yield a browser task before surface topology work. Resolved-promise awaits
 * only yield to the microtask queue, so React still cannot paint the activity
 * indicator and a queued user cancellation cannot run before Delaunay starts.
 */
async function yieldToInteraction(signal: AbortSignal | undefined): Promise<void> {
  throwIfCancelled(signal)
  await new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = () => {
      if (timer !== undefined) clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }
    const onAbort = () => {
      if (timer !== undefined) clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      reject(cancellationError(signal))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    timer = setTimeout(finish, 0)
  })
  throwIfCancelled(signal)
}

function normalizedSelection(atomIds: readonly string[] | undefined): string[] {
  return [...new Set(atomIds ?? [])].sort()
}

function sameSelection(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((atomId, index) => atomId === right[index])
}

const detectManifest: ZatomToolManifest = {
  name: 'surface_detect_adsorption_sites',
  title: 'Detect surface adsorption sites',
  version: '2.1.0',
  description: 'Detect the outward atom layer, construct a bounded extended periodic surface mesh, and enumerate deterministic top sites plus Delaunay bridge/hollow topology with canonical atom IDs, periodic images, numeric checks, and inspection targets. Returns sourceFingerprint: site IDs are only meaningful for that exact structure, so pass it as expectedSourceFingerprint when placing an adsorbate, otherwise an edit between detection and placement will silently move the site.',
  inputSchema: objectSchema({
    structure: ZATOM_STRUCTURE_JSON_SCHEMA,
    surfaceUp: vec3Schema,
    layerToleranceA: { type: 'number', exclusiveMinimum: 0, default: 0.5 },
    bondCutoffA: { type: 'number', exclusiveMinimum: 0, default: 3.5 },
    triangleCutoffA: { type: 'number', exclusiveMinimum: 0, default: 3.5 },
    maxSurfaceAtoms: { type: 'integer', minimum: 1, maximum: 1000, default: 200 },
    maxExpandedSurfacePoints: { type: 'integer', minimum: 1, maximum: 100000, default: 50000 },
    kind: { enum: ['top', 'bridge', 'hollow'] },
    offset: { type: 'integer', minimum: 0, default: 0 },
    limit: { type: 'integer', minimum: 1, maximum: 1000, default: 200 },
  }),
  effects: { structure: 'read', workspace: 'read', visual: 'none' },
  tags: ['surface', 'adsorption', 'sites', 'position', 'agent'],
}

const detectAdsorptionSitesTool: ZatomToolDefinition = {
  manifest: detectManifest,
  execute: async (input, context) => {
    try {
      const structure = await resolveStructure(input, context)
      const result = detectAdsorptionSites({
        structure,
        surfaceUp: vec3Option(input.surfaceUp, 'surfaceUp'),
        layerToleranceA: numberOption(input, 'layerToleranceA'),
        bondCutoffA: numberOption(input, 'bondCutoffA'),
        triangleCutoffA: numberOption(input, 'triangleCutoffA'),
        maxSurfaceAtoms: numberOption(input, 'maxSurfaceAtoms'),
        maxExpandedSurfacePoints: numberOption(input, 'maxExpandedSurfacePoints'),
      })
      const kind = input.kind === 'top' || input.kind === 'bridge' || input.kind === 'hollow' ? input.kind : null
      const matched = kind ? result.sites.filter((site) => site.kind === kind) : result.sites
      const offset = Math.max(0, Math.trunc(numberOption(input, 'offset') ?? 0))
      const limit = Math.max(1, Math.min(1000, Math.trunc(numberOption(input, 'limit') ?? 200)))
      const sites = matched.slice(offset, offset + limit)
      const sourceFingerprint = fingerprintStructure(structure)
      return {
        ok: true,
        tool: detectManifest.name,
        summary: `Detected ${result.sites.length} adsorption sites on ${result.surfaceAtomIds.length} surface atoms; returned ${sites.length}. Site IDs are only valid for source fingerprint ${sourceFingerprint}; pass it as expectedSourceFingerprint to structure_place_adsorbate.`,
        data: {
          ...result,
          sites,
          sourceFingerprint,
          totalSiteCount: result.sites.length,
          matchedSiteCount: matched.length,
          returnedSiteCount: sites.length,
          truncated: offset + sites.length < matched.length,
        },
        checks: result.checks,
      }
    } catch (error) {
      return toolError(detectManifest.name, error)
    }
  },
}

const searchManifest: ZatomToolManifest = {
  name: 'surface_enumerate_adsorbate_configurations',
  title: 'Enumerate adsorption configurations',
  version: '1.0.0',
  description: 'Enumerate a bounded Cartesian product of PBC-aware adsorption sites, anchor heights, tilts, and azimuths; build and collision-audit every unrelaxed structure; collapse exact fingerprint duplicates; and return an unweighted catalog whose valid entries contain source/result-bound structure_place_adsorbate replay inputs. This does not rank energy or infer bonding/stability.',
  inputSchema: objectSchema({
    structure: ZATOM_STRUCTURE_JSON_SCHEMA,
    fragment: { enum: BUILTIN_ADSORBATE_FRAGMENTS },
    siteKinds: {
      type: 'array', minItems: 1, maxItems: 3, uniqueItems: true,
      items: { enum: ['top', 'bridge', 'hollow'] },
    },
    bondLengthsA: { type: 'array', minItems: 1, maxItems: 32, uniqueItems: true, items: { type: 'number', exclusiveMinimum: 0, maximum: 20 } },
    tiltAnglesDeg: { type: 'array', minItems: 1, maxItems: 32, uniqueItems: true, items: { type: 'number', minimum: 0, maximum: 180 } },
    azimuthAnglesDeg: { type: 'array', minItems: 1, maxItems: 32, uniqueItems: true, items: { type: 'number', minimum: 0, exclusiveMaximum: 360 } },
    surfaceBondPolicy: { enum: ['none', 'anchor-to-site-atoms'], default: 'none' },
    surfaceBondOrder: { enum: [1, 1.5, 2, 3], default: 1 },
    collisionFactor: { type: 'number', exclusiveMinimum: 0, default: 0.8 },
    surfaceUp: vec3Schema,
    layerToleranceA: { type: 'number', exclusiveMinimum: 0, default: 0.5 },
    bondCutoffA: { type: 'number', exclusiveMinimum: 0, default: 3.5 },
    triangleCutoffA: { type: 'number', exclusiveMinimum: 0, default: 3.5 },
    maxSurfaceAtoms: { type: 'integer', minimum: 1, maximum: 1000, default: 200 },
    maxExpandedSurfacePoints: { type: 'integer', minimum: 1, maximum: 100000, default: 50000 },
    maxCandidates: { type: 'integer', minimum: 1, maximum: 512, default: 128 },
  }, ['fragment']),
  effects: { structure: 'read', workspace: 'read', visual: 'none' },
  tags: ['surface', 'adsorption', 'configuration-search', 'pose', 'catalog', 'geometry', 'agent'],
}

const enumerateAdsorptionConfigurationsTool: ZatomToolDefinition = {
  manifest: searchManifest,
  execute: async (input, context) => {
    try {
      const structure = await resolveStructure(input, context)
      const kinds = Array.isArray(input.siteKinds)
        ? input.siteKinds.map(String).filter((kind): kind is 'top' | 'bridge' | 'hollow' => (
            kind === 'top' || kind === 'bridge' || kind === 'hollow'
          ))
        : undefined
      const result = enumerateAdsorptionConfigurations({
        structure,
        fragment: typeof input.fragment === 'string' ? input.fragment : '',
        siteKinds: kinds,
        bondLengthsA: numberArrayOption(input.bondLengthsA, 'bondLengthsA'),
        tiltAnglesDeg: numberArrayOption(input.tiltAnglesDeg, 'tiltAnglesDeg'),
        azimuthAnglesDeg: numberArrayOption(input.azimuthAnglesDeg, 'azimuthAnglesDeg'),
        surfaceBondPolicy: input.surfaceBondPolicy === 'anchor-to-site-atoms' ? 'anchor-to-site-atoms' : 'none',
        surfaceBondOrder: (input.surfaceBondOrder === 1 || input.surfaceBondOrder === 1.5
          || input.surfaceBondOrder === 2 || input.surfaceBondOrder === 3) ? input.surfaceBondOrder : 1,
        collisionFactor: numberOption(input, 'collisionFactor'),
        surfaceUp: vec3Option(input.surfaceUp, 'surfaceUp'),
        layerToleranceA: numberOption(input, 'layerToleranceA'),
        bondCutoffA: numberOption(input, 'bondCutoffA'),
        triangleCutoffA: numberOption(input, 'triangleCutoffA'),
        maxSurfaceAtoms: numberOption(input, 'maxSurfaceAtoms'),
        maxExpandedSurfacePoints: numberOption(input, 'maxExpandedSurfacePoints'),
        maxCandidates: numberOption(input, 'maxCandidates'),
      })
      return {
        ok: true,
        tool: searchManifest.name,
        summary: `Enumerated ${result.catalog.search.evaluatedCombinationCount} adsorption configurations into ${result.catalog.search.uniqueCandidateCount} unique candidates (${result.catalog.search.validCandidateCount} valid, ${result.catalog.search.rejectedCandidateCount} rejected); no energy ranking was assigned`,
        data: result,
        checks: result.checks,
      }
    } catch (error) {
      return toolError(searchManifest.name, error)
    }
  },
}

const slabManifest: ZatomToolManifest = {
  name: 'structure_build_miller_slab',
  title: 'Build a Miller-index surface slab',
  version: '2.0.0',
  description: 'Cut a periodic crystal along an integer Miller plane, repeat layers, add measured vacuum, validate cell containment and distances, and return the top surface as an inspection target.',
  inputSchema: objectSchema({
    structure: ZATOM_STRUCTURE_JSON_SCHEMA,
    miller: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'integer' } },
    layers: { type: 'integer', minimum: 1, maximum: 256, default: 4 },
    vacuumA: { type: 'number', minimum: 0, default: 10 },
    searchMax: { type: 'integer', minimum: 2, maximum: 16, default: 4 },
    reverse: { type: 'boolean', default: false },
    center: { type: 'boolean', default: true },
    applyToWorkspace: { type: 'boolean', default: false, description: 'Apply only when explicitly true' },
    captureAfter: { type: 'boolean', description: 'Default true only when applying to the active workspace in a visual host' },
  }, ['miller']),
  effects: { structure: 'create', workspace: 'write', visual: 'read' },
  tags: ['structure', 'surface', 'slab', 'miller', 'validation', 'agent'],
}

const buildMillerSlabTool: ZatomToolDefinition = {
  manifest: slabManifest,
  execute: async (input, context) => {
    try {
      const structure = await resolveStructure(input, context)
      if (!Array.isArray(input.miller) || input.miller.length !== 3) throw new SurfaceInputError('invalid_miller', 'miller must contain three integers')
      const result = buildMillerSlab({
        structure,
        miller: [Number(input.miller[0]), Number(input.miller[1]), Number(input.miller[2])],
        layers: numberOption(input, 'layers'),
        vacuumA: numberOption(input, 'vacuumA'),
        searchMax: numberOption(input, 'searchMax'),
        reverse: input.reverse === true,
        center: input.center !== false,
      })
      const requestedApply = input.applyToWorkspace === true
      const captureAfter = typeof input.captureAfter === 'boolean' ? input.captureAfter : requestedApply
      return await finalizeStructureCandidate({
        tool: slabManifest.name,
        result,
        requestedApply,
        captureAfter,
        context,
        summary: (applied, blocked) => `Built ${result.structure.atoms.length}-atom (${result.metrics.miller.join('')}) slab with ${result.metrics.measuredVacuumA.toFixed(3)} Å measured vacuum${applied ? ' and applied it to the active workspace' : blocked ? '; workspace application was blocked' : ''}`,
      })
    } catch (error) {
      return toolError(slabManifest.name, error)
    }
  },
}

const adsorbateManifest: ZatomToolManifest = {
  name: 'structure_place_adsorbate',
  title: 'Place an adsorbate on a surface site',
  version: '3.1.0',
  description: 'Place a chemistry template at a PBC-aware detected site ID or one-to-three surface atom IDs, apply explicit tilt/azimuth, optionally record declared anchor-to-site bond topology, and enforce exact periodic collision/distance gates before workspace application. Selecting by siteId requires expectedSourceFingerprint from the detection that produced the ID, because site IDs are positional and are rejected once the structure changes. This produces an unrelaxed hypothesis, not inferred bonding, adsorption energy, or stability.',
  inputSchema: objectSchema({
    structure: ZATOM_STRUCTURE_JSON_SCHEMA,
    expectedSourceFingerprint: {
      type: 'string',
      minLength: 1,
      maxLength: 128,
      description: 'sourceFingerprint from surface_detect_adsorption_sites. Required when siteId is used.',
    },
    expectedResultFingerprint: { type: 'string', minLength: 1, maxLength: 128 },
    fragment: { enum: BUILTIN_ADSORBATE_FRAGMENTS },
    siteId: { type: 'string', description: 'ID returned by surface_detect_adsorption_sites; must be paired with expectedSourceFingerprint' },
    siteAtomIds: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'string' } },
    resolvedSite: objectSchema({
      id: { type: 'string', minLength: 1 },
      kind: { enum: ['top', 'bridge', 'hollow'] },
      position: vec3Schema,
      bindingPosition: vec3Schema,
      normal: vec3Schema,
      atomIds: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'string' } },
      atomImages: {
        type: 'array', minItems: 1, maxItems: 3,
        items: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'integer' } },
      },
    }, ['id', 'kind', 'position', 'bindingPosition', 'normal', 'atomIds', 'atomImages']),
    surfaceUp: vec3Schema,
    layerToleranceA: { type: 'number', exclusiveMinimum: 0, default: 0.5 },
    bondCutoffA: { type: 'number', exclusiveMinimum: 0, default: 3.5 },
    triangleCutoffA: { type: 'number', exclusiveMinimum: 0, default: 3.5 },
    maxSurfaceAtoms: { type: 'integer', minimum: 1, maximum: 1000, default: 200 },
    maxExpandedSurfacePoints: { type: 'integer', minimum: 1, maximum: 100000, default: 50000 },
    bondLengthA: { type: 'number', exclusiveMinimum: 0 },
    collisionFactor: { type: 'number', exclusiveMinimum: 0, default: 0.8 },
    tiltDeg: { type: 'number', minimum: 0, maximum: 180, default: 0 },
    azimuthDeg: { type: 'number', minimum: 0, exclusiveMaximum: 360, default: 0 },
    surfaceBondPolicy: { enum: ['none', 'anchor-to-site-atoms'], default: 'none' },
    surfaceBondOrder: { enum: [1, 1.5, 2, 3], default: 1 },
    applyToWorkspace: { type: 'boolean', default: false, description: 'Apply only when explicitly true' },
    captureAfter: { type: 'boolean', description: 'Default true only when applying to the active workspace in a visual host' },
  }, ['fragment']),
  effects: { structure: 'replace', workspace: 'write', visual: 'read' },
  tags: ['structure', 'surface', 'adsorbate', 'collision', 'validation', 'agent'],
}

const placeAdsorbateTool: ZatomToolDefinition = {
  manifest: adsorbateManifest,
  execute: async (input, context) => {
    try {
      const structure = await resolveStructure(input, context)
      if (typeof input.expectedSourceFingerprint === 'string'
        && fingerprintStructure(structure) !== input.expectedSourceFingerprint) {
        throw new SurfaceInputError(
          'stale_adsorption_source',
          `Source fingerprint ${fingerprintStructure(structure)} does not match catalog binding ${input.expectedSourceFingerprint}`,
        )
      }
      if (input.resolvedSite !== undefined && typeof input.expectedSourceFingerprint !== 'string') {
        throw new SurfaceInputError(
          'unbound_resolved_site',
          'resolvedSite must be paired with expectedSourceFingerprint from surface_prepare_adsorption.',
        )
      }
      const siteAtomIds = Array.isArray(input.siteAtomIds) ? input.siteAtomIds.map(String) : undefined
      const result = placeAdsorbate({
        structure,
        fragment: typeof input.fragment === 'string' ? input.fragment : '',
        ...(typeof input.siteId === 'string' ? { siteId: input.siteId } : {}),
        ...(typeof input.expectedSourceFingerprint === 'string'
          ? { expectedSourceFingerprint: input.expectedSourceFingerprint }
          : {}),
        ...(siteAtomIds ? { siteAtomIds } : {}),
        ...(input.resolvedSite ? { resolvedSite: input.resolvedSite as AdsorptionSite } : {}),
        surfaceUp: vec3Option(input.surfaceUp, 'surfaceUp'),
        layerToleranceA: numberOption(input, 'layerToleranceA'),
        bondCutoffA: numberOption(input, 'bondCutoffA'),
        triangleCutoffA: numberOption(input, 'triangleCutoffA'),
        maxSurfaceAtoms: numberOption(input, 'maxSurfaceAtoms'),
        maxExpandedSurfacePoints: numberOption(input, 'maxExpandedSurfacePoints'),
        bondLengthA: numberOption(input, 'bondLengthA'),
        collisionFactor: numberOption(input, 'collisionFactor'),
        tiltDeg: numberOption(input, 'tiltDeg'),
        azimuthDeg: numberOption(input, 'azimuthDeg'),
        surfaceBondPolicy: input.surfaceBondPolicy === 'anchor-to-site-atoms' ? 'anchor-to-site-atoms' : 'none',
        surfaceBondOrder: (input.surfaceBondOrder === 1 || input.surfaceBondOrder === 1.5
          || input.surfaceBondOrder === 2 || input.surfaceBondOrder === 3) ? input.surfaceBondOrder : 1,
      })
      if (typeof input.expectedResultFingerprint === 'string'
        && fingerprintStructure(result.structure) !== input.expectedResultFingerprint) {
        throw new SurfaceInputError(
          'adsorption_candidate_replay_mismatch',
          `Replayed result fingerprint ${fingerprintStructure(result.structure)} does not match catalog binding ${input.expectedResultFingerprint}`,
        )
      }
      const requestedApply = input.applyToWorkspace === true
      const captureAfter = typeof input.captureAfter === 'boolean' ? input.captureAfter : requestedApply
      const finalized = await finalizeStructureCandidate({
        tool: adsorbateManifest.name,
        result,
        requestedApply,
        captureAfter,
        context,
        summary: (applied, blocked) => `Placed ${input.fragment} at ${result.site.kind} site ${result.site.id}${applied ? ' and applied it to the active workspace' : blocked ? '; workspace application was blocked by collision/validation' : ''}`,
      })
      if (finalized.ok && context.guidance) {
        const envelope = finalized.data as { proposal?: unknown; appliedToWorkspace?: boolean }
        if (envelope.proposal || envelope.appliedToWorkspace) {
          await context.guidance.clear('candidates')
          await context.guidance.advance(
            envelope.proposal ? 3 : 4,
            envelope.proposal
              ? `Review the ghosted ${String(input.fragment)} pose before applying it.`
              : 'Verify distances, collisions, vacuum, and periodic boundaries.',
          )
        }
      }
      return finalized
    } catch (error) {
      return toolError(adsorbateManifest.name, error)
    }
  },
}

const prepareAdsorptionManifest: ZatomToolManifest = {
  name: 'surface_prepare_adsorption',
  title: 'Prepare a collaborative adsorption workflow',
  version: '1.0.0',
  description: 'Inspect the active slab, validate its exposed surface/vacuum, honor the user\'s current atom selection or an explicit local region, choose up to six diverse top/bridge/hollow candidates, and show their exact periodic-image positions as numbered viewport badges. Clicking a badge performs the real anchor selection and camera focus. Returns candidateSetId for guide_candidate_status, deterministic molecule options, and exact structure_place_adsorbate replay inputs; it does not rank adsorption energy.',
  inputSchema: objectSchema({
    siteKinds: {
      type: 'array', minItems: 1, maxItems: 3, uniqueItems: true,
      items: { enum: ['top', 'bridge', 'hollow'] },
    },
    selectionOnly: {
      type: 'boolean',
      default: true,
      description: 'When the user selected atoms, keep only sites anchored in that selected region.',
    },
    region: objectSchema({
      center: vec3Schema,
      radiusA: { type: 'number', exclusiveMinimum: 0, maximum: 1000000 },
    }, ['center', 'radiusA']),
    maxCandidates: { type: 'integer', minimum: 1, maximum: 6, default: 3 },
    layerToleranceA: { type: 'number', exclusiveMinimum: 0, default: 0.5 },
    bondCutoffA: { type: 'number', exclusiveMinimum: 0, default: 3.5 },
    triangleCutoffA: { type: 'number', exclusiveMinimum: 0, default: 3.5 },
    maxSurfaceAtoms: {
      type: 'integer', minimum: 1, maximum: 1000, default: 200,
      description: 'Reject a larger detected host layer before periodic expansion or Delaunay topology work.',
    },
    maxExpandedSurfacePoints: {
      type: 'integer', minimum: 1, maximum: 100000, default: 50000,
      description: 'Hard allocation budget for the periodic surface mesh after the surface-layer limit passes.',
    },
    surfaceUp: {
      ...vec3Schema,
      description: 'Optional outward face normal. When omitted, a selected bottom-face patch flips the detected vacuum-side normal automatically.',
    },
  }),
  effects: { structure: 'read', workspace: 'read', visual: 'write' },
  tags: ['surface', 'adsorption', 'workflow', 'selection', 'camera', 'guide', 'agent'],
}

const MOLECULE_CANDIDATES = [
  { fragment: 'H2O', label: 'Water', anchorElement: 'O', note: 'Polar probe; orient O toward the site, then choose H direction.' },
  { fragment: 'CO', label: 'Carbon monoxide', anchorElement: 'C', note: 'Compact linear probe; C-down is the conventional initial hypothesis.' },
  { fragment: 'OH', label: 'Hydroxyl', anchorElement: 'O', note: 'Reactive fragment; use only as an unrelaxed initial geometry.' },
  { fragment: 'O', label: 'Oxygen atom', anchorElement: 'O', note: 'Single-atom adsorption hypothesis.' },
  { fragment: 'H', label: 'Hydrogen atom', anchorElement: 'H', note: 'Single-atom adsorption hypothesis.' },
] as const

const prepareAdsorptionTool: ZatomToolDefinition = {
  manifest: prepareAdsorptionManifest,
  execute: async (input, context) => {
    let publishedGuidance = false
    let candidateSetId: string | null = null
    try {
      throwIfCancelled(context.signal)
      if (!context.readStructure || !context.workspaceIdentity) {
        throw new SurfaceInputError('workspace_identity_unavailable', 'Collaborative adsorption preparation requires an active viewport workspace.')
      }
      const structure = await context.readStructure()
      throwIfCancelled(context.signal)
      const identity = await context.workspaceIdentity()
      throwIfCancelled(context.signal)
      if (!structure || fingerprintStructure(structure) !== identity.structureFingerprint) {
        throw new SurfaceInputError('workspace_identity_changed', 'The active structure changed while adsorption preparation began. Re-observe and retry.')
      }
      const expectedWorkspace = context.expectedWorkspace
      const identityMatches = (candidate: typeof identity) => (
        candidate.viewportId === identity.viewportId
        && candidate.revision === identity.revision
        && candidate.structureFingerprint === identity.structureFingerprint
        && candidate.trajectoryFingerprint === identity.trajectoryFingerprint
      )
      const expectedMatches = (candidate: typeof identity) => !expectedWorkspace || (
        candidate.viewportId === expectedWorkspace.viewportId
        && candidate.revision === expectedWorkspace.revision
        && candidate.structureFingerprint === expectedWorkspace.structureFingerprint
        && candidate.trajectoryFingerprint === expectedWorkspace.trajectoryFingerprint
      )
      if (!expectedMatches(identity)) {
        throw new SurfaceInputError('workspace_identity_changed', 'The workspace no longer matches the observed revision supplied for adsorption preparation.')
      }
      const assertWorkspaceStillCurrent = async () => {
        throwIfCancelled(context.signal)
        const current = await context.workspaceIdentity!()
        throwIfCancelled(context.signal)
        if (!identityMatches(current) || !expectedMatches(current)) {
          throw new SurfaceInputError(
            'workspace_identity_changed',
            'The viewport or structure changed while adsorption sites were being prepared. Stale candidates were not shown.',
          )
        }
      }
      const viewer = await context.readViewerScene?.(context.signal) ?? null
      throwIfCancelled(context.signal)
      const selectionAtStart = normalizedSelection(viewer?.selectedAtomIds)
      const selected = new Set(selectionAtStart)
      const maxSurfaceAtoms = numberOption(input, 'maxSurfaceAtoms') ?? 200
      const maxExpandedSurfacePoints = numberOption(input, 'maxExpandedSurfacePoints') ?? 50_000
      const assertSelectionStillCurrent = async (phase: string) => {
        throwIfCancelled(context.signal)
        const currentViewer = await context.readViewerScene?.(context.signal) ?? null
        throwIfCancelled(context.signal)
        const currentSelection = normalizedSelection(currentViewer?.selectedAtomIds)
        if (!sameSelection(selectionAtStart, currentSelection)) {
          throw new SurfaceInputError(
            'selection_changed',
            `The atom selection changed ${phase}; stale adsorption candidates were not shown. Re-observe and retry for the current selection.`,
          )
        }
      }
      // Let the activity indicator paint and let a queued user cancellation
      // run before any potentially expensive surface classification/topology.
      await yieldToInteraction(context.signal)
      const requestedKinds = Array.isArray(input.siteKinds)
        ? new Set(input.siteKinds.map(String))
        : new Set(['top', 'bridge', 'hollow'])
      const region = input.region && typeof input.region === 'object' && !Array.isArray(input.region)
        ? input.region as { center: Vec3; radiusA: number }
        : null
      const surfaceLattice: SurfaceLattice | undefined = structure.lattice ? {
        a: structure.lattice.vectors[0],
        b: structure.lattice.vectors[1],
        c: structure.lattice.vectors[2],
      } : undefined
      const assessment = assessSurface(surfaceLattice, structure.atoms.map((atom) => atom.position))
      if (!assessment.ok) throw new SurfaceInputError('bulk_has_no_surface', assessment.message)
      let surfaceUp = vec3Option(input.surfaceUp, 'surfaceUp') ?? assessment.frame.up
      if (input.surfaceUp === undefined && selected.size) {
        const heights = structure.atoms.map((atom) => frameHeight(assessment.frame, atom.position))
        const selectedHeights = structure.atoms
          .filter((atom) => selected.has(atom.id))
          .map((atom) => frameHeight(assessment.frame, atom.position))
        if (selectedHeights.length) {
          const selectedMean = selectedHeights.reduce((sum, height) => sum + height, 0) / selectedHeights.length
          const low = Math.min(...heights)
          const high = Math.max(...heights)
          if (selectedMean - low < high - selectedMean) {
            surfaceUp = [-surfaceUp[0], -surfaceUp[1], -surfaceUp[2]]
          }
        }
      }
      const distance = createDistanceCalculator(structure.lattice)
      const inRegion = (position: Vec3) => !region || distance(position, region.center) <= region.radiusA

      let detectionStructure = structure
      if (selected.size || region) {
        const layer = detectSurfaceLayer(
          structure.atoms.map((atom) => ({ element: atom.element, cartesian: atom.position })),
          { surface_up: surfaceUp, lattice: surfaceLattice },
        )
        let surfaceAtoms = layer.atomIndices.map((index) => structure.atoms[index])
        let anchors = surfaceAtoms.filter((atom) => (
          (selected.size ? selected.has(atom.id) : true) && inRegion(atom.position)
        ))
        // An explicit user selection outranks the majority-layer heuristic.
        // This is how a sparse bottom face, step edge, or defect patch remains
        // addressable instead of being mistaken for an adsorbate outlier.
        if (!anchors.length && selected.size) {
          const selectedAtoms = structure.atoms.filter((atom) => selected.has(atom.id) && inRegion(atom.position))
          if (selectedAtoms.length) {
            const projected = (position: Vec3) => position[0] * surfaceUp[0]
              + position[1] * surfaceUp[1] + position[2] * surfaceUp[2]
            const selectedPlane = selectedAtoms.reduce((sum, atom) => sum + projected(atom.position), 0) / selectedAtoms.length
            const tolerance = numberOption(input, 'layerToleranceA') ?? 0.5
            surfaceAtoms = structure.atoms.filter((atom) => Math.abs(projected(atom.position) - selectedPlane) <= tolerance)
            anchors = selectedAtoms
          }
        }
        if (!anchors.length) {
          throw new SurfaceInputError(
            'no_surface_atoms_in_region',
            'The selected/local region does not contain atoms on the requested surface face.',
          )
        }
        if (anchors.length > maxSurfaceAtoms) {
          throw new SurfaceInputError(
            'surface_region_too_large',
            `The selected/local region contains ${anchors.length.toLocaleString()} surface anchors, above maxSurfaceAtoms=${maxSurfaceAtoms.toLocaleString()}. Select a smaller patch before asking for adsorption sites.`,
          )
        }
        const paddingA = 2 * Math.max(
          numberOption(input, 'bondCutoffA') ?? 3.5,
          numberOption(input, 'triangleCutoffA') ?? 3.5,
        )
        const pairCount = surfaceAtoms.length * anchors.length
        if (pairCount > LOCAL_SURFACE_DISTANCE_PAIR_BUDGET) {
          throw new SurfaceInputError(
            'surface_region_search_too_large',
            `The local surface search would compare ${pairCount.toLocaleString()} atom pairs, above the ${LOCAL_SURFACE_DISTANCE_PAIR_BUDGET.toLocaleString()} responsive limit. Select fewer anchors or use a smaller region.`,
          )
        }
        const localSurfaceIds = new Set<string>()
        let checkedPairs = 0
        for (const atom of surfaceAtoms) {
          for (const anchor of anchors) {
            checkedPairs += 1
            const withinPadding = distance(atom.position, anchor.position) <= paddingA
            if (checkedPairs % 8192 === 0) await yieldToInteraction(context.signal)
            if (withinPadding) {
              localSurfaceIds.add(atom.id)
              break
            }
          }
        }
        detectionStructure = {
          ...structure,
          atoms: structure.atoms.filter((atom) => localSurfaceIds.has(atom.id)),
          bonds: structure.bonds?.filter((bond) => localSurfaceIds.has(bond.atomIds[0]) && localSurfaceIds.has(bond.atomIds[1])),
        }
      }
      throwIfCancelled(context.signal)
      const detected = detectAdsorptionSites({
        structure: detectionStructure,
        surfaceUp,
        layerToleranceA: numberOption(input, 'layerToleranceA'),
        bondCutoffA: numberOption(input, 'bondCutoffA'),
        triangleCutoffA: numberOption(input, 'triangleCutoffA'),
        maxSurfaceAtoms,
        maxExpandedSurfacePoints,
      })
      throwIfCancelled(context.signal)
      let pool = detected.sites.filter((site) => requestedKinds.has(site.kind) && inRegion(site.bindingPosition))
      if (input.selectionOnly !== false && selected.size) {
        pool = pool.filter((site) => site.atomIds.some((id) => selected.has(id)))
      }
      if (!pool.length) {
        throw new SurfaceInputError(
          'no_adsorption_sites_in_region',
          selected.size
            ? 'No adsorption site is anchored in the user selection. Widen the selection or rerun with selectionOnly=false.'
            : 'No adsorption site matches the requested local region and site kinds.',
        )
      }
      const maxCandidates = Math.max(1, Math.min(6, Math.trunc(Number(input.maxCandidates ?? 3))))
      const chosen: typeof pool = []
      // First preserve topological diversity, then fill deterministically.
      for (const kind of ['top', 'bridge', 'hollow'] as const) {
        const site = pool.find((candidate) => candidate.kind === kind)
        if (site && chosen.length < maxCandidates) chosen.push(site)
      }
      for (const site of pool) {
        if (chosen.length >= maxCandidates) break
        if (!chosen.includes(site)) chosen.push(site)
      }
      const atomById = new Map(structure.atoms.map((atom) => [atom.id, atom]))
      const latticeVectors = structure.lattice?.vectors
      const candidates: GuidanceCandidateInput[] = chosen.map((site) => ({
        atomIds: site.atomIds,
        position: site.position,
        anchorPositions: site.atomIds.map((atomId, index) => {
          const atom = atomById.get(atomId)!
          const image = site.atomImages[index] ?? [0, 0, 0]
          if (!latticeVectors) return [...atom.position] as Vec3
          return [
            atom.position[0] + image[0] * latticeVectors[0][0] + image[1] * latticeVectors[1][0] + image[2] * latticeVectors[2][0],
            atom.position[1] + image[0] * latticeVectors[0][1] + image[1] * latticeVectors[1][1] + image[2] * latticeVectors[2][1],
            atom.position[2] + image[0] * latticeVectors[0][2] + image[1] * latticeVectors[1][2] + image[2] * latticeVectors[2][2],
          ]
        }),
        label: `${site.kind} site`,
        detail: `${site.atomIds.length} anchor${site.atomIds.length === 1 ? '' : 's'}${site.atomImages.some((image) => image.some(Boolean)) ? ' · crosses PBC' : ''}`,
      }))
      await assertWorkspaceStillCurrent()
      await assertSelectionStillCurrent('before candidate publication')
      if (context.guidance) {
        const existingGuidance = await context.guidance.read()
        if (existingGuidance.candidates) {
          throw new SurfaceInputError(
            'candidate_decision_pending',
            `Candidate set ${existingGuidance.candidates.id} is ${existingGuidance.candidates.decision.status}. Read its status and clear it before preparing another adsorption choice.`,
          )
        }
      }
      // Move to the first option before publishing clickable badges. Once the
      // choice is visible, a changed selection may be the user's legitimate
      // candidate click and must never be mistaken for stale input.
      if (context.camera) {
        await context.camera.lookAt({
          target: { point: chosen[0].position, radius: 3 },
          view: { direction: chosen[0].normal },
        }, context.signal)
      }
      throwIfCancelled(context.signal)
      await assertWorkspaceStillCurrent()
      await assertSelectionStillCurrent('before candidate publication')
      if (context.guidance) {
        // Claim the one candidate-decision slot first. If another question is
        // already present this fails without replacing its plan or markers.
        const guidanceSnapshot = await context.guidance.presentCandidates('Which adsorption site?', candidates)
        publishedGuidance = true
        candidateSetId = guidanceSnapshot.candidates?.id ?? null
        if (!candidateSetId) {
          throw new SurfaceInputError(
            'candidate_publication_failed',
            'The guidance surface did not return the candidate-set identity required for user confirmation.',
          )
        }
        throwIfCancelled(context.signal)
        await context.guidance.setPlan(
          ['Understand surface', 'Choose site', 'Choose molecule', 'Preview pose', 'Verify result'],
          1,
          'Pick a numbered adsorption site in the viewport.',
        )
        throwIfCancelled(context.signal)
      }
      const session = {
        candidateSetId,
        viewportId: identity.viewportId,
        workspaceRevision: identity.revision,
        sourceFingerprint: identity.structureFingerprint,
        normal: detected.normal,
        surfaceAtomIds: detected.surfaceAtomIds,
        candidates: chosen.map((site, index) => ({
          index: index + 1,
          ...site,
          placeInput: {
            expectedSourceFingerprint: identity.structureFingerprint,
            resolvedSite: site,
            applyToWorkspace: true,
          },
        })),
        moleculeCandidates: MOLECULE_CANDIDATES,
      }
      return {
        ok: true,
        tool: prepareAdsorptionManifest.name,
        summary: `Prepared ${chosen.length} visible adsorption-site choices on ${identity.viewportId} r${identity.revision}`
          + `${candidateSetId ? `; wait for Confirm/Cancel with guide_candidate_status candidateSetId=${candidateSetId}` : ''}`
          + '; after confirmation choose a molecule and call structure_place_adsorbate with applyToWorkspace=true to publish a ghost proposal.',
        data: {
          sessionId: fingerprintCanonicalJson(session),
          ...session,
        },
        checks: detected.checks,
      }
    } catch (error) {
      if (publishedGuidance && context.guidance) {
        try {
          await context.guidance.clear('all')
        } catch {
          // Preserve the original modeling error; stale overlay cleanup is best effort.
        }
      }
      return toolError(
        prepareAdsorptionManifest.name,
        context.signal?.aborted ? cancellationError(context.signal) : error,
      )
    }
  },
}

export const SURFACE_ZATOM_AGENT_TOOLS: readonly ZatomToolDefinition[] = [
  prepareAdsorptionTool,
  detectAdsorptionSitesTool,
  enumerateAdsorptionConfigurationsTool,
  buildMillerSlabTool,
  placeAdsorbateTool,
]
