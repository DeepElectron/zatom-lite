/** Bounded pH titration series and macroscopic protonation-step aggregation. */

import type { InspectionTarget, ValidationCheck } from './contracts'
import type { ZatomChemicalStateEnsemble } from './chemical-state-ensemble'
import {
  fitMicrostateEquilibriumPotentials,
  microstatePotentialEnsemblePopulationRows,
  microstatePopulationStandardDeviations,
  normalizedMicrostatePopulations,
  resolveMicrostatePopulationScope,
  summarizeMicrostateSampleMatrix,
  validateMicrostatePopulationPreconditions,
  type ParseZatomMicrostateTransitionGraphOptions,
  type ZatomMicrostateTransitionGraph,
  type ZatomMicrostateTransitionGraphValidation,
  type ZatomMicrostateUncertaintyMode,
  type ZatomMicrostateSampleDiagnosticsPolicy,
  type ZatomMicrostateCensoringBounds,
  type ZatomMicrostateSampleUncertaintySummary,
  ZatomMicrostateTransitionGraphInputError,
} from './microstate-transition-graph'
import type { ZatomMicrostateEquilibriumPotentialEnsemble } from './microstate-equilibrium-potential-ensemble'
import type { ZatomMicrostatePotentialSampleDiagnostics } from './microstate-potential-sample-diagnostics'
import type { ZatomMicrostateStateCoverage } from './microstate-state-coverage'
import { fingerprintCanonicalJson } from './structure-math'

export const ZATOM_MICROSTATE_TITRATION_SERIES_SCHEMA = 'zatom.microstate-titration-series/v1' as const

export interface ZatomMicrostateTitrationLevel {
  relativeProtonCount: number
  formalCharge: number
  stateIds: string[]
}

export interface ZatomMicrostateMacroscopicStep {
  /** Conventional order: step 1 removes a proton from the most-protonated level. */
  stepIndex: number
  fromRelativeProtonCount: number
  toRelativeProtonCount: number
  fromFormalCharge: number
  toFormalCharge: number
  pKa: number
  standardDeviation?: number
  sampleUncertainty?: ZatomMicrostateSampleUncertaintySummary
  insideScanRange: boolean
}

export interface ZatomMicrostateTitrationPoint {
  pH: number
  populations: Array<{
    stateId: string
    fraction: number
    standardDeviation?: number
    sampleUncertainty?: ZatomMicrostateSampleUncertaintySummary
    censoringBounds?: ZatomMicrostateCensoringBounds
  }>
  protonationLevelFractions: Array<{
    relativeProtonCount: number
    formalCharge: number
    fraction: number
    standardDeviation?: number
    sampleUncertainty?: ZatomMicrostateSampleUncertaintySummary
    censoringBounds?: ZatomMicrostateCensoringBounds
  }>
  dominantStateIds: string[]
  dominantStateScope: 'complete-state-universe' | 'returned-states-only'
  globalDominantStateIds?: string[]
  meanRelativeProtonCount: number
  meanFormalCharge: number
  /** Equals `-d(meanRelativeProtonCount)/d(pH)` for the fitted equilibrium model. */
  protonationSusceptibilityPerPH: number
  sampleUncertainty?: {
    meanRelativeProtonCount: ZatomMicrostateSampleUncertaintySummary
    meanFormalCharge: ZatomMicrostateSampleUncertaintySummary
    protonationSusceptibilityPerPH: ZatomMicrostateSampleUncertaintySummary
  }
}

export interface ZatomMicrostateTitrationSeries {
  schemaVersion: typeof ZATOM_MICROSTATE_TITRATION_SERIES_SCHEMA
  graphFingerprint: string
  chemicalStateEnsembleFingerprint: string
  conditions: ZatomMicrostateTransitionGraph['conditions']
  grid: {
    spacing: 'linear-inclusive'
    minimumPH: number
    maximumPH: number
    pointCount: number
  }
  solver: {
    method:
      | 'log-equilibrium-graph-least-squares-with-analytic-ph-shift'
      | 'log-equilibrium-graph-generalized-least-squares-with-analytic-ph-shift'
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
  populationScope: {
    normalization: 'complete-state-universe' | 'conditional-on-returned-states'
    coverageAssessment: 'complete' | 'bounded' | 'unknown'
    stateCoverageFingerprint?: string
    pHDomain?: { minimum: number; maximum: number }
    totalOmittedFractionBounds?: ZatomMicrostateCensoringBounds
    retainedUniverseFractionBounds?: ZatomMicrostateCensoringBounds
    summaryStatisticsScope: 'complete-state-universe' | 'returned-states-only'
    macroscopicPkaScope: 'complete-state-universe' | 'returned-states-only'
  }
  states: Array<{ stateId: string; relativeProtonCount: number; formalCharge: number }>
  protonationLevels: ZatomMicrostateTitrationLevel[]
  macroscopicSteps: ZatomMicrostateMacroscopicStep[]
  points: ZatomMicrostateTitrationPoint[]
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

export interface ScanZatomMicrostateTitrationOptions extends ParseZatomMicrostateTransitionGraphOptions {
  pHMinimum: number
  pHMaximum: number
  pointCount: number
  maximumCycleClosureResidualLog10: number
  requireCompleteGraph: boolean
  allowUnknownApplicability: boolean
  uncertaintyMode: ZatomMicrostateUncertaintyMode
  stateCoverage?: ZatomMicrostateStateCoverage
  equilibriumPotentialEnsemble?: ZatomMicrostateEquilibriumPotentialEnsemble
  sampleIntervalProbability?: number
  minimumSampleWeightEffectiveSize?: number
  sampleDiagnosticsPolicy?: ZatomMicrostateSampleDiagnosticsPolicy
  potentialSampleDiagnostics?: ZatomMicrostatePotentialSampleDiagnostics
  /** Host-side output ceiling; MCP callers cannot increase the default. */
  maxPointStates?: number
  /** Host-side dense covariance-work ceiling; MCP callers cannot increase the default. */
  maxPointCovarianceElements?: number
  /** Host-side joint-sample propagation ceiling; MCP callers cannot increase the default. */
  maxPointPotentialStateSamples?: number
}

export interface ZatomMicrostateTitrationResult {
  graphValidation: ZatomMicrostateTransitionGraphValidation
  series: ZatomMicrostateTitrationSeries
  seriesFingerprint: string
  checks: ValidationCheck[]
  inspectionTargets: InspectionTarget[]
}

interface IndexedLevel extends ZatomMicrostateTitrationLevel {
  stateIndices: number[]
}

function numberIn(value: unknown, field: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new ZatomMicrostateTransitionGraphInputError(
      'invalid_microstate_titration_options',
      `${field} must be finite from ${minimum} through ${maximum}`,
    )
  }
  return Object.is(value, -0) ? 0 : value
}

function integer(value: unknown, field: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new ZatomMicrostateTransitionGraphInputError(
      'invalid_microstate_titration_options',
      `${field} must be an integer from ${minimum} through ${maximum}`,
    )
  }
  return Number(value)
}


