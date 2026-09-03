/** Validated stitching for canonical continuation-trajectory segments. */

import type {
  InspectionTarget,
  Mat3,
  ValidationCheck,
  Vec3,
  ZatomLattice,
  ZatomTrajectory,
  ZatomTrajectoryFrame,
} from './contracts'
import { ZATOM_TRAJECTORY_SCHEMA } from './contracts'
import { fingerprintTrajectory, parseZatomTrajectory } from './trajectory'

const MAX_SEGMENTS = 64
const CANONICAL_LATTICE_TOLERANCE_A = 1e-8

export class ZatomTrajectoryStitchInputError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'ZatomTrajectoryStitchInputError'
    this.code = code
  }
}

export interface ZatomTrajectoryStitchOptions {
  segments: ZatomTrajectory[]
  label?: string
  maximumBoundaryPositionErrorA?: number
  maximumBoundaryVelocityErrorAperPs?: number
  maximumBoundaryLatticeErrorA?: number
  maximumBoundaryTimeErrorPs?: number
  requireBoundaryVelocities?: boolean
  requireParentFingerprintChain?: boolean
  maxFrames?: number
  maxAtomFrames?: number
}

export interface ZatomTrajectoryBoundaryAudit {
  boundaryIndex: number
  parentSegmentIndex: number
  childSegmentIndex: number
  parentFingerprint: string
  childFingerprint: string
  declaredParentFingerprint: string | null
  parentFrameIndex: number
  childFrameIndex: 0
  stitchedFrameIndex: number
  parentStep: number
  childStep: number
  parentTimePs: number
  childTimePs: number
  timeErrorPs: number
  maximumPositionErrorA: number
  maximumPositionErrorAtomId: string
  velocityAvailability: 'both' | 'neither' | 'parent-only' | 'child-only'
  maximumVelocityErrorAperPs: number | null
  maximumVelocityErrorAtomId: string | null
  latticeAvailability: 'both' | 'neither'
  maximumLatticeErrorA: number | null
  periodicFlagsMatch: boolean
}

export interface ZatomTrajectoryStitchResult {
  trajectory: ZatomTrajectory
  checks: ValidationCheck[]
  inspectionTargets: InspectionTarget[]
  boundaries: ZatomTrajectoryBoundaryAudit[]
  provenance: {
    engine: 'zatom-trajectory-stitch'
    engineVersion: '1.0.0'
    segmentFingerprints: string[]
    resultFingerprint: string
    parameters: {
      segmentCount: number
      maximumBoundaryPositionErrorA: number
      maximumBoundaryVelocityErrorAperPs: number
      maximumBoundaryLatticeErrorA: number
      maximumBoundaryTimeErrorPs: number
      requireBoundaryVelocities: boolean
      requireParentFingerprintChain: boolean
      maxFrames: number
      maxAtomFrames: number
    }
  }
}

function finiteBound(
  value: number | undefined,
  fallback: number,
  field: string,
  minimum: number,
  maximum: number,
): number {
  const result = value ?? fallback
  if (!Number.isFinite(result) || result < minimum || result > maximum) {
    throw new ZatomTrajectoryStitchInputError(
      'invalid_trajectory_stitch_parameter',
      `${field} must be from ${minimum} through ${maximum}`,
    )
  }
  return result
}

function integerBound(
  value: number | undefined,
  fallback: number,
  field: string,
  minimum: number,
  maximum: number,
): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) {
    throw new ZatomTrajectoryStitchInputError(
      'invalid_trajectory_stitch_parameter',
      `${field} must be an integer from ${minimum} through ${maximum}`,
    )
  }
  return result
}

function cloneLattice(lattice: ZatomLattice): ZatomLattice {
  return {
    vectors: lattice.vectors.map((row) => [...row]) as Mat3,
    periodic: [...lattice.periodic],
  }
}

function effectiveLattice(trajectory: ZatomTrajectory, frame: ZatomTrajectoryFrame): ZatomLattice | undefined {
  return frame.lattice ?? trajectory.lattice
}

