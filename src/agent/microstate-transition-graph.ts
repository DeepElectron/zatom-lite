/** Canonical chemical-microstate transition graph and equilibrium population solver. */

import type { InspectionTarget, JsonValue, ValidationCheck, ZatomStructure } from './contracts'
import {
  parseZatomChemicalStateEnsemble,
  type ZatomChemicalStateEnsemble,
  type ZatomChemicalStatePopulationModel,
} from './chemical-state-ensemble'
import { boundsOfPositions, fingerprintCanonicalJson } from './structure-math'
import { parseZatomStructure } from './structure-validation'
import {
  parseZatomMicrostateStateCoverage,
  type ZatomMicrostateStateCoverage,
  type ZatomMicrostateStateCoverageValidation,
} from './microstate-state-coverage'
import {
  parseZatomMicrostateEquilibriumPotentialEnsemble,
  type ZatomMicrostateEquilibriumPotentialEnsemble,
  type ZatomMicrostateEquilibriumPotentialEnsembleValidation,
} from './microstate-equilibrium-potential-ensemble'
import {
  parseZatomMicrostatePotentialSampleDiagnostics,
  type ZatomMicrostatePotentialSampleDiagnostics,
  type ZatomMicrostatePotentialSampleDiagnosticsValidation,
} from './microstate-potential-sample-diagnostics'

export const ZATOM_MICROSTATE_TRANSITION_GRAPH_SCHEMA = 'zatom.microstate-transition-graph/v1' as const
export const ZATOM_MICROSTATE_POPULATION_SOLUTION_SCHEMA = 'zatom.microstate-population-solution/v1' as const

const GAS_CONSTANT_KCAL_PER_MOL_K = 0.00198720425864083
const LN_10 = Math.log(10)

export interface ZatomMicrostateGraphState {
  stateId: string
  /** Total-H difference from the least-protonated state; derived from the bound ensemble. */
  relativeProtonCount: number
}

export interface ZatomMicrostateEdgeUncertainty {
  standardDeviation: number
  unit: 'pKa' | 'kcal/mol'
  method: string
}

export interface ZatomMicrostateEdgeCorrelationModel {
  kind: 'full-correlation-matrix'
  /** Exact canonical graph-edge order after parsing. */
  edgeIds: string[]
  correlationMatrix: number[][]
  method: string
  assumptions: string[]
  scopeWarning: string
}

interface ZatomMicrostateEdgeBase {
  id: string
  fromStateId: string
  toStateId: string
  evidenceSourceIds: string[]
  /** Optional localization only when the exact selected structure is an endpoint. */
  selectedStructureAtomIds?: string[]
}

export interface ZatomMicrostateProtonTransferEdge extends ZatomMicrostateEdgeBase {
  kind: 'proton-transfer'
  /** `from` is protonated; `to` is the one-proton-lower conjugate. */
  pKa: number
  uncertainty?: ZatomMicrostateEdgeUncertainty
}

export interface ZatomMicrostateIsomerizationEdge extends ZatomMicrostateEdgeBase {
  kind: 'isomerization'
  /** G(to) - G(from) under graph conditions. */
  deltaGToMinusFromKcalMol: number
  uncertainty?: ZatomMicrostateEdgeUncertainty
}

export type ZatomMicrostateTransitionEdge =
  | ZatomMicrostateProtonTransferEdge
  | ZatomMicrostateIsomerizationEdge

export interface ZatomMicrostateEvidenceSource {
  id: string
  kind: 'microscopic-pka' | 'relative-free-energy' | 'experimental' | 'other'
  engine: string
  engineVersion: string
  method: string
  artifacts: Array<{
    id: string
    role: string
    fingerprint: string
  }>
  citations: string[]
  evidenceStatement: string
  applicability: {
    assessment: 'in-domain' | 'out-of-domain' | 'unknown'
    domain: string
    reasons: string[]
  }
  scopeWarning: string
}

export interface ZatomMicrostateTransitionGraph {
  schemaVersion: typeof ZATOM_MICROSTATE_TRANSITION_GRAPH_SCHEMA
  chemicalStateEnsembleFingerprint: string
  conditions: {
    temperatureK: number
    medium: string
    ionicStrengthMolar?: number
    standardState: string
  }
  completeness: {
    transitionsComplete: boolean
    status: string
  }
  states: ZatomMicrostateGraphState[]
  edges: ZatomMicrostateTransitionEdge[]
  evidenceSources: ZatomMicrostateEvidenceSource[]
  /** Optional full correlation model for the declared native-unit edge SDs. */
  edgeCorrelation?: ZatomMicrostateEdgeCorrelationModel
  acceptance: {
    /** Maximum absolute fundamental-cycle residual in log10 equilibrium-ratio units. */
    maximumCycleClosureResidualLog10: number
  }
  provenance: {
    engine: string
    engineVersion: string
    method: string
    parameters: Record<string, JsonValue>
    citations: string[]
    scopeWarning: string
  }
  metadata?: Record<string, JsonValue>
}

export interface ZatomMicrostateThermodynamicAudit {
  componentCount: number
  cycleRank: number
  fundamentalCycleResidualsLog10: Array<{
    closingEdgeId: string
    residualLog10: number
  }>
  maximumCycleClosureResidualLog10: number
  rmsCycleClosureResidualLog10: number
  completeEdgeUncertainty: boolean
}

export interface ZatomMicrostateTransitionGraphValidation {
  graph: ZatomMicrostateTransitionGraph
  fingerprint: string
  chemicalStateEnsemble: ZatomChemicalStateEnsemble
  thermodynamicAudit: ZatomMicrostateThermodynamicAudit
  checks: ValidationCheck[]
  inspectionTargets: InspectionTarget[]
}

export type ZatomMicrostateUncertaintyMode =
  | 'none'
  | 'independent-gaussian-delta-method'
  | 'correlated-gaussian-delta-method'
  | 'equilibrium-potential-sample-ensemble'

export type ZatomMicrostateSampleDiagnosticsPolicy = 'require-pass' | 'allow-missing'

export interface ZatomMicrostateSampleUncertaintySummary {
  mean: number
  standardDeviation: number
  median: number
  lowerQuantile: number
  upperQuantile: number
  intervalProbability: number
}

export interface ZatomMicrostateCensoringBounds {
  minimum: number
  maximum: number
}

export interface ZatomMicrostatePopulationScope {
  normalization: 'complete-state-universe' | 'conditional-on-returned-states'
  coverageAssessment: 'complete' | 'bounded' | 'unknown'
  /** Present only when a separately validated canonical coverage artifact was supplied. */
  stateCoverageFingerprint?: string
  pHDomain?: { minimum: number; maximum: number }
  totalOmittedFractionBounds?: ZatomMicrostateCensoringBounds
  retainedUniverseFractionBounds?: ZatomMicrostateCensoringBounds
  maximumPopulationScope: 'complete-state-universe' | 'returned-states-only'
  globalMaximumCertified: boolean
  globalMaximumStateIds?: string[]
}

export interface ZatomMicrostatePopulationSolution {
  schemaVersion: typeof ZATOM_MICROSTATE_POPULATION_SOLUTION_SCHEMA
  graphFingerprint: string
  chemicalStateEnsembleFingerprint: string
  conditions: ZatomMicrostateTransitionGraph['conditions'] & { pH: number }
  solver: {
    method: 'log-equilibrium-graph-least-squares' | 'log-equilibrium-graph-generalized-least-squares'
    uncertaintyMode: ZatomMicrostateUncertaintyMode
    requireCompleteGraph: boolean
    allowUnknownApplicability: boolean
    maximumCycleClosureResidualLog10: number
    referenceStateId: string
    equilibriumPotentialEnsembleFingerprint?: string
    sampleIntervalProbability?: number
    minimumSampleWeightEffectiveSize?: number
    sampleDiagnosticsPolicy?: ZatomMicrostateSampleDiagnosticsPolicy
    potentialSampleDiagnosticsFingerprint?: string
  }
  fit: {
    stateCount: number
    edgeCount: number
    cycleRank: number
    maximumFundamentalCycleResidualLog10: number
    maximumEdgeFitResidualLog10: number
    rmsEdgeFitResidualLog10: number
  }
  populationScope: ZatomMicrostatePopulationScope
  populations: Array<{
    stateId: string
    fraction: number
    log10WeightRelativeToReference: number
    standardDeviation?: number
    sampleUncertainty?: ZatomMicrostateSampleUncertaintySummary
    /** Full-universe population bounds from state censoring only; separate from edge-parameter SD. */
    censoringBounds?: ZatomMicrostateCensoringBounds
  }>
  maximumPopulationStateIds: string[]
  uncertainty?: {
    method:
      | 'weighted-least-squares-independent-gaussian-edge-errors-delta-method'
      | 'generalized-least-squares-correlated-gaussian-edge-errors-delta-method'
      | 'weighted-joint-equilibrium-potential-sample-ensemble'
    assumptions: string[]
    sampleCount?: number
    weightEffectiveSampleSize?: number
    intervalProbability?: number
    sampleDiagnosticsAssessment?: 'passed' | 'missing-explicitly-allowed'
  }
  provenance: {
    method: string
    citations: string[]
    scopeWarning: string
  }
}

export interface ZatomMicrostatePopulationSolveResult {
  graphValidation: ZatomMicrostateTransitionGraphValidation
  solution: ZatomMicrostatePopulationSolution
  solutionFingerprint: string
  populationModel: ZatomChemicalStatePopulationModel
  ensembleWithPopulationModel: ZatomChemicalStateEnsemble
  ensembleWithPopulationModelFingerprint: string
  checks: ValidationCheck[]
  inspectionTargets: InspectionTarget[]
}

export interface ParseZatomMicrostateTransitionGraphOptions {
  structure: ZatomStructure
  chemicalStateEnsemble: ZatomChemicalStateEnsemble
  maxStates?: number
  maxEdges?: number
  maxEvidenceSources?: number
  maxMetadataBytes?: number
  maxCorrelatedEdges?: number
}

export interface SolveZatomMicrostatePopulationsOptions extends ParseZatomMicrostateTransitionGraphOptions {
  pH: number
  maximumCycleClosureResidualLog10: number
  requireCompleteGraph: boolean
  allowUnknownApplicability: boolean
  uncertaintyMode: ZatomMicrostateUncertaintyMode
  /** Optional exact graph-bound evidence for omitted-state population mass. */
  stateCoverage?: ZatomMicrostateStateCoverage
  /** Joint gauge-fixed state-potential samples required by the sample-ensemble uncertainty mode. */
  equilibriumPotentialEnsemble?: ZatomMicrostateEquilibriumPotentialEnsemble
  /** Central probability mass of the reported weighted quantile interval. */
  sampleIntervalProbability?: number
  /** Consumer Kish weight-ESS gate; it may only tighten the producer threshold. */
  minimumSampleWeightEffectiveSize?: number
  /** Explicit convergence-evidence policy required by the sample-ensemble mode. */
  sampleDiagnosticsPolicy?: ZatomMicrostateSampleDiagnosticsPolicy
  /** Optional exact potential-ensemble-bound multi-chain diagnostics artifact. */
  potentialSampleDiagnostics?: ZatomMicrostatePotentialSampleDiagnostics
}

export class ZatomMicrostateTransitionGraphInputError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'ZatomMicrostateTransitionGraphInputError'
    this.code = code
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function exactObject(
  value: unknown,
  field: string,
  required: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new ZatomMicrostateTransitionGraphInputError('invalid_microstate_transition_graph', `${field} must be an object`)
  }
  const allowed = new Set([...required, ...optional])
  const missing = required.filter((key) => !(key in value))
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key))
  if (missing.length || unexpected.length) {
    throw new ZatomMicrostateTransitionGraphInputError(
      'invalid_microstate_transition_graph',
      `${field} fields differ (missing=${missing.join(',') || 'none'}, unexpected=${unexpected.join(',') || 'none'})`,
    )
  }
  return value
}

function text(value: unknown, field: string, maximum = 1024): string {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0') || value.length > maximum) {
    throw new ZatomMicrostateTransitionGraphInputError(
      'invalid_microstate_transition_graph',
      `${field} must be non-empty text of at most ${maximum} characters without NUL bytes`,
    )
  }
  return value.trim()
}

function token(value: unknown, field: string, maximum = 128): string {
  const result = text(value, field, maximum)
  if (!/^[A-Za-z0-9_.:+@/-]+$/.test(result)) {
    throw new ZatomMicrostateTransitionGraphInputError(
      'invalid_microstate_transition_graph',
      `${field} contains unsupported token characters`,
    )
  }
  return result
}

function integer(value: unknown, field: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new ZatomMicrostateTransitionGraphInputError(
      'invalid_microstate_transition_graph',
      `${field} must be an integer from ${minimum} through ${maximum}`,
    )
  }
  return Number(value)
}

function numberIn(value: unknown, field: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new ZatomMicrostateTransitionGraphInputError(
      'invalid_microstate_transition_graph',
      `${field} must be finite from ${minimum} through ${maximum}`,
    )
  }
  return Object.is(value, -0) ? 0 : value
}

function jsonValue(value: unknown, field: string): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new ZatomMicrostateTransitionGraphInputError('invalid_microstate_transition_graph', `${field} must be finite`)
    }
    return Object.is(value, -0) ? 0 : value
  }
  if (Array.isArray(value)) return value.map((item, index) => jsonValue(item, `${field}[${index}]`))
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonValue(item, `${field}.${key}`)]))
  }
  throw new ZatomMicrostateTransitionGraphInputError('invalid_microstate_transition_graph', `${field} is not JSON-safe`)
}

