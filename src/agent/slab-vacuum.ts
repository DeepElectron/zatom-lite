/**
 * Candidate-first slab-vacuum editing.
 *
 * Vacuum is a perpendicular cell spacing, not `|a|`, `|b|`, or `|c|` in an
 * oblique cell.  This module therefore grows only the component of the chosen
 * lattice vector normal to the opposite cell face.  Its in-plane shear and the
 * structure's periodic flags are left untouched.
 */

import { MIN_VACUUM_A } from '../lib/analysis/builders/adsorbate'
import { detectVacuum } from '../lib/scene-grid/system-semantics'
import type {
  InspectionTarget,
  StructureChangeSet,
  StructureProvenance,
  ValidationCheck,
  Vec3,
  ZatomLattice,
  ZatomStructure,
} from './contracts'
import { buildStructureChangeSet } from './operations'
import {
  boundsOfPositions,
  cartesianToFractional,
  fingerprintStructure,
} from './structure-math'
import { validateStructure } from './structure-validation'

export type SlabVacuumAxis = 'auto' | 'a' | 'b' | 'c'

export interface EnsureSlabVacuumOptions {
  structure: ZatomStructure
  /** Minimum empty spacing to retain around the slab. Defaults to 12 Å. */
  minimumVacuumA?: number
  /** Auto uses declared aperiodicity or a uniquely detected vacuum gap. */
  axis?: SlabVacuumAxis
}

export interface EnsureSlabVacuumResult {
  structure: ZatomStructure
  validation: ReturnType<typeof validateStructure>
  checks: ValidationCheck[]
  changeSet: StructureChangeSet
  provenance: StructureProvenance
  inspectionTargets: InspectionTarget[]
  changed: boolean
  metrics: {
    axis: 'a' | 'b' | 'c'
    axisIndex: 0 | 1 | 2
    axisResolution: 'explicit' | 'declared-aperiodic' | 'detected-vacuum' | 'thin-gap-inference'
    periodicAlongAxis: boolean
    requestedMinimumVacuumA: number
    sourceVacuumA: number
    achievedVacuumA: number
    addedVacuumA: number
    sourceCellSpacingA: number
    resultCellSpacingA: number
    recentered: boolean
  }
}

export class SlabVacuumInputError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'SlabVacuumInputError'
    this.code = code
  }
}

interface AxisGap {
  axis: 0 | 1 | 2
  normal: Vec3
  spacingA: number
  gapA: number
  gapFraction: number
  gapStartFraction: number
}

type AxisResolution = EnsureSlabVacuumResult['metrics']['axisResolution']

const AXES = [0, 1, 2] as const

function dot(left: readonly number[], right: readonly number[]): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2]
}

function cross(left: readonly number[], right: readonly number[]): Vec3 {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ]
}

function norm(vector: readonly number[]): number {
  return Math.hypot(vector[0], vector[1], vector[2])
}

function scale(vector: readonly number[], amount: number): Vec3 {
  return [vector[0] * amount, vector[1] * amount, vector[2] * amount]
}

function add(left: readonly number[], right: readonly number[]): Vec3 {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2]]
}

function subtract(left: readonly number[], right: readonly number[]): Vec3 {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]]
}

function modulo(value: number, period: number): number {
  return ((value % period) + period) % period
}

function cloneStructure(source: ZatomStructure): ZatomStructure {
  return {
    ...source,
    atoms: source.atoms.map((atom) => ({
      ...atom,
      position: [...atom.position] as Vec3,
    })),
    ...(source.bonds ? {
      bonds: source.bonds.map((bond) => ({
        ...bond,
        atomIds: [...bond.atomIds] as [string, string],
      })),
    } : {}),
    ...(source.lattice ? {
      lattice: {
        vectors: source.lattice.vectors.map((vector) => [...vector]) as [Vec3, Vec3, Vec3],
        periodic: [...source.lattice.periodic] as [boolean, boolean, boolean],
      },
    } : {}),
  }
}

/** Normal of the face opposite `axis`, oriented along the positive axis vector. */
function axisNormal(lattice: ZatomLattice, axis: 0 | 1 | 2): Vec3 {
  const other = AXES.filter((candidate) => candidate !== axis)
  const raw = cross(lattice.vectors[other[0]], lattice.vectors[other[1]])
  const length = norm(raw)
  if (!Number.isFinite(length) || length < 1e-10) {
    throw new SlabVacuumInputError('invalid_lattice', 'Vacuum requires a finite, nonsingular lattice.')
  }
  const unit = scale(raw, 1 / length)
  return dot(lattice.vectors[axis], unit) >= 0 ? unit : scale(unit, -1)
}

