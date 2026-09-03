/** MCP composition/replay tools for periodic-dislocation relaxation series. */

import type { ZatomToolDefinition } from './contracts'
import { ZATOM_STRUCTURE_JSON_SCHEMA } from './contracts'
import { finalizeStructureCandidate } from './candidate-tool'
import {
  composeZatomPeriodicDislocationRelaxationSeries,
  fingerprintPeriodicDislocationRelaxationSeries,
  parseZatomPeriodicDislocationRelaxationSeries,
  type ZatomPeriodicDislocationRelaxationSeriesCaseContext,
  type ZatomPeriodicDislocationRelaxationSeriesValidation,
  ZatomPeriodicDislocationRelaxationSeriesInputError,
  ZATOM_PERIODIC_DISLOCATION_RELAXATION_SERIES_SCHEMA,
} from './periodic-dislocation-relaxation-series'
import {
  fingerprintPeriodicDislocationRelaxationEvidence,
  type ZatomPeriodicDislocationRelaxationEvidence,
} from './periodic-dislocation-relaxation-evidence'
import type { ZatomPeriodicDislocationDipoleEvidence } from './periodic-dislocation-dipole-evidence'
import type { ZatomFixedCellRelaxationEvidence } from './fixed-cell-relaxation-evidence'
import { parseZatomStructure } from './structure-validation'
import { toolError } from './tool-helpers'

const COMPOSE_TOOL = 'periodic_dislocation_compose_relaxation_series'
const VALIDATE_TOOL = 'periodic_dislocation_validate_relaxation_series'

function finiteOption(input: Record<string, unknown>, field: string, fallback: number): number {
  const value = input[field] === undefined ? fallback : Number(input[field])
  if (!Number.isFinite(value) || value < 0) {
    throw new ZatomPeriodicDislocationRelaxationSeriesInputError('invalid_periodic_dislocation_relaxation_series_acceptance', `${field} must be finite and nonnegative`)
  }
  return value
}

function integerOption(input: Record<string, unknown>, field: string, fallback: number, minimum: number, maximum: number): number {
  const value = input[field] === undefined ? fallback : Number(input[field])
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new ZatomPeriodicDislocationRelaxationSeriesInputError('invalid_periodic_dislocation_relaxation_series_acceptance', `${field} must be an integer from ${minimum} through ${maximum}`)
  }
  return value
}

function caseSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: [
      'id', 'pairEvidence', 'sourceStructure', 'seedStructure', 'relaxedDefectStructure',
      'relaxedReferenceStructure', 'seedEvidence', 'defectRelaxationEvidence', 'referenceRelaxationEvidence',
    ],
    properties: {
      id: { type: 'string' },
      pairEvidence: { type: 'object' },
      sourceStructure: ZATOM_STRUCTURE_JSON_SCHEMA,
      seedStructure: ZATOM_STRUCTURE_JSON_SCHEMA,
      relaxedDefectStructure: ZATOM_STRUCTURE_JSON_SCHEMA,
      relaxedReferenceStructure: ZATOM_STRUCTURE_JSON_SCHEMA,
      seedEvidence: { type: 'object' },
      defectRelaxationEvidence: { type: 'object' },
      referenceRelaxationEvidence: { type: 'object' },
      maxMinimumImageCandidateEvaluations: { type: 'integer', minimum: 1, maximum: 1000000000 },
    },
  }
}

function toolSchema(includeEvidence: boolean): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: [
      ...(includeEvidence ? ['evidence'] : [
        'kind', 'selectedCaseId', 'selectionMethod', 'selectionRationale',
      ]),
      'cases',
    ],
    properties: {
      ...(includeEvidence ? {
        evidence: {
          type: 'object',
          properties: { schemaVersion: { const: ZATOM_PERIODIC_DISLOCATION_RELAXATION_SERIES_SCHEMA } },
        },
      } : {
        kind: { enum: ['shift-scan-at-fixed-cell', 'cell-size-at-fixed-shift'] },
        selectedCaseId: { type: 'string' },
        selectionMethod: { enum: ['explicit', 'minimum-excess-energy', 'largest-transverse-cell'] },
        selectionRationale: { type: 'string' },
        minimumCaseCount: { type: 'integer', minimum: 2, maximum: 32 },
        minimumLargestTransverseCellVectorPerBurgers: { type: 'number', minimum: 0, default: 6 },
        maximumLargestPairExcessEnergyDriftEvPerA: { type: 'number', minimum: 0, default: 0.01 },
        maximumLargestPairCoreAnchorRmsDriftA: { type: 'number', minimum: 0, default: 0.05 },
        maximumLargestPairStressDifferenceDriftBar: { type: 'number', minimum: 0, default: 1000 },
      }),
      cases: { type: 'array', minItems: 2, maxItems: 32, items: caseSchema() },
      applyToWorkspace: { type: 'boolean', default: false },
      captureAfter: { type: 'boolean', default: false },
    },
  }
}