function uniqueTextList(
  value: unknown,
  field: string,
  minimum = 1,
  maximum = 32,
  maximumTextLength = 2048,
): string[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    throw new ZatomMicrostateTransitionGraphInputError(
      'invalid_microstate_transition_graph',
      `${field} must contain ${minimum}-${maximum} entries`,
    )
  }
  const result = value.map((item, index) => text(item, `${field}[${index}]`, maximumTextLength))
  if (new Set(result).size !== result.length) {
    throw new ZatomMicrostateTransitionGraphInputError(
      'invalid_microstate_transition_graph',
      `${field} must not repeat entries`,
    )
  }
  return result.sort(compareText)
}

function uniqueTokenList(value: unknown, field: string, minimum = 1, maximum = 32): string[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    throw new ZatomMicrostateTransitionGraphInputError(
      'invalid_microstate_transition_graph',
      `${field} must contain ${minimum}-${maximum} identifiers`,
    )
  }
  const result = value.map((item, index) => token(item, `${field}[${index}]`))
  if (new Set(result).size !== result.length) {
    throw new ZatomMicrostateTransitionGraphInputError(
      'invalid_microstate_transition_graph',
      `${field} must not repeat identifiers`,
    )
  }
  return result.sort(compareText)
}

function uniqueTokenListPreservingOrder(
  value: unknown,
  field: string,
  minimum = 1,
  maximum = 32,
): string[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    throw new ZatomMicrostateTransitionGraphInputError(
      'invalid_microstate_transition_graph',
      `${field} must contain ${minimum}-${maximum} identifiers`,
    )
  }
  const result = value.map((item, index) => token(item, `${field}[${index}]`))
  if (new Set(result).size !== result.length) {
    throw new ZatomMicrostateTransitionGraphInputError(
      'invalid_microstate_transition_graph',
      `${field} must not repeat identifiers`,
    )
  }
  return result
}

interface ParsedHillFormula {
  counts: Map<string, number>
  formalCharge: number
}

function serializeHillFormula(formula: ParsedHillFormula): string {
  const hasCarbon = formula.counts.has('C')
  const elements = [...formula.counts.keys()].sort((left, right) => {
    if (hasCarbon) {
      if (left === 'C') return -1
      if (right === 'C') return 1
      if (left === 'H') return -1
      if (right === 'H') return 1
    }
    return compareText(left, right)
  })
  const base = elements.map((element) => {
    const count = formula.counts.get(element)!
    return `${element}${count === 1 ? '' : count}`
  }).join('')
  if (formula.formalCharge === 0) return base
  const sign = formula.formalCharge > 0 ? '+' : '-'
  const magnitude = Math.abs(formula.formalCharge)
  return `${base}${sign}${magnitude === 1 ? '' : magnitude}`
}

function parseHillFormula(value: string, field: string): ParsedHillFormula {
  const chargeMatch = /([+-])(\d*)$/.exec(value)
  const base = chargeMatch ? value.slice(0, chargeMatch.index) : value
  const formalCharge = chargeMatch
    ? (chargeMatch[1] === '+' ? 1 : -1) * (chargeMatch[2] ? Number(chargeMatch[2]) : 1)
    : 0
  if (!base || !Number.isSafeInteger(formalCharge)) {
    throw new ZatomMicrostateTransitionGraphInputError(
      'microstate_state_formula_mismatch',
      `${field} is not a supported canonical Hill formula`,
    )
  }
  const counts = new Map<string, number>()
  const pattern = /([A-Z][a-z]?)(\d*)/g
  let cursor = 0
  for (let match = pattern.exec(base); match; match = pattern.exec(base)) {
    if (match.index !== cursor) {
      throw new ZatomMicrostateTransitionGraphInputError(
        'microstate_state_formula_mismatch',
        `${field} is not a supported canonical Hill formula`,
      )
    }
    const count = match[2] ? Number(match[2]) : 1
    if (!Number.isSafeInteger(count) || count <= 0 || counts.has(match[1])) {
      throw new ZatomMicrostateTransitionGraphInputError(
        'microstate_state_formula_mismatch',
        `${field} has an invalid or repeated element count`,
      )
    }
    counts.set(match[1], count)
    cursor = pattern.lastIndex
  }
  if (cursor !== base.length || !counts.size) {
    throw new ZatomMicrostateTransitionGraphInputError(
      'microstate_state_formula_mismatch',
      `${field} is not a supported canonical Hill formula`,
    )
  }
  const parsed = { counts, formalCharge }
  if (serializeHillFormula(parsed) !== value) {
    throw new ZatomMicrostateTransitionGraphInputError(
      'microstate_state_formula_mismatch',
      `${field} must use canonical Hill element and charge ordering`,
    )
  }
  return parsed
}

function heavyCompositionKey(formula: ParsedHillFormula): string {
  return [...formula.counts.entries()]
    .filter(([element]) => element !== 'H')
    .sort(([left], [right]) => compareText(left, right))
    .map(([element, count]) => `${element}:${count}`)
    .join('|')
}


export function fingerprintMicrostateTransitionGraph(value: ZatomMicrostateTransitionGraph): string {
  return fingerprintCanonicalJson(value)
}

export function fingerprintMicrostatePopulationSolution(value: ZatomMicrostatePopulationSolution): string {
  return fingerprintCanonicalJson(value)
}

function parseUncertainty(value: unknown, field: string, expectedUnit: 'pKa' | 'kcal/mol'): ZatomMicrostateEdgeUncertainty {
  const record = exactObject(value, field, ['standardDeviation', 'unit', 'method'])
  if (record.unit !== expectedUnit) {
    throw new ZatomMicrostateTransitionGraphInputError(
      'microstate_edge_uncertainty_mismatch',
      `${field}.unit must be ${expectedUnit}`,
    )
  }
  return {
    standardDeviation: numberIn(record.standardDeviation, `${field}.standardDeviation`, 1e-12, 1_000),
    unit: expectedUnit,
    method: text(record.method, `${field}.method`, 1024),
  }
}

function edgeLog10Ratio(
  edge: ZatomMicrostateTransitionEdge,
  conditions: ZatomMicrostateTransitionGraph['conditions'],
  pH: number,
): number {
  if (edge.kind === 'proton-transfer') return pH - edge.pKa
  return -edge.deltaGToMinusFromKcalMol / (GAS_CONSTANT_KCAL_PER_MOL_K * conditions.temperatureK * LN_10)
}

function edgeSigmaLog10(
  edge: ZatomMicrostateTransitionEdge,
  conditions: ZatomMicrostateTransitionGraph['conditions'],
): number | null {
  if (!edge.uncertainty) return null
  if (edge.kind === 'proton-transfer') return edge.uncertainty.standardDeviation
  return edge.uncertainty.standardDeviation / (GAS_CONSTANT_KCAL_PER_MOL_K * conditions.temperatureK * LN_10)
}

function choleskyLower(
  matrix: readonly (readonly number[])[],
  code: string,
  field: string,
): number[][] {
  const size = matrix.length
  if (!size || matrix.some((row) => row.length !== size)) {
    throw new ZatomMicrostateTransitionGraphInputError(code, `${field} must be a non-empty square matrix`)
  }
  const scale = matrix.reduce(
    (maximum, row) => row.reduce((rowMaximum, value) => Math.max(rowMaximum, Math.abs(value)), maximum),
    0,
  )
  const tolerance = scale * Number.EPSILON * Math.max(64, size * 16)
  const lower = Array.from({ length: size }, () => Array.from({ length: size }, () => 0))
  for (let row = 0; row < size; row++) {
    for (let column = 0; column <= row; column++) {
      let residual = matrix[row][column]
      for (let inner = 0; inner < column; inner++) residual -= lower[row][inner] * lower[column][inner]
      if (row === column) {
        if (!Number.isFinite(residual) || residual <= tolerance) {
          throw new ZatomMicrostateTransitionGraphInputError(
            code,
            `${field} must be numerically positive definite; pivot ${row} is ${residual}`,
          )
        }
        lower[row][column] = Math.sqrt(residual)
      } else {
        lower[row][column] = residual / lower[column][column]
      }
    }
  }
  return lower
}

function solveLowerTriangular(lower: readonly (readonly number[])[], vector: readonly number[]): number[] {
  const result = vector.map(() => 0)
  for (let row = 0; row < vector.length; row++) {
    let residual = vector[row]
    for (let column = 0; column < row; column++) residual -= lower[row][column] * result[column]
    result[row] = residual / lower[row][row]
  }
  return result
}

interface GraphTopologyAudit {
  componentCount: number
  treeEdgeIds: Set<string>
  referencePotentials: number[]
}

function auditGraphTopology(
  graph: ZatomMicrostateTransitionGraph,
  stateIndexById: ReadonlyMap<string, number>,
): GraphTopologyAudit {
  const adjacency = graph.states.map(() => [] as Array<{ edge: ZatomMicrostateTransitionEdge; neighbor: number; delta: number }>)
  for (const edge of graph.edges) {
    const from = stateIndexById.get(edge.fromStateId)!
    const to = stateIndexById.get(edge.toStateId)!
    const delta = edgeLog10Ratio(edge, graph.conditions, 0)
    adjacency[from].push({ edge, neighbor: to, delta })
    adjacency[to].push({ edge, neighbor: from, delta: -delta })
  }
  for (const entries of adjacency) entries.sort((left, right) => compareText(left.edge.id, right.edge.id))
  const visited = graph.states.map(() => false)
  const referencePotentials = graph.states.map(() => 0)
  const treeEdgeIds = new Set<string>()
  let componentCount = 0
  for (let root = 0; root < graph.states.length; root++) {
    if (visited[root]) continue
    componentCount++
    visited[root] = true
    const queue = [root]
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const current = queue[cursor]
      for (const item of adjacency[current]) {
        if (visited[item.neighbor]) continue
        visited[item.neighbor] = true
        treeEdgeIds.add(item.edge.id)
        referencePotentials[item.neighbor] = referencePotentials[current] + item.delta
        queue.push(item.neighbor)
      }
    }
  }
  return { componentCount, treeEdgeIds, referencePotentials }
}

function thermodynamicAudit(
  graph: ZatomMicrostateTransitionGraph,
  stateIndexById: ReadonlyMap<string, number>,
): ZatomMicrostateThermodynamicAudit {
  const topology = auditGraphTopology(graph, stateIndexById)
  const residuals = graph.edges.filter((edge) => !topology.treeEdgeIds.has(edge.id)).map((edge) => {
    const from = stateIndexById.get(edge.fromStateId)!
    const to = stateIndexById.get(edge.toStateId)!
    const expected = edgeLog10Ratio(edge, graph.conditions, 0)
    return {
      closingEdgeId: edge.id,
      residualLog10: topology.referencePotentials[to] - topology.referencePotentials[from] - expected,
    }
  })
  const maximum = residuals.reduce((result, item) => Math.max(result, Math.abs(item.residualLog10)), 0)
  const rms = residuals.length
    ? Math.sqrt(residuals.reduce((sum, item) => sum + item.residualLog10 ** 2, 0) / residuals.length)
    : 0
  return {
    componentCount: topology.componentCount,
    cycleRank: graph.edges.length - graph.states.length + topology.componentCount,
    fundamentalCycleResidualsLog10: residuals,
    maximumCycleClosureResidualLog10: maximum,
    rmsCycleClosureResidualLog10: rms,
    completeEdgeUncertainty: graph.edges.every((edge) => edge.uncertainty !== undefined),
  }
}

