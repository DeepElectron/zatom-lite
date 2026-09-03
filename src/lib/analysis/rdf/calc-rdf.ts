import type { LatticeVectors } from '../../crystal/types'
import type { Pbc, RdfOptions, RdfPattern, RdfStructure } from './types'

type Vec3 = [number, number, number]
type Mat3 = [Vec3, Vec3, Vec3]

function latticeToMatrix(lv: LatticeVectors): Mat3 {
  return [lv.a, lv.b, lv.c]
}

function matrixDet3(m: Mat3): number {
  return (
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
  )
}

function matrixInverse3(m: Mat3): Mat3 | null {
  const det = matrixDet3(m)
  if (Math.abs(det) < 1e-12) return null
  const inv = 1 / det
  return [
    [
      (m[1][1] * m[2][2] - m[1][2] * m[2][1]) * inv,
      (m[0][2] * m[2][1] - m[0][1] * m[2][2]) * inv,
      (m[0][1] * m[1][2] - m[0][2] * m[1][1]) * inv,
    ],
    [
      (m[1][2] * m[2][0] - m[1][0] * m[2][2]) * inv,
      (m[0][0] * m[2][2] - m[0][2] * m[2][0]) * inv,
      (m[0][2] * m[1][0] - m[0][0] * m[1][2]) * inv,
    ],
    [
      (m[1][0] * m[2][1] - m[1][1] * m[2][0]) * inv,
      (m[0][1] * m[2][0] - m[0][0] * m[2][1]) * inv,
      (m[0][0] * m[1][1] - m[0][1] * m[1][0]) * inv,
    ],
  ]
}

function vecLen(v: Vec3): number {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])
}

function volume(m: Mat3): number {
  return Math.abs(matrixDet3(m))
}

/** Minimum-image distance honoring per-axis PBC flags. */
function pbcDistance(
  a: Vec3,
  b: Vec3,
  lattice: Mat3,
  inv: Mat3,
  pbc: Pbc,
): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const dz = b[2] - a[2]
  // Cartesian → fractional via M^-1 (row-major lattice rows == basis vectors).
  let fa = dx * inv[0][0] + dy * inv[1][0] + dz * inv[2][0]
  let fb = dx * inv[0][1] + dy * inv[1][1] + dz * inv[2][1]
  let fc = dx * inv[0][2] + dy * inv[1][2] + dz * inv[2][2]
  if (pbc[0]) fa -= Math.round(fa)
  if (pbc[1]) fb -= Math.round(fb)
  if (pbc[2]) fc -= Math.round(fc)
  const cx = fa * lattice[0][0] + fb * lattice[1][0] + fc * lattice[2][0]
  const cy = fa * lattice[0][1] + fb * lattice[1][1] + fc * lattice[2][1]
  const cz = fa * lattice[0][2] + fb * lattice[1][2] + fc * lattice[2][2]
  return Math.sqrt(cx * cx + cy * cy + cz * cz)
}

function expandStructure(
  structure: RdfStructure,
  nx: number,
  ny: number,
  nz: number,
): RdfStructure {
  if (nx === 1 && ny === 1 && nz === 1) return structure
  const { a, b, c } = structure.latticeVectors
  const expanded: RdfStructure['sites'] = []
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      for (let k = 0; k < nz; k++) {
        for (const site of structure.sites) {
          expanded.push({
            element: site.element,
            cartesian: [
              site.cartesian[0] + i * a[0] + j * b[0] + k * c[0],
              site.cartesian[1] + i * a[1] + j * b[1] + k * c[1],
              site.cartesian[2] + i * a[2] + j * b[2] + k * c[2],
            ],
          })
        }
      }
    }
  }
  return {
    sites: expanded,
    latticeVectors: {
      a: [a[0] * nx, a[1] * nx, a[2] * nx],
      b: [b[0] * ny, b[1] * ny, b[2] * ny],
      c: [c[0] * nz, c[1] * nz, c[2] * nz],
    },
  }
}

/** One coordination shell around the selected centres. */
export interface NeighborShell {
  /** Shell radius in Å (mean of the distances clustered into it). */
  distance: number
  /** Neighbour count summed over every selected centre. */
  count: number
}