export function fingerprintMicrostateTitrationSeries(value: ZatomMicrostateTitrationSeries): string {
  return fingerprintCanonicalJson(value)
}

function linearGrid(minimum: number, maximum: number, pointCount: number): number[] {
  const span = maximum - minimum
  return Array.from({ length: pointCount }, (_, index) => {
    if (index === 0) return minimum
    if (index === pointCount - 1) return maximum
    const value = minimum + span * index / (pointCount - 1)
    return Object.is(value, -0) ? 0 : value
  })
}

function buildLevels(
  graph: ZatomMicrostateTransitionGraph,
  ensemble: ZatomChemicalStateEnsemble,
): IndexedLevel[] {
  const stateById = new Map(ensemble.states.map((state) => [state.id, state]))
  const grouped = new Map<number, IndexedLevel>()
  graph.states.forEach((state, stateIndex) => {
    const ensembleState = stateById.get(state.stateId)!
    const existing = grouped.get(state.relativeProtonCount)
    if (existing) {
      if (existing.formalCharge !== ensembleState.formalCharge) {
        throw new ZatomMicrostateTransitionGraphInputError(
          'microstate_titration_level_charge_mismatch',
          `Protonation level ${state.relativeProtonCount} contains inconsistent formal charges`,
        )
      }
      existing.stateIds.push(state.stateId)
      existing.stateIndices.push(stateIndex)
    } else {
      grouped.set(state.relativeProtonCount, {
        relativeProtonCount: state.relativeProtonCount,
        formalCharge: ensembleState.formalCharge,
        stateIds: [state.stateId],
        stateIndices: [stateIndex],
      })
    }
  })
  const levels = [...grouped.values()].sort((left, right) => (
    left.relativeProtonCount - right.relativeProtonCount
  ))
  for (let index = 1; index < levels.length; index++) {
    if (levels[index].relativeProtonCount !== levels[index - 1].relativeProtonCount + 1) {
      throw new ZatomMicrostateTransitionGraphInputError(
        'microstate_titration_protonation_level_gap',
        'A connected one-proton transition graph must cover every intermediate protonation level',
      )
    }
  }
  return levels
}

function log10SumExp(log10Weights: readonly number[], indices: readonly number[]): number {
  const maximum = Math.max(...indices.map((index) => log10Weights[index]))
  const scaled = indices.reduce((sum, index) => sum + 10 ** (log10Weights[index] - maximum), 0)
  const result = maximum + Math.log10(scaled)
  if (!Number.isFinite(result)) {
    throw new ZatomMicrostateTransitionGraphInputError(
      'microstate_titration_numerical_failure',
      'A protonation-level partition function was non-finite',
    )
  }
  return result
}

function levelFractionStandardDeviations(
  levels: readonly IndexedLevel[],
  levelFractions: readonly number[],
  populations: readonly number[],
  covariance: readonly number[][],
): number[] {
  const dimension = populations.length - 1
  const variablePopulations = populations.slice(1)
  const levelIndexByState = new Map<number, number>()
  levels.forEach((level, levelIndex) => {
    level.stateIndices.forEach((stateIndex) => levelIndexByState.set(stateIndex, levelIndex))
  })
  const covarianceTimesPopulation = Array.from({ length: dimension }, (_, row) => (
    covariance[row].reduce((sum, value, column) => sum + value * variablePopulations[column], 0)
  ))
  const populationQuadratic = variablePopulations.reduce((sum, value, index) => (
    sum + value * covarianceTimesPopulation[index]
  ), 0)
  const levelQuadratics = levels.map(() => 0)
  const levelPopulationCross = levels.map(() => 0)
  for (let row = 0; row < dimension; row++) {
    const stateIndex = row + 1
    const levelIndex = levelIndexByState.get(stateIndex)!
    const rowPopulation = variablePopulations[row]
    levelPopulationCross[levelIndex] += rowPopulation * covarianceTimesPopulation[row]
    for (let column = 0; column < dimension; column++) {
      if (levelIndexByState.get(column + 1) !== levelIndex) continue
      levelQuadratics[levelIndex] += rowPopulation * covariance[row][column] * variablePopulations[column]
    }
  }
  return levels.map((_, levelIndex) => {
    const levelFraction = levelFractions[levelIndex]
    const variance = Math.LN10 ** 2 * (
      levelQuadratics[levelIndex]
      - 2 * levelFraction * levelPopulationCross[levelIndex]
      + levelFraction ** 2 * populationQuadratic
    )
    if (!Number.isFinite(variance)) {
      throw new ZatomMicrostateTransitionGraphInputError(
        'microstate_titration_numerical_failure',
        'Protonation-level uncertainty propagation produced a non-finite variance',
      )
    }
    return Math.sqrt(Math.max(0, variance))
  })
}