export function parseZatomMicrostateTransitionGraph(
  value: unknown,
  options: ParseZatomMicrostateTransitionGraphOptions,
): ZatomMicrostateTransitionGraphValidation {
  const structure = parseZatomStructure(options.structure)
  const parsedEnsemble = parseZatomChemicalStateEnsemble(options.chemicalStateEnsemble, { structure })
  const ensemble = parsedEnsemble.ensemble
  if (!new Set(['protonation', 'tautomer-protonation', 'custom']).has(ensemble.enumeration.kind)) {
    throw new ZatomMicrostateTransitionGraphInputError(
      'unsupported_microstate_ensemble_kind',
      `Microstate transition graph requires a protonation-capable ensemble, not ${ensemble.enumeration.kind}`,
    )
  }
  if (ensemble.populationModel !== undefined || ensemble.selection.method === 'maximum-population') {
    throw new ZatomMicrostateTransitionGraphInputError(
      'microstate_graph_population_cycle',
      'The graph must bind a pre-population ensemble; existing population evidence would create circular provenance',
    )
  }
  const maxStates = options.maxStates ?? 512
  const maxEdges = options.maxEdges ?? 8_192
  const maxEvidenceSources = options.maxEvidenceSources ?? 128
  const maxMetadataBytes = options.maxMetadataBytes ?? 2 * 1024 * 1024
  const maxCorrelatedEdges = options.maxCorrelatedEdges ?? 128
  if (![maxStates, maxEdges, maxEvidenceSources, maxMetadataBytes, maxCorrelatedEdges].every((item) => (
    Number.isSafeInteger(item) && item > 0
  ))) {
    throw new ZatomMicrostateTransitionGraphInputError(
      'invalid_microstate_transition_graph_budget',
      'Microstate graph parser budgets must be positive safe integers',
    )
  }
  if (ensemble.states.length < 2 || ensemble.states.length > maxStates) {
    throw new ZatomMicrostateTransitionGraphInputError(
      'microstate_transition_graph_budget_exceeded',
      `The bound ensemble must contain 2-${maxStates} states`,
    )
  }

  const root = exactObject(value, 'graph', [
    'schemaVersion',
    'chemicalStateEnsembleFingerprint',
    'conditions',
    'completeness',
    'states',
    'edges',
    'evidenceSources',
    'acceptance',
    'provenance',
  ], ['edgeCorrelation', 'metadata'])
  if (root.schemaVersion !== ZATOM_MICROSTATE_TRANSITION_GRAPH_SCHEMA) {
    throw new ZatomMicrostateTransitionGraphInputError(
      'invalid_microstate_transition_graph',
      `graph.schemaVersion must be ${ZATOM_MICROSTATE_TRANSITION_GRAPH_SCHEMA}`,
    )
  }
  const ensembleFingerprint = text(
    root.chemicalStateEnsembleFingerprint,
    'graph.chemicalStateEnsembleFingerprint',
    128,
  )
  if (ensembleFingerprint !== parsedEnsemble.fingerprint) {
    throw new ZatomMicrostateTransitionGraphInputError(
      'microstate_ensemble_fingerprint_mismatch',
      'graph.chemicalStateEnsembleFingerprint does not match the canonical bound ensemble',
    )
  }

  const rawConditions = exactObject(
    root.conditions,
    'graph.conditions',
    ['temperatureK', 'medium', 'standardState'],
    ['ionicStrengthMolar'],
  )
  const conditions: ZatomMicrostateTransitionGraph['conditions'] = {
    temperatureK: numberIn(rawConditions.temperatureK, 'graph.conditions.temperatureK', 0.01, 1_000_000),
    medium: text(rawConditions.medium, 'graph.conditions.medium', 512),
    ...(rawConditions.ionicStrengthMolar === undefined ? {} : {
      ionicStrengthMolar: numberIn(rawConditions.ionicStrengthMolar, 'graph.conditions.ionicStrengthMolar', 0, 100),
    }),
    standardState: text(rawConditions.standardState, 'graph.conditions.standardState', 512),
  }

  const rawCompleteness = exactObject(
    root.completeness,
    'graph.completeness',
    ['transitionsComplete', 'status'],
  )
  if (typeof rawCompleteness.transitionsComplete !== 'boolean') {
    throw new ZatomMicrostateTransitionGraphInputError(
      'invalid_microstate_transition_graph',
      'graph.completeness.transitionsComplete must be boolean',
    )
  }
  const completeness: ZatomMicrostateTransitionGraph['completeness'] = {
    transitionsComplete: rawCompleteness.transitionsComplete,
    status: text(rawCompleteness.status, 'graph.completeness.status', 1024),
  }

  if (!Array.isArray(root.states) || root.states.length !== ensemble.states.length) {
    throw new ZatomMicrostateTransitionGraphInputError(
      'microstate_graph_state_coverage_mismatch',
      'graph.states must cover every bound ensemble state exactly once',
    )
  }
  const minimumHydrogenCount = Math.min(...ensemble.states.map((state) => state.explicitHydrogenCount))
  const ensembleStateById = new Map(ensemble.states.map((state) => [state.id, state]))
  const parsedStateFormulas = ensemble.states.map((state) => {
    const parsed = parseHillFormula(state.formula, `ensemble state ${state.id}.formula`)
    const observedAtomCount = [...parsed.counts.values()].reduce((sum, count) => sum + count, 0)
    if (
      parsed.formalCharge !== state.formalCharge
      || (parsed.counts.get('H') ?? 0) !== state.explicitHydrogenCount
      || observedAtomCount !== state.atomCount
    ) {
      throw new ZatomMicrostateTransitionGraphInputError(
        'microstate_state_formula_mismatch',
        `Ensemble state ${state.id} formula does not reproduce its formal charge, explicit-H count, and atom count`,
      )
    }
    return parsed
  })
  if (new Set(parsedStateFormulas.map(heavyCompositionKey)).size !== 1) {
    throw new ZatomMicrostateTransitionGraphInputError(
      'microstate_heavy_composition_mismatch',
      'Every graph state must preserve the exact heavy-element composition',
    )
  }
  const rawStateById = new Map<string, Record<string, unknown>>()
  for (let index = 0; index < root.states.length; index++) {
    const record = exactObject(root.states[index], `graph.states[${index}]`, ['stateId', 'relativeProtonCount'])
    const stateId = token(record.stateId, `graph.states[${index}].stateId`)
    if (rawStateById.has(stateId)) {
      throw new ZatomMicrostateTransitionGraphInputError(
        'microstate_graph_state_coverage_mismatch',
        `graph.states repeats ${stateId}`,
      )
    }
    rawStateById.set(stateId, record)
  }
  const states = ensemble.states.map((state): ZatomMicrostateGraphState => {
    const raw = rawStateById.get(state.id)
    if (!raw) {
      throw new ZatomMicrostateTransitionGraphInputError(
        'microstate_graph_state_coverage_mismatch',
        `graph.states omits ensemble state ${state.id}`,
      )
    }
    const expectedRelativeProtonCount = state.explicitHydrogenCount - minimumHydrogenCount
    const relativeProtonCount = integer(
      raw.relativeProtonCount,
      `graph.states[${state.id}].relativeProtonCount`,
      0,
      10_000,
    )
    if (relativeProtonCount !== expectedRelativeProtonCount) {
      throw new ZatomMicrostateTransitionGraphInputError(
        'microstate_proton_count_mismatch',
        `State ${state.id} relativeProtonCount ${relativeProtonCount} differs from ensemble H-count difference ${expectedRelativeProtonCount}`,
      )
    }
    return { stateId: state.id, relativeProtonCount }
  })
  if ([...rawStateById.keys()].some((stateId) => !ensembleStateById.has(stateId))) {
    throw new ZatomMicrostateTransitionGraphInputError(
      'microstate_graph_state_coverage_mismatch',
      'graph.states references a state absent from the bound ensemble',
    )
  }
  const chargeBaselines = ensemble.states.map((state, index) => state.formalCharge - states[index].relativeProtonCount)
  if (new Set(chargeBaselines).size !== 1) {
    throw new ZatomMicrostateTransitionGraphInputError(
      'microstate_proton_charge_ladder_mismatch',
      'Every state must lie on one protonation ladder: formalCharge - relativeProtonCount must be constant',
    )
  }

  if (!Array.isArray(root.evidenceSources)
    || !root.evidenceSources.length
    || root.evidenceSources.length > maxEvidenceSources) {
    throw new ZatomMicrostateTransitionGraphInputError(
      'microstate_transition_graph_budget_exceeded',
      `graph.evidenceSources must contain 1-${maxEvidenceSources} entries`,
    )
  }
  const evidenceKinds = new Set<ZatomMicrostateEvidenceSource['kind']>([
    'microscopic-pka',
    'relative-free-energy',
    'experimental',
    'other',
  ])
  const applicabilityAssessments = new Set(['in-domain', 'out-of-domain', 'unknown'])
  const evidenceSources = root.evidenceSources.map((raw, index): ZatomMicrostateEvidenceSource => {
    const field = `graph.evidenceSources[${index}]`
    const record = exactObject(raw, field, [
      'id',
      'kind',
      'engine',
      'engineVersion',
      'method',
      'artifacts',
      'citations',
      'evidenceStatement',
      'applicability',
      'scopeWarning',
    ])
    if (!evidenceKinds.has(record.kind as ZatomMicrostateEvidenceSource['kind'])) {
      throw new ZatomMicrostateTransitionGraphInputError(
        'invalid_microstate_transition_graph',
        `${field}.kind is unsupported`,
      )
    }
    if (!Array.isArray(record.artifacts) || record.artifacts.length > 32) {
      throw new ZatomMicrostateTransitionGraphInputError(
        'invalid_microstate_transition_graph',
        `${field}.artifacts must contain 0-32 entries`,
      )
    }
    const artifacts = record.artifacts.map((rawArtifact, artifactIndex) => {
      const artifactField = `${field}.artifacts[${artifactIndex}]`
      const artifact = exactObject(rawArtifact, artifactField, ['id', 'role', 'fingerprint'])
      return {
        id: token(artifact.id, `${artifactField}.id`),
        role: text(artifact.role, `${artifactField}.role`, 512),
        fingerprint: text(artifact.fingerprint, `${artifactField}.fingerprint`, 256),
      }
    }).sort((left, right) => compareText(left.id, right.id))
    if (new Set(artifacts.map((artifact) => artifact.id)).size !== artifacts.length) {
      throw new ZatomMicrostateTransitionGraphInputError(
        'invalid_microstate_transition_graph',
        `${field}.artifacts repeats an ID`,
      )
    }
    const rawApplicability = exactObject(record.applicability, `${field}.applicability`, [
      'assessment', 'domain', 'reasons',
    ])
    if (!applicabilityAssessments.has(String(rawApplicability.assessment))) {
      throw new ZatomMicrostateTransitionGraphInputError(
        'invalid_microstate_transition_graph',
        `${field}.applicability.assessment is unsupported`,
      )
    }
    return {
      id: token(record.id, `${field}.id`),
      kind: record.kind as ZatomMicrostateEvidenceSource['kind'],
      engine: text(record.engine, `${field}.engine`, 256),
      engineVersion: text(record.engineVersion, `${field}.engineVersion`, 256),
      method: text(record.method, `${field}.method`, 2048),
      artifacts,
      citations: uniqueTextList(record.citations, `${field}.citations`),
      evidenceStatement: text(record.evidenceStatement, `${field}.evidenceStatement`, 4096),
      applicability: {
        assessment: rawApplicability.assessment as ZatomMicrostateEvidenceSource['applicability']['assessment'],
        domain: text(rawApplicability.domain, `${field}.applicability.domain`, 4096),
        reasons: uniqueTextList(rawApplicability.reasons, `${field}.applicability.reasons`),
      },
      scopeWarning: text(record.scopeWarning, `${field}.scopeWarning`, 8192),
    }
  }).sort((left, right) => compareText(left.id, right.id))
  if (new Set(evidenceSources.map((source) => source.id)).size !== evidenceSources.length) {
    throw new ZatomMicrostateTransitionGraphInputError(
      'invalid_microstate_transition_graph',
      'graph.evidenceSources IDs must be unique',
    )
  }
  const evidenceSourceIds = new Set(evidenceSources.map((source) => source.id))

  if (!Array.isArray(root.edges) || !root.edges.length || root.edges.length > maxEdges) {
    throw new ZatomMicrostateTransitionGraphInputError(
      'microstate_transition_graph_budget_exceeded',
      `graph.edges must contain 1-${maxEdges} transitions`,
    )
  }
  const structureAtomIds = new Set(structure.atoms.map((atom) => atom.id))
  const selectedStateId = ensemble.selection.selectedStateId
  const edges = root.edges.map((raw, index): ZatomMicrostateTransitionEdge => {
    const field = `graph.edges[${index}]`
    if (!isRecord(raw)) {
      throw new ZatomMicrostateTransitionGraphInputError('invalid_microstate_transition_graph', `${field} must be an object`)
    }
    const kind = raw.kind
    const commonRequired = ['id', 'kind', 'fromStateId', 'toStateId', 'evidenceSourceIds']
    const commonOptional = ['uncertainty', 'selectedStructureAtomIds']
    const record = kind === 'proton-transfer'
      ? exactObject(raw, field, [...commonRequired, 'pKa'], commonOptional)
      : kind === 'isomerization'
        ? exactObject(raw, field, [...commonRequired, 'deltaGToMinusFromKcalMol'], commonOptional)
        : (() => {
            throw new ZatomMicrostateTransitionGraphInputError(
              'invalid_microstate_transition_graph',
              `${field}.kind is unsupported`,
            )
          })()
    let fromStateId = token(record.fromStateId, `${field}.fromStateId`)
    let toStateId = token(record.toStateId, `${field}.toStateId`)
    if (fromStateId === toStateId || !ensembleStateById.has(fromStateId) || !ensembleStateById.has(toStateId)) {
      throw new ZatomMicrostateTransitionGraphInputError(
        'microstate_edge_state_mismatch',
        `${field} must connect two distinct bound ensemble states`,
      )
    }
    const sourceIds = uniqueTokenList(record.evidenceSourceIds, `${field}.evidenceSourceIds`)
    if (sourceIds.some((sourceId) => !evidenceSourceIds.has(sourceId))) {
      throw new ZatomMicrostateTransitionGraphInputError(
        'microstate_edge_evidence_mismatch',
        `${field} references an unknown evidence source`,
      )
    }
    let selectedStructureAtomIds: string[] | undefined
    if (record.selectedStructureAtomIds !== undefined) {
      selectedStructureAtomIds = uniqueTokenList(
        record.selectedStructureAtomIds,
        `${field}.selectedStructureAtomIds`,
        1,
        128,
      )
      if (fromStateId !== selectedStateId && toStateId !== selectedStateId) {
        throw new ZatomMicrostateTransitionGraphInputError(
          'microstate_edge_visual_mapping_mismatch',
          `${field}.selectedStructureAtomIds requires the selected state as one endpoint`,
        )
      }
      if (selectedStructureAtomIds.some((atomId) => !structureAtomIds.has(atomId))) {
        throw new ZatomMicrostateTransitionGraphInputError(
          'microstate_edge_visual_mapping_mismatch',
          `${field}.selectedStructureAtomIds contains an atom absent from the exact selected structure`,
        )
      }
    }
    const fromState = ensembleStateById.get(fromStateId)!
    const toState = ensembleStateById.get(toStateId)!
    const fromGraphState = states[ensemble.states.findIndex((state) => state.id === fromStateId)]
    const toGraphState = states[ensemble.states.findIndex((state) => state.id === toStateId)]
    const id = token(record.id, `${field}.id`)
    if (kind === 'proton-transfer') {
      if (
        fromGraphState.relativeProtonCount !== toGraphState.relativeProtonCount + 1
        || fromState.explicitHydrogenCount !== toState.explicitHydrogenCount + 1
        || fromState.formalCharge !== toState.formalCharge + 1
        || fromState.heavyAtomCount !== toState.heavyAtomCount
      ) {
        throw new ZatomMicrostateTransitionGraphInputError(
          'microstate_proton_transfer_stoichiometry_mismatch',
          `${field} must point from the protonated state to a state with exactly one fewer H and one lower formal charge`,
        )
      }
      return {
        id,
        kind,
        fromStateId,
        toStateId,
        pKa: numberIn(record.pKa, `${field}.pKa`, -100, 100),
        evidenceSourceIds: sourceIds,
        ...(record.uncertainty === undefined ? {} : {
          uncertainty: parseUncertainty(record.uncertainty, `${field}.uncertainty`, 'pKa'),
        }),
        ...(selectedStructureAtomIds ? { selectedStructureAtomIds } : {}),
      }
    }
    if (
      fromGraphState.relativeProtonCount !== toGraphState.relativeProtonCount
      || fromState.explicitHydrogenCount !== toState.explicitHydrogenCount
      || fromState.formalCharge !== toState.formalCharge
      || fromState.formula !== toState.formula
      || fromState.heavyAtomCount !== toState.heavyAtomCount
    ) {
      throw new ZatomMicrostateTransitionGraphInputError(
        'microstate_isomerization_stoichiometry_mismatch',
        `${field} isomerization endpoints must have identical formula, H count, heavy-atom count, and formal charge`,
      )
    }
    let deltaG = numberIn(
      record.deltaGToMinusFromKcalMol,
      `${field}.deltaGToMinusFromKcalMol`,
      -1_000,
      1_000,
    )
    if (compareText(fromStateId, toStateId) > 0) {
      ;[fromStateId, toStateId] = [toStateId, fromStateId]
      deltaG = -deltaG
    }
    return {
      id,
      kind,
      fromStateId,
      toStateId,
      deltaGToMinusFromKcalMol: Object.is(deltaG, -0) ? 0 : deltaG,
      evidenceSourceIds: sourceIds,
      ...(record.uncertainty === undefined ? {} : {
        uncertainty: parseUncertainty(record.uncertainty, `${field}.uncertainty`, 'kcal/mol'),
      }),
      ...(selectedStructureAtomIds ? { selectedStructureAtomIds } : {}),
    }
  }).sort((left, right) => (
    compareText(left.fromStateId, right.fromStateId)
    || compareText(left.toStateId, right.toStateId)
    || compareText(left.kind, right.kind)
    || compareText(left.id, right.id)
  ))
  if (new Set(edges.map((edge) => edge.id)).size !== edges.length) {
    throw new ZatomMicrostateTransitionGraphInputError(
      'invalid_microstate_transition_graph',
      'graph.edges IDs must be unique',
    )
  }
  const edgePairs = edges.map((edge) => [edge.fromStateId, edge.toStateId].sort(compareText).join('\0'))
  if (new Set(edgePairs).size !== edgePairs.length) {
    throw new ZatomMicrostateTransitionGraphInputError(
      'microstate_duplicate_transition',
      'At most one aggregated thermodynamic edge may connect each unordered state pair',
    )
  }
  if (!edges.some((edge) => edge.kind === 'proton-transfer')) {
    throw new ZatomMicrostateTransitionGraphInputError(
      'microstate_proton_transfer_required',
      'A pH-dependent microstate graph must contain at least one proton-transfer edge',
    )
  }

  let edgeCorrelation: ZatomMicrostateEdgeCorrelationModel | undefined
  let edgeCorrelationMinimumCholeskyDiagonal: number | undefined
  if (root.edgeCorrelation !== undefined) {
    if (edges.length > maxCorrelatedEdges) {
      throw new ZatomMicrostateTransitionGraphInputError(
        'microstate_transition_graph_budget_exceeded',
        `A full edge-correlation matrix is limited to ${maxCorrelatedEdges} edges`,
      )
    }
    if (!edges.every((edge) => edge.uncertainty !== undefined)) {
      throw new ZatomMicrostateTransitionGraphInputError(
        'microstate_edge_correlation_uncertainty_incomplete',
        'A full edge-correlation model requires a native-unit standard deviation on every edge',
      )
    }
    const record = exactObject(root.edgeCorrelation, 'graph.edgeCorrelation', [
      'kind', 'edgeIds', 'correlationMatrix', 'method', 'assumptions', 'scopeWarning',
    ])
    if (record.kind !== 'full-correlation-matrix') {
      throw new ZatomMicrostateTransitionGraphInputError(
        'invalid_microstate_transition_graph',
        'graph.edgeCorrelation.kind must be full-correlation-matrix',
      )
    }
    const inputEdgeIds = uniqueTokenListPreservingOrder(
      record.edgeIds,
      'graph.edgeCorrelation.edgeIds',
      edges.length,
      edges.length,
    )
    const canonicalEdgeIds = edges.map((edge) => edge.id)
    if (inputEdgeIds.some((edgeId) => !canonicalEdgeIds.includes(edgeId))) {
      throw new ZatomMicrostateTransitionGraphInputError(
        'microstate_edge_correlation_coverage_mismatch',
        'graph.edgeCorrelation.edgeIds must cover every canonical edge exactly once',
      )
    }
    if (!Array.isArray(record.correlationMatrix)
      || record.correlationMatrix.length !== edges.length
      || record.correlationMatrix.some((row) => !Array.isArray(row) || row.length !== edges.length)) {
      throw new ZatomMicrostateTransitionGraphInputError(
        'microstate_edge_correlation_shape_mismatch',
        `graph.edgeCorrelation.correlationMatrix must be ${edges.length} by ${edges.length}`,
      )
    }
    const inputMatrix = record.correlationMatrix.map((row, rowIndex) => (
      (row as unknown[]).map((entry, columnIndex) => numberIn(
        entry,
        `graph.edgeCorrelation.correlationMatrix[${rowIndex}][${columnIndex}]`,
        -1,
        1,
      ))
    ))
    for (let row = 0; row < edges.length; row++) {
      if (Math.abs(inputMatrix[row][row] - 1) > 1e-12) {
        throw new ZatomMicrostateTransitionGraphInputError(
          'microstate_edge_correlation_diagonal_mismatch',
          `graph.edgeCorrelation.correlationMatrix diagonal ${row} must equal 1`,
        )
      }
      inputMatrix[row][row] = 1
      for (let column = 0; column < row; column++) {
        if (Math.abs(inputMatrix[row][column] - inputMatrix[column][row]) > 1e-12) {
          throw new ZatomMicrostateTransitionGraphInputError(
            'microstate_edge_correlation_symmetry_mismatch',
            `graph.edgeCorrelation.correlationMatrix differs across [${row},${column}] and [${column},${row}]`,
          )
        }
        const average = (inputMatrix[row][column] + inputMatrix[column][row]) / 2
        inputMatrix[row][column] = Object.is(average, -0) ? 0 : average
        inputMatrix[column][row] = inputMatrix[row][column]
      }
    }
    const inputIndexById = new Map(inputEdgeIds.map((edgeId, index) => [edgeId, index]))
    const correlationMatrix = canonicalEdgeIds.map((rowEdgeId) => canonicalEdgeIds.map((columnEdgeId) => (
      inputMatrix[inputIndexById.get(rowEdgeId)!][inputIndexById.get(columnEdgeId)!]
    )))
    const lower = choleskyLower(
      correlationMatrix,
      'microstate_edge_correlation_not_positive_definite',
      'graph.edgeCorrelation.correlationMatrix',
    )
    edgeCorrelationMinimumCholeskyDiagonal = Math.min(...lower.map((row, index) => row[index]))
    edgeCorrelation = {
      kind: 'full-correlation-matrix',
      edgeIds: canonicalEdgeIds,
      correlationMatrix,
      method: text(record.method, 'graph.edgeCorrelation.method', 2048),
      assumptions: uniqueTextList(record.assumptions, 'graph.edgeCorrelation.assumptions', 1, 64),
      scopeWarning: text(record.scopeWarning, 'graph.edgeCorrelation.scopeWarning', 8192),
    }
  }

  const rawAcceptance = exactObject(
    root.acceptance,
    'graph.acceptance',
    ['maximumCycleClosureResidualLog10'],
  )
  const acceptance = {
    maximumCycleClosureResidualLog10: numberIn(
      rawAcceptance.maximumCycleClosureResidualLog10,
      'graph.acceptance.maximumCycleClosureResidualLog10',
      0,
      10,
    ),
  }

  const rawProvenance = exactObject(root.provenance, 'graph.provenance', [
    'engine', 'engineVersion', 'method', 'parameters', 'citations', 'scopeWarning',
  ])
  if (!isRecord(rawProvenance.parameters)) {
    throw new ZatomMicrostateTransitionGraphInputError(
      'invalid_microstate_transition_graph',
      'graph.provenance.parameters must be an object',
    )
  }
  const provenance: ZatomMicrostateTransitionGraph['provenance'] = {
    engine: text(rawProvenance.engine, 'graph.provenance.engine', 256),
    engineVersion: text(rawProvenance.engineVersion, 'graph.provenance.engineVersion', 256),
    method: text(rawProvenance.method, 'graph.provenance.method', 2048),
    parameters: jsonValue(rawProvenance.parameters, 'graph.provenance.parameters') as Record<string, JsonValue>,
    citations: uniqueTextList(rawProvenance.citations, 'graph.provenance.citations'),
    scopeWarning: text(rawProvenance.scopeWarning, 'graph.provenance.scopeWarning', 8192),
  }
  let metadata: Record<string, JsonValue> | undefined
  if (root.metadata !== undefined) {
    if (!isRecord(root.metadata)) {
      throw new ZatomMicrostateTransitionGraphInputError(
        'invalid_microstate_transition_graph',
        'graph.metadata must be an object',
      )
    }
    metadata = jsonValue(root.metadata, 'graph.metadata') as Record<string, JsonValue>
  }
  const boundedSupplementaryData = {
    provenanceParameters: provenance.parameters,
    metadata,
    edgeCorrelation,
    evidenceStatements: evidenceSources.map((source) => ({
      evidenceStatement: source.evidenceStatement,
      scopeWarning: source.scopeWarning,
      applicability: source.applicability,
    })),
  }
  if (new TextEncoder().encode(JSON.stringify(boundedSupplementaryData)).length > maxMetadataBytes) {
    throw new ZatomMicrostateTransitionGraphInputError(
      'microstate_transition_graph_budget_exceeded',
      `Graph metadata/provenance/evidence text exceeds ${maxMetadataBytes} bytes`,
    )
  }

  const graph: ZatomMicrostateTransitionGraph = {
    schemaVersion: ZATOM_MICROSTATE_TRANSITION_GRAPH_SCHEMA,
    chemicalStateEnsembleFingerprint: ensembleFingerprint,
    conditions,
    completeness,
    states,
    edges,
    evidenceSources,
    ...(edgeCorrelation ? { edgeCorrelation } : {}),
    acceptance,
    provenance,
    ...(metadata ? { metadata } : {}),
  }
  const fingerprint = fingerprintMicrostateTransitionGraph(graph)
  const stateIndexById = new Map(states.map((state, index) => [state.stateId, index]))
  const audit = thermodynamicAudit(graph, stateIndexById)
  const unknownEvidenceCount = evidenceSources.filter((source) => source.applicability.assessment === 'unknown').length
  const outOfDomainEvidenceCount = evidenceSources.filter((source) => source.applicability.assessment === 'out-of-domain').length
  const maximumAbsoluteOffDiagonalCorrelation = edgeCorrelation
    ? edgeCorrelation.correlationMatrix.reduce((maximum, row, rowIndex) => (
        row.reduce((rowMaximum, value, columnIndex) => (
          rowIndex === columnIndex ? rowMaximum : Math.max(rowMaximum, Math.abs(value))
        ), maximum)
      ), 0)
    : 0
  const referencedEvidenceIds = new Set(edges.flatMap((edge) => edge.evidenceSourceIds))
  const unreferencedEvidenceCount = evidenceSources.filter((source) => !referencedEvidenceIds.has(source.id)).length
  if (unreferencedEvidenceCount) {
    throw new ZatomMicrostateTransitionGraphInputError(
      'microstate_edge_evidence_mismatch',
      `${unreferencedEvidenceCount} evidence source(s) are not referenced by any edge`,
    )
  }
  const checks: ValidationCheck[] = [
    {
      id: 'microstate_graph.identity',
      status: 'pass',
      message: `Graph ${fingerprint} is bound to chemical-state ensemble ${ensembleFingerprint}`,
      metrics: { fingerprint, ensembleFingerprint, stateCount: states.length, edgeCount: edges.length },
    },
    {
      id: 'microstate_graph.state_coverage',
      status: 'pass',
      message: 'Graph states cover every canonical ensemble state exactly once in ensemble order',
      metrics: { stateCount: states.length },
    },
    {
      id: 'microstate_graph.proton_charge_ladder',
      status: 'pass',
      message: 'Relative proton counts match explicit H counts and all states share one charge-versus-proton ladder',
      metrics: {
        minimumHydrogenCount,
        maximumRelativeProtonCount: Math.max(...states.map((state) => state.relativeProtonCount)),
        chargeBaseline: chargeBaselines[0],
      },
    },
    {
      id: 'microstate_graph.edge_semantics',
      status: 'pass',
      message: 'Every edge has unique endpoints, valid proton-transfer or isomerization stoichiometry, and referenced evidence',
      metrics: {
        edgeCount: edges.length,
        protonTransferEdgeCount: edges.filter((edge) => edge.kind === 'proton-transfer').length,
        isomerizationEdgeCount: edges.filter((edge) => edge.kind === 'isomerization').length,
      },
    },
    {
      id: 'microstate_graph.connectivity',
      status: audit.componentCount === 1 ? 'pass' : 'fail',
      message: audit.componentCount === 1
        ? 'Every state belongs to one connected thermodynamic graph'
        : `Graph has ${audit.componentCount} disconnected components; their relative populations are undefined`,
      metrics: { componentCount: audit.componentCount },
    },
    {
      id: 'microstate_graph.completeness',
      status: ensemble.enumeration.complete && completeness.transitionsComplete ? 'pass' : 'warn',
      message: ensemble.enumeration.complete && completeness.transitionsComplete
        ? 'State and transition enumeration both declare completion'
        : `Population solving is incomplete: stateComplete=${ensemble.enumeration.complete}, transitionComplete=${completeness.transitionsComplete}; ${completeness.status}`,
      metrics: {
        stateEnumerationComplete: ensemble.enumeration.complete,
        transitionEnumerationComplete: completeness.transitionsComplete,
      },
    },
    {
      id: 'microstate_graph.cycle_closure',
      status: audit.componentCount !== 1 || audit.cycleRank === 0
        ? 'skipped'
        : audit.maximumCycleClosureResidualLog10 <= acceptance.maximumCycleClosureResidualLog10
          ? 'pass'
          : 'fail',
      message: audit.componentCount !== 1
        ? 'Cycle closure is not interpreted for a disconnected graph'
        : audit.cycleRank === 0
          ? 'The connected graph is a tree; no independent thermodynamic cycle exists to test closure'
          : `Maximum fundamental-cycle closure residual is ${audit.maximumCycleClosureResidualLog10} log10 units against ${acceptance.maximumCycleClosureResidualLog10}`,
      metrics: {
        cycleRank: audit.cycleRank,
        maximumCycleClosureResidualLog10: audit.maximumCycleClosureResidualLog10,
        rmsCycleClosureResidualLog10: audit.rmsCycleClosureResidualLog10,
        acceptanceLog10: acceptance.maximumCycleClosureResidualLog10,
      },
    },
    {
      id: 'microstate_graph.edge_uncertainty',
      status: audit.completeEdgeUncertainty ? 'pass' : 'warn',
      message: audit.completeEdgeUncertainty
        ? 'Every thermodynamic edge carries a native-unit standard deviation'
        : `${edges.filter((edge) => edge.uncertainty !== undefined).length}/${edges.length} edges carry uncertainty; complete propagation is unavailable`,
      metrics: {
        edgeCount: edges.length,
        uncertaintyCount: edges.filter((edge) => edge.uncertainty !== undefined).length,
      },
    },
    {
      id: 'microstate_graph.edge_correlation',
      status: edgeCorrelation ? 'pass' : 'skipped',
      message: edgeCorrelation
        ? `Canonical full correlation matrix covers all ${edges.length} edge errors and is numerically positive definite`
        : 'No edge-error correlation model is declared; correlated uncertainty propagation is unavailable',
      metrics: {
        edgeCount: edges.length,
        correlationModelPresent: edgeCorrelation !== undefined,
        maximumAbsoluteOffDiagonalCorrelation,
        ...(edgeCorrelationMinimumCholeskyDiagonal === undefined ? {} : {
          minimumCholeskyDiagonal: edgeCorrelationMinimumCholeskyDiagonal,
        }),
      },
    },
    {
      id: 'microstate_graph.evidence_applicability',
      status: outOfDomainEvidenceCount ? 'fail' : unknownEvidenceCount ? 'warn' : 'pass',
      message: outOfDomainEvidenceCount
        ? `${outOfDomainEvidenceCount} evidence source(s) are declared out-of-domain`
        : unknownEvidenceCount
          ? `${unknownEvidenceCount} evidence source(s) have unknown applicability`
          : 'Every edge evidence source is explicitly assessed in-domain',
      metrics: {
        evidenceSourceCount: evidenceSources.length,
        unknownEvidenceCount,
        outOfDomainEvidenceCount,
      },
    },
    {
      id: 'microstate_graph.population_scope',
      status: 'skipped',
      message: 'A transition graph is thermodynamic evidence, not a population claim until an explicit pH and solver policy are applied',
    },
    {
      id: 'microstate_graph.provenance',
      status: 'pass',
      message: `Graph assembly records ${provenance.engine} ${provenance.engineVersion}, method, parameters, citations, and scope`,
      metrics: { citationCount: provenance.citations.length, evidenceSourceCount: evidenceSources.length },
    },
  ]
  const bounds = boundsOfPositions(structure.atoms.map((atom) => atom.position))
  const localizedAtomIds = [...new Set(edges.flatMap((edge) => edge.selectedStructureAtomIds ?? []))]
  const structureAtomById = new Map(structure.atoms.map((atom) => [atom.id, atom]))
  const localizedAtoms = localizedAtomIds.map((atomId) => structureAtomById.get(atomId)!)
  const localizedBounds = boundsOfPositions(localizedAtoms.map((atom) => atom.position))
  const inspectionTargets: InspectionTarget[] = [
    ...(bounds ? [{
      id: 'microstate-graph-selected-structure',
      reason: `Inspect the exact selected structure ${selectedStateId} anchoring this ${states.length}-state graph`,
      center: bounds.center,
      radius: Math.max(1.5, bounds.radius + 0.5),
      atomIds: structure.atoms.slice(0, 512).map((atom) => atom.id),
      ...(structure.atoms.length > 512 ? { atomIdsTruncated: true as const } : {}),
    }] : []),
    ...(localizedBounds ? [{
      id: 'microstate-graph-selected-state-transitions',
      reason: 'Inspect selected-structure atoms explicitly mapped to incident thermodynamic transitions',
      center: localizedBounds.center,
      radius: Math.max(1, localizedBounds.radius + 1),
      atomIds: localizedAtomIds.slice(0, 512),
      ...(localizedAtomIds.length > 512 ? { atomIdsTruncated: true as const } : {}),
    }] : []),
  ]
  return {
    graph,
    fingerprint,
    chemicalStateEnsemble: ensemble,
    thermodynamicAudit: audit,
    checks,
    inspectionTargets,
  }
}

