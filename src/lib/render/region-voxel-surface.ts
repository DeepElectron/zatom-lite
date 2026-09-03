import { grainColorHex } from '../polycrystal/grain-colors'
import type { MergedRegionHulls } from './region-hulls'

/**
 * Layer ③ of the dynamic region pipeline, concave-friendly geometry: voxelize each
 * region onto a uniform grid and mesh its exposed boundary faces with GREEDY rectangle
 * merging (coplanar same-region faces collapse into large quads — a thin slab's
 * top/bottom would otherwise emit one quad per atom and per-frame rebuilds would choke
 * on buffer churn). Output is shaped exactly like buildRegionHulls (non-indexed soup +
 * per-vertex atomIndex/offsets), so it drops into the existing renderer and playback
 * deformation path unchanged.
 */

const MAX_GRID_CELLS = 64_000_000 // dense-grid guard: above this, bail (sparse impl = future)

function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
  ]
}

const EMPTY: MergedRegionHulls = {
  positions: new Float32Array(0), colors: new Float32Array(0),
  atomIndex: new Uint32Array(0), offsets: new Float32Array(0), vertexCount: 0,
}

export function buildVoxelSurface(
  positions: Float32Array,
  count: number,
  regionOf: Int32Array | Uint32Array,
  cell: number,
  /** map regionId → color id (e.g. the region's LABEL for frame-stable colors); default identity */
  colorIdOf?: (regionId: number) => number,
): MergedRegionHulls {
  if (count === 0 || cell <= 0) return EMPTY
  const inv = 1 / cell
  // absolute integer voxel coords + grid extent (only atoms in real regions count)
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  for (let i = 0; i < count; i++) {
    if (regionOf[i] < 0) continue
    const x = Math.floor(positions[i * 3] * inv), y = Math.floor(positions[i * 3 + 1] * inv), z = Math.floor(positions[i * 3 + 2] * inv)
    if (x < minX) minX = x; if (y < minY) minY = y; if (z < minZ) minZ = z
    if (x > maxX) maxX = x; if (y > maxY) maxY = y; if (z > maxZ) maxZ = z
  }
  if (!Number.isFinite(minX)) return EMPTY
  const nx = maxX - minX + 1, ny = maxY - minY + 1, nz = maxZ - minZ + 1
  if (nx * ny * nz > MAX_GRID_CELLS) return EMPTY
  const minI = [minX, minY, minZ]
  const dims = [nx, ny, nz]

  // dense voxel grids: region id (-1 empty) + owner atom (first atom wins)
  const regionGrid = new Int32Array(nx * ny * nz).fill(-1)
  const ownerGrid = new Int32Array(nx * ny * nz)
  const vidx = (x: number, y: number, z: number) => (x * ny + y) * nz + z
  for (let i = 0; i < count; i++) {
    const r = regionOf[i]
    if (r < 0) continue
    const x = Math.floor(positions[i * 3] * inv) - minX
    const y = Math.floor(positions[i * 3 + 1] * inv) - minY
    const z = Math.floor(positions[i * 3 + 2] * inv) - minZ
    const k = vidx(x, y, z)
    if (regionGrid[k] === -1) { regionGrid[k] = r; ownerGrid[k] = i }
  }

  // region color cache (by colorId so frame-stable label coloring is possible)
  const colorCache = new Map<number, [number, number, number]>()
  const colorOf = (r: number): [number, number, number] => {
    const cid = colorIdOf ? colorIdOf(r) : r
    let c = colorCache.get(cid)
    if (!c) { c = hexToRgb(grainColorHex(cid)); colorCache.set(cid, c) }
    return c
  }

  const pos: number[] = [], col: number[] = [], atom: number[] = [], off: number[] = []
  /** Emit one rectangle: plane slice sl along axis d, span [i,i+w)×[j,j+h) in (u,v). */
  const emitQuad = (
    d: number, u: number, v: number, sl: number,
    i: number, j: number, w: number, h: number,
    region: number, owner: number, positiveFace: boolean,
  ) => {
    const [cr, cg, cb] = colorOf(region)
    const planeW = (minI[d] + sl) * cell
    const corner = (iu: number, jv: number): [number, number, number] => {
      const p: [number, number, number] = [0, 0, 0]
      p[d] = planeW
      p[u] = (minI[u] + iu) * cell
      p[v] = (minI[v] + jv) * cell
      return p
    }
    const c0 = corner(i, j), c1 = corner(i + w, j), c2 = corner(i + w, j + h), c3 = corner(i, j + h)
    // (u,v,d) is a cyclic triple, so CCW in (u→v) order faces +d; reverse for −d.
    const tri = positiveFace ? [c0, c1, c2, c0, c2, c3] : [c0, c2, c1, c0, c3, c2]
    const ax = positions[owner * 3], ay = positions[owner * 3 + 1], az = positions[owner * 3 + 2]
    for (const p of tri) {
      pos.push(p[0], p[1], p[2])
      col.push(cr, cg, cb)
      atom.push(owner)
      off.push(p[0] - ax, p[1] - ay, p[2] - az)
    }
  }

  // per axis: sweep boundary planes, build a (u,v) mask per face direction, greedy-merge
  for (let d = 0; d < 3; d++) {
    const u = (d + 1) % 3, v = (d + 2) % 3
    const dimU = dims[u], dimV = dims[v]
    const mask = new Int32Array(dimU * dimV)
    const ownerMask = new Int32Array(dimU * dimV)
    const voxAt = (sl: number, iu: number, jv: number): number => {
      if (sl < 0 || sl >= dims[d]) return -1
      const c: [number, number, number] = [0, 0, 0]
      c[d] = sl; c[u] = iu; c[v] = jv
      return vidx(c[0], c[1], c[2])
    }
    for (let sl = 0; sl <= dims[d]; sl++) {
      for (const positiveFace of [true, false]) {
        mask.fill(-1)
        let any = false
        for (let jv = 0; jv < dimV; jv++) {
          for (let iu = 0; iu < dimU; iu++) {
            const ka = voxAt(sl - 1, iu, jv), kb = voxAt(sl, iu, jv)
            const ra = ka >= 0 ? regionGrid[ka] : -1
            const rb = kb >= 0 ? regionGrid[kb] : -1
            // +face belongs to voxel A (below the plane) when exposed toward +d;
            // −face belongs to voxel B (above the plane) when exposed toward −d.
            const show = positiveFace ? (ra >= 0 && rb !== ra) : (rb >= 0 && ra !== rb)
            if (!show) continue
            const m = jv * dimU + iu
            mask[m] = positiveFace ? ra : rb
            ownerMask[m] = positiveFace ? ownerGrid[ka] : ownerGrid[kb]
            any = true
          }
        }
        if (!any) continue
        // greedy rectangles
        for (let jv = 0; jv < dimV; jv++) {
          for (let iu = 0; iu < dimU; iu++) {
            const m0 = jv * dimU + iu
            const r = mask[m0]
            if (r < 0) continue
            let w = 1
            while (iu + w < dimU && mask[m0 + w] === r) w++
            let h = 1
            expand: while (jv + h < dimV) {
              for (let k = 0; k < w; k++) if (mask[(jv + h) * dimU + iu + k] !== r) break expand
              h++
            }
            emitQuad(d, u, v, sl, iu, jv, w, h, r, ownerMask[m0], positiveFace)
            for (let jj = 0; jj < h; jj++) for (let ii = 0; ii < w; ii++) mask[(jv + jj) * dimU + iu + ii] = -1
          }
        }
      }
    }
  }

  return {
    positions: Float32Array.from(pos),
    colors: Float32Array.from(col),
    atomIndex: Uint32Array.from(atom),
    offsets: Float32Array.from(off),
    vertexCount: pos.length / 3,
  }
}