/**
 * Coordination shells around a set of selected atoms, in the same distance
 * metric as `calculateRdf` — that is what lets the caller draw them as
 * markers on top of a g(r) curve without them landing off-peak.
 *
 * This does a real lattice-image search rather than a single minimum-image
 * step: g(r) is routinely computed with a cutoff larger than half the
 * shortest lattice vector (the default cutoff is 10 Å), and minimum image
 * silently truncates every shell past that half-vector. Images are searched
 * over `ceil(cutoff / |axis|) + 1` cells per axis; `|axis|` overestimates the
 * perpendicular spacing of a skewed cell, so the `+ 1` covers the shortfall.
 *
 * Distances are clustered into shells with `tolerance` — pass the g(r) bin
 * width (cutoff / n_bins) so a shell can never be finer than the curve that
 * it annotates.
 */
export function selectionNeighborShells(
  structure: RdfStructure,
  centerIndices: number[],
  options: { cutoff?: number; pbc?: boolean; tolerance?: number; maxShells?: number } = {},
): NeighborShell[] {
  const { cutoff = 10, pbc = true, tolerance = 0.05, maxShells = 12 } = options
  if (centerIndices.length === 0 || cutoff <= 0) return []

  const sites = structure.sites
  const lattice = latticeToMatrix(structure.latticeVectors)
  const lens = [vecLen(lattice[0]), vecLen(lattice[1]), vecLen(lattice[2])]
  // A degenerate cell means "molecule": no images, plain Cartesian distances.
  const periodic = pbc && lens.every((l) => l > 1e-6) && Math.abs(matrixDet3(lattice)) > 1e-12
  const range = periodic
    ? (lens.map((l) => Math.ceil(cutoff / l) + 1) as Vec3)
    : ([0, 0, 0] as Vec3)

  const cutoffSq = cutoff * cutoff
  const found: number[] = []

  for (const ci of centerIndices) {
    const center = sites[ci]?.cartesian
    if (!center) continue
    for (let si = 0; si < sites.length; si++) {
      const target = sites[si].cartesian
      for (let ia = -range[0]; ia <= range[0]; ia++) {
        for (let ib = -range[1]; ib <= range[1]; ib++) {
          for (let ic = -range[2]; ic <= range[2]; ic++) {
            // Skip the atom's own home image; its own periodic replicas are
            // real neighbours and must stay in.
            if (si === ci && ia === 0 && ib === 0 && ic === 0) continue
            const dx = target[0] + ia * lattice[0][0] + ib * lattice[1][0] + ic * lattice[2][0] - center[0]
            const dy = target[1] + ia * lattice[0][1] + ib * lattice[1][1] + ic * lattice[2][1] - center[1]
            const dz = target[2] + ia * lattice[0][2] + ib * lattice[1][2] + ic * lattice[2][2] - center[2]
            const d2 = dx * dx + dy * dy + dz * dz
            if (d2 > 1e-10 && d2 <= cutoffSq) found.push(Math.sqrt(d2))
          }
        }
      }
    }
  }

  if (found.length === 0) return []
  found.sort((p, q) => p - q)

  const shells: NeighborShell[] = []
  let bucket: number[] = [found[0]]
  const flush = () => {
    const mean = bucket.reduce((s, v) => s + v, 0) / bucket.length
    shells.push({ distance: mean, count: bucket.length })
  }
  for (let i = 1; i < found.length; i++) {
    if (found[i] - bucket[0] <= tolerance) bucket.push(found[i])
    else { flush(); bucket = [found[i]] }
  }
  flush()

  return shells.slice(0, maxShells)
}

/**
 * Radial distribution function g(r) for a structure.
 *
 * If `auto_expand` is true (default), the cell is replicated until each
 * lattice vector is at least `expansion_factor × cutoff` long — this is
 * what prevents artificial close contacts at the cell boundary when the
 * cutoff exceeds half the shortest lattice vector. Expansion disables
 * PBC because the explicit replicas already account for periodicity.
 */
