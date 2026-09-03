/** Special quasirandom structure generation tool. */

import type { ZatomToolDefinition, ZatomToolManifest } from './contracts'
import { ZATOM_STRUCTURE_JSON_SCHEMA } from './contracts'
import { finalizeStructureCandidate, type CandidateEnvelope } from './candidate-tool'
import { generateSqs, type GenerateSqsOptions, type SqsSublatticeSpec } from './sqs'
import { ZatomStructureInputError } from './structure-validation'
import { numberOption, objectSchema, resolveStructure, toolError } from './tool-helpers'

function parseSupercell(value: unknown): [number, number, number] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length !== 3) throw new ZatomStructureInputError('invalid_supercell', 'supercell must have three integers')
  return [Number(value[0]), Number(value[1]), Number(value[2])]
}

function parseSublattices(input: Record<string, unknown>): SqsSublatticeSpec[] {
  if (Array.isArray(input.sublattices)) {
    return input.sublattices.map((raw, index) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new ZatomStructureInputError('invalid_sublattice', `sublattices[${index}] must be an object`)
      }
      const obj = raw as Record<string, unknown>
      const hasElementSelector = Array.isArray(obj.siteElements)
      const hasIdSelector = Array.isArray(obj.siteAtomIds)
      const invalidSelectorType = (obj.siteElements !== undefined && !hasElementSelector)
        || (obj.siteAtomIds !== undefined && !hasIdSelector)
      if (invalidSelectorType || (!hasElementSelector && !hasIdSelector)
        || !obj.composition || typeof obj.composition !== 'object' || Array.isArray(obj.composition)) {
        throw new ZatomStructureInputError(
          'invalid_sublattice',
          `sublattices[${index}] requires siteElements[] or siteAtomIds[], plus composition{}`,
        )
      }
      return {
        ...(typeof obj.id === 'string' ? { id: obj.id } : {}),
        ...(Array.isArray(obj.siteElements) ? { siteElements: obj.siteElements.map(String) } : {}),
        ...(Array.isArray(obj.siteAtomIds) ? { siteAtomIds: obj.siteAtomIds.map(String) } : {}),
        composition: Object.fromEntries(Object.entries(obj.composition as Record<string, unknown>).map(([key, value]) => [key, Number(value)])),
      }
    })
  }
  const target = typeof input.targetElement === 'string' ? input.targetElement : ''
  const substitute = typeof input.substituteElement === 'string' ? input.substituteElement : ''
  const fraction = numberOption(input, 'fraction')
  if (!target || !substitute || fraction === undefined) {
    throw new ZatomStructureInputError(
      'missing_sublattices',
      'Provide sublattices[], or the binary shorthand targetElement + substituteElement + fraction',
    )
  }
  return [{
    id: `${target}-sites`,
    siteElements: [target],
    composition: { [target]: 1 - fraction, [substitute]: fraction },
  }]
}

const sqsManifest: ZatomToolManifest = {
  name: 'structure_generate_sqs',
  title: 'Generate a special quasirandom structure',
  version: '2.0.0',
  description: 'Generate an exact-composition, deterministic multi-component SQS on one or more parent sublattices. The default fast path matches pair shells; explicit bounded triplet and quadruplet cutoffs additionally match symmetry-canonical triangle and complete four-site distributions. Optional independently seeded ensembles are ranked with stable tie-breaking under state/figure-visit budgets. Returns correlations, Warren-Cowley metrics, cluster-space scope, provenance, numeric gates, and optional viewport evidence.',
  inputSchema: objectSchema({
    structure: ZATOM_STRUCTURE_JSON_SCHEMA,
    sublattices: {
      type: 'array',
      items: objectSchema({
        id: { type: 'string' },
        siteElements: { type: 'array', minItems: 1, items: { type: 'string' } },
        siteAtomIds: { type: 'array', minItems: 1, items: { type: 'string' }, description: 'Parent-cell atom IDs; replicas inherit this selector' },
        composition: { type: 'object', additionalProperties: { type: 'number', minimum: 0, maximum: 1 } },
      }, ['composition']),
      description: 'Preferred general form. Provide siteElements, siteAtomIds, or both (intersection); selectors must not overlap.',
    },
    targetElement: { type: 'string', description: 'Binary shorthand: parent element to replace' },
    substituteElement: { type: 'string', description: 'Binary shorthand: substituting element' },
    fraction: { type: 'number', exclusiveMinimum: 0, exclusiveMaximum: 1, description: 'Binary shorthand substitution fraction' },
    supercell: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'integer', minimum: 1, maximum: 64 }, default: [1, 1, 1] },
    shellCount: { type: 'integer', minimum: 1, maximum: 12, default: 4 },
    shellToleranceA: { type: 'number', exclusiveMinimum: 0, maximum: 0.5, default: 0.05 },
    tripletCutoffA: { type: 'number', minimum: 0, maximum: 100, description: 'Maximum side length in Å for closed triangle figures; omitted or zero keeps the pair-only fast path' },
    tripletWeight: { type: 'number', exclusiveMinimum: 0, maximum: 10, default: 1, description: 'Relative triplet-objective weight when tripletCutoffA is enabled' },
    maxTripletFigures: { type: 'integer', minimum: 1, maximum: 200000, default: 20000, description: 'Hard local triangle-enumeration budget' },
    maxTripletSearchSites: { type: 'integer', minimum: 3, maximum: 1000, default: 512, description: 'Hard mutable-site budget when triplets are enabled' },
    quadrupletCutoffA: { type: 'number', minimum: 0, maximum: 100, description: 'Maximum pair distance in Å for complete four-site figures; omitted or zero disables quadruplets' },
    quadrupletWeight: { type: 'number', exclusiveMinimum: 0, maximum: 10, default: 1, description: 'Relative quadruplet-objective weight when quadrupletCutoffA is enabled' },
    maxQuadrupletFigures: { type: 'integer', minimum: 1, maximum: 100000, default: 10000, description: 'Hard local four-site figure budget' },
    maxQuadrupletCandidates: { type: 'integer', minimum: 1, maximum: 20000000, default: 2000000, description: 'Hard candidate-combination enumeration budget before clique filtering' },
    maxQuadrupletSearchSites: { type: 'integer', minimum: 4, maximum: 512, default: 256, description: 'Hard mutable-site budget when quadruplets are enabled' },
    seed: { type: 'integer', minimum: 0, default: 42 },
    ensembleSize: { type: 'integer', minimum: 1, maximum: 32, default: 1, description: 'Independent deterministically derived seeds to optimize and rank' },
    restarts: { type: 'integer', minimum: 1, maximum: 128 },
    stepsPerRestart: { type: 'integer', minimum: 1, maximum: 10000 },
    maxSearchEvaluations: { type: 'integer', minimum: 1, maximum: 50000000, default: 5000000, description: 'Hard projected occupation-state evaluation budget across the full ensemble' },
    maxObjectiveTermEvaluations: { type: 'integer', minimum: 1, maximum: 10000000000, default: 500000000, description: 'Hard projected pair/triplet figure-visit budget across the full ensemble' },
    applyToWorkspace: { type: 'boolean', default: false, description: 'Apply only when explicitly true' },
    captureAfter: { type: 'boolean', description: 'Capture visual evidence after applying; default true when applyToWorkspace is true' },
  }),
  effects: { structure: 'create', workspace: 'write', visual: 'read' },
  tags: ['structure', 'sqs', 'alloy', 'validation', 'agent'],
}