function latticeError(left: ZatomLattice, right: ZatomLattice): number {
  return Math.max(...left.vectors.flatMap((row, rowIndex) => (
    row.map((value, axis) => Math.abs(value - right.vectors[rowIndex][axis]))
  )))
}

function maximumVectorError(left: Vec3[], right: Vec3[]): { error: number; atomIndex: number } {
  let maximum = -1
  let atomIndex = 0
  for (let index = 0; index < left.length; index++) {
    const error = Math.hypot(
      left[index][0] - right[index][0],
      left[index][1] - right[index][1],
      left[index][2] - right[index][2],
    )
    if (error > maximum) {
      maximum = error
      atomIndex = index
    }
  }
  return { error: maximum, atomIndex }
}

function cloneFrame(frame: ZatomTrajectoryFrame, lattice: ZatomLattice | undefined): ZatomTrajectoryFrame {
  return {
    step: frame.step,
    timePs: frame.timePs,
    positions: frame.positions.map((position) => [...position]),
    ...(frame.velocitiesAperPs ? {
      velocitiesAperPs: frame.velocitiesAperPs.map((velocity) => [...velocity]),
    } : {}),
    ...(frame.forcesEvPerA ? {
      forcesEvPerA: frame.forcesEvPerA.map((force) => [...force]),
    } : {}),
    ...(lattice ? { lattice: cloneLattice(lattice) } : {}),
    ...(frame.scalars ? { scalars: { ...frame.scalars } } : {}),
  }
}

function allAtomIdsEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index])
}