function macroscopicSteps(
  levels: readonly IndexedLevel[],
  baseLog10Weights: readonly number[],
  covariance: readonly number[][] | undefined,
  pHMinimum: number,
  pHMaximum: number,
): ZatomMicrostateMacroscopicStep[] {
  const descending = [...levels].sort((left, right) => right.relativeProtonCount - left.relativeProtonCount)
  let levelVariances: number[] | undefined
  let adjacentCovariances: number[] | undefined
  if (covariance) {
    const levelIndexByState = new Map<number, number>()
    const conditionalByState = baseLog10Weights.map(() => 0)
    levels.forEach((level, levelIndex) => {
      level.stateIndices.forEach((stateIndex) => levelIndexByState.set(stateIndex, levelIndex))
      const maximum = Math.max(...level.stateIndices.map((stateIndex) => baseLog10Weights[stateIndex]))
      const rawWeights = level.stateIndices.map((stateIndex) => 10 ** (baseLog10Weights[stateIndex] - maximum))
      const sum = rawWeights.reduce((total, item) => total + item, 0)
      level.stateIndices.forEach((stateIndex, offset) => {
        conditionalByState[stateIndex] = rawWeights[offset] / sum
      })
    })
    levelVariances = levels.map(() => 0)
    adjacentCovariances = levels.slice(1).map(() => 0)
    for (let row = 0; row < covariance.length; row++) {
      const rowStateIndex = row + 1
      const rowLevelIndex = levelIndexByState.get(rowStateIndex)!
      for (let column = 0; column < covariance.length; column++) {
        const columnStateIndex = column + 1
        const columnLevelIndex = levelIndexByState.get(columnStateIndex)!
        const contribution = conditionalByState[rowStateIndex]
          * covariance[row][column]
          * conditionalByState[columnStateIndex]
        if (rowLevelIndex === columnLevelIndex) {
          levelVariances[rowLevelIndex] += contribution
        } else if (rowLevelIndex === columnLevelIndex + 1) {
          adjacentCovariances[columnLevelIndex] += contribution
        }
      }
    }
  }
  return descending.slice(0, -1).map((higher, index) => {
    const lower = descending[index + 1]
    const pKa = log10SumExp(baseLog10Weights, higher.stateIndices)
      - log10SumExp(baseLog10Weights, lower.stateIndices)
    let standardDeviation: number | undefined
    if (levelVariances && adjacentCovariances) {
      const higherLevelIndex = levels.length - 1 - index
      const lowerLevelIndex = higherLevelIndex - 1
      const variance = levelVariances[higherLevelIndex]
        + levelVariances[lowerLevelIndex]
        - 2 * adjacentCovariances[lowerLevelIndex]
      if (!Number.isFinite(variance)) {
        throw new ZatomMicrostateTransitionGraphInputError(
          'microstate_titration_numerical_failure',
          'Macroscopic-pKa uncertainty propagation produced a non-finite variance',
        )
      }
      standardDeviation = Math.sqrt(Math.max(0, variance))
    }
    return {
      stepIndex: index + 1,
      fromRelativeProtonCount: higher.relativeProtonCount,
      toRelativeProtonCount: lower.relativeProtonCount,
      fromFormalCharge: higher.formalCharge,
      toFormalCharge: lower.formalCharge,
      pKa,
      ...(standardDeviation === undefined ? {} : { standardDeviation }),
      insideScanRange: pKa >= pHMinimum && pKa <= pHMaximum,
    }
  })
}

