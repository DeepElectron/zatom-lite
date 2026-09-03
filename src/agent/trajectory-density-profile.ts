import { symbolToAtomicNumber } from '../chemistry/periodic-table'
import type {
  InspectionTarget,
  ValidationCheck,
  Vec3,
  ZatomStructure,
  ZatomTrajectory,
} from './contracts'
import {
  cartesianToFractional,
  determinant3,
  fingerprintCanonicalJson,
  fingerprintStructure,
  fractionalToCartesian,
} from './structure-math'
import { fingerprintTrajectory } from './trajectory'

export const TRAJECTORY_DENSITY_PROFILE_VERSION = '1.0.0'

export type LatticeAxis = 'a' | 'b' | 'c'

export interface AnalyzeTrajectoryDensityProfileOptions {
  structure: ZatomStructure
  trajectory: ZatomTrajectory
  latticeAxis: LatticeAxis
  binCount?: number
  species?: string[]
  startFrameIndex?: number
  endFrameIndex?: number
  frameStride?: number
  maxAtomFrameAssignments?: number
}

export interface DensityProfileRepresentative {
  atomId: string
  frameIndex: number
  position: Vec3
}

export interface TrajectoryDensityProfileBin {
  index: number
  minimumFraction: number
  maximumFraction: number
  centerFraction: number
  minimumCoordinateA: number
  maximumCoordinateA: number
  centerCoordinateA: number
  binVolumeA3: number
  totalAtomCount: number
  meanAtomCount: number
  totalNumberDensityPerA3: number
  speciesAtomCounts: Record<string, number>
  speciesNumberDensityPerA3: Record<string, number>
  speciesFractions: Record<string, number | null>
  representative?: DensityProfileRepresentative
}

export interface TrajectoryDensityProfileResult {
  structureFingerprint: string
  trajectoryFingerprint: string
  fingerprint: string
  method: {
    engine: 'zatom-trajectory-density-profile'
    engineVersion: typeof TRAJECTORY_DENSITY_PROFILE_VERSION
    grid: 'fixed-cell-axis-aligned'
    reduction: 'particle-count-divided-by-bin-volume-then-frame-mean'
  }
  latticeAxis: LatticeAxis
  latticeAxisIndex: 0 | 1 | 2
  axisPeriodic: boolean
  normal: Vec3
  cellHeightA: number
  lateralAreaA2: number
  cellVolumeA3: number
  binCount: number
  selectedSpecies: string[]
  selectedAtomCount: number
  frameRange: {
    startFrameIndex: number
    endFrameIndex: number
    frameStride: number
    frameIndices: number[]
    frameCount: number
    cadencePs: number | null
    maximumCadenceRelativeError: number | null
  }
  atomFrameAssignments: number
  integratedMeanAtomCount: number
  bins: TrajectoryDensityProfileBin[]
  verdict: 'warn'
  checks: ValidationCheck[]
  inspectionTargets: InspectionTarget[]
}

export class TrajectoryDensityProfileInputError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'TrajectoryDensityProfileInputError'
    this.code = code
  }
}

function axisIndex(axis: LatticeAxis): 0 | 1 | 2 {
  if (axis === 'a') return 0
  if (axis === 'b') return 1
  if (axis === 'c') return 2
  throw new TrajectoryDensityProfileInputError('invalid_density_axis', 'latticeAxis must be a, b, or c')
}

function cross(left: readonly number[], right: readonly number[]): Vec3 {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ]
}

function normalize(vector: readonly number[]): Vec3 {
  const length = Math.hypot(vector[0], vector[1], vector[2])
  if (!Number.isFinite(length) || length <= 1e-12) {
    throw new TrajectoryDensityProfileInputError('invalid_density_lattice', 'Lateral cell plane has zero area')
  }
  return [vector[0] / length, vector[1] / length, vector[2] / length]
}