function analyzeAxisGap(
  structure: ZatomStructure,
  fractional: readonly Vec3[],
  axis: 0 | 1 | 2,
): AxisGap {
  const lattice = structure.lattice!
  const normal = axisNormal(lattice, axis)
  const spacingA = dot(lattice.vectors[axis], normal)
  if (!Number.isFinite(spacingA) || spacingA < 1e-8) {
    throw new SlabVacuumInputError('invalid_lattice', `Lattice axis ${'abc'[axis]} has no usable perpendicular spacing.`)
  }
  const coordinates = fractional
    .map((value) => modulo(value[axis], 1))
    .sort((left, right) => left - right)
  let gapFraction = -1
  let gapStartFraction = 0
  for (let index = 0; index < coordinates.length; index++) {
    const next = index + 1 < coordinates.length ? coordinates[index + 1] : coordinates[0] + 1
    const gap = next - coordinates[index]
    if (gap > gapFraction) {
      gapFraction = gap
      gapStartFraction = coordinates[index]
    }
  }
  return {
    axis,
    normal,
    spacingA,
    gapA: Math.max(0, gapFraction) * spacingA,
    gapFraction: Math.max(0, gapFraction),
    gapStartFraction,
  }
}

function resolveAxis(
  structure: ZatomStructure,
  analyses: readonly AxisGap[],
  requested: SlabVacuumAxis,
): { analysis: AxisGap; resolution: AxisResolution; sourceRecognizedAsSlab: boolean } {
  if (requested !== 'auto') {
    const axis = ({ a: 0, b: 1, c: 2 } as const)[requested]
    const automaticallyDetected = detectVacuum(structure).some((item) => item.axis === axis)
      || structure.lattice!.periodic.filter((periodic) => !periodic).length === 1
        && !structure.lattice!.periodic[axis]
    return {
      analysis: analyses[axis],
      resolution: 'explicit',
      sourceRecognizedAsSlab: automaticallyDetected,
    }
  }

  const aperiodic = AXES.filter((axis) => !structure.lattice!.periodic[axis])
  if (aperiodic.length === 1) {
    return {
      analysis: analyses[aperiodic[0]],
      resolution: 'declared-aperiodic',
      sourceRecognizedAsSlab: true,
    }
  }
  if (aperiodic.length > 1) {
    throw new SlabVacuumInputError(
      'ambiguous_vacuum_axis',
      `The lattice declares ${aperiodic.length} aperiodic axes. This looks like a wire, molecule box, or cluster rather than one slab; pass axis explicitly only after choosing the intended surface normal.`,
    )
  }

  const detectedAxes = new Set(detectVacuum(structure).map((item) => item.axis))
  const detected = analyses
    .filter((item) => detectedAxes.has(item.axis))
    .sort((left, right) => right.gapA - left.gapA || left.axis - right.axis)
  if (detected.length === 1) {
    return { analysis: detected[0], resolution: 'detected-vacuum', sourceRecognizedAsSlab: true }
  }
  if (detected.length > 1 && detected[0].gapA >= 1.5 * detected[1].gapA) {
    return { analysis: detected[0], resolution: 'detected-vacuum', sourceRecognizedAsSlab: true }
  }
  if (detected.length > 1) {
    throw new SlabVacuumInputError(
      'ambiguous_vacuum_axis',
      `Vacuum-like gaps were detected along ${detected.map((item) => `${'abc'[item.axis]} (${item.gapA.toFixed(2)} Å)`).join(', ')}. Pass axis explicitly so the Agent does not open the wrong face.`,
    )
  }

  // A slab with too little vacuum may sit just below the shared 5 Å surface
  // threshold. Infer it only when one gap is strongly anisotropic; otherwise a
  // bulk interlayer spacing must never be silently turned into a free surface.
  const ranked = [...analyses].sort((left, right) => right.gapA - left.gapA || left.axis - right.axis)
  const best = ranked[0]
  const runnerUp = ranked[1]
  if (best.gapA >= 2
    && best.gapFraction >= 0.3
    && best.gapA >= 1.5 * runnerUp.gapA
    && best.gapFraction >= 1.25 * runnerUp.gapFraction) {
    return { analysis: best, resolution: 'thin-gap-inference', sourceRecognizedAsSlab: true }
  }
  throw new SlabVacuumInputError(
    'vacuum_axis_not_found',
    `No unique slab-vacuum axis was found. Largest cyclic gaps are ${ranked.map((item) => `${'abc'[item.axis]}=${item.gapA.toFixed(2)} Å`).join(', ')}. For a bulk crystal, cut a Miller slab first; otherwise pass the known surface-normal axis explicitly.`,
  )
}