function solveLinearSystem(matrix: readonly number[][], vector: readonly number[], field: string): number[] {
  const size = vector.length
  const matrixScale = matrix.reduce(
    (maximum, row) => row.reduce((rowMaximum, value) => Math.max(rowMaximum, Math.abs(value)), maximum),
    0,
  )
  if (!Number.isFinite(matrixScale) || matrixScale === 0) {
    throw new ZatomMicrostateTransitionGraphInputError(
      'microstate_population_linear_system_singular',
      `${field} is singular or numerically unresolved`,
    )
  }
  const pivotTolerance = matrixScale * Number.EPSILON * Math.max(32, size * 8)
  const augmented = matrix.map((row, index) => [...row, vector[index]])
  for (let column = 0; column < size; column++) {
    let pivotRow = column
    for (let row = column + 1; row < size; row++) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivotRow][column])) pivotRow = row
    }
    const pivot = augmented[pivotRow][column]
    if (!Number.isFinite(pivot) || Math.abs(pivot) <= pivotTolerance) {
      throw new ZatomMicrostateTransitionGraphInputError(
        'microstate_population_linear_system_singular',
        `${field} is singular or numerically unresolved`,
      )
    }
    ;[augmented[column], augmented[pivotRow]] = [augmented[pivotRow], augmented[column]]
    for (let index = column; index <= size; index++) augmented[column][index] /= pivot
    for (let row = 0; row < size; row++) {
      if (row === column) continue
      const factor = augmented[row][column]
      if (factor === 0) continue
      for (let index = column; index <= size; index++) {
        augmented[row][index] -= factor * augmented[column][index]
      }
    }
  }
  const result = augmented.map((row) => row[size])
  if (result.some((item) => !Number.isFinite(item))) {
    throw new ZatomMicrostateTransitionGraphInputError(
      'microstate_population_linear_system_singular',
      `${field} produced non-finite values`,
    )
  }
  return result
}

