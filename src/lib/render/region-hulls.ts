import * as THREE from 'three'
import { ConvexGeometry } from 'three-stdlib'
import { grainColorHex } from '../polycrystal/grain-colors'

export interface MergedRegionHulls {
  /** merged non-indexed triangle soup, xyz per vertex */
  positions: Float32Array
  /** rgb (0..1) per vertex — region color */
  colors: Float32Array
  /** the atom index each hull vertex tracks (hull vertices ARE atom points) */
  atomIndex: Uint32Array
  /** per-vertex outward dilation (xyz) — closes the gap between neighbouring hulls
  *  (boundary atoms sit ~a lattice spacing short of the true Voronoi plane) */
  offsets: Float32Array
  vertexCount: number
}

const SAMPLE_CAP = 1200 // hull input points per region (hull of a subsample ≈ hull)
const DILATE = 1.6 // Å — push hull vertices outward to close inter-grain gaps

/**
 * Build one merged hull geometry over all regions: per region, take (subsampled)
 * atom positions → convex hull → triangles, tinted by grainColorHex(regionId).
 * Each output vertex maps back to exactly one atom (coordinate-key lookup), which
 * lets playback deform the hulls with their atoms ("flow").
 */
/**
 * Max outward travel from v along dir d that stays inside Voronoi cell `i`
 * (and inside the data bbox). Cell membership is linear in t per competing seed:
 * |v+td − s_j|² ≥ |v+td − s_i|² ⇔ t ≤ (|v−s_j|² − |v−s_i|²) / (2 d·(s_j−s_i)).
 */
function voronoiTravel(
  vx: number, vy: number, vz: number,
  dx: number, dy: number, dz: number,
  seeds: Float32Array, regionId: number,
  bboxMin: [number, number, number], bboxMax: [number, number, number],
): number {
  const six = seeds[regionId * 3], siy = seeds[regionId * 3 + 1], siz = seeds[regionId * 3 + 2]
  const di2 = (vx - six) ** 2 + (vy - siy) ** 2 + (vz - siz) ** 2
  let t = Infinity
  const nSeeds = seeds.length / 3
  for (let j = 0; j < nSeeds; j++) {
    if (j === regionId) continue
    const sjx = seeds[j * 3], sjy = seeds[j * 3 + 1], sjz = seeds[j * 3 + 2]
    const denom = 2 * (dx * (sjx - six) + dy * (sjy - siy) + dz * (sjz - siz))
    if (denom <= 1e-9) continue // moving away from this bisector
    const dj2 = (vx - sjx) ** 2 + (vy - sjy) ** 2 + (vz - sjz) ** 2
    const tj = (dj2 - di2) / denom
    if (tj < t) t = tj
  }
  // clip to the data bbox so border cells don't extend past the structure
  const v = [vx, vy, vz], d = [dx, dy, dz]
  for (let a = 0; a < 3; a++) {
    if (d[a] > 1e-9) t = Math.min(t, (bboxMax[a] - v[a]) / d[a])
    else if (d[a] < -1e-9) t = Math.min(t, (bboxMin[a] - v[a]) / d[a])
  }
  return Math.max(0, Number.isFinite(t) ? t : 0)
}