function parseCases(value: unknown): ZatomPeriodicDislocationRelaxationSeriesCaseContext[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > 32) {
    throw new ZatomPeriodicDislocationRelaxationSeriesInputError('invalid_periodic_dislocation_relaxation_series_context', 'cases must contain 2-32 entries')
  }
  return value.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new ZatomPeriodicDislocationRelaxationSeriesInputError('invalid_periodic_dislocation_relaxation_series_context', `cases[${index}] must be an object`)
    }
    const item = raw as Record<string, unknown>
    if (typeof item.id !== 'string' || !item.id.trim()) {
      throw new ZatomPeriodicDislocationRelaxationSeriesInputError('invalid_periodic_dislocation_relaxation_series_context', `cases[${index}].id is required`)
    }
    return {
      id: item.id,
      pairEvidence: item.pairEvidence as ZatomPeriodicDislocationRelaxationEvidence,
      sourceStructure: parseZatomStructure(item.sourceStructure),
      seedStructure: parseZatomStructure(item.seedStructure),
      relaxedDefectStructure: parseZatomStructure(item.relaxedDefectStructure),
      relaxedReferenceStructure: parseZatomStructure(item.relaxedReferenceStructure),
      seedEvidence: item.seedEvidence as ZatomPeriodicDislocationDipoleEvidence,
      defectRelaxationEvidence: item.defectRelaxationEvidence as ZatomFixedCellRelaxationEvidence,
      referenceRelaxationEvidence: item.referenceRelaxationEvidence as ZatomFixedCellRelaxationEvidence,
      ...(item.maxMinimumImageCandidateEvaluations === undefined
        ? {}
        : { maxMinimumImageCandidateEvaluations: Number(item.maxMinimumImageCandidateEvaluations) }),
    }
  })
}

async function candidateResult(
  tool: string,
  validation: ZatomPeriodicDislocationRelaxationSeriesValidation,
  input: Record<string, unknown>,
  context: Parameters<ZatomToolDefinition['execute']>[1],
) {
  return finalizeStructureCandidate({
    tool,
    result: {
      structure: validation.selectedStructure,
      seriesEvidence: validation.evidence,
      fingerprint: validation.fingerprint,
      checks: validation.checks,
      inspectionTargets: validation.inspectionTargets,
    },
    requestedApply: input.applyToWorkspace === true,
    captureAfter: input.captureAfter === true,
    context,
    summary: (applied, blocked, verified) => `${validation.evidence.kind} ${validation.fingerprint}: selected ${validation.evidence.selection.selectedCaseId}; ${validation.evidence.metrics.acceptancePassed ? 'series gates passed' : 'series gates failed'}${applied ? verified ? '; applied and verified' : '; applied' : blocked ? '; application blocked' : '; candidate only'}`,
  })
}