function invertMatrix(matrix: readonly number[][]): number[][] {
  const size = matrix.length
  const matrixScale = matrix.reduce(
    (maximum, row) => row.reduce((rowMaximum, value) => Math.max(rowMaximum, Math.abs(value)), maximum),
    0,
  )
  if (!Number.isFinite(matrixScale) || matrixScale === 0) {
    throw new ZatomMicrostateTransitionGraphInputError(
      'microstate_population_linear_system_singular',
      'microstate population covariance is singular or numerically unresolved',
    )
  }
  const pivotTolerance = matrixScale * Number.EPSILON * Math.max(32, size * 8)
  const augmented = matrix.map((row, rowIndex) => [
    ...row,
    ...Array.from({ length: size }, (_, columnIndex) => rowIndex === columnIndex ? 1 : 0),
  ])
  for (let column = 0; column < size; column++) {
    let pivotRow = column
    for (let row = column + 1; row < size; row++) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivotRow][column])) pivotRow = row
    }
    const pivot = augmented[pivotRow][column]
    if (!Number.isFinite(pivot) || Math.abs(pivot) <= pivotTolerance) {
      throw new ZatomMicrostateTransitionGraphInputError(
        'microstate_population_linear_system_singular',
        'microstate population covariance is singular or numerically unresolved',
      )
    }
    ;[augmented[column], augmented[pivotRow]] = [augmented[pivotRow], augmented[column]]
    for (let index = 0; index < size * 2; index++) augmented[column][index] /= pivot
    for (let row = 0; row < size; row++) {
      if (row === column) continue
      const factor = augmented[row][column]
      if (factor === 0) continue
      for (let index = 0; index < size * 2; index++) {
        augmented[row][index] -= factor * augmented[column][index]
      }
    }
  }
  const inverse = augmented.map((row) => row.slice(size))
  if (inverse.some((row) => row.some((value) => !Number.isFinite(value)))) {
    throw new ZatomMicrostateTransitionGraphInputError(
      'microstate_population_linear_system_singular',
      'microstate population covariance produced non-finite values',
    )
  }
  return inverse
}

/** Lower-level canonical fit shared by the single-pH and bounded titration solvers. */
export interface ZatomMicrostateEquilibriumFit {
  log10Weights: number[]
  edgeResiduals: number[]
  covariance?: number[][]
}

/** @internal Call only after the graph population preconditions have passed. */
export function fitMicrostateEquilibriumPotentials(
  graph: ZatomMicrostateTransitionGraph,
  pH: number,
  uncertaintyMode: ZatomMicrostateUncertaintyMode,
): ZatomMicrostateEquilibriumFit {
  const gaussianMode = uncertaintyMode === 'independent-gaussian-delta-method'
    || uncertaintyMode === 'correlated-gaussian-delta-method'
  const stateIndexById = new Map(graph.states.map((state, index) => [state.stateId, index]))
  const dimension = graph.states.length - 1
  const normal = Array.from({ length: dimension }, () => Array.from({ length: dimension }, () => 0))
  const rhs = Array.from({ length: dimension }, () => 0)
  if (uncertaintyMode === 'correlated-gaussian-delta-method') {
    const design = graph.edges.map((edge) => {
      const row = Array.from({ length: dimension }, () => 0)
      const from = stateIndexById.get(edge.fromStateId)!
      const to = stateIndexById.get(edge.toStateId)!
      const sigma = edgeSigmaLog10(edge, graph.conditions)!
      if (from !== 0) row[from - 1] = -1 / sigma
      if (to !== 0) row[to - 1] = 1 / sigma
      return row
    })
    const standardizedTargets = graph.edges.map((edge) => (
      edgeLog10Ratio(edge, graph.conditions, pH) / edgeSigmaLog10(edge, graph.conditions)!
    ))
    const lower = choleskyLower(
      graph.edgeCorrelation!.correlationMatrix,
      'microstate_population_correlation_not_positive_definite',
      'canonical edge-error correlation matrix',
    )
    const whitenedTargets = solveLowerTriangular(lower, standardizedTargets)
    const whitenedDesign = graph.edges.map(() => Array.from({ length: dimension }, () => 0))
    for (let column = 0; column < dimension; column++) {
      const whitenedColumn = solveLowerTriangular(lower, design.map((row) => row[column]))
      for (let row = 0; row < graph.edges.length; row++) whitenedDesign[row][column] = whitenedColumn[row]
    }
    for (let observation = 0; observation < graph.edges.length; observation++) {
      for (let row = 0; row < dimension; row++) {
        const rowCoefficient = whitenedDesign[observation][row]
        if (rowCoefficient === 0) continue
        rhs[row] += rowCoefficient * whitenedTargets[observation]
        for (let column = 0; column < dimension; column++) {
          normal[row][column] += rowCoefficient * whitenedDesign[observation][column]
        }
      }
    }
  } else {
    for (const edge of graph.edges) {
      const from = stateIndexById.get(edge.fromStateId)!
      const to = stateIndexById.get(edge.toStateId)!
      const target = edgeLog10Ratio(edge, graph.conditions, pH)
      const sigma = edgeSigmaLog10(edge, graph.conditions)
      const weight = uncertaintyMode === 'independent-gaussian-delta-method' ? 1 / (sigma! ** 2) : 1
      const coefficients: Array<[number, number]> = []
      if (from !== 0) coefficients.push([from - 1, -1])
      if (to !== 0) coefficients.push([to - 1, 1])
      for (const [row, rowCoefficient] of coefficients) {
        rhs[row] += weight * rowCoefficient * target
        for (const [column, columnCoefficient] of coefficients) {
          normal[row][column] += weight * rowCoefficient * columnCoefficient
        }
      }
    }
  }
  const solved = solveLinearSystem(normal, rhs, 'microstate equilibrium graph')
  const log10Weights = [0, ...solved]
  const edgeResiduals = graph.edges.map((edge) => {
    const from = stateIndexById.get(edge.fromStateId)!
    const to = stateIndexById.get(edge.toStateId)!
    return log10Weights[to] - log10Weights[from] - edgeLog10Ratio(edge, graph.conditions, pH)
  })
  return {
    log10Weights,
    edgeResiduals,
    ...(gaussianMode ? { covariance: invertMatrix(normal) } : {}),
  }
}