export function buildRegionHulls(
  positions: Float32Array,
  /** per-atom region id; entries < 0 (dynamic-cluster noise) belong to no region */
  regionOf: Uint32Array | Int32Array,
  regionIds: number[],
  /** Voronoi seeds (xyz per region id): snap hull vertices exactly onto the cell
  *  boundary — gap-free tiling. Absent → fixed 1.6Å dilation fallback. */
  seeds?: Float32Array | null,
): MergedRegionHulls {
  const count = regionOf.length
  // data bbox (clips border-cell projection)
  const bbMin: [number, number, number] = [Infinity, Infinity, Infinity]
  const bbMax: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < count; i++) {
    for (let a = 0; a < 3; a++) {
      const v = positions[i * 3 + a]
      if (v < bbMin[a]) bbMin[a] = v
      if (v > bbMax[a]) bbMax[a] = v
    }
  }
  // bucket atom indices per region
  const byRegion = new Map<number, number[]>()
  for (const id of regionIds) byRegion.set(id, [])
  for (let i = 0; i < count; i++) byRegion.get(regionOf[i])?.push(i)

  const posParts: Float32Array[] = []
  const colParts: Float32Array[] = []
  const atomParts: Uint32Array[] = []
  const offsetParts: Float32Array[] = []
  let total = 0

  const tmp = new THREE.Color()
  for (const id of regionIds) {
    const idx = byRegion.get(id)!
    if (idx.length < 4) continue // hull needs ≥4 non-coplanar points
    const stride = idx.length > SAMPLE_CAP ? Math.ceil(idx.length / SAMPLE_CAP) : 1
    const pts: THREE.Vector3[] = []
    const keyToAtom = new Map<string, number>()
    for (let j = 0; j < idx.length; j += stride) {
      const ai = idx[j]
      const x = positions[ai * 3], y = positions[ai * 3 + 1], z = positions[ai * 3 + 2]
      pts.push(new THREE.Vector3(x, y, z))
      keyToAtom.set(`${x},${y},${z}`, ai)
    }
    if (pts.length < 4) continue
    let geom: ConvexGeometry
    try {
      geom = new ConvexGeometry(pts)
    } catch {
      continue // degenerate (coplanar) region — skip its hull
    }
    const p = geom.getAttribute('position').array as Float32Array
    const n = p.length / 3
    const col = new Float32Array(p.length)
    const ati = new Uint32Array(n)
    const off = new Float32Array(p.length)
    // region centroid (of the hull input points) for outward dilation
    let cx = 0, cy = 0, cz = 0
    for (const pt of pts) { cx += pt.x; cy += pt.y; cz += pt.z }
    cx /= pts.length; cy /= pts.length; cz /= pts.length
    tmp.set(grainColorHex(id))
    const dilated = p.slice()
    for (let v = 0; v < n; v++) {
      col[v * 3] = tmp.r; col[v * 3 + 1] = tmp.g; col[v * 3 + 2] = tmp.b
      const key = `${p[v * 3]},${p[v * 3 + 1]},${p[v * 3 + 2]}`
      ati[v] = keyToAtom.get(key) ?? 0
      const dx = p[v * 3] - cx, dy = p[v * 3 + 1] - cy, dz = p[v * 3 + 2] - cz
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1
      const ux = dx / len, uy = dy / len, uz = dz / len
      // with seeds: travel exactly to the Voronoi cell boundary (gap-free tiling);
      // without: fixed dilation approximation
      const t = seeds && id * 3 + 2 < seeds.length
        ? voronoiTravel(p[v * 3], p[v * 3 + 1], p[v * 3 + 2], ux, uy, uz, seeds, id, bbMin, bbMax)
        : DILATE
      const ox = ux * t, oy = uy * t, oz = uz * t
      off[v * 3] = ox; off[v * 3 + 1] = oy; off[v * 3 + 2] = oz
      dilated[v * 3] += ox; dilated[v * 3 + 1] += oy; dilated[v * 3 + 2] += oz
    }
    posParts.push(dilated)
    colParts.push(col)
    atomParts.push(ati)
    offsetParts.push(off)
    total += n
    geom.dispose()
  }

  const mergedPos = new Float32Array(total * 3)
  const mergedCol = new Float32Array(total * 3)
  const mergedAtom = new Uint32Array(total)
  const mergedOff = new Float32Array(total * 3)
  let w = 0
  for (let k = 0; k < posParts.length; k++) {
    mergedPos.set(posParts[k], w * 3)
    mergedCol.set(colParts[k], w * 3)
    mergedAtom.set(atomParts[k], w)
    mergedOff.set(offsetParts[k], w * 3)
    w += atomParts[k].length
  }
  return { positions: mergedPos, colors: mergedCol, atomIndex: mergedAtom, offsets: mergedOff, vertexCount: total }
}
