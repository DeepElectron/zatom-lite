import type { BaseCell, Grain } from './types'
import type { SeedGrid } from './seeds'
import { applyMatrix } from './orientation'

export interface FillArrays {
  positions: Float32Array
  elementIndex: Uint8Array
  grainId: Uint32Array
  basisIndex: Uint32Array
  elements: string[]
  count: number
}

/**
 * For each grain: lay its rotated lattice over the whole box and keep a site iff
 * the site's nearest seed is this grain (== Voronoi membership). We iterate
 * integer lattice translations from the grain seed out to a radius covering the
 * box, then test each basis site.
 */
export function fillGrains(
  base: BaseCell,
  grains: Grain[],
  boxSize: number,
  seedGrid: SeedGrid,
  maxAtoms: number,
  onProgress?: (fraction: number) => void,
): FillArrays {
  const { a, b, c } = base.latticeVectors
  const elements: string[] = []
  const elementIdxBySym = new Map<string, number>()
  const elemIndexOf = (sym: string): number => {
    let idx = elementIdxBySym.get(sym)
    if (idx === undefined) {
      if (elements.length >= 256) throw new Error('Polycrystal supports at most 256 distinct elements')
      idx = elements.length; elements.push(sym); elementIdxBySym.set(sym, idx)
    }
    return idx
  }

  // dynamic arrays
  let cap = Math.min(1 << 16, maxAtoms)
  let positions = new Float32Array(cap * 3)
  let elementIndex = new Uint8Array(cap)
  let grainId = new Uint32Array(cap)
  let basisIndex = new Uint32Array(cap)
  let count = 0
  const push = (x: number, y: number, z: number, ei: number, g: number, sourceSite: number) => {
    if (count >= maxAtoms) throw new Error(`Polycrystal exceeds the ${maxAtoms}-atom generation budget`)
    if (count >= cap) {
      cap = Math.min(cap * 2, maxAtoms)
      const np = new Float32Array(cap * 3); np.set(positions); positions = np
      const ne = new Uint8Array(cap); ne.set(elementIndex); elementIndex = ne
      const ng = new Uint32Array(cap); ng.set(grainId); grainId = ng
      const nb = new Uint32Array(cap); nb.set(basisIndex); basisIndex = nb
    }
    positions[count * 3] = x; positions[count * 3 + 1] = y; positions[count * 3 + 2] = z
    elementIndex[count] = ei; grainId[count] = g; basisIndex[count] = sourceSite; count++
  }

  // Hard cap on shell radius — a sphere of radius = box diagonal always covers
  // the box from any seed, so no grain can need more. Used only as a runaway
  // guard; the empty-shell termination below normally stops far sooner.
  const diag = boxSize * Math.sqrt(3)
  const aLen = Math.hypot(...a), bLen = Math.hypot(...b), cLen = Math.hypot(...c)
  const maxR = Math.ceil(diag / Math.min(aLen, bLen, cLen)) + 1

  for (let gi = 0; gi < grains.length; gi++) {
    const g = grains[gi]
    // rotate lattice vectors once per grain
    const ra3 = applyMatrix(g.rotation, a as [number, number, number])
    const rb3 = applyMatrix(g.rotation, b as [number, number, number])
    const rc3 = applyMatrix(g.rotation, c as [number, number, number])

    // Test one lattice cell (origin i,j,k) against box + Voronoi membership.
    // Returns how many basis sites were kept.
    const testCell = (i: number, j: number, k: number): number => {
      const ox = g.seed[0] + i * ra3[0] + j * rb3[0] + k * rc3[0]
      const oy = g.seed[1] + i * ra3[1] + j * rb3[1] + k * rc3[1]
      const oz = g.seed[2] + i * ra3[2] + j * rb3[2] + k * rc3[2]
      let kept = 0
      for (const [sourceSite, site] of base.basis.entries()) {
        const fx = site.frac[0], fy = site.frac[1], fz = site.frac[2]
        const x = ox + fx * ra3[0] + fy * rb3[0] + fz * rc3[0]
        const y = oy + fx * ra3[1] + fy * rb3[1] + fz * rc3[1]
        const z = oz + fx * ra3[2] + fy * rb3[2] + fz * rc3[2]
        if (x < 0 || x > boxSize || y < 0 || y > boxSize || z < 0 || z > boxSize) continue
        if (seedGrid.nearest([x, y, z]) !== gi) continue
        push(x, y, z, elemIndexOf(site.element), gi, sourceSite)
        kept++
      }
      return kept
    }

    // Expand Chebyshev shells outward from the seed. A grain's Voronoi cell is
    // convex and bounded, so once whole shells stop contributing atoms the cell
    // is fully filled — bounding work to ~O(cell volume) instead of O(box³).
    // Require 2 consecutive empty shells to bridge discrete-lattice gaps.
    let emptyStreak = 0
    for (let r = 0; r <= maxR; r++) {
      let keptThisShell = 0
      if (r === 0) {
        keptThisShell += testCell(0, 0, 0)
      } else {
        // top/bottom faces (k = ±r)
        for (let i = -r; i <= r; i++)
          for (let j = -r; j <= r; j++) {
            keptThisShell += testCell(i, j, -r)
            keptThisShell += testCell(i, j, r)
          }
        // side bands (|k| < r): i = ±r and j = ±r
        for (let k = -r + 1; k <= r - 1; k++) {
          for (let i = -r; i <= r; i++) {
            keptThisShell += testCell(i, -r, k)
            keptThisShell += testCell(i, r, k)
          }
          for (let j = -r + 1; j <= r - 1; j++) {
            keptThisShell += testCell(-r, j, k)
            keptThisShell += testCell(r, j, k)
          }
        }
      }
      if (r > 0 && keptThisShell === 0) {
        emptyStreak++
        if (emptyStreak >= 2) break
      } else {
        emptyStreak = 0
      }
    }
    if (onProgress) onProgress((gi + 1) / grains.length)
  }

  return {
    positions: positions.subarray(0, count * 3).slice(),
    elementIndex: elementIndex.subarray(0, count).slice(),
    grainId: grainId.subarray(0, count).slice(),
    basisIndex: basisIndex.subarray(0, count).slice(),
    elements,
    count,
  }
}