/** @internal Stable base-10 softmax used by population consumers. */
export function normalizedMicrostatePopulations(log10Weights: readonly number[]): number[] {
  const maximum = Math.max(...log10Weights)
  const weights = log10Weights.map((value) => Math.exp((value - maximum) * LN_10))
  const sum = weights.reduce((result, value) => result + value, 0)
  if (!Number.isFinite(sum) || sum <= 0) {
    throw new ZatomMicrostateTransitionGraphInputError(
      'microstate_population_normalization_failed',
      'Microstate equilibrium weights could not be normalized',
    )
  }
  const fractions = weights.map((value) => value / sum)
  const normalizedSum = fractions.reduce((result, value) => result + value, 0)
  fractions[fractions.length - 1] += 1 - normalizedSum
  return fractions
}

/** @internal First-order normalized-population propagation in the gauge-fixed log10 basis. */
export function microstatePopulationStandardDeviations(
  populations: readonly number[],
  covariance: readonly number[][],
): number[] {
  const dimension = populations.length - 1
  const variablePopulations = populations.slice(1)
  const covarianceTimesPopulation = Array.from({ length: dimension }, (_, row) => (
    covariance[row].reduce((sum, value, column) => sum + value * variablePopulations[column], 0)
  ))
  const populationQuadratic = variablePopulations.reduce((sum, value, index) => (
    sum + value * covarianceTimesPopulation[index]
  ), 0)
  return populations.map((population, stateIndex) => {
    const variableIndex = stateIndex - 1
    const bracket = populationQuadratic + (stateIndex === 0
      ? 0
      : covariance[variableIndex][variableIndex] - 2 * covarianceTimesPopulation[variableIndex])
    const variance = (LN_10 * population) ** 2 * bracket
    if (!Number.isFinite(variance)) {
      throw new ZatomMicrostateTransitionGraphInputError(
        'microstate_population_uncertainty_failed',
        'Population uncertainty propagation produced a non-finite variance',
      )
    }
    return Math.sqrt(Math.max(0, variance))
  })
}

function weightedQuantile(
  values: readonly number[],
  weights: readonly number[],
  probability: number,
): number {
  const ordered = values.map((value, index) => ({ value, weight: weights[index], index }))
    .sort((left, right) => left.value - right.value || left.index - right.index)
  let cumulative = 0
  for (const item of ordered) {
    cumulative += item.weight
    if (cumulative + 1e-15 >= probability) return item.value
  }
  return ordered[ordered.length - 1].value
}

/** @internal Weighted summaries of a complete joint-sample matrix, one row per sample. */
export function summarizeMicrostateSampleMatrix(
  sampleRows: readonly (readonly number[])[],
  weights: readonly number[],
  intervalProbability: number,
): ZatomMicrostateSampleUncertaintySummary[] {
  if (!sampleRows.length || sampleRows.length !== weights.length
    || sampleRows[0].length === 0
    || sampleRows.some((row) => (
      row.length !== sampleRows[0].length || row.some((value) => !Number.isFinite(value))
    ))) {
    throw new ZatomMicrostateTransitionGraphInputError(
      'microstate_population_sample_summary_failed',
      'Joint sample matrix must have consistent non-empty dimensions and finite values',
    )
  }
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0)
  if (weights.some((weight) => !Number.isFinite(weight) || weight <= 0)
    || Math.abs(weightSum - 1) > 1e-10
    || !Number.isFinite(intervalProbability)
    || intervalProbability < 0.5
    || intervalProbability > 0.999999) {
    throw new ZatomMicrostateTransitionGraphInputError(
      'microstate_population_sample_summary_failed',
      'Joint sample weights must be finite, positive, and normalized, and interval probability must be from 0.5 through 0.999999',
    )
  }
  const lowerProbability = (1 - intervalProbability) / 2
  const upperProbability = 1 - lowerProbability
  return Array.from({ length: sampleRows[0].length }, (_, column) => {
    const values = sampleRows.map((row) => row[column])
    const mean = values.reduce((sum, value, index) => sum + weights[index] * value, 0)
    const variance = values.reduce((sum, value, index) => sum + weights[index] * (value - mean) ** 2, 0)
    if (!Number.isFinite(mean) || !Number.isFinite(variance)) {
      throw new ZatomMicrostateTransitionGraphInputError(
        'microstate_population_sample_summary_failed',
        'Joint sample summary produced a non-finite mean or variance',
      )
    }
    return {
      mean,
      standardDeviation: Math.sqrt(Math.max(0, variance)),
      median: weightedQuantile(values, weights, 0.5),
      lowerQuantile: weightedQuantile(values, weights, lowerProbability),
      upperQuantile: weightedQuantile(values, weights, upperProbability),
      intervalProbability,
    }
  })
}

/** @internal Apply the exact proton-count pH shift to every joint intrinsic-potential sample. */
export function microstatePotentialEnsemblePopulationRows(
  graph: ZatomMicrostateTransitionGraph,
  potentialEnsemble: ZatomMicrostateEquilibriumPotentialEnsemble,
  pH: number,
): number[][] {
  const referenceProtonCount = graph.states[0].relativeProtonCount
  return potentialEnsemble.samples.map((sample) => normalizedMicrostatePopulations(
    sample.log10WeightsRelativeToReference.map((potential, stateIndex) => (
      potential + (referenceProtonCount - graph.states[stateIndex].relativeProtonCount) * pH
    )),
  ))
}

export interface ZatomMicrostatePopulationPreconditions {
  validation: ZatomMicrostateTransitionGraphValidation
  graph: ZatomMicrostateTransitionGraph
  ensemble: ZatomChemicalStateEnsemble
  pH: number
  maximumCycleClosureResidualLog10: number
  requireCompleteGraph: boolean
  allowUnknownApplicability: boolean
  uncertaintyMode: ZatomMicrostateUncertaintyMode
  stateCoverageValidation?: ZatomMicrostateStateCoverageValidation
  equilibriumPotentialEnsembleValidation?: ZatomMicrostateEquilibriumPotentialEnsembleValidation
  potentialSampleDiagnosticsValidation?: ZatomMicrostatePotentialSampleDiagnosticsValidation
  sampleIntervalProbability?: number
  minimumSampleWeightEffectiveSize?: number
  sampleDiagnosticsPolicy?: ZatomMicrostateSampleDiagnosticsPolicy
}

/** @internal Shared fail-closed policy gate for every population-producing operation. */
export function validateMicrostatePopulationPreconditions(
  value: unknown,
  options: SolveZatomMicrostatePopulationsOptions,
): ZatomMicrostatePopulationPreconditions {
  const validation = parseZatomMicrostateTransitionGraph(value, options)
  const graph = validation.graph
  const ensemble = validation.chemicalStateEnsemble
  const pH = numberIn(options.pH, 'populationSolver.pH', 0, 14)
  const maximumCycleClosureResidualLog10 = numberIn(
    options.maximumCycleClosureResidualLog10,
    'populationSolver.maximumCycleClosureResidualLog10',
    0,
    graph.acceptance.maximumCycleClosureResidualLog10,
  )
  if (typeof options.requireCompleteGraph !== 'boolean'
    || typeof options.allowUnknownApplicability !== 'boolean') {
    throw new ZatomMicrostateTransitionGraphInputError(
      'invalid_microstate_population_options',
      'requireCompleteGraph and allowUnknownApplicability must be explicit booleans',
    )
  }
  if (!new Set<ZatomMicrostateUncertaintyMode>([
    'none',
    'independent-gaussian-delta-method',
    'correlated-gaussian-delta-method',
    'equilibrium-potential-sample-ensemble',
  ]).has(options.uncertaintyMode)) {
    throw new ZatomMicrostateTransitionGraphInputError(
      'invalid_microstate_population_options',
      'populationSolver.uncertaintyMode is unsupported',
    )
  }
  if (validation.thermodynamicAudit.componentCount !== 1) {
    throw new ZatomMicrostateTransitionGraphInputError(
      'microstate_population_graph_disconnected',
      'Cannot normalize relative populations across disconnected graph components',
    )
  }
  if (options.requireCompleteGraph
    && (!ensemble.enumeration.complete || !graph.completeness.transitionsComplete)) {
    throw new ZatomMicrostateTransitionGraphInputError(
      'microstate_population_graph_incomplete',
      'Strict population solving requires complete state and transition enumeration',
    )
  }
  if (validation.thermodynamicAudit.cycleRank > 0
    && validation.thermodynamicAudit.maximumCycleClosureResidualLog10 > maximumCycleClosureResidualLog10) {
    throw new ZatomMicrostateTransitionGraphInputError(
      'microstate_population_cycle_closure_failed',
      `Fundamental-cycle residual ${validation.thermodynamicAudit.maximumCycleClosureResidualLog10} exceeds ${maximumCycleClosureResidualLog10} log10 units`,
    )
  }
  const outOfDomainSources = graph.evidenceSources.filter((source) => source.applicability.assessment === 'out-of-domain')
  const unknownSources = graph.evidenceSources.filter((source) => source.applicability.assessment === 'unknown')
  if (outOfDomainSources.length) {
    throw new ZatomMicrostateTransitionGraphInputError(
      'microstate_population_evidence_out_of_domain',
      `Cannot solve populations from ${outOfDomainSources.length} out-of-domain evidence source(s)`,
    )
  }
  if (unknownSources.length && !options.allowUnknownApplicability) {
    throw new ZatomMicrostateTransitionGraphInputError(
      'microstate_population_applicability_unknown',
      `${unknownSources.length} evidence source(s) have unknown applicability; explicit acceptance is required`,
    )
  }
  let stateCoverageValidation: ZatomMicrostateStateCoverageValidation | undefined
  if (options.stateCoverage !== undefined) {
    stateCoverageValidation = parseZatomMicrostateStateCoverage(options.stateCoverage, {
      chemicalStateEnsembleFingerprint: graph.chemicalStateEnsembleFingerprint,
      microstateTransitionGraphFingerprint: validation.fingerprint,
      stateEnumerationComplete: ensemble.enumeration.complete,
      returnedStateCount: graph.states.length,
    })
    const coverage = stateCoverageValidation.coverage
    if (pH < coverage.pHDomain.minimum || pH > coverage.pHDomain.maximum) {
      throw new ZatomMicrostateTransitionGraphInputError(
        'microstate_state_coverage_ph_outside_domain',
        `Population pH ${pH} lies outside coverage domain ${coverage.pHDomain.minimum}-${coverage.pHDomain.maximum}`,
      )
    }
    const coverageApplicability = coverage.assessment.applicability.assessment
    if (coverageApplicability === 'out-of-domain') {
      throw new ZatomMicrostateTransitionGraphInputError(
        'microstate_state_coverage_out_of_domain',
        'Cannot use an out-of-domain state-coverage assessment',
      )
    }
    if (coverageApplicability === 'unknown' && !options.allowUnknownApplicability) {
      throw new ZatomMicrostateTransitionGraphInputError(
        'microstate_state_coverage_applicability_unknown',
        'State-coverage applicability is unknown; explicit acceptance is required',
      )
    }
  }
  const gaussianUncertaintyMode = options.uncertaintyMode === 'independent-gaussian-delta-method'
    || options.uncertaintyMode === 'correlated-gaussian-delta-method'
  if (gaussianUncertaintyMode
    && !validation.thermodynamicAudit.completeEdgeUncertainty) {
    throw new ZatomMicrostateTransitionGraphInputError(
      'microstate_population_uncertainty_incomplete',
      'Gaussian propagation requires a native-unit standard deviation on every edge',
    )
  }
  if (options.uncertaintyMode === 'correlated-gaussian-delta-method' && !graph.edgeCorrelation) {
    throw new ZatomMicrostateTransitionGraphInputError(
      'microstate_population_correlation_model_required',
      'Correlated-Gaussian propagation requires a canonical full edge-correlation model',
    )
  }
  if (options.uncertaintyMode === 'independent-gaussian-delta-method' && graph.edgeCorrelation) {
    throw new ZatomMicrostateTransitionGraphInputError(
      'microstate_population_correlation_cannot_be_ignored',
      'The graph declares edge-error correlations; choose correlated-gaussian-delta-method or make no uncertainty claim',
    )
  }
  let equilibriumPotentialEnsembleValidation: ZatomMicrostateEquilibriumPotentialEnsembleValidation | undefined
  let potentialSampleDiagnosticsValidation: ZatomMicrostatePotentialSampleDiagnosticsValidation | undefined
  let sampleIntervalProbability: number | undefined
  let minimumSampleWeightEffectiveSize: number | undefined
  let sampleDiagnosticsPolicy: ZatomMicrostateSampleDiagnosticsPolicy | undefined
  if (options.uncertaintyMode === 'equilibrium-potential-sample-ensemble') {
    if (options.equilibriumPotentialEnsemble === undefined
      || options.sampleIntervalProbability === undefined
      || options.minimumSampleWeightEffectiveSize === undefined
      || options.sampleDiagnosticsPolicy === undefined) {
      throw new ZatomMicrostateTransitionGraphInputError(
        'microstate_population_potential_ensemble_options_required',
        'Sample-ensemble uncertainty requires equilibriumPotentialEnsemble, sampleIntervalProbability, minimumSampleWeightEffectiveSize, and sampleDiagnosticsPolicy',
      )
    }
    equilibriumPotentialEnsembleValidation = parseZatomMicrostateEquilibriumPotentialEnsemble(
      options.equilibriumPotentialEnsemble,
      {
        chemicalStateEnsembleFingerprint: graph.chemicalStateEnsembleFingerprint,
        microstateTransitionGraphFingerprint: validation.fingerprint,
        canonicalStateIds: graph.states.map((state) => state.stateId),
        referenceStateId: graph.states[0].stateId,
      },
    )
    const potentialEnsemble = equilibriumPotentialEnsembleValidation.ensemble
    if (pH < potentialEnsemble.pHDomain.minimum || pH > potentialEnsemble.pHDomain.maximum) {
      throw new ZatomMicrostateTransitionGraphInputError(
        'microstate_potential_ensemble_ph_outside_domain',
        `Population pH ${pH} lies outside potential-ensemble domain ${potentialEnsemble.pHDomain.minimum}-${potentialEnsemble.pHDomain.maximum}`,
      )
    }
    const applicability = potentialEnsemble.uncertaintyModel.applicability.assessment
    if (applicability === 'out-of-domain') {
      throw new ZatomMicrostateTransitionGraphInputError(
        'microstate_potential_ensemble_out_of_domain',
        'Cannot propagate an out-of-domain equilibrium-potential ensemble',
      )
    }
    if (applicability === 'unknown' && !options.allowUnknownApplicability) {
      throw new ZatomMicrostateTransitionGraphInputError(
        'microstate_potential_ensemble_applicability_unknown',
        'Equilibrium-potential ensemble applicability is unknown; explicit acceptance is required',
      )
    }
    sampleIntervalProbability = numberIn(
      options.sampleIntervalProbability,
      'populationSolver.sampleIntervalProbability',
      0.5,
      0.999999,
    )
    minimumSampleWeightEffectiveSize = numberIn(
      options.minimumSampleWeightEffectiveSize,
      'populationSolver.minimumSampleWeightEffectiveSize',
      potentialEnsemble.acceptance.minimumWeightEffectiveSampleSize,
      equilibriumPotentialEnsembleValidation.weightEffectiveSampleSize,
    )
    if (options.sampleDiagnosticsPolicy !== 'require-pass'
      && options.sampleDiagnosticsPolicy !== 'allow-missing') {
      throw new ZatomMicrostateTransitionGraphInputError(
        'invalid_microstate_population_options',
        'populationSolver.sampleDiagnosticsPolicy must be require-pass or allow-missing',
      )
    }
    sampleDiagnosticsPolicy = options.sampleDiagnosticsPolicy
    if (options.potentialSampleDiagnostics !== undefined) {
      potentialSampleDiagnosticsValidation = parseZatomMicrostatePotentialSampleDiagnostics(
        options.potentialSampleDiagnostics,
        { potentialEnsembleValidation: equilibriumPotentialEnsembleValidation },
      )
      if (!potentialSampleDiagnosticsValidation.diagnostics.overallPassed) {
        throw new ZatomMicrostateTransitionGraphInputError(
          'microstate_population_sample_diagnostics_failed',
          'Potential-sample diagnostics fail one or more declared MCMC convergence gates',
        )
      }
    } else if (sampleDiagnosticsPolicy === 'require-pass') {
      throw new ZatomMicrostateTransitionGraphInputError(
        'microstate_population_sample_diagnostics_required',
        'sampleDiagnosticsPolicy=require-pass requires a passing potentialSampleDiagnostics artifact',
      )
    }
  } else if (options.equilibriumPotentialEnsemble !== undefined
    || options.sampleIntervalProbability !== undefined
    || options.minimumSampleWeightEffectiveSize !== undefined
    || options.sampleDiagnosticsPolicy !== undefined
    || options.potentialSampleDiagnostics !== undefined) {
    throw new ZatomMicrostateTransitionGraphInputError(
      'microstate_population_potential_ensemble_unused',
      'Potential-ensemble inputs are allowed only with equilibrium-potential-sample-ensemble uncertainty mode',
    )
  }

  return {
    validation,
    graph,
    ensemble,
    pH,
    maximumCycleClosureResidualLog10,
    requireCompleteGraph: options.requireCompleteGraph,
    allowUnknownApplicability: options.allowUnknownApplicability,
    uncertaintyMode: options.uncertaintyMode,
    ...(stateCoverageValidation ? { stateCoverageValidation } : {}),
    ...(equilibriumPotentialEnsembleValidation ? { equilibriumPotentialEnsembleValidation } : {}),
    ...(potentialSampleDiagnosticsValidation ? { potentialSampleDiagnosticsValidation } : {}),
    ...(sampleIntervalProbability === undefined ? {} : { sampleIntervalProbability }),
    ...(minimumSampleWeightEffectiveSize === undefined ? {} : { minimumSampleWeightEffectiveSize }),
    ...(sampleDiagnosticsPolicy === undefined ? {} : { sampleDiagnosticsPolicy }),
  }
}