function nonPeriodicSpan(structure: ZatomStructure, normal: Vec3): { min: number; max: number; span: number } {
  const projections = structure.atoms.map((atom) => dot(atom.position, normal))
  const min = Math.min(...projections)
  const max = Math.max(...projections)
  return { min, max, span: max - min }
}

function surfaceTarget(structure: ZatomStructure, normal: Vec3, axis: 0 | 1 | 2): InspectionTarget[] {
  const projections = structure.atoms.map((atom) => dot(atom.position, normal))
  const top = Math.max(...projections)
  const atoms = structure.atoms.filter((_, index) => top - projections[index] <= 0.5)
  const bounds = boundsOfPositions(atoms.map((atom) => atom.position))
  if (!bounds) return []
  return [{
    id: 'vacuum-top-surface',
    reason: `Inspect the outward surface after ensuring vacuum along lattice axis ${'abc'[axis]}`,
    center: bounds.center,
    radius: Math.max(1, bounds.radius),
    atomIds: atoms.slice(0, 80).map((atom) => atom.id),
    atomIdsTruncated: atoms.length > 80,
  }]
}

/**
 * Ensure a minimum empty spacing along one slab axis without scaling atoms or
 * changing in-plane lattice vectors. Existing larger vacuum is never shrunk.
 */
