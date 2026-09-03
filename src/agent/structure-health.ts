/**
 * Post-commit structure health checks.
 *
 * `validateStructure` owns topology, overlap, and periodic self-image validity.
 * This module adds chemical and presentation checks that validation cannot see:
 * implausible or image-closing bonds, slab vacuum thickness, and atoms outside
 * the wrapped fractional cell. Minimum-distance results are reused rather than
 * recomputed so the commit path, review card, and MCP tools share one report.
 */

import { getElement } from '../lib/chemistry/elements'
import type { StructureValidationReport, ValidationCheck, ZatomLattice, ZatomStructure } from './contracts'
import {
  cartesianToFractional,
  createCertifiedMinimumImageCalculator,
  determinant3,
} from './structure-math'
import { validateStructure, type ValidateStructureOptions } from './structure-validation'

export interface StructureHealthOptions extends ValidateStructureOptions {
  /** Warn when bond length exceeds this multiple of the summed covalent radii. */
  bondLengthWarnRatio?: number
  /** Fail when bond length exceeds this multiple of the summed covalent radii. */
  bondLengthFailRatio?: number
  /** Warn when slab vacuum is thinner than this value in angstroms. */
  minVacuumA?: number
  /** Treat an axis as containing vacuum only when its largest gap reaches this value. */
  vacuumDetectionA?: number
}

export interface StructureHealthReport {
  verdict: 'pass' | 'warn' | 'fail'
  /** Core validation plus health checks, ordered for the review card. */
  checks: ValidationCheck[]
  validation: StructureValidationReport
  /** Vacuum thickness per periodic axis in angstroms; nonperiodic axes are null. */
  vacuumA: [number | null, number | null, number | null]
  longestBondA: number | null
}

/** Per-axis plane spacing `d = |V| / |cross(other vectors)|`, used to project vacuum gaps. */
function axisSpacings(lattice: ZatomLattice): [number, number, number] {
  const volume = Math.abs(determinant3(lattice.vectors))
  return [0, 1, 2].map((axis) => {
    const [u, v] = [0, 1, 2].filter((other) => other !== axis).map((index) => lattice.vectors[index])
    const cross = [
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0],
    ]
    const area = Math.hypot(cross[0], cross[1], cross[2])
    return area > 1e-12 ? volume / area : 0
  }) as [number, number, number]
}

function verdictOf(checks: readonly ValidationCheck[]): 'pass' | 'warn' | 'fail' {
  if (checks.some((check) => check.status === 'fail')) return 'fail'
  if (checks.some((check) => check.status === 'warn')) return 'warn'
  return 'pass'
}