const composeSeriesTool: ZatomToolDefinition = {
  manifest: {
    name: COMPOSE_TOOL,
    title: 'Compose periodic-dislocation relaxation shift/size series',
    version: '2.0.0',
    description: `Compose ${ZATOM_PERIODIC_DISLOCATION_RELAXATION_SERIES_SCHEMA} from 2-32 fully replayed matched defect/reference relaxation pairs. Use shift-scan-at-fixed-cell only for unique sampled shifts in one exact lattice and rank only those sampled shifts. Use cell-size-at-fixed-shift only for one fixed shift, common line repeat, and strictly increasing transverse area; gate largest-two drift in excess energy per total line length, core-anchor RMS, and the maximum componentwise change across all six positive-compression pressure-tensor-difference components. Require exact common crystallography, elasticity, Atomman runtime/image protocol/gates, and LAMMPS executable/potential/provider/request identity. Return the explicitly selected relaxed defect with visual targets; never upgrade sampled stability into an isolated core energy or infinite-size proof.`,
    inputSchema: toolSchema(false),
    effects: { structure: 'create', workspace: 'write', visual: 'read' },
    tags: ['dislocation', 'periodic-dipole', 'relaxation', 'shift-scan', 'cell-size', 'convergence', 'visual-validation'],
  },
  execute: async (input, context) => {
    try {
      const cases = parseCases(input.cases)
      const kind = input.kind
      if (kind !== 'shift-scan-at-fixed-cell' && kind !== 'cell-size-at-fixed-shift') {
        throw new ZatomPeriodicDislocationRelaxationSeriesInputError('invalid_periodic_dislocation_relaxation_series', 'kind is unsupported')
      }
      const selectionMethod = input.selectionMethod
      if (selectionMethod !== 'explicit' && selectionMethod !== 'minimum-excess-energy' && selectionMethod !== 'largest-transverse-cell') {
        throw new ZatomPeriodicDislocationRelaxationSeriesInputError('invalid_periodic_dislocation_relaxation_series', 'selectionMethod is unsupported')
      }
      if (typeof input.selectedCaseId !== 'string' || typeof input.selectionRationale !== 'string') {
        throw new ZatomPeriodicDislocationRelaxationSeriesInputError('invalid_periodic_dislocation_relaxation_series', 'selectedCaseId and selectionRationale are required')
      }
      const isSize = kind === 'cell-size-at-fixed-shift'
      const minimumCaseCount = integerOption(input, 'minimumCaseCount', isSize ? 3 : 2, 2, 32)
      const artifacts = cases.map((item) => ({
        id: `pair:${item.id}`,
        role: `${kind} matched relaxation pair`,
        fingerprint: fingerprintPeriodicDislocationRelaxationEvidence(item.pairEvidence),
      }))
      const validation = composeZatomPeriodicDislocationRelaxationSeries({
        kind,
        cases,
        selection: {
          selectedCaseId: input.selectedCaseId,
          method: selectionMethod,
          rationale: input.selectionRationale,
        },
        acceptance: {
          minimumCaseCount,
          requireAllCasesAccepted: true,
          minimumLargestTransverseCellVectorPerBurgers: isSize
            ? finiteOption(input, 'minimumLargestTransverseCellVectorPerBurgers', 6)
            : null,
          maximumLargestPairExcessEnergyDriftEvPerA: isSize
            ? finiteOption(input, 'maximumLargestPairExcessEnergyDriftEvPerA', 0.01)
            : null,
          maximumLargestPairCoreAnchorRmsDriftA: isSize
            ? finiteOption(input, 'maximumLargestPairCoreAnchorRmsDriftA', 0.05)
            : null,
          maximumLargestPairStressDifferenceDriftBar: isSize
            ? finiteOption(input, 'maximumLargestPairStressDifferenceDriftBar', 1000)
            : null,
        },
        provenance: {
          method: kind === 'shift-scan-at-fixed-cell'
            ? 'Rank only the supplied unique atomman shift indices after exact matched fixed-cell defect/reference relaxation'
            : 'Compare largest-two sampled finite-cell observables across strictly increasing transverse areas at one fixed atomman shift index',
          artifacts,
          parameters: {
            kind,
            selectedCaseId: input.selectedCaseId,
            selectionMethod,
            minimumCaseCount,
            ...(isSize ? {
              minimumLargestTransverseCellVectorPerBurgers: finiteOption(input, 'minimumLargestTransverseCellVectorPerBurgers', 6),
              maximumLargestPairExcessEnergyDriftEvPerA: finiteOption(input, 'maximumLargestPairExcessEnergyDriftEvPerA', 0.01),
              maximumLargestPairCoreAnchorRmsDriftA: finiteOption(input, 'maximumLargestPairCoreAnchorRmsDriftA', 0.05),
              maximumLargestPairStressDifferenceDriftBar: finiteOption(input, 'maximumLargestPairStressDifferenceDriftBar', 1000),
            } : {}),
          },
          citations: [
            'https://www.ctcms.nist.gov/potentials/atomman/tutorial/4.9._Dislocation_configurations_generator.html',
            'https://doi.org/10.1080/0141861021000051109',
            'https://docs.lammps.org/minimize.html',
          ],
          scopeWarning: kind === 'shift-scan-at-fixed-cell'
            ? 'Ranking covers only explicitly supplied shift indices and makes no shift-enumeration completeness claim.'
            : 'Largest-two finite-cell observable stability is an empirical sampled gate without continuum elastic-image subtraction.',
        },
      })
      return await candidateResult(COMPOSE_TOOL, validation, input, context)
    } catch (error) {
      return toolError(COMPOSE_TOOL, error)
    }
  },
}

const validateSeriesTool: ZatomToolDefinition = {
  manifest: {
    name: VALIDATE_TOOL,
    title: 'Validate periodic-dislocation relaxation shift/size series',
    version: '2.0.0',
    description: `Replay ${ZATOM_PERIODIC_DISLOCATION_RELAXATION_SERIES_SCHEMA} against every exact matched relaxation-pair context. Recompute common identity, canonical case ordering, sampled shift ranking or largest-two finite-cell drifts, selection, acceptance, fingerprints, and selected-case visual targets.`,
    inputSchema: toolSchema(true),
    effects: { structure: 'create', workspace: 'write', visual: 'read' },
    tags: ['dislocation', 'periodic-dipole', 'relaxation', 'shift-scan', 'cell-size', 'quality-evidence', 'validation'],
  },
  execute: async (input, context) => {
    try {
      const validation = parseZatomPeriodicDislocationRelaxationSeries(input.evidence, { cases: parseCases(input.cases) })
      if (fingerprintPeriodicDislocationRelaxationSeries(validation.evidence) !== validation.fingerprint) {
        throw new ZatomPeriodicDislocationRelaxationSeriesInputError('periodic_dislocation_relaxation_series_fingerprint_mismatch', 'Series fingerprint replay mismatch')
      }
      return await candidateResult(VALIDATE_TOOL, validation, input, context)
    } catch (error) {
      return toolError(VALIDATE_TOOL, error)
    }
  },
}

export const PERIODIC_DISLOCATION_RELAXATION_SERIES_ZATOM_AGENT_TOOLS:
readonly ZatomToolDefinition[] = [composeSeriesTool, validateSeriesTool]