export function ensureSlabVacuum(options: EnsureSlabVacuumOptions): EnsureSlabVacuumResult {
  const minimumVacuumA = options.minimumVacuumA ?? 12
  if (!Number.isFinite(minimumVacuumA)
    || minimumVacuumA < MIN_VACUUM_A
    || minimumVacuumA > 10_000) {
    throw new SlabVacuumInputError(
      'invalid_vacuum',
      `minimumVacuumA must be finite from ${MIN_VACUUM_A} through 10000 Å so the result remains a detectable exposed surface.`,
    )
  }
  const requestedAxis = options.axis ?? 'auto'
  if (requestedAxis !== 'auto' && requestedAxis !== 'a' && requestedAxis !== 'b' && requestedAxis !== 'c') {
    throw new SlabVacuumInputError('invalid_vacuum_axis', 'axis must be auto, a, b, or c.')
  }
  const sourceValidation = validateStructure(options.structure)
  if (sourceValidation.verdict === 'fail') {
    throw new SlabVacuumInputError('invalid_source_structure', 'Vacuum editing requires a numerically valid source structure.')
  }
  if (!options.structure.lattice) {
    throw new SlabVacuumInputError('slab_lattice_required', 'Vacuum editing requires a lattice; a finite molecule or cluster has no slab cell to expand.')
  }
  if (!options.structure.atoms.length) {
    throw new SlabVacuumInputError('surface_has_no_atoms', 'Vacuum editing requires at least one atom.')
  }
  const fractional = options.structure.atoms.map((atom) => cartesianToFractional(
    atom.position,
    options.structure.lattice!.vectors,
  ))
  if (fractional.some((value) => value === null)) {
    throw new SlabVacuumInputError('invalid_lattice', 'The lattice could not be inverted to measure its vacuum gap.')
  }
  const analyses = AXES.map((axis) => analyzeAxisGap(options.structure, fractional as Vec3[], axis))
  const resolved = resolveAxis(options.structure, analyses, requestedAxis)
  const { analysis } = resolved
  const periodicAlongAxis = options.structure.lattice.periodic[analysis.axis]
  const sourceNonPeriodicSpan = periodicAlongAxis
    ? null
    : nonPeriodicSpan(options.structure, analysis.normal)
  const sourceVacuumA = periodicAlongAxis
    ? analysis.gapA
    : Math.max(0, analysis.spacingA - sourceNonPeriodicSpan!.span)
  const targetVacuumA = Math.max(sourceVacuumA, minimumVacuumA)
  const addedVacuumA = Math.max(0, targetVacuumA - sourceVacuumA)
  const changed = addedVacuumA > 1e-7
  const structure = cloneStructure(options.structure)
  const periodicImageOffsets = new Array<number>(structure.atoms.length).fill(0)
  let recentered = false

  if (changed) {
    const oldAxisVector = structure.lattice!.vectors[analysis.axis]
    const resultSpacingA = periodicAlongAxis
      ? analysis.spacingA + addedVacuumA
      : sourceNonPeriodicSpan!.span + targetVacuumA
    const spacingDeltaA = resultSpacingA - analysis.spacingA
    structure.lattice!.vectors[analysis.axis] = add(
      oldAxisVector,
      scale(analysis.normal, spacingDeltaA),
    )

    if (periodicAlongAxis) {
      // Put the largest cyclic gap across the two cell boundaries. Every atom
      // is changed only by a normal translation plus an old lattice image, so
      // the slab's physical geometry and all in-plane coordinates are intact.
      const gapCenterFraction = modulo(
        analysis.gapStartFraction + analysis.gapFraction / 2,
        1,
      )
      const phaseA = gapCenterFraction * analysis.spacingA
      for (let index = 0; index < structure.atoms.length; index++) {
        const atom = structure.atoms[index]
        const sourceProjection = dot(atom.position, analysis.normal)
        const relativeProjection = sourceProjection - phaseA
        const unwrappedProjection = modulo(relativeProjection, analysis.spacingA)
        const imageOffset = Math.round(
          (unwrappedProjection - relativeProjection) / analysis.spacingA,
        )
        periodicImageOffsets[index] = imageOffset
        // The integer part must use the complete old lattice vector, including
        // its shear. Moving only by `imageOffset * spacing * normal` changes
        // in-plane geometry in an oblique cell. The remaining shift is one
        // common normal translation that centers the enlarged vacuum.
        const shift = add(
          scale(oldAxisVector, imageOffset),
          scale(analysis.normal, -phaseA + addedVacuumA / 2),
        )
        atom.position = add(atom.position, shift)
        if (norm(shift) > 1e-7) recentered = true
      }
    } else {
      // Aperiodic coordinates are not image-equivalent, so retain the whole
      // slab as one rigid body and center it in the longer open cell.
      const sourceCenterA = (sourceNonPeriodicSpan!.min + sourceNonPeriodicSpan!.max) / 2
      const targetCenterA = resultSpacingA / 2
      const shiftA = targetCenterA - sourceCenterA
      for (const atom of structure.atoms) {
        atom.position = add(atom.position, scale(analysis.normal, shiftA))
      }
      recentered = Math.abs(shiftA) > 1e-7
    }
  }

  const resultFractional = structure.atoms.map((atom) => cartesianToFractional(
    atom.position,
    structure.lattice!.vectors,
  ))
  const resultAnalysis = analyzeAxisGap(structure, resultFractional as Vec3[], analysis.axis)
  const resultNonPeriodicSpan = periodicAlongAxis
    ? null
    : nonPeriodicSpan(structure, analysis.normal)
  const achievedVacuumA = periodicAlongAxis
    ? resultAnalysis.gapA
    : Math.max(0, resultAnalysis.spacingA - resultNonPeriodicSpan!.span)
  const maxInPlaneDriftA = structure.atoms.reduce((maximum, atom, index) => {
    let displacement = subtract(atom.position, options.structure.atoms[index].position)
    if (periodicAlongAxis && periodicImageOffsets[index] !== 0) {
      // Periodic reimaging by the complete source vector is exactly equivalent
      // geometry, so remove it before measuring unintended in-plane drift.
      displacement = subtract(
        displacement,
        scale(options.structure.lattice!.vectors[analysis.axis], periodicImageOffsets[index]),
      )
    }
    const normalPart = scale(analysis.normal, dot(displacement, analysis.normal))
    return Math.max(maximum, norm(subtract(displacement, normalPart)))
  }, 0)
  const fractionsInsideAxis = resultFractional.every((value) => value !== null
    && value[analysis.axis] >= -1e-7
    && value[analysis.axis] <= 1 + 1e-7)
  const sourceParallelAxis = subtract(
    options.structure.lattice.vectors[analysis.axis],
    scale(analysis.normal, analysis.spacingA),
  )
  const resultParallelAxis = subtract(
    structure.lattice!.vectors[analysis.axis],
    scale(analysis.normal, resultAnalysis.spacingA),
  )
  const shearDriftA = norm(subtract(sourceParallelAxis, resultParallelAxis))
  const validation = validateStructure(structure)
  const checks: ValidationCheck[] = [
    {
      id: 'vacuum.axis_resolution',
      status: resolved.sourceRecognizedAsSlab ? 'pass' : 'warn',
      message: resolved.sourceRecognizedAsSlab
        ? `Resolved lattice axis ${'abc'[analysis.axis]} from ${resolved.resolution.replaceAll('-', ' ')} (${sourceVacuumA.toFixed(3)} Å source gap).`
        : `Used explicitly requested lattice axis ${'abc'[analysis.axis]}; the source was not independently recognized as a slab, so verify that this is the intended cleavage normal.`,
      metrics: {
        axis: 'abc'[analysis.axis],
        sourceRecognizedAsSlab: resolved.sourceRecognizedAsSlab,
        sourceGapA: sourceVacuumA,
      },
    },
    {
      id: 'vacuum.minimum_gap',
      status: achievedVacuumA + 1e-6 >= minimumVacuumA ? 'pass' : 'fail',
      message: changed
        ? `Vacuum along ${'abc'[analysis.axis]} is ${achievedVacuumA.toFixed(3)} Å (minimum ${minimumVacuumA.toFixed(3)} Å).`
        : `Existing ${sourceVacuumA.toFixed(3)} Å vacuum already meets the ${minimumVacuumA.toFixed(3)} Å minimum; no structure change is needed.`,
      metrics: {
        requestedMinimumVacuumA: minimumVacuumA,
        sourceVacuumA,
        achievedVacuumA,
        addedVacuumA,
      },
    },
    {
      id: 'vacuum.periodicity_preserved',
      status: structure.lattice!.periodic.every((value, axis) => value === options.structure.lattice!.periodic[axis]) ? 'pass' : 'fail',
      message: `Preserved periodicity flags [${structure.lattice!.periodic.map((value) => value ? 'periodic' : 'open').join(', ')}].`,
    },
    {
      id: 'vacuum.in_plane_geometry',
      status: maxInPlaneDriftA <= 1e-7 && shearDriftA <= 1e-7 ? 'pass' : 'fail',
      message: maxInPlaneDriftA <= 1e-7 && shearDriftA <= 1e-7
        ? 'Changed only perpendicular spacing; atom in-plane coordinates and lattice shear are unchanged.'
        : 'Vacuum editing introduced an unexpected in-plane displacement or lattice-shear change.',
      metrics: { maxAtomInPlaneDriftA: maxInPlaneDriftA, latticeShearDriftA: shearDriftA },
    },
    {
      id: 'vacuum.atoms_inside_cell',
      status: fractionsInsideAxis ? 'pass' : changed ? 'fail' : 'warn',
      message: fractionsInsideAxis
        ? `Every atom lies inside the result cell along ${'abc'[analysis.axis]}.`
        : `Some source atoms remain outside the canonical cell along ${'abc'[analysis.axis]}; vacuum was already sufficient, so the no-op candidate did not silently wrap them.`,
    },
    ...validation.checks,
  ]
  const changeSet = buildStructureChangeSet(options.structure, structure)
  const provenance: StructureProvenance = {
    engine: 'zatom-slab-vacuum',
    engineVersion: '1.0.0',
    sourceFingerprint: fingerprintStructure(options.structure),
    resultFingerprint: fingerprintStructure(structure),
    parameters: {
      axis: 'abc'[analysis.axis],
      axisResolution: resolved.resolution,
      minimumVacuumA,
      sourceVacuumA,
      achievedVacuumA,
      periodicAlongAxis,
    },
  }
  const inspectionTargets = [
    ...surfaceTarget(structure, analysis.normal, analysis.axis),
    ...validation.inspectionTargets,
  ]
  return {
    structure,
    validation,
    checks,
    changeSet,
    provenance,
    inspectionTargets,
    changed,
    metrics: {
      axis: 'abc'[analysis.axis] as 'a' | 'b' | 'c',
      axisIndex: analysis.axis,
      axisResolution: resolved.resolution,
      periodicAlongAxis,
      requestedMinimumVacuumA: minimumVacuumA,
      sourceVacuumA,
      achievedVacuumA,
      addedVacuumA,
      sourceCellSpacingA: analysis.spacingA,
      resultCellSpacingA: resultAnalysis.spacingA,
      recentered,
    },
  }
}