/** Audit a structure without viewport state so every consumer receives the same result. */
export function auditStructureHealth(
  structure: ZatomStructure,
  options: StructureHealthOptions = {},
): StructureHealthReport {
  const bondLengthWarnRatio = Math.max(1, options.bondLengthWarnRatio ?? 1.30)
  const bondLengthFailRatio = Math.max(bondLengthWarnRatio, options.bondLengthFailRatio ?? 1.80)
  const minVacuumA = Math.max(0, options.minVacuumA ?? 10)
  const vacuumDetectionA = Math.max(0, options.vacuumDetectionA ?? 2)

  const validation = validateStructure(structure, options)
  const checks: ValidationCheck[] = [...validation.checks]
  const lattice = structure.lattice
  const latticeUsable = !!lattice && Math.abs(determinant3(lattice.vectors)) > 1e-8
  const byId = new Map(structure.atoms.map((atom) => [atom.id, atom]))
  const spacings = lattice && latticeUsable ? axisSpacings(lattice) : null

  // 1. Bond lengths.
  let longestBondA: number | null = null
  if (!structure.bonds?.length) {
    checks.push({
      id: 'health.bond_lengths',
      status: 'skipped',
      message: 'No explicit bonds to measure',
    })
  } else {
    const minimumImage = lattice && latticeUsable && lattice.periodic.some(Boolean)
      ? createCertifiedMinimumImageCalculator(lattice)
      : null
    const stretchedBondIds: string[] = []
    const brokenBondIds: string[] = []
    // A bond may look normal under minimum-image folding while its direct
    // endpoints span the cell. That stale image assignment renders as a long
    // crossing bond after supercell or slab operations. A half-cell test is
    // invalid here because orthogonal minimum-image distances never exceed it.
    const imageClosingBondIds: string[] = []
    let worstRatio = 0
    let worstBondId: string | null = null
    for (const bond of structure.bonds) {
      const left = byId.get(bond.atomIds[0])
      const right = byId.get(bond.atomIds[1])
      if (!left || !right) continue
      const direct = [0, 1, 2].map((axis) => right.position[axis] - left.position[axis]) as [number, number, number]
      const directLengthA = Math.hypot(direct[0], direct[1], direct[2])
      // Use the calculator's bounded default search because health checks run on
      // the interactive commit path and must not exhaustively search skew cells.
      const lengthA = minimumImage ? minimumImage(direct).distance : directLengthA
      if (!Number.isFinite(lengthA)) continue
      if (longestBondA === null || lengthA > longestBondA) longestBondA = lengthA
      const reference = getElement(left.element).covalentRadius + getElement(right.element).covalentRadius
      const ratio = reference > 1e-6 ? lengthA / reference : Infinity
      if (ratio > worstRatio) {
        worstRatio = ratio
        worstBondId = bond.id
      }
      if (ratio >= bondLengthFailRatio) brokenBondIds.push(bond.id)
      else if (ratio >= bondLengthWarnRatio) stretchedBondIds.push(bond.id)
      else if (reference > 1e-6 && directLengthA > bondLengthFailRatio * reference) {
        imageClosingBondIds.push(bond.id)
      }
    }
    const status = brokenBondIds.length
      ? 'fail'
      : stretchedBondIds.length || imageClosingBondIds.length ? 'warn' : 'pass'
    checks.push({
      id: 'health.bond_lengths',
      status,
      message: brokenBondIds.length
        ? `${brokenBondIds.length} bonds exceed ${bondLengthFailRatio.toFixed(2)}× the covalent reference length`
        : stretchedBondIds.length
          ? `${stretchedBondIds.length} bonds are stretched past ${bondLengthWarnRatio.toFixed(2)}× the covalent reference length`
          : imageClosingBondIds.length
            ? `${imageClosingBondIds.length} bonds only close through a periodic image; they draw across the cell unless atoms are wrapped`
            : `Bond lengths are within ${bondLengthWarnRatio.toFixed(2)}× of covalent reference lengths (longest ${(longestBondA ?? 0).toFixed(3)} Å)`,
      metrics: {
        longestBondA,
        worstCovalentRatio: Number.isFinite(worstRatio) ? worstRatio : null,
        worstBondId,
        imageClosingBonds: imageClosingBondIds.length,
      },
      atomIds: [...brokenBondIds, ...stretchedBondIds, ...imageClosingBondIds]
        .slice(0, 20)
        .flatMap((bondId) => structure.bonds!.find((bond) => bond.id === bondId)?.atomIds ?? []),
    })
  }

  // 2. Vacuum gap and 3. periodic wrapping.
  const vacuumA: [number | null, number | null, number | null] = [null, null, null]
  if (!lattice || !latticeUsable || !spacings) {
    checks.push({ id: 'health.vacuum_gap', status: 'skipped', message: 'No usable lattice for a vacuum-gap check' })
    checks.push({ id: 'health.periodic_wrap', status: 'skipped', message: 'No usable lattice for a wrapping check' })
  } else {
    const fractional = structure.atoms
      .map((atom) => cartesianToFractional(atom.position, lattice.vectors))
      .filter((value): value is [number, number, number] => !!value && value.every(Number.isFinite))
    // Vacuum is identified by anisotropy, not absolute empty space. A thin bulk
    // cell can also have a cell-wide gap along one coordinate. A slab requires
    // one axis to be distinctly emptier than the runner-up; equally sparse axes
    // describe sparse bulk rather than slab vacuum.
    const gapFractions: (number | null)[] = [null, null, null]
    for (const axis of [0, 1, 2]) {
      if (!lattice.periodic[axis] || fractional.length < 1) continue
      const wrapped = fractional
        .map((value) => value[axis] - Math.floor(value[axis]))
        .sort((left, right) => left - right)
      let largestGap = 1 - (wrapped[wrapped.length - 1] - wrapped[0])
      for (let index = 1; index < wrapped.length; index++) {
        largestGap = Math.max(largestGap, wrapped[index] - wrapped[index - 1])
      }
      gapFractions[axis] = largestGap
      vacuumA[axis] = largestGap * spacings[axis]
    }
    const ranked = [0, 1, 2]
      .filter((axis) => gapFractions[axis] !== null)
      .sort((left, right) => (gapFractions[right] ?? 0) - (gapFractions[left] ?? 0))
    const emptiestAxis = ranked[0]
    const emptiestFraction = emptiestAxis === undefined ? 0 : gapFractions[emptiestAxis] ?? 0
    const runnerUpFraction = ranked.length > 1 ? gapFractions[ranked[1]] ?? 0 : 0
    const vacuumAxis = emptiestAxis !== undefined
      && (vacuumA[emptiestAxis] ?? 0) >= vacuumDetectionA
      && emptiestFraction >= 0.5
      // Adsorbates legitimately occupy part of the vacuum and reduce the
      // largest empty fraction. 1.5× misclassified a small 2×2 slab + H2O as
      // bulk (0.744 vs 0.5); 1.25× still demands clear anisotropy while keeping
      // the post-adsorption sanity report consistent with surface detection.
      && (ranked.length === 1 || emptiestFraction >= 1.25 * runnerUpFraction)
      ? emptiestAxis
      : null
    const vacuumThicknessA = vacuumAxis === null ? null : vacuumA[vacuumAxis] ?? null
    const isThin = vacuumThicknessA !== null && vacuumThicknessA < minVacuumA
    checks.push({
      id: 'health.vacuum_gap',
      status: isThin ? 'warn' : 'pass',
      message: vacuumAxis === null
        ? 'No slab-like vacuum gap detected; treating the cell as bulk'
        : `Vacuum along ${'abc'[vacuumAxis]} is ${(vacuumThicknessA ?? 0).toFixed(2)} Å${isThin ? `, thinner than ${minVacuumA} Å` : ''}`,
      metrics: {
        vacuumAxis: vacuumAxis === null ? null : 'abc'[vacuumAxis],
        vacuumThicknessA,
        vacuumAlongA: vacuumA[0],
        vacuumAlongB: vacuumA[1],
        vacuumAlongC: vacuumA[2],
        minVacuumA,
        vacuumDetectionA,
      },
    })

    const unwrappedIds = structure.atoms.filter((atom) => {
      const value = cartesianToFractional(atom.position, lattice.vectors)
      if (!value) return false
      return [0, 1, 2].some((axis) => lattice.periodic[axis] && (value[axis] < -1e-6 || value[axis] >= 1 + 1e-6))
    }).map((atom) => atom.id)
    checks.push({
      id: 'health.periodic_wrap',
      status: unwrappedIds.length ? 'warn' : 'pass',
      message: unwrappedIds.length
        ? `${unwrappedIds.length} atoms sit outside the cell along a periodic axis; fragments may straddle the boundary`
        : 'Every atom lies inside the cell along periodic axes',
      atomIds: unwrappedIds.slice(0, 20),
    })
  }

  return { verdict: verdictOf(checks), checks, validation, vacuumA, longestBondA }
}

export interface StructureHealthSummary {
  verdict: 'pass' | 'warn' | 'fail'
  /** Review-card lines: passing checks are folded; warnings and failures remain separate. */
  lines: { status: ValidationCheck['status']; message: string }[]
}

/** Condense a health report into the few lines needed by the review card. */
export function summarizeStructureHealth(report: StructureHealthReport): StructureHealthSummary {
  const problems = report.checks.filter((check) => check.status === 'fail' || check.status === 'warn')
  const passed = report.checks.filter((check) => check.status === 'pass')
  const lines = problems.map((check) => ({ status: check.status, message: check.message }))
  if (passed.length) {
    lines.push({
      status: 'pass' as const,
      message: `${passed.length} checks passed`,
    })
  }
  return { verdict: report.verdict, lines }
}