export function stitchZatomTrajectories(options: ZatomTrajectoryStitchOptions): ZatomTrajectoryStitchResult {
  if (!Array.isArray(options.segments) || options.segments.length < 2 || options.segments.length > MAX_SEGMENTS) {
    throw new ZatomTrajectoryStitchInputError(
      'invalid_trajectory_segments',
      `segments must contain 2-${MAX_SEGMENTS} canonical trajectories`,
    )
  }
  const maximumBoundaryPositionErrorA = finiteBound(
    options.maximumBoundaryPositionErrorA,
    1e-6,
    'maximumBoundaryPositionErrorA',
    0,
    100,
  )
  const maximumBoundaryVelocityErrorAperPs = finiteBound(
    options.maximumBoundaryVelocityErrorAperPs,
    1e-6,
    'maximumBoundaryVelocityErrorAperPs',
    0,
    1e9,
  )
  const maximumBoundaryLatticeErrorA = finiteBound(
    options.maximumBoundaryLatticeErrorA,
    1e-8,
    'maximumBoundaryLatticeErrorA',
    0,
    100,
  )
  const maximumBoundaryTimeErrorPs = finiteBound(
    options.maximumBoundaryTimeErrorPs,
    1e-12,
    'maximumBoundaryTimeErrorPs',
    0,
    1,
  )
  const maxFrames = integerBound(options.maxFrames, 10_000, 'maxFrames', 2, 10_000)
  const maxAtomFrames = integerBound(options.maxAtomFrames, 10_000_000, 'maxAtomFrames', 2, 10_000_000)
  const requireBoundaryVelocities = options.requireBoundaryVelocities ?? true
  const requireParentFingerprintChain = options.requireParentFingerprintChain ?? true
  if (typeof requireBoundaryVelocities !== 'boolean' || typeof requireParentFingerprintChain !== 'boolean') {
    throw new ZatomTrajectoryStitchInputError(
      'invalid_trajectory_stitch_parameter',
      'requireBoundaryVelocities and requireParentFingerprintChain must be boolean',
    )
  }

  const segments = options.segments.map((segment) => parseZatomTrajectory(segment))
  const first = segments[0]
  for (let index = 1; index < segments.length; index++) {
    if (!allAtomIdsEqual(first.atomIds, segments[index].atomIds)) {
      throw new ZatomTrajectoryStitchInputError(
        'trajectory_atom_identity_mismatch',
        `segments[${index}].atomIds do not exactly match segments[0]`,
      )
    }
    if (segments[index].coordinateMode !== first.coordinateMode) {
      throw new ZatomTrajectoryStitchInputError(
        'trajectory_coordinate_mode_mismatch',
        `segments[${index}].coordinateMode does not match segments[0]`,
      )
    }
  }

  const stitchedFrameCount = segments.reduce((sum, segment) => sum + segment.frames.length, 0) - segments.length + 1
  const stitchedAtomFrames = stitchedFrameCount * first.atomIds.length
  if (stitchedFrameCount > maxFrames || stitchedAtomFrames > maxAtomFrames) {
    throw new ZatomTrajectoryStitchInputError(
      'trajectory_stitch_budget_exceeded',
      `Projected stitched trajectory has ${stitchedFrameCount} frames/${stitchedAtomFrames} atom-frames above limits ${maxFrames}/${maxAtomFrames}`,
    )
  }

  const effectiveLattices = segments.flatMap((segment) => (
    segment.frames.map((frame) => effectiveLattice(segment, frame))
  ))
  const hasLattice = effectiveLattices.some((lattice) => lattice !== undefined)
  if (hasLattice && effectiveLattices.some((lattice) => lattice === undefined)) {
    throw new ZatomTrajectoryStitchInputError(
      'trajectory_lattice_mode_mismatch',
      'Every stitched frame must either have one effective lattice or all frames must be nonperiodic',
    )
  }
  const firstLattice = effectiveLattices.find((lattice): lattice is ZatomLattice => lattice !== undefined)
  if (firstLattice && effectiveLattices.some((lattice) => (
    lattice!.periodic.some((value, axis) => value !== firstLattice.periodic[axis])
  ))) {
    throw new ZatomTrajectoryStitchInputError(
      'trajectory_periodicity_mismatch',
      'Periodic boundary flags must remain constant across every stitched frame',
    )
  }
  const useVariableCell = !!firstLattice && effectiveLattices.some((lattice) => (
    latticeError(firstLattice, lattice!) > CANONICAL_LATTICE_TOLERANCE_A
  ))

  const segmentFingerprints = segments.map(fingerprintTrajectory)
  const boundaries: ZatomTrajectoryBoundaryAudit[] = []
  const inspectionTargets: InspectionTarget[] = []
  const stitchedFrames: ZatomTrajectoryFrame[] = []
  let effectiveLatticeIndex = 0
  for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex++) {
    const segment = segments[segmentIndex]
    if (segmentIndex > 0) {
      const parent = segments[segmentIndex - 1]
      const parentFrame = parent.frames[parent.frames.length - 1]
      const childFrame = segment.frames[0]
      const positionAudit = maximumVectorError(parentFrame.positions, childFrame.positions)
      const parentVelocity = parentFrame.velocitiesAperPs
      const childVelocity = childFrame.velocitiesAperPs
      const velocityAvailability: ZatomTrajectoryBoundaryAudit['velocityAvailability'] = parentVelocity && childVelocity
        ? 'both'
        : parentVelocity
          ? 'parent-only'
          : childVelocity
            ? 'child-only'
            : 'neither'
      const velocityAudit = parentVelocity && childVelocity
        ? maximumVectorError(parentVelocity, childVelocity)
        : null
      const parentLattice = effectiveLattice(parent, parentFrame)
      const childLattice = effectiveLattice(segment, childFrame)
      const maximumLatticeError = parentLattice && childLattice
        ? latticeError(parentLattice, childLattice)
        : null
      const periodicFlagsMatch = !parentLattice && !childLattice
        ? true
        : !!parentLattice && !!childLattice && parentLattice.periodic.every((value, axis) => value === childLattice.periodic[axis])
      const rawDeclaredParent = segment.metadata?.['zatom.provider.sourceTrajectoryFingerprint']
      const declaredParentFingerprint = typeof rawDeclaredParent === 'string' ? rawDeclaredParent : null
      const boundary: ZatomTrajectoryBoundaryAudit = {
        boundaryIndex: segmentIndex - 1,
        parentSegmentIndex: segmentIndex - 1,
        childSegmentIndex: segmentIndex,
        parentFingerprint: segmentFingerprints[segmentIndex - 1],
        childFingerprint: segmentFingerprints[segmentIndex],
        declaredParentFingerprint,
        parentFrameIndex: parent.frames.length - 1,
        childFrameIndex: 0,
        stitchedFrameIndex: stitchedFrames.length - 1,
        parentStep: parentFrame.step,
        childStep: childFrame.step,
        parentTimePs: parentFrame.timePs,
        childTimePs: childFrame.timePs,
        timeErrorPs: Math.abs(parentFrame.timePs - childFrame.timePs),
        maximumPositionErrorA: positionAudit.error,
        maximumPositionErrorAtomId: first.atomIds[positionAudit.atomIndex],
        velocityAvailability,
        maximumVelocityErrorAperPs: velocityAudit?.error ?? null,
        maximumVelocityErrorAtomId: velocityAudit ? first.atomIds[velocityAudit.atomIndex] : null,
        latticeAvailability: parentLattice && childLattice ? 'both' : 'neither',
        maximumLatticeErrorA: maximumLatticeError,
        periodicFlagsMatch,
      }
      boundaries.push(boundary)
      const leftPosition = parentFrame.positions[positionAudit.atomIndex]
      const rightPosition = childFrame.positions[positionAudit.atomIndex]
      inspectionTargets.push({
        id: `trajectory-stitch-boundary-${String(segmentIndex).padStart(4, '0')}`,
        reason: `Inspect the largest coordinate discontinuity at segment boundary ${segmentIndex - 1}→${segmentIndex}`,
        center: [
          (leftPosition[0] + rightPosition[0]) / 2,
          (leftPosition[1] + rightPosition[1]) / 2,
          (leftPosition[2] + rightPosition[2]) / 2,
        ],
        radius: Math.max(1.5, positionAudit.error + 0.5),
        atomIds: [first.atomIds[positionAudit.atomIndex]],
        trajectoryFrameIndex: stitchedFrames.length - 1,
      })
      const firstRetained = segment.frames[1]
      const previousRetained = stitchedFrames[stitchedFrames.length - 1]
      if (firstRetained.step <= previousRetained.step || firstRetained.timePs <= previousRetained.timePs) {
        throw new ZatomTrajectoryStitchInputError(
          'trajectory_stitch_nonmonotonic',
          `segments[${segmentIndex}] remains nonmonotonic after removing its duplicate boundary frame`,
        )
      }
    }
    for (let frameIndex = segmentIndex === 0 ? 0 : 1; frameIndex < segment.frames.length; frameIndex++) {
      const effective = effectiveLattices[effectiveLatticeIndex + frameIndex]
      stitchedFrames.push(cloneFrame(segment.frames[frameIndex], useVariableCell ? effective : undefined))
    }
    effectiveLatticeIndex += segment.frames.length
  }

  const stepTimeFailures = boundaries.filter((boundary) => (
    boundary.parentStep !== boundary.childStep || boundary.timeErrorPs > maximumBoundaryTimeErrorPs
  ))
  const positionFailures = boundaries.filter((boundary) => (
    boundary.maximumPositionErrorA > maximumBoundaryPositionErrorA
  ))
  const velocityHardFailures = boundaries.filter((boundary) => (
    (requireBoundaryVelocities && boundary.velocityAvailability !== 'both')
    || (boundary.maximumVelocityErrorAperPs !== null
      && boundary.maximumVelocityErrorAperPs > maximumBoundaryVelocityErrorAperPs)
  ))
  const velocityMissing = boundaries.filter((boundary) => boundary.velocityAvailability !== 'both')
  const latticeFailures = boundaries.filter((boundary) => (
    !boundary.periodicFlagsMatch
    || (boundary.maximumLatticeErrorA !== null && boundary.maximumLatticeErrorA > maximumBoundaryLatticeErrorA)
  ))
  const chainConflicts = boundaries.filter((boundary) => (
    boundary.declaredParentFingerprint !== null
    && boundary.declaredParentFingerprint !== boundary.parentFingerprint
  ))
  const chainMissing = boundaries.filter((boundary) => boundary.declaredParentFingerprint === null)
  const chainFailures = [
    ...chainConflicts,
    ...(requireParentFingerprintChain ? chainMissing : []),
  ]
  const maximumPositionBoundary = boundaries.reduce((worst, boundary) => (
    boundary.maximumPositionErrorA > worst.maximumPositionErrorA ? boundary : worst
  ))
  const velocityValues = boundaries.flatMap((boundary) => (
    boundary.maximumVelocityErrorAperPs === null ? [] : [boundary.maximumVelocityErrorAperPs]
  ))
  const latticeValues = boundaries.flatMap((boundary) => (
    boundary.maximumLatticeErrorA === null ? [] : [boundary.maximumLatticeErrorA]
  ))
  const checks: ValidationCheck[] = [
    {
      id: 'trajectory_stitch.segment_contract',
      status: 'pass',
      message: `Parsed ${segments.length} canonical segments and removed exactly ${segments.length - 1} duplicate boundary frames`,
      metrics: {
        segmentCount: segments.length,
        sourceFrameCount: segments.reduce((sum, segment) => sum + segment.frames.length, 0),
        stitchedFrameCount,
        removedBoundaryFrameCount: segments.length - 1,
        atomFrameCount: stitchedAtomFrames,
      },
    },
    {
      id: 'trajectory_stitch.atom_identity',
      status: 'pass',
      message: `Every segment uses the same ordered ${first.atomIds.length}-atom identity and ${first.coordinateMode} coordinate mode`,
      metrics: { atomCount: first.atomIds.length, coordinateMode: first.coordinateMode },
    },
    {
      id: 'trajectory_stitch.boundary_step_time',
      status: stepTimeFailures.length ? 'fail' : 'pass',
      message: stepTimeFailures.length
        ? `${stepTimeFailures.length} segment boundary/boundaries do not share the same step and physical time within ${maximumBoundaryTimeErrorPs} ps`
        : `All ${boundaries.length} boundaries share one duplicate step/time within ${maximumBoundaryTimeErrorPs} ps`,
      metrics: {
        boundaryCount: boundaries.length,
        failureCount: stepTimeFailures.length,
        maximumTimeErrorPs: Math.max(...boundaries.map((boundary) => boundary.timeErrorPs)),
        allowedMaximumTimeErrorPs: maximumBoundaryTimeErrorPs,
      },
    },
    {
      id: 'trajectory_stitch.boundary_positions',
      status: positionFailures.length ? 'fail' : 'pass',
      message: `Maximum Cartesian boundary-position discontinuity is ${maximumPositionBoundary.maximumPositionErrorA.toExponential(6)} Å against ${maximumBoundaryPositionErrorA.toExponential(6)} Å`,
      metrics: {
        failureCount: positionFailures.length,
        maximumBoundaryPositionErrorA: maximumPositionBoundary.maximumPositionErrorA,
        allowedMaximumBoundaryPositionErrorA: maximumBoundaryPositionErrorA,
        boundaryIndex: maximumPositionBoundary.boundaryIndex,
      },
      atomIds: [maximumPositionBoundary.maximumPositionErrorAtomId],
    },
    {
      id: 'trajectory_stitch.boundary_velocities',
      status: velocityHardFailures.length
        ? 'fail'
        : velocityMissing.length
          ? requireBoundaryVelocities ? 'fail' : 'warn'
          : velocityValues.length ? 'pass' : 'skipped',
      message: velocityHardFailures.length
        ? `${velocityHardFailures.length} boundary velocity gate(s) failed`
        : velocityMissing.length
          ? `${velocityMissing.length} boundaries lack velocities on one or both sides; coordinate continuity was retained without full state continuity`
          : velocityValues.length
            ? `Maximum boundary-velocity discontinuity is ${Math.max(...velocityValues).toExponential(6)} Å/ps against ${maximumBoundaryVelocityErrorAperPs.toExponential(6)} Å/ps`
            : 'No boundary contains velocity evidence',
      metrics: {
        boundaryCount: boundaries.length,
        comparedBoundaryCount: velocityValues.length,
        missingBoundaryCount: velocityMissing.length,
        failureCount: velocityHardFailures.length,
        maximumBoundaryVelocityErrorAperPs: velocityValues.length ? Math.max(...velocityValues) : null,
        allowedMaximumBoundaryVelocityErrorAperPs: maximumBoundaryVelocityErrorAperPs,
        requireBoundaryVelocities,
      },
    },
    {
      id: 'trajectory_stitch.boundary_lattice',
      status: latticeFailures.length ? 'fail' : 'pass',
      message: latticeFailures.length
        ? `${latticeFailures.length} boundary lattice gate(s) failed`
        : firstLattice
          ? `All periodic boundary cells match within ${maximumBoundaryLatticeErrorA} Å; output uses ${useVariableCell ? 'per-frame' : 'fixed'} lattice mode`
          : 'Every segment is nonperiodic',
      metrics: {
        boundaryCount: boundaries.length,
        failureCount: latticeFailures.length,
        maximumBoundaryLatticeErrorA: latticeValues.length ? Math.max(...latticeValues) : null,
        allowedMaximumBoundaryLatticeErrorA: maximumBoundaryLatticeErrorA,
        outputLatticeMode: firstLattice ? useVariableCell ? 'per-frame' : 'fixed' : 'none',
      },
    },
    {
      id: 'trajectory_stitch.parent_fingerprint_chain',
      status: chainFailures.length
        ? 'fail'
        : chainMissing.length
          ? 'warn'
          : 'pass',
      message: chainFailures.length
        ? `${chainFailures.length} parent fingerprint link(s) are missing or conflict with the supplied preceding segment`
        : chainMissing.length
          ? `${chainMissing.length} child segment(s) omit a broker parent fingerprint; geometric boundary checks passed but lineage is incomplete`
          : `All ${boundaries.length} child segments declare the exact supplied parent fingerprint`,
      metrics: {
        boundaryCount: boundaries.length,
        exactLinkCount: boundaries.length - chainMissing.length - chainConflicts.length,
        missingLinkCount: chainMissing.length,
        conflictingLinkCount: chainConflicts.length,
        requireParentFingerprintChain,
      },
    },
    {
      id: 'trajectory_stitch.model_scope',
      status: 'warn',
      message: 'Stitching removes validated duplicate boundary frames and normalizes fixed/per-frame lattice representation; it does not interpolate, resample, unwrap, repair discontinuities, recover hidden engine checkpoint state, or prove physical continuity/equilibration',
    },
  ]

  const trajectory = parseZatomTrajectory({
    schemaVersion: ZATOM_TRAJECTORY_SCHEMA,
    atomIds: [...first.atomIds],
    coordinateMode: first.coordinateMode,
    frames: stitchedFrames,
    ...(!firstLattice || useVariableCell ? {} : { lattice: cloneLattice(firstLattice) }),
    label: options.label?.trim() || `Stitched ${segments.length}-segment trajectory`,
    metadata: {
      'zatom.trajectory.stitch.segmentFingerprints': segmentFingerprints,
      'zatom.trajectory.stitch.segmentFrameCounts': segments.map((segment) => segment.frames.length),
      'zatom.trajectory.stitch.segmentLabels': segments.map((segment) => segment.label ?? ''),
      'zatom.trajectory.stitch.segmentCount': segments.length,
      'zatom.trajectory.stitch.removedBoundaryFrameCount': segments.length - 1,
    },
  }, { maxFrames, maxAtomFrames })
  const resultFingerprint = fingerprintTrajectory(trajectory)
  return {
    trajectory,
    checks,
    inspectionTargets,
    boundaries,
    provenance: {
      engine: 'zatom-trajectory-stitch',
      engineVersion: '1.0.0',
      segmentFingerprints,
      resultFingerprint,
      parameters: {
        segmentCount: segments.length,
        maximumBoundaryPositionErrorA,
        maximumBoundaryVelocityErrorAperPs,
        maximumBoundaryLatticeErrorA,
        maximumBoundaryTimeErrorPs,
        requireBoundaryVelocities,
        requireParentFingerprintChain,
        maxFrames,
        maxAtomFrames,
      },
    },
  }
}