type SqsToolData = CandidateEnvelope<ReturnType<typeof generateSqs>>

const structureGenerateSqsTool: ZatomToolDefinition<SqsToolData> = {
  manifest: sqsManifest,
  execute: async (input, context) => {
    try {
      const structure = await resolveStructure(input, context)
      const applyToWorkspace = input.applyToWorkspace === true
      const captureAfter = typeof input.captureAfter === 'boolean' ? input.captureAfter : applyToWorkspace
      const options: GenerateSqsOptions = {
        structure,
        sublattices: parseSublattices(input),
        supercell: parseSupercell(input.supercell),
        shellCount: numberOption(input, 'shellCount'),
        shellToleranceA: numberOption(input, 'shellToleranceA'),
        tripletCutoffA: numberOption(input, 'tripletCutoffA'),
        tripletWeight: numberOption(input, 'tripletWeight'),
        maxTripletFigures: numberOption(input, 'maxTripletFigures'),
        maxTripletSearchSites: numberOption(input, 'maxTripletSearchSites'),
        quadrupletCutoffA: numberOption(input, 'quadrupletCutoffA'),
        quadrupletWeight: numberOption(input, 'quadrupletWeight'),
        maxQuadrupletFigures: numberOption(input, 'maxQuadrupletFigures'),
        maxQuadrupletCandidates: numberOption(input, 'maxQuadrupletCandidates'),
        maxQuadrupletSearchSites: numberOption(input, 'maxQuadrupletSearchSites'),
        seed: numberOption(input, 'seed'),
        ensembleSize: numberOption(input, 'ensembleSize'),
        restarts: numberOption(input, 'restarts'),
        stepsPerRestart: numberOption(input, 'stepsPerRestart'),
        maxSearchEvaluations: numberOption(input, 'maxSearchEvaluations'),
        maxObjectiveTermEvaluations: numberOption(input, 'maxObjectiveTermEvaluations'),
      }
      const result = generateSqs(options)
      return await finalizeStructureCandidate({
        tool: sqsManifest.name,
        result,
        requestedApply: applyToWorkspace,
        captureAfter,
        context,
        summary: (applied, blocked, verified) => `Generated ${result.structure.atoms.length.toLocaleString()}-atom SQS (${result.quality.verdict}, objective=${result.quality.objective.toExponential(3)}, selected seed ${result.search.selectedSeed} from ${result.search.ensembleSize})${applied ? verified === true ? ' and fingerprint-verified it in the active workspace' : verified === false ? '; workspace readback does not match the candidate' : ' and applied it without readback' : blocked ? '; workspace application was blocked' : ''}`,
      })
    } catch (error) {
      return toolError<SqsToolData>(sqsManifest.name, error)
    }
  },
}

export const STRUCTURE_SQS_ZATOM_AGENT_TOOLS: readonly ZatomToolDefinition[] = [structureGenerateSqsTool]
