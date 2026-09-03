import { symbolToAtomicNumber } from '../chemistry/periodic-table'
import type { XYZFrame } from '../lib/crystal/xyz-parser'
import {
  computeMsd,
  type MsdDirections,
} from '../lib/analysis/trajectory/md-postprocess/msd'
import type {
  InspectionTarget,
  ValidationCheck,
  ZatomStructure,
  ZatomTrajectory,
} from './contracts'
import { fingerprintCanonicalJson, fingerprintStructure } from './structure-math'
import { fingerprintTrajectory } from './trajectory'

export const TRAJECTORY_MSD_VERSION = '1.0.0'

export interface AnalyzeTrajectoryMsdOptions {
  structure: ZatomStructure
  trajectory: ZatomTrajectory
  species?: string[]
  directions?: MsdDirections
  maxLagFrames?: number
  fitLagRangeFrames?: [number, number]
  minimumFitRSquared?: number
  maxDisplacementEvaluations?: number
}

export interface TrajectoryMsdPoint {
  lagFrames: number
  lagTimePs: number
  valueA2: number
  sampleCount: number
}

export interface TrajectoryMsdSpeciesResult {
  element: string
  atomCount: number
  points: TrajectoryMsdPoint[]
  fit: {
    lagRangeFrames: [number, number]
    lagTimeRangePs: [number, number]
    pointCount: number
    slopeA2PerPs: number
    interceptA2: number
    rSquared: number
  } | null
  diffusionCoefficientA2PerPs: number | null
  maximumObservedDisplacement: {
    atomId: string
    fromFrameIndex: number
    toFrameIndex: number
    lagFrames: number
    displacementA: number
  }
}

export interface TrajectoryMsdResult {
  structureFingerprint: string
  trajectoryFingerprint: string
  fingerprint: string
  method: {
    engine: 'zatom-windowed-msd'
    engineVersion: typeof TRAJECTORY_MSD_VERSION
    estimator: 'all-time-origins-species-mean'
    fit: 'ordinary-least-squares'
    coordinateRequirement: 'unwrapped-cartesian-for-periodic'
  }
  coordinateMode: ZatomTrajectory['coordinateMode']
  directions: MsdDirections
  dimensionality: number
  frameCount: number
  cadencePs: number
  maximumCadenceRelativeError: number
  maxLagFrames: number
  displacementEvaluations: number
  species: TrajectoryMsdSpeciesResult[]
  verdict: 'pass' | 'warn' | 'fail'
  checks: ValidationCheck[]
  inspectionTargets: InspectionTarget[]
}

export class TrajectoryMsdInputError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'TrajectoryMsdInputError'
    this.code = code
  }
}

function directionSquared(
  from: readonly number[],
  to: readonly number[],
  directions: MsdDirections,
): number {
  let squared = 0
  if (directions.includes('x')) squared += (to[0] - from[0]) ** 2
  if (directions.includes('y')) squared += (to[1] - from[1]) ** 2
  if (directions.includes('z')) squared += (to[2] - from[2]) ** 2
  return squared
}

function canonicalElement(value: string, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TrajectoryMsdInputError('invalid_msd_species', `${field} must be an element symbol`)
  }
  const text = value.trim()
  const symbol = text[0].toUpperCase() + text.slice(1).toLowerCase()
  if (symbolToAtomicNumber(symbol) <= 0) {
    throw new TrajectoryMsdInputError('invalid_msd_species', `${field} uses unknown element ${value}`)
  }
  return symbol
}

function verdictFor(checks: readonly ValidationCheck[]): TrajectoryMsdResult['verdict'] {
  if (checks.some((check) => check.status === 'fail')) return 'fail'
  if (checks.some((check) => check.status === 'warn')) return 'warn'
  return 'pass'
}