export function scanZatomMicrostateTitration(
  value: unknown,
  options: ScanZatomMicrostateTitrationOptions,
): ZatomMicrostateTitrationResult {
  const pHMinimum = numberIn(options.pHMinimum, 'titration.pHMinimum', 0, 14)
  const pHMaximum = numberIn(options.pHMaximum, 'titration.pHMaximum', 0, 14)
  if (pHMaximum <= pHMinimum) {
    throw new ZatomMicrostateTransitionGraphInputError(
      'invalid_microstate_titration_options',
      'titration.pHMaximum must be greater than pHMinimum',
    )
  }
  const pointCount = integer(options.pointCount, 'titration.pointCount', 2, 2_001)
  const maxPointStates = options.maxPointStates ?? 131_072
  const maxPointCovarianceElements = options.maxPointCovarianceElements ?? 33_554_432
  const maxPointPotentialStateSamples = options.maxPointPotentialStateSamples ?? 16_777_216
  if (!Number.isSafeInteger(maxPointStates) || maxPointStates <= 0
    || !Number.isSafeInteger(maxPointCovarianceElements) || maxPointCovarianceElements <= 0
    || !Number.isSafeInteger(maxPointPotentialStateSamples) || maxPointPotentialStateSamples <= 0) {
    throw new ZatomMicrostateTransitionGraphInputError(
      'invalid_microstate_titration_budget',
      'Titration output, covariance-work, and joint-sample-work budgets must be positive safe integers',
    )
  }

  const preconditions = validateMicrostatePopulationPreconditions(value, {
    structure: options.structure,
    chemicalStateEnsemble: options.chemicalStateEnsemble,
    ...(options.maxStates === undefined ? {} : { maxStates: options.maxStates }),
    ...(options.maxEdges === undefined ? {} : { maxEdges: options.maxEdges }),
    ...(options.maxEvidenceSources === undefined ? {} : { maxEvidenceSources: options.maxEvidenceSources }),
    ...(options.maxMetadataBytes === undefined ? {} : { maxMetadataBytes: options.maxMetadataBytes }),
    ...(options.maxCorrelatedEdges === undefined ? {} : { maxCorrelatedEdges: options.maxCorrelatedEdges }),
    pH: pHMinimum,
    maximumCycleClosureResidualLog10: options.maximumCycleClosureResidualLog10,
    requireCompleteGraph: options.requireCompleteGraph,
    allowUnknownApplicability: options.allowUnknownApplicability,
    uncertaintyMode: options.uncertaintyMode,
    ...(options.stateCoverage === undefined ? {} : { stateCoverage: options.stateCoverage }),
    ...(options.equilibriumPotentialEnsemble === undefined ? {} : {
      equilibriumPotentialEnsemble: options.equilibriumPotentialEnsemble,
    }),
    ...(options.sampleIntervalProbability === undefined ? {} : {
      sampleIntervalProbability: options.sampleIntervalProbability,
    }),
    ...(options.minimumSampleWeightEffectiveSize === undefined ? {} : {
      minimumSampleWeightEffectiveSize: options.minimumSampleWeightEffectiveSize,
    }),
    ...(options.sampleDiagnosticsPolicy === undefined ? {} : {
      sampleDiagnosticsPolicy: options.sampleDiagnosticsPolicy,
    }),
    ...(options.potentialSampleDiagnostics === undefined ? {} : {
      potentialSampleDiagnostics: options.potentialSampleDiagnostics,
    }),
  })
  const { validation, graph, ensemble } = preconditions
  if (preconditions.stateCoverageValidation
    && pHMaximum > preconditions.stateCoverageValidation.coverage.pHDomain.maximum) {
    throw new ZatomMicrostateTransitionGraphInputError(
      'microstate_state_coverage_ph_outside_domain',
      `Titration maximum pH ${pHMaximum} lies outside coverage domain ${preconditions.stateCoverageValidation.coverage.pHDomain.minimum}-${preconditions.stateCoverageValidation.coverage.pHDomain.maximum}`,
    )
  }
  if (preconditions.equilibriumPotentialEnsembleValidation
    && pHMaximum > preconditions.equilibriumPotentialEnsembleValidation.ensemble.pHDomain.maximum) {
    const domain = preconditions.equilibriumPotentialEnsembleValidation.ensemble.pHDomain
    throw new ZatomMicrostateTransitionGraphInputError(
      'microstate_potential_ensemble_ph_outside_domain',
      `Titration maximum pH ${pHMaximum} lies outside potential-ensemble domain ${domain.minimum}-${domain.maximum}`,
    )
  }
  if (pointCount * graph.states.length > maxPointStates) {
    throw new ZatomMicrostateTransitionGraphInputError(
      'microstate_titration_budget_exceeded',
      `Titration output would contain ${pointCount * graph.states.length} point-state rows; limit is ${maxPointStates}`,
    )
  }
  const pointCovarianceElements = pointCount * (graph.states.length - 1) ** 2
  const gaussianUncertaintyMode = options.uncertaintyMode === 'independent-gaussian-delta-method'
    || options.uncertaintyMode === 'correlated-gaussian-delta-method'
  if (gaussianUncertaintyMode
    && pointCovarianceElements > maxPointCovarianceElements) {
    throw new ZatomMicrostateTransitionGraphInputError(
      'microstate_titration_budget_exceeded',
      `Titration uncertainty propagation would inspect ${pointCovarianceElements} point-covariance elements; limit is ${maxPointCovarianceElements}`,
    )
  }
  const potentialSampleCount = preconditions.equilibriumPotentialEnsembleValidation?.ensemble.samples.length ?? 0
  const pointPotentialStateSamples = pointCount * graph.states.length * potentialSampleCount
  if (pointPotentialStateSamples > maxPointPotentialStateSamples) {
    throw new ZatomMicrostateTransitionGraphInputError(
      'microstate_titration_budget_exceeded',
      `Titration joint-sample propagation would normalize ${pointPotentialStateSamples} point-state-samples; limit is ${maxPointPotentialStateSamples}`,
    )
  }

  const levels = buildLevels(graph, ensemble)
  const baseFit = fitMicrostateEquilibriumPotentials(graph, 0, options.uncertaintyMode)
  const referenceProtonCount = graph.states[0].relativeProtonCount
  const ensembleStateById = new Map(ensemble.states.map((state) => [state.id, state]))
  const pHValues = linearGrid(pHMinimum, pHMaximum, pointCount)
  const potentialEnsembleValidation = preconditions.equilibriumPotentialEnsembleValidation
  const potentialSampleWeights = potentialEnsembleValidation?.ensemble.samples.map((sample) => sample.weight)
  let maximumPopulationNormalizationError = 0
  let maximumLevelNormalizationError = 0
  let seriesPopulationScope: ReturnType<typeof resolveMicrostatePopulationScope>['scope'] | undefined
  const points = pHValues.map((pH): ZatomMicrostateTitrationPoint => {
    const log10Weights = baseFit.log10Weights.map((base, stateIndex) => (
      base + (referenceProtonCount - graph.states[stateIndex].relativeProtonCount) * pH
    ))
    const fractions = normalizedMicrostatePopulations(log10Weights)
    const samplePopulationRows = potentialEnsembleValidation
      ? microstatePotentialEnsemblePopulationRows(graph, potentialEnsembleValidation.ensemble, pH)
      : undefined
    const populationSampleSummaries = samplePopulationRows
      ? summarizeMicrostateSampleMatrix(
          samplePopulationRows,
          potentialSampleWeights!,
          preconditions.sampleIntervalProbability!,
        )
      : undefined
    const standardDeviations = baseFit.covariance
      ? microstatePopulationStandardDeviations(fractions, baseFit.covariance)
      : populationSampleSummaries?.map((summary) => summary.standardDeviation)
    const populationSum = fractions.reduce((sum, fraction) => sum + fraction, 0)
    maximumPopulationNormalizationError = Math.max(maximumPopulationNormalizationError, Math.abs(populationSum - 1))
    const rawLevelFractions = levels.map((level) => (
      level.stateIndices.reduce((sum, stateIndex) => sum + fractions[stateIndex], 0)
    ))
    const sampleLevelRows = samplePopulationRows?.map((samplePopulations) => levels.map((level) => (
      level.stateIndices.reduce((sum, stateIndex) => sum + samplePopulations[stateIndex], 0)
    )))
    const levelSampleSummaries = sampleLevelRows
      ? summarizeMicrostateSampleMatrix(
          sampleLevelRows,
          potentialSampleWeights!,
          preconditions.sampleIntervalProbability!,
        )
      : undefined
    const levelStandardDeviations = baseFit.covariance
      ? levelFractionStandardDeviations(levels, rawLevelFractions, fractions, baseFit.covariance)
      : levelSampleSummaries?.map((summary) => summary.standardDeviation)
    const protonationLevelFractions = levels.map((level, levelIndex) => {
      const fraction = rawLevelFractions[levelIndex]
      const standardDeviation = levelStandardDeviations?.[levelIndex]
      return {
        relativeProtonCount: level.relativeProtonCount,
        formalCharge: level.formalCharge,
        fraction,
        ...(standardDeviation === undefined ? {} : { standardDeviation }),
        ...(levelSampleSummaries ? { sampleUncertainty: levelSampleSummaries[levelIndex] } : {}),
      }
    })
    const levelSum = protonationLevelFractions.reduce((sum, level) => sum + level.fraction, 0)
    maximumLevelNormalizationError = Math.max(maximumLevelNormalizationError, Math.abs(levelSum - 1))
    const meanRelativeProtonCount = graph.states.reduce((sum, state, stateIndex) => (
      sum + state.relativeProtonCount * fractions[stateIndex]
    ), 0)
    const meanFormalCharge = graph.states.reduce((sum, state, stateIndex) => (
      sum + ensembleStateById.get(state.stateId)!.formalCharge * fractions[stateIndex]
    ), 0)
    const protonCountVariance = graph.states.reduce((sum, state, stateIndex) => (
      sum + fractions[stateIndex] * (state.relativeProtonCount - meanRelativeProtonCount) ** 2
    ), 0)
    const derivedSampleRows = samplePopulationRows?.map((samplePopulations) => {
      const sampleMeanProtonCount = graph.states.reduce((sum, state, stateIndex) => (
        sum + state.relativeProtonCount * samplePopulations[stateIndex]
      ), 0)
      const sampleMeanCharge = graph.states.reduce((sum, state, stateIndex) => (
        sum + ensembleStateById.get(state.stateId)!.formalCharge * samplePopulations[stateIndex]
      ), 0)
      const sampleProtonCountVariance = graph.states.reduce((sum, state, stateIndex) => (
        sum + samplePopulations[stateIndex]
          * (state.relativeProtonCount - sampleMeanProtonCount) ** 2
      ), 0)
      return [
        sampleMeanProtonCount,
        sampleMeanCharge,
        Math.LN10 * sampleProtonCountVariance,
      ]
    })
    const derivedSampleSummaries = derivedSampleRows
      ? summarizeMicrostateSampleMatrix(
          derivedSampleRows,
          potentialSampleWeights!,
          preconditions.sampleIntervalProbability!,
        )
      : undefined
    const maximumFraction = Math.max(...fractions)
    const dominantStateIds = graph.states
      .filter((_, stateIndex) => fractions[stateIndex] + 1e-12 >= maximumFraction)
      .map((state) => state.stateId)
    const resolvedScope = resolveMicrostatePopulationScope(
      ensemble,
      preconditions.stateCoverageValidation,
      fractions,
      dominantStateIds,
    )
    seriesPopulationScope ??= resolvedScope.scope
    const omittedUpperBound = resolvedScope.scope.totalOmittedFractionBounds?.maximum
    return {
      pH,
      populations: graph.states.map((state, stateIndex) => ({
        stateId: state.stateId,
        fraction: fractions[stateIndex],
        ...(standardDeviations ? { standardDeviation: standardDeviations[stateIndex] } : {}),
        ...(populationSampleSummaries ? {
          sampleUncertainty: populationSampleSummaries[stateIndex],
        } : {}),
        ...(resolvedScope.stateBounds ? { censoringBounds: resolvedScope.stateBounds[stateIndex] } : {}),
      })),
      protonationLevelFractions: protonationLevelFractions.map((level) => ({
        ...level,
        ...(omittedUpperBound === undefined ? {} : {
          censoringBounds: {
            minimum: level.fraction * (1 - omittedUpperBound),
            maximum: level.fraction + omittedUpperBound * (1 - level.fraction),
          },
        }),
      })),
      dominantStateIds,
      dominantStateScope: resolvedScope.scope.maximumPopulationScope,
      ...(resolvedScope.scope.globalMaximumStateIds ? {
        globalDominantStateIds: resolvedScope.scope.globalMaximumStateIds,
      } : {}),
      meanRelativeProtonCount,
      meanFormalCharge,
      protonationSusceptibilityPerPH: Math.LN10 * protonCountVariance,
      ...(derivedSampleSummaries ? {
        sampleUncertainty: {
          meanRelativeProtonCount: derivedSampleSummaries[0],
          meanFormalCharge: derivedSampleSummaries[1],
          protonationSusceptibilityPerPH: derivedSampleSummaries[2],
        },
      } : {}),
    }
  })

  const nominalMacroSteps = macroscopicSteps(
    levels,
    baseFit.log10Weights,
    baseFit.covariance,
    pHMinimum,
    pHMaximum,
  )
  const macroSampleRows = potentialEnsembleValidation?.ensemble.samples.map((sample) => (
    macroscopicSteps(
      levels,
      sample.log10WeightsRelativeToReference,
      undefined,
      pHMinimum,
      pHMaximum,
    ).map((step) => step.pKa)
  ))
  const macroSampleSummaries = macroSampleRows
    ? summarizeMicrostateSampleMatrix(
        macroSampleRows,
        potentialSampleWeights!,
        preconditions.sampleIntervalProbability!,
      )
    : undefined
  const macroSteps = nominalMacroSteps.map((step, stepIndex) => (
    macroSampleSummaries
      ? {
          ...step,
          standardDeviation: macroSampleSummaries[stepIndex].standardDeviation,
          sampleUncertainty: macroSampleSummaries[stepIndex],
        }
      : step
  ))
  const maximumEdgeFitResidualLog10 = baseFit.edgeResiduals.reduce(
    (maximum, residual) => Math.max(maximum, Math.abs(residual)),
    0,
  )
  const rmsEdgeFitResidualLog10 = Math.sqrt(
    baseFit.edgeResiduals.reduce((sum, residual) => sum + residual ** 2, 0) / baseFit.edgeResiduals.length,
  )
  const uncertaintyAssumptions = options.uncertaintyMode === 'independent-gaussian-delta-method'
    ? [
        'Every native-unit edge standard deviation is treated as Gaussian.',
        'Edge errors are treated as mutually independent even when evidence sources share a model or dataset.',
        'Microstate, protonation-level, and macroscopic-pKa standard deviations use first-order delta-method propagation.',
      ]
    : options.uncertaintyMode === 'correlated-gaussian-delta-method'
      ? [
          'Every native-unit edge standard deviation is treated as Gaussian.',
          'The declared full positive-definite edge correlation matrix is treated as exact for generalized least squares.',
          ...graph.edgeCorrelation!.assumptions.map((assumption) => `Correlation model: ${assumption}`),
          'Microstate, protonation-level, and macroscopic-pKa standard deviations use first-order delta-method propagation.',
        ]
      : options.uncertaintyMode === 'equilibrium-potential-sample-ensemble'
        ? [
            'Every sample is treated as one complete joint draw or replicate of all gauge-fixed intrinsic state potentials.',
            'Sample weights and the declared sampling/bootstrap/model-ensemble construction are treated as the uncertainty distribution.',
            ...potentialEnsembleValidation!.ensemble.uncertaintyModel.assumptions
              .map((assumption) => `Potential ensemble: ${assumption}`),
            'Microstate, protonation-level, and macroscopic-pKa summaries use direct nonlinear propagation of every joint sample.',
            preconditions.potentialSampleDiagnosticsValidation
              ? 'Every non-reference state passed the bound multi-chain split-R-hat and autocorrelation-ESS gates.'
              : 'Multi-chain dependence/convergence diagnostics were explicitly allowed to be missing.',
          ]
        : []
  const resolvedSeriesScope = seriesPopulationScope!
  const macroscopicPkaScope = resolvedSeriesScope.coverageAssessment === 'complete'
    || resolvedSeriesScope.totalOmittedFractionBounds?.maximum === 0
    ? 'complete-state-universe' as const
    : 'returned-states-only' as const
  const seriesCitations = [...new Set([
    ...graph.provenance.citations,
    ...(potentialEnsembleValidation?.ensemble.provenance.citations ?? []),
    ...(preconditions.potentialSampleDiagnosticsValidation?.diagnostics.provenance.citations ?? []),
  ])].sort()
  const scopeWarning = [
    `The series assumes equilibrium across the declared ${graph.states.length}-state/${graph.edges.length}-edge graph from pH ${pHMinimum} through ${pHMaximum}.`,
    options.requireCompleteGraph
      ? 'State and transition enumeration were required complete.'
      : resolvedSeriesScope.coverageAssessment === 'bounded'
        ? `Incomplete enumeration was explicitly accepted; returned-state curves carry separate censoring bounds from a pointwise total omitted-population upper bound of ${resolvedSeriesScope.totalOmittedFractionBounds!.maximum}, while macroscopic pKa remains conditional unless that bound is zero.`
        : resolvedSeriesScope.coverageAssessment === 'unknown'
          ? 'Incomplete enumeration was explicitly accepted; total omitted population is unknown, so the titration curve and every macroscopic pKa are conditional on returned states.'
          : 'Enumeration is complete, although strict graph completeness was not required.',
    'Macroscopic step pKa values are ratios of fitted protonation-level partition functions under the graph conditions and standard state; they are not isolated site labels.',
    validation.thermodynamicAudit.cycleRank === 0
      ? 'The graph has no independent cycle, so thermodynamic closure could not be cross-validated.'
      : `Fundamental-cycle closure was gated at ${preconditions.maximumCycleClosureResidualLog10} log10 units.`,
    options.uncertaintyMode === 'none'
      ? 'No titration or macroscopic-pKa uncertainty is claimed.'
      : options.uncertaintyMode === 'independent-gaussian-delta-method'
        ? 'Reported standard deviations depend on the explicit independent-Gaussian and first-order assumptions.'
        : options.uncertaintyMode === 'correlated-gaussian-delta-method'
          ? 'Reported standard deviations depend on the declared correlated-Gaussian matrix and first-order assumptions.'
          : `Reported weighted quantiles and standard deviations depend on the declared ${potentialEnsembleValidation!.ensemble.uncertaintyModel.kind} joint-potential ensemble; its Kish weight ESS does not diagnose sample autocorrelation or convergence.`,
    ...(options.uncertaintyMode === 'correlated-gaussian-delta-method'
      ? [`Correlation-model scope: ${graph.edgeCorrelation!.scopeWarning}`]
      : []),
    ...(options.uncertaintyMode === 'equilibrium-potential-sample-ensemble'
      ? [
          `Potential-ensemble model scope: ${potentialEnsembleValidation!.ensemble.uncertaintyModel.scopeWarning}`,
          `Potential-ensemble provenance scope: ${potentialEnsembleValidation!.ensemble.provenance.scopeWarning}`,
          preconditions.potentialSampleDiagnosticsValidation
            ? `Potential-sample diagnostics scope: ${preconditions.potentialSampleDiagnosticsValidation.diagnostics.design.scopeWarning} ${preconditions.potentialSampleDiagnosticsValidation.diagnostics.provenance.scopeWarning}`
            : 'Potential-sample multi-chain dependence and convergence diagnostics are missing by explicit policy; weighted summaries are descriptive for the supplied empirical sample only.',
        ]
      : []),
    'The pH series does not establish kinetics, barriers, sampling convergence, chemical correctness, concentration-dependent buffer capacity, or applicability beyond the recorded evidence.',
  ].join(' ')
  const series: ZatomMicrostateTitrationSeries = {
    schemaVersion: ZATOM_MICROSTATE_TITRATION_SERIES_SCHEMA,
    graphFingerprint: validation.fingerprint,
    chemicalStateEnsembleFingerprint: graph.chemicalStateEnsembleFingerprint,
    conditions: graph.conditions,
    grid: { spacing: 'linear-inclusive', minimumPH: pHMinimum, maximumPH: pHMaximum, pointCount },
    solver: {
      method: options.uncertaintyMode === 'correlated-gaussian-delta-method'
        ? 'log-equilibrium-graph-generalized-least-squares-with-analytic-ph-shift'
        : 'log-equilibrium-graph-least-squares-with-analytic-ph-shift',
      uncertaintyMode: options.uncertaintyMode,
      requireCompleteGraph: options.requireCompleteGraph,
      allowUnknownApplicability: options.allowUnknownApplicability,
      maximumCycleClosureResidualLog10: preconditions.maximumCycleClosureResidualLog10,
      referenceStateId: graph.states[0].stateId,
      ...(potentialEnsembleValidation ? {
        equilibriumPotentialEnsembleFingerprint: potentialEnsembleValidation.fingerprint,
        sampleIntervalProbability: preconditions.sampleIntervalProbability!,
        minimumSampleWeightEffectiveSize: preconditions.minimumSampleWeightEffectiveSize!,
        sampleDiagnosticsPolicy: preconditions.sampleDiagnosticsPolicy!,
        ...(preconditions.potentialSampleDiagnosticsValidation ? {
          potentialSampleDiagnosticsFingerprint: preconditions.potentialSampleDiagnosticsValidation.fingerprint,
        } : {}),
      } : {}),
    },
    fit: {
      stateCount: graph.states.length,
      edgeCount: graph.edges.length,
      cycleRank: validation.thermodynamicAudit.cycleRank,
      maximumFundamentalCycleResidualLog10: validation.thermodynamicAudit.maximumCycleClosureResidualLog10,
      maximumEdgeFitResidualLog10,
      rmsEdgeFitResidualLog10,
    },
    populationScope: {
      normalization: resolvedSeriesScope.normalization,
      coverageAssessment: resolvedSeriesScope.coverageAssessment,
      ...(resolvedSeriesScope.stateCoverageFingerprint ? {
        stateCoverageFingerprint: resolvedSeriesScope.stateCoverageFingerprint,
      } : {}),
      ...(resolvedSeriesScope.pHDomain ? { pHDomain: resolvedSeriesScope.pHDomain } : {}),
      ...(resolvedSeriesScope.totalOmittedFractionBounds ? {
        totalOmittedFractionBounds: resolvedSeriesScope.totalOmittedFractionBounds,
      } : {}),
      ...(resolvedSeriesScope.retainedUniverseFractionBounds ? {
        retainedUniverseFractionBounds: resolvedSeriesScope.retainedUniverseFractionBounds,
      } : {}),
      summaryStatisticsScope: macroscopicPkaScope,
      macroscopicPkaScope,
    },
    states: graph.states.map((state) => ({
      stateId: state.stateId,
      relativeProtonCount: state.relativeProtonCount,
      formalCharge: ensembleStateById.get(state.stateId)!.formalCharge,
    })),
    protonationLevels: levels.map(({ stateIndices: _stateIndices, ...level }) => level),
    macroscopicSteps: macroSteps,
    points,
    ...(options.uncertaintyMode !== 'none' ? {
      uncertainty: {
        method: options.uncertaintyMode === 'correlated-gaussian-delta-method'
          ? 'generalized-least-squares-correlated-gaussian-edge-errors-delta-method'
          : options.uncertaintyMode === 'equilibrium-potential-sample-ensemble'
            ? 'weighted-joint-equilibrium-potential-sample-ensemble'
            : 'weighted-least-squares-independent-gaussian-edge-errors-delta-method',
        assumptions: uncertaintyAssumptions,
        ...(potentialEnsembleValidation ? {
          sampleCount: potentialEnsembleValidation.ensemble.samples.length,
          weightEffectiveSampleSize: potentialEnsembleValidation.weightEffectiveSampleSize,
          intervalProbability: preconditions.sampleIntervalProbability!,
          sampleDiagnosticsAssessment: preconditions.potentialSampleDiagnosticsValidation
            ? 'passed'
            : 'missing-explicitly-allowed',
        } : {}),
      },
    } : {}),
    provenance: {
      method: options.uncertaintyMode === 'equilibrium-potential-sample-ensemble'
        ? 'Fit the nominal graph once, then apply the exact proton-count pH shift and direct nonlinear normalization to every weighted joint intrinsic-potential sample; aggregate each sample by protonation level, returned-state summary statistics, and macroscopic partition-function ratio'
        : 'Fit graph log-equilibrium potentials once at pH 0, apply the exact proton-count pH shift, normalize every grid point, and aggregate state partition functions by protonation level',
      citations: seriesCitations,
      scopeWarning,
    },
  }
  const seriesFingerprint = fingerprintMicrostateTitrationSeries(series)
  const outsideScanCount = macroSteps.filter((step) => !step.insideScanRange).length
  const propagatedUncertainty = baseFit.covariance !== undefined || potentialEnsembleValidation !== undefined
  const checks: ValidationCheck[] = [
    ...validation.checks,
    ...(preconditions.stateCoverageValidation?.checks ?? []),
    ...(potentialEnsembleValidation?.checks ?? []),
    ...(preconditions.potentialSampleDiagnosticsValidation?.checks ?? []),
    {
      id: 'microstate_titration.preconditions',
      status: 'pass',
      message: `Titration accepted graph completeness=${options.requireCompleteGraph}, unknown-applicability=${options.allowUnknownApplicability}, and uncertainty=${options.uncertaintyMode} policies`,
      metrics: {
        requireCompleteGraph: options.requireCompleteGraph,
        allowUnknownApplicability: options.allowUnknownApplicability,
        uncertaintyMode: options.uncertaintyMode,
        coverageAssessment: resolvedSeriesScope.coverageAssessment,
      },
    },
    {
      id: 'microstate_titration.grid',
      status: 'pass',
      message: `Generated an inclusive ${pointCount}-point linear grid from pH ${pHMinimum} through ${pHMaximum}`,
      metrics: {
        pHMinimum,
        pHMaximum,
        pointCount,
        pointStateCount: pointCount * graph.states.length,
        ...(baseFit.covariance ? { pointCovarianceElements } : {}),
        ...(potentialEnsembleValidation ? {
          pointPotentialStateSamples,
          sampleCount: potentialEnsembleValidation.ensemble.samples.length,
        } : {}),
      },
    },
    {
      id: 'microstate_titration.normalization',
      status: maximumPopulationNormalizationError <= 1e-12 && maximumLevelNormalizationError <= 1e-12
        ? 'pass'
        : 'fail',
      message: `Every pH point covers all states and protonation levels; maximum normalization errors are ${maximumPopulationNormalizationError} and ${maximumLevelNormalizationError}`,
      metrics: { maximumPopulationNormalizationError, maximumLevelNormalizationError },
    },
    {
      id: 'microstate_titration.state_coverage',
      status: resolvedSeriesScope.coverageAssessment === 'complete' ? 'pass' : 'warn',
      message: resolvedSeriesScope.coverageAssessment === 'complete'
        ? 'Every titration point covers a complete producer-declared state universe'
        : resolvedSeriesScope.coverageAssessment === 'bounded'
          ? `Every returned-state and protonation-level point carries a separate censoring interval from total omitted-population bound ${resolvedSeriesScope.totalOmittedFractionBounds!.maximum}`
          : 'Every titration point is conditional on returned states because total omitted population is unknown',
      metrics: {
        coverageAssessment: resolvedSeriesScope.coverageAssessment,
        ...(resolvedSeriesScope.totalOmittedFractionBounds ? {
          totalOmittedFractionUpperBound: resolvedSeriesScope.totalOmittedFractionBounds.maximum,
        } : {}),
      },
    },
    {
      id: 'microstate_titration.protonation_levels',
      status: 'pass',
      message: `Aggregated ${graph.states.length} states into ${levels.length} consecutive protonation levels with exact charge mapping`,
      metrics: { levelCount: levels.length, macroscopicStepCount: macroSteps.length },
    },
    {
      id: 'microstate_titration.macroscopic_pka',
      status: macroscopicPkaScope === 'complete-state-universe' ? 'pass' : 'warn',
      message: macroscopicPkaScope === 'complete-state-universe'
        ? `Derived ${macroSteps.length} complete-state-universe macroscopic step pKa value(s) from adjacent protonation-level partition-function ratios`
        : `Derived ${macroSteps.length} returned-state-conditional macroscopic step pKa value(s); omitted states can change partition-function ratios`,
      metrics: { macroscopicStepCount: macroSteps.length, macroscopicPkaScope },
    },
    {
      id: 'microstate_titration.scan_coverage',
      status: outsideScanCount ? 'warn' : 'pass',
      message: outsideScanCount
        ? `${outsideScanCount}/${macroSteps.length} macroscopic pKa midpoint(s) lie outside the requested scan range`
        : 'Every macroscopic pKa midpoint lies inside the requested scan range',
      metrics: { outsideScanCount, macroscopicStepCount: macroSteps.length },
    },
    {
      id: 'microstate_titration.uncertainty',
      status: propagatedUncertainty ? 'pass' : 'skipped',
      message: propagatedUncertainty
        ? options.uncertaintyMode === 'correlated-gaussian-delta-method'
          ? 'Propagated complete native edge standard deviations and the declared full correlation matrix through generalized least squares to microstate fractions, protonation-level fractions, and macroscopic pKa values'
          : options.uncertaintyMode === 'equilibrium-potential-sample-ensemble'
            ? `Directly propagated ${potentialEnsembleValidation!.ensemble.samples.length} weighted joint equilibrium-potential samples to microstate fractions, protonation-level fractions, returned-state summary statistics, and macroscopic pKa values`
            : 'Propagated complete native edge standard deviations to microstate fractions, protonation-level fractions, and macroscopic pKa values under explicit independent-Gaussian/delta-method assumptions'
        : 'Uncertainty mode none was explicit; no titration or macroscopic-pKa error bars are claimed',
      metrics: {
        uncertaintyMode: options.uncertaintyMode,
        ...(potentialEnsembleValidation ? {
          sampleCount: potentialEnsembleValidation.ensemble.samples.length,
          weightEffectiveSampleSize: potentialEnsembleValidation.weightEffectiveSampleSize,
          intervalProbability: preconditions.sampleIntervalProbability!,
          sampleDiagnosticsAssessment: preconditions.potentialSampleDiagnosticsValidation
            ? 'passed'
            : 'missing-explicitly-allowed',
        } : {}),
      },
    },
    {
      id: 'microstate_titration.sample_diagnostics',
      status: options.uncertaintyMode !== 'equilibrium-potential-sample-ensemble'
        ? 'skipped'
        : preconditions.potentialSampleDiagnosticsValidation ? 'pass' : 'warn',
      message: options.uncertaintyMode !== 'equilibrium-potential-sample-ensemble'
        ? 'Potential-sample diagnostics do not apply to the selected uncertainty mode'
        : preconditions.potentialSampleDiagnosticsValidation
          ? `Bound passing multi-chain diagnostics ${preconditions.potentialSampleDiagnosticsValidation.fingerprint}`
          : 'Multi-chain dependence/convergence diagnostics are missing under explicit allow-missing policy',
      metrics: {
        sampleDiagnosticsPolicy: preconditions.sampleDiagnosticsPolicy ?? 'not-applicable',
        diagnosticsPresent: preconditions.potentialSampleDiagnosticsValidation !== undefined,
      },
    },
    {
      id: 'microstate_titration.model_scope',
      status: 'warn',
      message: scopeWarning,
      metrics: { seriesFingerprint },
    },
  ]
  return {
    graphValidation: validation,
    series,
    seriesFingerprint,
    checks,
    inspectionTargets: validation.inspectionTargets,
  }
}