export function calculateRdf(structure: RdfStructure, options: RdfOptions = {}): RdfPattern {
  const {
    center_species,
    neighbor_species,
    cutoff = 15,
    n_bins = 75,
    auto_expand = true,
    expansion_factor = 2.0,
  } = options
  let pbc: Pbc = options.pbc ?? [true, true, true]

  if (cutoff <= 0 || n_bins <= 0) {
    throw new Error('cutoff and n_bins must be positive')
  }

  let working = structure
  if (auto_expand) {
    const m = latticeToMatrix(working.latticeVectors)
    const lens = [vecLen(m[0]), vecLen(m[1]), vecLen(m[2])]
    const minSize = cutoff * expansion_factor
    const [nx, ny, nz] = lens.map((len) => Math.max(1, Math.ceil(minSize / len))) as Vec3
    if (nx > 1 || ny > 1 || nz > 1) {
      working = expandStructure(working, nx, ny, nz)
      pbc = [false, false, false]
    }
  }

  const lattice = latticeToMatrix(working.latticeVectors)
  const usePbc = pbc[0] || pbc[1] || pbc[2]
  const inv = usePbc ? matrixInverse3(lattice) : null
  if (usePbc && !inv) {
    throw new Error('Lattice is singular; cannot use PBC')
  }

  const sites = working.sites
  const centers = center_species
    ? sites.filter((s) => s.element === center_species)
    : sites
  const neighbors = neighbor_species
    ? sites.filter((s) => s.element === neighbor_species)
    : sites

  const binSize = cutoff / n_bins
  const r = Array.from({ length: n_bins }, (_, i) => (i + 0.5) * binSize)
  const g_r = new Array(n_bins).fill(0) as number[]
  const elementPair: [string, string] | undefined = center_species && neighbor_species
    ? [center_species, neighbor_species]
    : undefined

  if (centers.length === 0 || neighbors.length === 0) {
    return { r, g_r, element_pair: elementPair }
  }

  for (const center of centers) {
    for (const neighbor of neighbors) {
      if (center === neighbor) continue
      const dist = usePbc && inv
        ? pbcDistance(center.cartesian, neighbor.cartesian, lattice, inv, pbc)
        : Math.sqrt(
            (center.cartesian[0] - neighbor.cartesian[0]) ** 2 +
              (center.cartesian[1] - neighbor.cartesian[1]) ** 2 +
              (center.cartesian[2] - neighbor.cartesian[2]) ** 2,
          )
      if (dist > 0 && dist < cutoff) {
        const idx = Math.min(Math.floor(dist / binSize), n_bins - 1)
        g_r[idx] += 1
      }
    }
  }

  // Normalize to ideal-gas density: 4π r² Δr × ρ × N_pairs.
  const nPairs = center_species === neighbor_species && center_species !== undefined
    ? centers.length * Math.max(0, neighbors.length - 1)
    : centers.length * neighbors.length
  if (nPairs > 0) {
    const vol = volume(lattice)
    const density = neighbors.length / vol
    for (let i = 0; i < n_bins; i++) {
      const shell = 4 * Math.PI * r[i] * r[i] * binSize
      const denom = nPairs * shell * density / neighbors.length
      g_r[i] = denom > 0 ? g_r[i] / denom : 0
    }
  }

  return { r, g_r, element_pair: elementPair }
}

/** g(r) for every unique element pair in the structure. */
export function calculateAllPairRdfs(
  structure: RdfStructure,
  options: Omit<RdfOptions, 'center_species' | 'neighbor_species'> = {},
): RdfPattern[] {
  const elements = [...new Set(structure.sites.map((s) => s.element))].sort()

  let working = structure
  let baseOptions = options
  if (options.auto_expand !== false) {
    const { cutoff = 15, expansion_factor = 2.0 } = options
    const m = latticeToMatrix(working.latticeVectors)
    const lens = [vecLen(m[0]), vecLen(m[1]), vecLen(m[2])]
    const minSize = cutoff * expansion_factor
    const [nx, ny, nz] = lens.map((len) => Math.max(1, Math.ceil(minSize / len))) as Vec3
    if (nx > 1 || ny > 1 || nz > 1) {
      working = expandStructure(working, nx, ny, nz)
      baseOptions = { ...options, auto_expand: false, pbc: [false, false, false] }
    } else {
      baseOptions = { ...options, auto_expand: false }
    }
  }

  return elements.flatMap((centerEl, idx) =>
    elements.slice(idx).map((neighborEl) =>
      calculateRdf(working, {
        ...baseOptions,
        center_species: centerEl,
        neighbor_species: neighborEl,
      }),
    ),
  )
}