function canonicalElement(value: string, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TrajectoryDensityProfileInputError('invalid_density_species', `${field} must be an element symbol`)
  }
  const text = value.trim()
  const symbol = text[0].toUpperCase() + text.slice(1).toLowerCase()
  if (symbolToAtomicNumber(symbol) <= 0) {
    throw new TrajectoryDensityProfileInputError('invalid_density_species', `${field} uses unknown element ${value}`)
  }
  return symbol
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  field: string,
  minimum: number,
  maximum: number,
): number {
  const parsed = value ?? fallback
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new TrajectoryDensityProfileInputError(
      'invalid_density_parameter',
      `${field} must be an integer in [${minimum}, ${maximum}]`,
    )
  }
  return parsed
}

/** Compute a fixed-cell, lattice-axis-aligned time-averaged number-density profile. */
export function analyzeTrajectoryDensityProfile(
  options: AnalyzeTrajectoryDensityProfileOptions,
): TrajectoryDensityProfileResult {
  const latticeAxisIndex = axisIndex(options.latticeAxis)
  const lattice = options.trajectory.lattice
  if (!lattice || options.trajectory.frames.some((frame) => frame.lattice !== undefined)) {
    throw new TrajectoryDensityProfileInputError(
      'fixed_density_lattice_required',
      'Density profiles require one fixed top-level trajectory lattice; variable-cell frames are unsupported',
    )
  }
  const lateralIndices = ([0, 1, 2] as const).filter((index) => index !== latticeAxisIndex)
  if (!lattice.periodic[lateralIndices[0]] || !lattice.periodic[lateralIndices[1]]) {
    throw new TrajectoryDensityProfileInputError(
      'periodic_lateral_axes_required',
      'Both lattice axes lateral to the profile direction must be periodic for an area-normalized density profile',
    )
  }
  const lateralCross = cross(lattice.vectors[lateralIndices[0]], lattice.vectors[lateralIndices[1]])
  const lateralAreaA2 = Math.hypot(lateralCross[0], lateralCross[1], lateralCross[2])
  let normal = normalize(lateralCross)
  const axisVector = lattice.vectors[latticeAxisIndex]
  if (normal[0] * axisVector[0] + normal[1] * axisVector[1] + normal[2] * axisVector[2] < 0) {
    normal = [-normal[0], -normal[1], -normal[2]]
  }
  const cellVolumeA3 = Math.abs(determinant3(lattice.vectors))
  if (!Number.isFinite(cellVolumeA3) || cellVolumeA3 <= 1e-12) {
    throw new TrajectoryDensityProfileInputError('invalid_density_lattice', 'Density-profile lattice volume is invalid')
  }
  const cellHeightA = cellVolumeA3 / lateralAreaA2
  const binCount = boundedInteger(options.binCount, 100, 'binCount', 1, 4096)
  const binVolumeA3 = cellVolumeA3 / binCount
  const frameCount = options.trajectory.frames.length
  if (frameCount < 2) {
    throw new TrajectoryDensityProfileInputError('insufficient_density_frames', 'Density profile requires at least two frames')
  }
  const structureAtomIds = options.structure.atoms.map((atom) => atom.id)
  if (structureAtomIds.length !== options.trajectory.atomIds.length
    || structureAtomIds.some((atomId, index) => atomId !== options.trajectory.atomIds[index])) {
    throw new TrajectoryDensityProfileInputError(
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
    throw new TrajectoryDensityProfileInputError(
      'trajectory_structure_identity_mismatch',
      'trajectory final positions must match the exact result structure',
    )
  }

  const availableSpecies = [...new Set(options.structure.atoms.map((atom) => atom.element))]
  const selectedSpecies = options.species === undefined
    ? availableSpecies
    : options.species.map((value, index) => canonicalElement(value, `species[${index}]`))
  if (!selectedSpecies.length || new Set(selectedSpecies).size !== selectedSpecies.length) {
    throw new TrajectoryDensityProfileInputError(
      'invalid_density_species',
      'species must contain one or more distinct elements',
    )
  }
  const availableSpeciesSet = new Set(availableSpecies)
  const absentSpecies = selectedSpecies.filter((element) => !availableSpeciesSet.has(element))
  if (absentSpecies.length) {
    throw new TrajectoryDensityProfileInputError(
      'density_species_missing',
      `Requested density species are absent from the structure: ${absentSpecies.join(', ')}`,
    )
  }
  const selectedSpeciesSet = new Set(selectedSpecies)
  const selectedAtomIndices = options.structure.atoms
    .map((atom, index) => ({ atom, index }))
    .filter(({ atom }) => selectedSpeciesSet.has(atom.element))
    .map(({ index }) => index)

  const startFrameIndex = boundedInteger(options.startFrameIndex, 0, 'startFrameIndex', 0, frameCount - 1)
  const endFrameIndex = boundedInteger(options.endFrameIndex, frameCount - 1, 'endFrameIndex', 0, frameCount - 1)
  if (endFrameIndex < startFrameIndex) {
    throw new TrajectoryDensityProfileInputError(
      'invalid_density_frame_range',
      'endFrameIndex must not precede startFrameIndex',
    )
  }
  const frameStride = boundedInteger(options.frameStride, 1, 'frameStride', 1, frameCount)
  const frameIndices: number[] = []
  for (let frameIndex = startFrameIndex; frameIndex <= endFrameIndex; frameIndex += frameStride) {
    frameIndices.push(frameIndex)
  }
  const maxAtomFrameAssignments = boundedInteger(
    options.maxAtomFrameAssignments,
    10_000_000,
    'maxAtomFrameAssignments',
    1,
    100_000_000,
  )
  const atomFrameAssignments = frameIndices.length * selectedAtomIndices.length
  if (!Number.isSafeInteger(atomFrameAssignments) || atomFrameAssignments > maxAtomFrameAssignments) {
    throw new TrajectoryDensityProfileInputError(
      'density_assignment_budget_exceeded',
      `Density profile requires ${atomFrameAssignments} atom-frame assignments above budget ${maxAtomFrameAssignments}`,
    )
  }
  const intervals = frameIndices.slice(1).map((frameIndex, index) => (
    options.trajectory.frames[frameIndex].timePs - options.trajectory.frames[frameIndices[index]].timePs
  ))
  const cadencePs = intervals.length
    ? intervals.reduce((sum, value) => sum + value, 0) / intervals.length
    : null
  const maximumCadenceRelativeError = cadencePs === null
    ? null
    : Math.max(...intervals.map((value) => Math.abs(value - cadencePs) / cadencePs))
  if (cadencePs !== null && (!Number.isFinite(cadencePs) || cadencePs <= 0
    || maximumCadenceRelativeError! > 1e-7)) {
    throw new TrajectoryDensityProfileInputError(
      'nonuniform_density_cadence',
      `Time-averaged density requires uniform selected-frame cadence; maximum relative error is ${maximumCadenceRelativeError}`,
    )
  }

  const totalCounts = new Array<number>(binCount).fill(0)
  const speciesCounts = Object.fromEntries(selectedSpecies.map((element) => (
    [element, new Array<number>(binCount).fill(0)]
  )))
  const representatives = new Array<DensityProfileRepresentative | undefined>(binCount)
  const representativeFrameAtomIds = new Array<string[] | undefined>(binCount)
  let maximumOutsideFraction = 0
  for (const frameIndex of frameIndices) {
    const frame = options.trajectory.frames[frameIndex]
    const frameBinAtomIds = Array.from({ length: binCount }, () => [] as string[])
    for (const atomIndex of selectedAtomIndices) {
      const fractional = cartesianToFractional(frame.positions[atomIndex], lattice.vectors)
      if (!fractional) {
        throw new TrajectoryDensityProfileInputError('invalid_density_lattice', 'Cannot invert density-profile lattice')
      }
      let axisFraction = fractional[latticeAxisIndex]
      if (lattice.periodic[latticeAxisIndex]) {
        axisFraction -= Math.floor(axisFraction)
      } else {
        const outside = Math.max(0, -axisFraction, axisFraction - 1)
        maximumOutsideFraction = Math.max(maximumOutsideFraction, outside)
        if (outside > 1e-10) {
          throw new TrajectoryDensityProfileInputError(
            'density_atom_outside_cell',
            `Atom ${options.structure.atoms[atomIndex].id} lies outside nonperiodic lattice-axis domain at frame ${frameIndex}`,
          )
        }
        axisFraction = Math.max(0, Math.min(1, axisFraction))
      }
      const binIndex = Math.min(binCount - 1, Math.floor(axisFraction * binCount))
      const atom = options.structure.atoms[atomIndex]
      totalCounts[binIndex] += 1
      speciesCounts[atom.element][binIndex] += 1
      frameBinAtomIds[binIndex].push(atom.id)
      representatives[binIndex] ??= {
        atomId: atom.id,
        frameIndex,
        position: [...frame.positions[atomIndex]] as Vec3,
      }
    }
    for (let binIndex = 0; binIndex < binCount; binIndex++) {
      if (!representativeFrameAtomIds[binIndex] && frameBinAtomIds[binIndex].length) {
        representativeFrameAtomIds[binIndex] = frameBinAtomIds[binIndex]
      }
    }
  }

  const bins = totalCounts.map((totalAtomCount, index): TrajectoryDensityProfileBin => {
    const minimumFraction = index / binCount
    const maximumFraction = (index + 1) / binCount
    const meanAtomCount = totalAtomCount / frameIndices.length
    const speciesAtomCounts = Object.fromEntries(selectedSpecies.map((element) => (
      [element, speciesCounts[element][index]]
    )))
    return {
      index,
      minimumFraction,
      maximumFraction,
      centerFraction: (minimumFraction + maximumFraction) / 2,
      minimumCoordinateA: minimumFraction * cellHeightA,
      maximumCoordinateA: maximumFraction * cellHeightA,
      centerCoordinateA: (minimumFraction + maximumFraction) * cellHeightA / 2,
      binVolumeA3,
      totalAtomCount,
      meanAtomCount,
      totalNumberDensityPerA3: meanAtomCount / binVolumeA3,
      speciesAtomCounts,
      speciesNumberDensityPerA3: Object.fromEntries(selectedSpecies.map((element) => (
        [element, speciesCounts[element][index] / frameIndices.length / binVolumeA3]
      ))),
      speciesFractions: Object.fromEntries(selectedSpecies.map((element) => (
        [element, totalAtomCount ? speciesCounts[element][index] / totalAtomCount : null]
      ))),
      ...(representatives[index] ? { representative: representatives[index] } : {}),
    }
  })
  const integratedMeanAtomCount = bins.reduce((sum, bin) => (
    sum + bin.totalNumberDensityPerA3 * bin.binVolumeA3
  ), 0)
  const integrationError = Math.abs(integratedMeanAtomCount - selectedAtomIndices.length)
  const structureFingerprint = fingerprintStructure(options.structure)
  const trajectoryFingerprint = fingerprintTrajectory(options.trajectory)
  const method = {
    engine: 'zatom-trajectory-density-profile',
    engineVersion: TRAJECTORY_DENSITY_PROFILE_VERSION,
    grid: 'fixed-cell-axis-aligned',
    reduction: 'particle-count-divided-by-bin-volume-then-frame-mean',
  } as const
  const checks: ValidationCheck[] = [
    {
      id: 'trajectory_density.identity',
      status: 'pass',
      message: 'Density profile binds exact ordered structure/trajectory identity and matching final coordinates',
      metrics: { structureFingerprint, trajectoryFingerprint, atomCount: options.structure.atoms.length },
    },
    {
      id: 'trajectory_density.cell',
      status: 'pass',
      message: `Fixed skew-cell bins follow lattice axis ${options.latticeAxis}; both lateral axes are periodic`,
      metrics: { cellVolumeA3, lateralAreaA2, cellHeightA, axisPeriodic: lattice.periodic[latticeAxisIndex] },
    },
    {
      id: 'trajectory_density.cell_containment',
      status: 'pass',
      message: lattice.periodic[latticeAxisIndex]
        ? 'Profile-axis coordinates were wrapped into the fixed periodic cell'
        : 'Every selected atom remains inside the finite profile-axis cell domain',
      metrics: { maximumOutsideFraction },
    },
    {
      id: 'trajectory_density.cadence',
      status: cadencePs === null ? 'skipped' : 'pass',
      message: cadencePs === null
        ? 'One selected frame defines an instantaneous profile without time averaging'
        : `Selected frames have uniform ${cadencePs} ps cadence within relative error ${maximumCadenceRelativeError}`,
      metrics: { cadencePs, maximumCadenceRelativeError },
    },
    {
      id: 'trajectory_density.assignment_budget',
      status: 'pass',
      message: `Assigned ${atomFrameAssignments.toLocaleString()} of ${maxAtomFrameAssignments.toLocaleString()} allowed atom-frames`,
      metrics: { atomFrameAssignments, maxAtomFrameAssignments },
    },
    {
      id: 'trajectory_density.normalization',
      status: integrationError <= 1e-10 ? 'pass' : 'fail',
      message: integrationError <= 1e-10
        ? 'Integrated mean number density exactly recovers the selected atom count'
        : 'Integrated density does not recover the selected atom count',
      metrics: { integratedMeanAtomCount, selectedAtomCount: selectedAtomIndices.length, integrationError },
    },
    {
      id: 'trajectory_density.scope',
      status: 'warn',
      message: 'A finite binned number-density profile does not prove equilibration, interfacial stability, or bin/frame/trajectory/lateral-size convergence',
      metrics: { selectedFrameCount: frameIndices.length, binCount },
    },
  ]
  const peakBin = bins.reduce((best, bin) => (
    bin.totalNumberDensityPerA3 > best.totalNumberDensityPerA3 ? bin : best
  ), bins[0])
  const inspectionTargets: InspectionTarget[] = []
  if (peakBin.representative) {
    const focusFraction: Vec3 = [0.5, 0.5, 0.5]
    focusFraction[latticeAxisIndex] = peakBin.centerFraction
    inspectionTargets.push({
      id: 'trajectory-density-maximum-bin',
      reason: `Inspect maximum mean number-density bin ${peakBin.index} centered at ${peakBin.centerCoordinateA} Å along lattice axis ${options.latticeAxis}`,
      center: fractionalToCartesian(focusFraction, lattice.vectors),
      radius: Math.max(1, Math.sqrt(lateralAreaA2) / 2),
      atomIds: representativeFrameAtomIds[peakBin.index] ?? [peakBin.representative.atomId],
      trajectoryFrameIndex: peakBin.representative.frameIndex,
    })
  }
  const fingerprint = fingerprintCanonicalJson({
    structureFingerprint,
    trajectoryFingerprint,
    method,
    latticeAxis: options.latticeAxis,
    binCount,
    selectedSpecies,
    frameIndices,
    bins,
  })
  return {
    structureFingerprint,
    trajectoryFingerprint,
    fingerprint,
    method,
    latticeAxis: options.latticeAxis,
    latticeAxisIndex,
    axisPeriodic: lattice.periodic[latticeAxisIndex],
    normal,
    cellHeightA,
    lateralAreaA2,
    cellVolumeA3,
    binCount,
    selectedSpecies,
    selectedAtomCount: selectedAtomIndices.length,
    frameRange: {
      startFrameIndex,
      endFrameIndex,
      frameStride,
      frameIndices,
      frameCount: frameIndices.length,
      cadencePs,
      maximumCadenceRelativeError,
    },
    atomFrameAssignments,
    integratedMeanAtomCount,
    bins,
    verdict: 'warn',
    checks,
    inspectionTargets,
  }
}