export interface ResolvedMicrostatePopulationScope {
  scope: ZatomMicrostatePopulationScope
  stateBounds?: ZatomMicrostateCensoringBounds[]
}

/** @internal Resolve state-censoring semantics separately from edge-parameter uncertainty. */
export function resolveMicrostatePopulationScope(
  ensemble: ZatomChemicalStateEnsemble,
  coverageValidation: ZatomMicrostateStateCoverageValidation | undefined,
  fractions: readonly number[],
  maximumPopulationStateIds: string[],
): ResolvedMicrostatePopulationScope {
  if (ensemble.enumeration.complete) {
    return {
      scope: {
        normalization: 'complete-state-universe',
        coverageAssessment: 'complete',
        ...(coverageValidation ? {
          stateCoverageFingerprint: coverageValidation.fingerprint,
          pHDomain: coverageValidation.coverage.pHDomain,
        } : {}),
        totalOmittedFractionBounds: { minimum: 0, maximum: 0 },
        retainedUniverseFractionBounds: { minimum: 1, maximum: 1 },
        maximumPopulationScope: 'complete-state-universe',
        globalMaximumCertified: true,
        globalMaximumStateIds: maximumPopulationStateIds,
      },
      stateBounds: fractions.map((fraction) => ({ minimum: fraction, maximum: fraction })),
    }
  }
  const coverage = coverageValidation?.coverage
  const upperBound = coverage?.assessment.kind === 'bounded-total-omitted-fraction'
    ? coverage.assessment.totalOmittedFractionUpperBound
    : undefined
  if (upperBound === undefined) {
    return {
      scope: {
        normalization: 'conditional-on-returned-states',
        coverageAssessment: 'unknown',
        ...(coverageValidation ? {
          stateCoverageFingerprint: coverageValidation.fingerprint,
          pHDomain: coverageValidation.coverage.pHDomain,
        } : {}),
        maximumPopulationScope: 'returned-states-only',
        globalMaximumCertified: false,
      },
    }
  }
  const maximumConditionalFraction = Math.max(...fractions)
  const globalMaximumCertified = maximumConditionalFraction * (1 - upperBound) > upperBound + 1e-15
  return {
    scope: {
      normalization: 'conditional-on-returned-states',
      coverageAssessment: 'bounded',
      stateCoverageFingerprint: coverageValidation!.fingerprint,
      pHDomain: coverage!.pHDomain,
      totalOmittedFractionBounds: { minimum: 0, maximum: upperBound },
      retainedUniverseFractionBounds: { minimum: 1 - upperBound, maximum: 1 },
      maximumPopulationScope: globalMaximumCertified ? 'complete-state-universe' : 'returned-states-only',
      globalMaximumCertified,
      ...(globalMaximumCertified ? { globalMaximumStateIds: maximumPopulationStateIds } : {}),
    },
    stateBounds: fractions.map((fraction) => ({
      minimum: fraction * (1 - upperBound),
      maximum: fraction,
    })),
  }
}