/** Analyze mean-square displacement on an exact structure-bound trajectory. */
export function analyzeTrajectoryMsd(options: AnalyzeTrajectoryMsdOptions): TrajectoryMsdResult {
  const frameCount = options.trajectory.frames.length
  if (frameCount < 2) {
    throw new TrajectoryMsdInputError('insufficient_msd_frames', 'MSD analysis requires at least two frames')
  }
  const structureAtomIds = options.structure.atoms.map((atom) => atom.id)
  if (structureAtomIds.length !== options.trajectory.atomIds.length
    || structureAtomIds.some((atomId, index) => atomId !== options.trajectory.atomIds[index])) {
    throw new TrajectoryMsdInputError(
      'trajectory_structure_identity_mismatch',
      'trajectory.atomIds must exactly match the structure atom order',
    )
  }
  const finalPositions = options.trajectory.frames[frameCount - 1].positions
  const maximumFinalPositionErrorA = Math.max(...finalPositions.map((position, index) => Math.hypot(
    position[0] - options.structure.atoms[index].position[0],
    position[1] - options.structure.atoms[index].position[1],
    position[2] - options.structure.atoms[index].position[2],
  )))
  if (maximumFinalPositionErrorA > 1e-8) {
    throw new TrajectoryMsdInputError(
      'trajectory_structure_identity_mismatch',
      'trajectory final positions must match the exact result structure',
    )
  }
  const fixedOrFirstLattice = options.trajectory.lattice ?? options.trajectory.frames[0].lattice
  const hasPeriodicAxes = fixedOrFirstLattice?.periodic.some(Boolean) === true
  if (hasPeriodicAxes && options.trajectory.coordinateMode !== 'unwrapped-cartesian') {
    throw new TrajectoryMsdInputError(
      'unwrapped_trajectory_required',
      'Periodic MSD requires coordinateMode=unwrapped-cartesian; wrapped positions do not identify multi-cell motion',
    )
  }

  const directions = options.directions ?? 'xyz'
  if (!['xyz', 'xy', 'xz', 'yz', 'x', 'y', 'z'].includes(directions)) {
    throw new TrajectoryMsdInputError('invalid_msd_directions', 'directions must be xyz, xy, xz, yz, x, y, or z')
  }
  const maxLagFrames = options.maxLagFrames ?? Math.floor(frameCount / 2)
  if (!Number.isSafeInteger(maxLagFrames) || maxLagFrames < 1 || maxLagFrames >= frameCount) {
    throw new TrajectoryMsdInputError(
      'invalid_msd_lag',
      `maxLagFrames must be an integer in [1, ${frameCount - 1}]`,
    )
  }
  let fitLagRangeFrames: [number, number] | undefined
  if (options.fitLagRangeFrames !== undefined) {
    if (!Array.isArray(options.fitLagRangeFrames) || options.fitLagRangeFrames.length !== 2
      || options.fitLagRangeFrames.some((value) => !Number.isSafeInteger(value))) {
      throw new TrajectoryMsdInputError(
        'invalid_msd_fit_range',
        'fitLagRangeFrames must contain exactly two integer lags',
      )
    }
    fitLagRangeFrames = [...options.fitLagRangeFrames] as [number, number]
    if (fitLagRangeFrames[0] < 1 || fitLagRangeFrames[0] >= fitLagRangeFrames[1]
      || fitLagRangeFrames[1] > maxLagFrames) {
      throw new TrajectoryMsdInputError(
        'invalid_msd_fit_range',
        `fitLagRangeFrames must satisfy 1 <= start < end <= ${maxLagFrames}`,
      )
    }
  }
  const minimumFitRSquared = options.minimumFitRSquared
  if (minimumFitRSquared !== undefined
    && (!Number.isFinite(minimumFitRSquared) || minimumFitRSquared < 0 || minimumFitRSquared > 1)) {
    throw new TrajectoryMsdInputError('invalid_msd_fit_gate', 'minimumFitRSquared must be in [0, 1]')
  }
  const maxDisplacementEvaluations = options.maxDisplacementEvaluations ?? 50_000_000
  if (!Number.isSafeInteger(maxDisplacementEvaluations)
    || maxDisplacementEvaluations < 1 || maxDisplacementEvaluations > 1_000_000_000) {
    throw new TrajectoryMsdInputError(
      'invalid_msd_budget',
      'maxDisplacementEvaluations must be an integer in [1, 1000000000]',
    )
  }

  const availableElements = new Set(options.structure.atoms.map((atom) => atom.element))
  const selectedSpecies = options.species === undefined
    ? [...new Set(options.structure.atoms.map((atom) => atom.element))]
    : options.species.map((value, index) => canonicalElement(value, `species[${index}]`))
  if (!selectedSpecies.length || new Set(selectedSpecies).size !== selectedSpecies.length) {
    throw new TrajectoryMsdInputError('invalid_msd_species', 'species must select one or more distinct elements')
  }
  const absentSpecies = selectedSpecies.filter((element) => !availableElements.has(element))
  if (absentSpecies.length) {
    throw new TrajectoryMsdInputError(
      'msd_species_missing',
      `Requested MSD species are absent from the structure: ${absentSpecies.join(', ')}`,
    )
  }
  const selectedElementSet = new Set(selectedSpecies)
  const selectedAtomIndices = options.structure.atoms
    .map((atom, index) => ({ atom, index }))
    .filter(({ atom }) => selectedElementSet.has(atom.element))
  const estimatorEvaluations = selectedAtomIndices.length * (
    maxLagFrames * frameCount - maxLagFrames * (maxLagFrames + 1) / 2
  )
  const maximumLocalizationEvaluations = selectedAtomIndices.length * (frameCount - 1)
  const projectedDisplacementEvaluations = estimatorEvaluations + maximumLocalizationEvaluations
  if (!Number.isSafeInteger(projectedDisplacementEvaluations)
    || projectedDisplacementEvaluations > maxDisplacementEvaluations) {
    throw new TrajectoryMsdInputError(
      'msd_budget_exceeded',
      `MSD analysis requires at most ${projectedDisplacementEvaluations} displacement evaluations above budget ${maxDisplacementEvaluations}`,
    )
  }

  const intervals = options.trajectory.frames.slice(1).map((frame, index) => (
    frame.timePs - options.trajectory.frames[index].timePs
  ))
  const cadencePs = intervals.reduce((sum, value) => sum + value, 0) / intervals.length
  const maximumCadenceRelativeError = Math.max(...intervals.map((value) => Math.abs(value - cadencePs) / cadencePs))
  if (!Number.isFinite(cadencePs) || cadencePs <= 0 || maximumCadenceRelativeError > 1e-7) {
    throw new TrajectoryMsdInputError(
      'nonuniform_trajectory_cadence',
      `MSD requires uniform frame cadence; maximum relative interval error is ${maximumCadenceRelativeError}`,
    )
  }
  const xyzFrames: XYZFrame[] = options.trajectory.frames.map((frame) => ({
    atoms: frame.positions.map((position, index) => ({
      id: options.trajectory.atomIds[index],
      element: options.structure.atoms[index].element,
      position: [0, 0, 0],
      cartesian: [...position],
    })),
  }))
  const raw = computeMsd(xyzFrames, {
    species: selectedSpecies,
    directions,
    max_tau: maxLagFrames,
    unwrap_pbc: false,
    ...(fitLagRangeFrames ? { fit_range: fitLagRangeFrames } : {}),
  })

  const checks: ValidationCheck[] = [
    {
      id: 'trajectory_msd.identity',
      status: 'pass',
      message: 'MSD input has exact ordered structure/trajectory identity and matching final coordinates',
      metrics: {
        structureFingerprint: fingerprintStructure(options.structure),
        trajectoryFingerprint: fingerprintTrajectory(options.trajectory),
        atomCount: options.structure.atoms.length,
        frameCount,
      },
    },
    {
      id: 'trajectory_msd.coordinate_provenance',
      status: 'pass',
      message: hasPeriodicAxes
        ? 'Periodic motion uses explicitly unwrapped Cartesian coordinates'
        : 'Finite motion uses direct Cartesian coordinates',
      metrics: { coordinateMode: options.trajectory.coordinateMode, periodic: hasPeriodicAxes },
    },
    {
      id: 'trajectory_msd.cadence',
      status: 'pass',
      message: `Frames have uniform ${cadencePs} ps cadence within relative error ${maximumCadenceRelativeError}`,
      metrics: { cadencePs, maximumCadenceRelativeError },
    },
  ]
  const inspectionTargets: InspectionTarget[] = []
  let displacementEvaluations = estimatorEvaluations
  const species = selectedSpecies.map((element): TrajectoryMsdSpeciesResult => {
    const legacy = raw.per_species[element.toUpperCase()]
    if (!legacy) {
      throw new TrajectoryMsdInputError('msd_algorithm_failed', `MSD algorithm did not return requested species ${element}`)
    }
    const points = raw.tau.map((lagFrames, index): TrajectoryMsdPoint => ({
      lagFrames,
      lagTimePs: lagFrames * cadencePs,
      valueA2: legacy.msd[index],
      sampleCount: legacy.n_atoms * (frameCount - lagFrames),
    }))
    const fit = legacy.fit_slope === null || legacy.fit_intercept === null
      || legacy.fit_r_squared === null || legacy.fit_tau_window === null
      ? null
      : {
          lagRangeFrames: legacy.fit_tau_window,
          lagTimeRangePs: [legacy.fit_tau_window[0] * cadencePs, legacy.fit_tau_window[1] * cadencePs] as [number, number],
          pointCount: legacy.fit_tau_window[1] - legacy.fit_tau_window[0] + 1,
          slopeA2PerPs: legacy.fit_slope / cadencePs,
          interceptA2: legacy.fit_intercept,
          rSquared: legacy.fit_r_squared,
        }
    const diffusionCoefficientA2PerPs = fit && fit.slopeA2PerPs >= 0
      ? fit.slopeA2PerPs / (2 * raw.dimensionality)
      : null
    let status: ValidationCheck['status'] = 'pass'
    let message = `${element} MSD fit is available over ${fit?.pointCount ?? 0} lag points`
    if (!fit) {
      status = minimumFitRSquared === undefined ? 'warn' : 'fail'
      message = `${element} trajectory has fewer than two usable MSD lag points; no diffusion fit is defined`
    } else if (fit.pointCount < 3) {
      status = minimumFitRSquared === undefined ? 'warn' : 'fail'
      message = `${element} MSD fit has only ${fit.pointCount} points, so linearity cannot be independently assessed`
    } else if (minimumFitRSquared !== undefined && fit.rSquared < minimumFitRSquared) {
      status = 'fail'
      message = `${element} MSD fit R² ${fit.rSquared} is below required ${minimumFitRSquared}`
    } else if (fit.slopeA2PerPs < 0) {
      status = 'warn'
      message = `${element} MSD fit slope is negative, so no physical diffusion coefficient is reported`
    }
    const elementAtomIndices = selectedAtomIndices.filter(({ atom }) => atom.element === element).map(({ index }) => index)
    const localizationLag = fit?.lagRangeFrames[1] ?? maxLagFrames
    displacementEvaluations += elementAtomIndices.length * (frameCount - localizationLag)
    let maximumSquared = -1
    let maximumAtomIndex = elementAtomIndices[0]
    let maximumFromFrameIndex = 0
    for (const atomIndex of elementAtomIndices) {
      for (let fromFrameIndex = 0; fromFrameIndex + localizationLag < frameCount; fromFrameIndex++) {
        const squared = directionSquared(
          options.trajectory.frames[fromFrameIndex].positions[atomIndex],
          options.trajectory.frames[fromFrameIndex + localizationLag].positions[atomIndex],
          directions,
        )
        if (squared > maximumSquared) {
          maximumSquared = squared
          maximumAtomIndex = atomIndex
          maximumFromFrameIndex = fromFrameIndex
        }
      }
    }
    const toFrameIndex = maximumFromFrameIndex + localizationLag
    const maximumObservedDisplacement = {
      atomId: options.trajectory.atomIds[maximumAtomIndex],
      fromFrameIndex: maximumFromFrameIndex,
      toFrameIndex,
      lagFrames: localizationLag,
      displacementA: Math.sqrt(Math.max(0, maximumSquared)),
    }
    checks.push({
      id: `trajectory_msd.${element}`,
      status,
      message,
      metrics: {
        atomCount: legacy.n_atoms,
        fitPointCount: fit?.pointCount ?? 0,
        fitSlopeA2PerPs: fit?.slopeA2PerPs ?? null,
        fitRSquared: fit?.rSquared ?? null,
        minimumFitRSquared: minimumFitRSquared ?? null,
        diffusionCoefficientA2PerPs,
        maximumObservedDisplacementA: maximumObservedDisplacement.displacementA,
      },
      atomIds: [maximumObservedDisplacement.atomId],
    })
    const targetPosition = options.trajectory.frames[toFrameIndex].positions[maximumAtomIndex]
    inspectionTargets.push({
      id: `trajectory-msd-${element}`,
      reason: `Inspect maximum observed ${directions} displacement for ${element}: ${maximumObservedDisplacement.displacementA} Å over ${localizationLag} frames`,
      center: [...targetPosition],
      radius: Math.max(1, maximumObservedDisplacement.displacementA),
      atomIds: [maximumObservedDisplacement.atomId],
      trajectoryFrameIndex: toFrameIndex,
    })
    return {
      element,
      atomCount: legacy.n_atoms,
      points,
      fit,
      diffusionCoefficientA2PerPs,
      maximumObservedDisplacement,
    }
  })
  checks.splice(3, 0, {
    id: 'trajectory_msd.budget',
    status: 'pass',
    message: `Used ${displacementEvaluations.toLocaleString()} of ${maxDisplacementEvaluations.toLocaleString()} displacement evaluations`,
    metrics: { displacementEvaluations, maxDisplacementEvaluations, projectedDisplacementEvaluations },
  })
  const structureFingerprint = fingerprintStructure(options.structure)
  const trajectoryFingerprint = fingerprintTrajectory(options.trajectory)
  const method = {
    engine: 'zatom-windowed-msd',
    engineVersion: TRAJECTORY_MSD_VERSION,
    estimator: 'all-time-origins-species-mean',
    fit: 'ordinary-least-squares',
    coordinateRequirement: 'unwrapped-cartesian-for-periodic',
  } as const
  const fingerprint = fingerprintCanonicalJson({
    structureFingerprint,
    trajectoryFingerprint,
    method,
    directions,
    cadencePs,
    maxLagFrames,
    fitLagRangeFrames: fitLagRangeFrames ?? null,
    minimumFitRSquared: minimumFitRSquared ?? null,
    species,
  })
  return {
    structureFingerprint,
    trajectoryFingerprint,
    fingerprint,
    method,
    coordinateMode: options.trajectory.coordinateMode,
    directions,
    dimensionality: raw.dimensionality,
    frameCount,
    cadencePs,
    maximumCadenceRelativeError,
    maxLagFrames,
    displacementEvaluations,
    species,
    verdict: verdictFor(checks),
    checks,
    inspectionTargets,
  }
}