export function solveZatomMicrostatePopulations(
  value: unknown,
  options: SolveZatomMicrostatePopulationsOptions,
): ZatomMicrostatePopulationSolveResult {
  const preconditions = validateMicrostatePopulationPreconditions(value, options)
  const {
    validation,
    graph,
    ensemble,
    pH,
    maximumCycleClosureResidualLog10,
    stateCoverageValidation,
    equilibriumPotentialEnsembleValidation,
    potentialSampleDiagnosticsValidation,
    sampleIntervalProbability,
    minimumSampleWeightEffectiveSize,
    sampleDiagnosticsPolicy,
  } = preconditions

  const fit = fitMicrostateEquilibriumPotentials(graph, pH, options.uncertaintyMode)
  const fractions = normalizedMicrostatePopulations(fit.log10Weights)
  const samplePopulationRows = equilibriumPotentialEnsembleValidation
    ? microstatePotentialEnsemblePopulationRows(
        graph,
        equilibriumPotentialEnsembleValidation.ensemble,
        pH,
      )
    : undefined
  const sampleSummaries = samplePopulationRows
    ? summarizeMicrostateSampleMatrix(
        samplePopulationRows,
        equilibriumPotentialEnsembleValidation!.ensemble.samples.map((sample) => sample.weight),
        sampleIntervalProbability!,
      )
    : undefined
  const standardDeviations = fit.covariance
    ? microstatePopulationStandardDeviations(fractions, fit.covariance)
    : sampleSummaries?.map((summary) => summary.standardDeviation)
  const maximumEdgeFitResidual = fit.edgeResiduals.reduce((result, value) => Math.max(result, Math.abs(value)), 0)
  const rmsEdgeFitResidual = Math.sqrt(
    fit.edgeResiduals.reduce((sum, value) => sum + value ** 2, 0) / fit.edgeResiduals.length,
  )
  const maximumFraction = Math.max(...fractions)
  const maximumPopulationStateIds = graph.states
    .filter((_, index) => fractions[index] + 1e-12 >= maximumFraction)
    .map((state) => state.stateId)
  const resolvedPopulationScope = resolveMicrostatePopulationScope(
    ensemble,
    stateCoverageValidation,
    fractions,
    maximumPopulationStateIds,
  )
  const uncertaintyAssumptions = options.uncertaintyMode === 'independent-gaussian-delta-method'
    ? [
        'Every native-unit edge standard deviation is treated as Gaussian.',
        'Edge errors are treated as mutually independent even when evidence sources share a model or dataset.',
        'Population standard deviations use first-order delta-method propagation through normalization.',
      ]
    : options.uncertaintyMode === 'correlated-gaussian-delta-method'
      ? [
          'Every native-unit edge standard deviation is treated as Gaussian.',
          'The declared full positive-definite edge correlation matrix is treated as exact for generalized least squares.',
          ...graph.edgeCorrelation!.assumptions.map((assumption) => `Correlation model: ${assumption}`),
          'Population standard deviations use first-order delta-method propagation through normalization.',
        ]
      : options.uncertaintyMode === 'equilibrium-potential-sample-ensemble'
        ? [
            'Every sample is treated as one complete joint draw or replicate of all gauge-fixed intrinsic state potentials.',
            'Sample weights and the declared sampling/bootstrap/model-ensemble construction are treated as the uncertainty distribution.',
            ...equilibriumPotentialEnsembleValidation!.ensemble.uncertaintyModel.assumptions
              .map((assumption) => `Potential ensemble: ${assumption}`),
            'Population summaries use direct nonlinear normalization of every joint sample, without Gaussian or first-order approximation.',
            potentialSampleDiagnosticsValidation
              ? 'Every non-reference state passed the bound multi-chain split-R-hat and autocorrelation-ESS gates.'
              : 'Multi-chain dependence/convergence diagnostics were explicitly allowed to be missing.',
        ]
        : []
  const solutionCitations = [...new Set([
    ...graph.provenance.citations,
    ...(equilibriumPotentialEnsembleValidation?.ensemble.provenance.citations ?? []),
    ...(potentialSampleDiagnosticsValidation?.diagnostics.provenance.citations ?? []),
  ])].sort(compareText)
  const scopeWarning = [
    `Populations assume equilibrium across the declared ${graph.states.length}-state/${graph.edges.length}-edge graph at pH ${pH}.`,
    options.requireCompleteGraph
      ? 'State and transition enumeration were required complete.'
      : resolvedPopulationScope.scope.coverageAssessment === 'bounded'
        ? `Incomplete enumeration was explicitly accepted; the separately validated pointwise total omitted-population bound is ${resolvedPopulationScope.scope.totalOmittedFractionBounds!.maximum}.`
        : resolvedPopulationScope.scope.coverageAssessment === 'unknown'
          ? 'Incomplete enumeration was explicitly accepted; total omitted population is unknown and returned fractions are conditional only.'
          : 'Enumeration is complete, although strict graph completeness was not required.',
    validation.thermodynamicAudit.cycleRank === 0
      ? 'The graph has no independent cycle, so thermodynamic closure could not be cross-validated.'
      : `Fundamental-cycle closure was gated at ${maximumCycleClosureResidualLog10} log10 units.`,
    options.uncertaintyMode === 'none'
      ? 'No population uncertainty is claimed.'
      : options.uncertaintyMode === 'independent-gaussian-delta-method'
        ? 'Reported standard deviations depend on the explicit independent-Gaussian and first-order assumptions.'
        : options.uncertaintyMode === 'correlated-gaussian-delta-method'
          ? 'Reported standard deviations depend on the declared correlated-Gaussian matrix and first-order assumptions.'
          : `Reported weighted quantiles and standard deviations depend on the declared ${equilibriumPotentialEnsembleValidation!.ensemble.uncertaintyModel.kind} joint-potential ensemble; its Kish weight ESS does not diagnose sample autocorrelation or convergence.`,
    ...(options.uncertaintyMode === 'correlated-gaussian-delta-method'
      ? [`Correlation-model scope: ${graph.edgeCorrelation!.scopeWarning}`]
      : []),
    ...(options.uncertaintyMode === 'equilibrium-potential-sample-ensemble'
      ? [
          `Potential-ensemble model scope: ${equilibriumPotentialEnsembleValidation!.ensemble.uncertaintyModel.scopeWarning}`,
          `Potential-ensemble provenance scope: ${equilibriumPotentialEnsembleValidation!.ensemble.provenance.scopeWarning}`,
          potentialSampleDiagnosticsValidation
            ? `Potential-sample diagnostics scope: ${potentialSampleDiagnosticsValidation.diagnostics.design.scopeWarning} ${potentialSampleDiagnosticsValidation.diagnostics.provenance.scopeWarning}`
            : 'Potential-sample multi-chain dependence and convergence diagnostics are missing by explicit policy; weighted summaries are descriptive for the supplied empirical sample only.',
        ]
      : []),
    'Equilibrium fractions do not establish kinetic accessibility, barriers, sampling convergence, chemical correctness, or model applicability beyond the recorded evidence.',
  ].join(' ')
  const solution: ZatomMicrostatePopulationSolution = {
    schemaVersion: ZATOM_MICROSTATE_POPULATION_SOLUTION_SCHEMA,
    graphFingerprint: validation.fingerprint,
    chemicalStateEnsembleFingerprint: graph.chemicalStateEnsembleFingerprint,
    conditions: { ...graph.conditions, pH },
    solver: {
      method: options.uncertaintyMode === 'correlated-gaussian-delta-method'
        ? 'log-equilibrium-graph-generalized-least-squares'
        : 'log-equilibrium-graph-least-squares',
      uncertaintyMode: options.uncertaintyMode,
      requireCompleteGraph: options.requireCompleteGraph,
      allowUnknownApplicability: options.allowUnknownApplicability,
      maximumCycleClosureResidualLog10,
      referenceStateId: graph.states[0].stateId,
      ...(equilibriumPotentialEnsembleValidation ? {
        equilibriumPotentialEnsembleFingerprint: equilibriumPotentialEnsembleValidation.fingerprint,
        sampleIntervalProbability: sampleIntervalProbability!,
        minimumSampleWeightEffectiveSize: minimumSampleWeightEffectiveSize!,
        sampleDiagnosticsPolicy: sampleDiagnosticsPolicy!,
        ...(potentialSampleDiagnosticsValidation ? {
          potentialSampleDiagnosticsFingerprint: potentialSampleDiagnosticsValidation.fingerprint,
        } : {}),
      } : {}),
    },
    fit: {
      stateCount: graph.states.length,
      edgeCount: graph.edges.length,
      cycleRank: validation.thermodynamicAudit.cycleRank,
      maximumFundamentalCycleResidualLog10: validation.thermodynamicAudit.maximumCycleClosureResidualLog10,
      maximumEdgeFitResidualLog10: maximumEdgeFitResidual,
      rmsEdgeFitResidualLog10: rmsEdgeFitResidual,
    },
    populationScope: resolvedPopulationScope.scope,
    populations: graph.states.map((state, index) => ({
      stateId: state.stateId,
      fraction: fractions[index],
      log10WeightRelativeToReference: fit.log10Weights[index],
      ...(standardDeviations ? { standardDeviation: standardDeviations[index] } : {}),
      ...(sampleSummaries ? { sampleUncertainty: sampleSummaries[index] } : {}),
      ...(resolvedPopulationScope.stateBounds ? {
        censoringBounds: resolvedPopulationScope.stateBounds[index],
      } : {}),
    })),
    maximumPopulationStateIds,
    ...(options.uncertaintyMode !== 'none' ? {
      uncertainty: {
        method: options.uncertaintyMode === 'correlated-gaussian-delta-method'
          ? 'generalized-least-squares-correlated-gaussian-edge-errors-delta-method'
          : options.uncertaintyMode === 'equilibrium-potential-sample-ensemble'
            ? 'weighted-joint-equilibrium-potential-sample-ensemble'
            : 'weighted-least-squares-independent-gaussian-edge-errors-delta-method',
        assumptions: uncertaintyAssumptions,
        ...(equilibriumPotentialEnsembleValidation ? {
          sampleCount: equilibriumPotentialEnsembleValidation.ensemble.samples.length,
          weightEffectiveSampleSize: equilibriumPotentialEnsembleValidation.weightEffectiveSampleSize,
          intervalProbability: sampleIntervalProbability!,
          sampleDiagnosticsAssessment: potentialSampleDiagnosticsValidation
            ? 'passed'
            : 'missing-explicitly-allowed',
        } : {}),
      },
    } : {}),
    provenance: {
      method: options.uncertaintyMode === 'independent-gaussian-delta-method'
        ? 'Weighted least-squares solution of log10 equilibrium ratios with analytic first-order covariance propagation'
        : options.uncertaintyMode === 'correlated-gaussian-delta-method'
          ? 'Generalized least-squares solution of correlated log10 equilibrium ratios with Cholesky whitening and analytic first-order covariance propagation'
          : options.uncertaintyMode === 'equilibrium-potential-sample-ensemble'
            ? 'Unweighted nominal graph solution plus direct nonlinear propagation of weighted joint gauge-fixed equilibrium-potential samples'
            : 'Unweighted least-squares solution of log10 equilibrium ratios without uncertainty propagation',
      citations: solutionCitations,
      scopeWarning,
    },
  }
  const solutionFingerprint = fingerprintMicrostatePopulationSolution(solution)
  const populationModel: ZatomChemicalStatePopulationModel = {
    method: options.uncertaintyMode === 'equilibrium-potential-sample-ensemble'
      ? `Nominal unweighted least-squares graph population; joint sample uncertainty remains in solution ${solutionFingerprint}`
      : `${solution.provenance.method}; ${solutionFingerprint}`,
    conditions: {
      pH,
      temperatureK: graph.conditions.temperatureK,
      solvent: graph.conditions.medium,
      ...(graph.conditions.ionicStrengthMolar === undefined ? {} : {
        ionicStrengthMolar: graph.conditions.ionicStrengthMolar,
      }),
    },
    populations: solution.populations.map((entry) => ({ stateId: entry.stateId, fraction: entry.fraction })),
    normalizationScope: {
      kind: solution.populationScope.normalization,
      ...(solution.populationScope.stateCoverageFingerprint ? {
        stateCoverageFingerprint: solution.populationScope.stateCoverageFingerprint,
      } : {}),
      ...(solution.populationScope.coverageAssessment === 'bounded' ? {
        totalOmittedFractionUpperBound: solution.populationScope.totalOmittedFractionBounds!.maximum,
      } : {}),
    },
    citations: graph.provenance.citations,
    scopeWarning,
  }
  const enriched = parseZatomChemicalStateEnsemble({
    ...ensemble,
    populationModel,
  }, { structure: parseZatomStructure(options.structure) })
  const selectedIsMaximumReturnedState = maximumPopulationStateIds.includes(ensemble.selection.selectedStateId)
  const selectedIsGloballyMaximum = resolvedPopulationScope.scope.globalMaximumCertified
    && selectedIsMaximumReturnedState
  const checks: ValidationCheck[] = [
    ...validation.checks,
    ...(stateCoverageValidation?.checks ?? []),
    ...(equilibriumPotentialEnsembleValidation?.checks ?? []),
    ...(potentialSampleDiagnosticsValidation?.checks ?? []),
    {
      id: 'microstate_population.preconditions',
      status: 'pass',
      message: `Population solve accepted graph completeness=${options.requireCompleteGraph}, unknown-applicability=${options.allowUnknownApplicability}, and uncertainty=${options.uncertaintyMode} policies`,
      metrics: {
        requireCompleteGraph: options.requireCompleteGraph,
        allowUnknownApplicability: options.allowUnknownApplicability,
        uncertaintyMode: options.uncertaintyMode,
      },
    },
    {
      id: 'microstate_population.equilibrium_fit',
      status: 'pass',
      message: `Solved ${graph.edges.length} log-equilibrium constraints over ${graph.states.length} states`,
      metrics: {
        maximumEdgeFitResidualLog10: maximumEdgeFitResidual,
        rmsEdgeFitResidualLog10: rmsEdgeFitResidual,
        cycleRank: validation.thermodynamicAudit.cycleRank,
      },
    },
    {
      id: 'microstate_population.normalization',
      status: 'pass',
      message: `Population fractions cover every returned state and normalize to ${fractions.reduce((sum, value) => sum + value, 0)} under ${resolvedPopulationScope.scope.normalization} normalization`,
      metrics: {
        stateCount: fractions.length,
        populationSum: fractions.reduce((sum, value) => sum + value, 0),
        maximumPopulationFraction: maximumFraction,
      },
    },
    {
      id: 'microstate_population.state_coverage',
      status: resolvedPopulationScope.scope.coverageAssessment === 'complete' ? 'pass' : 'warn',
      message: resolvedPopulationScope.scope.coverageAssessment === 'complete'
        ? 'Population normalization covers a complete producer-declared state universe'
        : resolvedPopulationScope.scope.coverageAssessment === 'bounded'
          ? `Returned-state conditional fractions have separate full-universe censoring bounds from a total omitted-population upper bound of ${resolvedPopulationScope.scope.totalOmittedFractionBounds!.maximum}`
          : 'Total omitted-state population is unknown; no full-universe population intervals or global maximum claim are available',
      metrics: {
        coverageAssessment: resolvedPopulationScope.scope.coverageAssessment,
        globalMaximumCertified: resolvedPopulationScope.scope.globalMaximumCertified,
        ...(resolvedPopulationScope.scope.totalOmittedFractionBounds ? {
          totalOmittedFractionUpperBound: resolvedPopulationScope.scope.totalOmittedFractionBounds.maximum,
        } : {}),
      },
    },
    {
      id: 'microstate_population.uncertainty',
      status: standardDeviations ? 'pass' : 'skipped',
      message: standardDeviations
        ? options.uncertaintyMode === 'correlated-gaussian-delta-method'
          ? 'Propagated complete native edge standard deviations and the declared full correlation matrix through generalized least squares and first-order normalization'
          : options.uncertaintyMode === 'equilibrium-potential-sample-ensemble'
            ? `Directly normalized ${equilibriumPotentialEnsembleValidation!.ensemble.samples.length} weighted joint equilibrium-potential samples and reported finite-sample non-Gaussian summaries`
            : 'Propagated complete native edge standard deviations under explicit independent-Gaussian/delta-method assumptions'
        : 'Uncertainty mode none was explicit; no population error bars are claimed',
      metrics: {
        uncertaintyMode: options.uncertaintyMode,
        maximumPopulationStandardDeviation: standardDeviations ? Math.max(...standardDeviations) : 0,
        ...(equilibriumPotentialEnsembleValidation ? {
          sampleCount: equilibriumPotentialEnsembleValidation.ensemble.samples.length,
          weightEffectiveSampleSize: equilibriumPotentialEnsembleValidation.weightEffectiveSampleSize,
          intervalProbability: sampleIntervalProbability!,
        } : {}),
      },
    },
    {
      id: 'microstate_population.sample_diagnostics',
      status: options.uncertaintyMode !== 'equilibrium-potential-sample-ensemble'
        ? 'skipped'
        : potentialSampleDiagnosticsValidation ? 'pass' : 'warn',
      message: options.uncertaintyMode !== 'equilibrium-potential-sample-ensemble'
        ? 'Potential-sample diagnostics do not apply to the selected uncertainty mode'
        : potentialSampleDiagnosticsValidation
          ? `Bound passing multi-chain diagnostics ${potentialSampleDiagnosticsValidation.fingerprint}`
          : 'Multi-chain dependence/convergence diagnostics are missing under explicit allow-missing policy',
      metrics: {
        sampleDiagnosticsPolicy: sampleDiagnosticsPolicy ?? 'not-applicable',
        diagnosticsPresent: potentialSampleDiagnosticsValidation !== undefined,
      },
    },
    {
      id: 'microstate_population.selected_structure_scope',
      status: selectedIsGloballyMaximum ? 'pass' : 'warn',
      message: selectedIsGloballyMaximum
        ? `The exact selected structure ${ensemble.selection.selectedStateId} is certified maximum over the complete or bounded state universe at pH ${pH}`
        : selectedIsMaximumReturnedState
          ? `Selected structure ${ensemble.selection.selectedStateId} is maximum only among returned states; omitted states prevent a global maximum claim`
          : `Maximum returned-state population ${maximumPopulationStateIds.join(', ')} differs from selected structure ${ensemble.selection.selectedStateId}; generate/select that exact structure before any returned-state maximum handoff`,
      metrics: {
        selectedIsMaximumReturnedState,
        selectedIsGloballyMaximum,
        selectedStateId: ensemble.selection.selectedStateId,
      },
    },
    {
      id: 'microstate_population.model_scope',
      status: 'warn',
      message: scopeWarning,
      metrics: { solutionFingerprint },
    },
  ]
  return {
    graphValidation: validation,
    solution,
    solutionFingerprint,
    populationModel,
    ensembleWithPopulationModel: enriched.ensemble,
    ensembleWithPopulationModelFingerprint: enriched.fingerprint,
    checks,
    inspectionTargets: validation.inspectionTargets,
  }
}
