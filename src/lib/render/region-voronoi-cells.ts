import * as THREE from 'three'
import { grainColorHex } from '../polycrystal/grain-colors'
import type { MergedRegionHulls } from './region-hulls'

/**
 * Exact Voronoi cell geometry: each grain's cell is the data bbox clipped by the
 * bisector half-space against every other seed. Cells tile space by construction —
 * no gaps, no grooves (unlike atom-hull approximations). Output matches the
 * MergedRegionHulls shape so RegionSolids/flow machinery is unchanged: each cell
 * vertex binds to its nearest grain atom (offset preserved through the deform).
 */

type Face = THREE.Vector3[] // planar CCW loop

function cubeFaces(min: [number, number, number], max: [number, number, number]): Face[] {
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
  const [x0, y0, z0] = min, [x1, y1, z1] = max
  return [
    [v(x0, y0, z0), v(x0, y1, z0), v(x1, y1, z0), v(x1, y0, z0)], // z = z0
    [v(x0, y0, z1), v(x1, y0, z1), v(x1, y1, z1), v(x0, y1, z1)], // z = z1
    [v(x0, y0, z0), v(x1, y0, z0), v(x1, y0, z1), v(x0, y0, z1)], // y = y0
    [v(x0, y1, z0), v(x0, y1, z1), v(x1, y1, z1), v(x1, y1, z0)], // y = y1
    [v(x0, y0, z0), v(x0, y0, z1), v(x0, y1, z1), v(x0, y1, z0)], // x = x0
    [v(x1, y0, z0), v(x1, y1, z0), v(x1, y1, z1), v(x1, y0, z1)], // x = x1
  ]
}

/** Clip a convex polytope (face loops) by half-space n·x ≤ d; adds the cap face. */
function clipByPlane(faces: Face[], n: THREE.Vector3, d: number): Face[] {
  const out: Face[] = []
  const capPts: THREE.Vector3[] = []
  for (const f of faces) {
    const res: THREE.Vector3[] = []
    for (let i = 0; i < f.length; i++) {
      const a = f[i], b = f[(i + 1) % f.length]
      const da = n.dot(a) - d, db = n.dot(b) - d
      if (da <= 1e-9) res.push(a)
      if ((da < -1e-9 && db > 1e-9) || (da > 1e-9 && db < -1e-9)) {
        const t = da / (da - db)
        const p = a.clone().lerp(b, t)
        res.push(p)
        capPts.push(p)
      }
    }
    if (res.length >= 3) out.push(res)
  }
  if (capPts.length >= 3) {
    // dedupe near-identical points, then order them around the cap centroid
    const uniq: THREE.Vector3[] = []
    for (const p of capPts) if (!uniq.some((q) => q.distanceToSquared(p) < 1e-10)) uniq.push(p)
    if (uniq.length >= 3) {
      const c = uniq.reduce((s, p) => s.add(p), new THREE.Vector3()).divideScalar(uniq.length)
      const u = new THREE.Vector3(1, 0, 0).cross(n)
      if (u.lengthSq() < 1e-8) u.set(0, 1, 0).cross(n)
      u.normalize()
      const w = new THREE.Vector3().crossVectors(n, u)
      uniq.sort((p, q) => {
        const ap = Math.atan2(w.dot(p.clone().sub(c)), u.dot(p.clone().sub(c)))
        const aq = Math.atan2(w.dot(q.clone().sub(c)), u.dot(q.clone().sub(c)))
        return ap - aq
      })
      // wind so the face normal points OUT of the kept half-space (along n)
      const e1 = uniq[1].clone().sub(uniq[0]), e2 = uniq[2].clone().sub(uniq[0])
      if (e1.cross(e2).dot(n) < 0) uniq.reverse()
      out.push(uniq)
    }
  }
  return out
}

export function buildVoronoiCells(
  positions: Float32Array,
  regionOf: Uint32Array,
  regionIds: number[],
  seeds: Float32Array,
  bbMin: [number, number, number],
  bbMax: [number, number, number],
): MergedRegionHulls {
  const count = regionOf.length
  const nSeeds = seeds.length / 3
  // bucket atoms per region for vertex→atom binding
  const byRegion = new Map<number, number[]>()
  for (const id of regionIds) byRegion.set(id, [])
  for (let i = 0; i < count; i++) byRegion.get(regionOf[i])?.push(i)

  const posParts: number[] = []
  const colParts: number[] = []
  const atomParts: number[] = []
  const offParts: number[] = []
  const tmp = new THREE.Color()
  const n = new THREE.Vector3()

  for (const id of regionIds) {
    if (id >= nSeeds) continue
    const atomIdx = byRegion.get(id)!
    if (atomIdx.length === 0) continue // no atoms to bind/flow with
    const six = seeds[id * 3], siy = seeds[id * 3 + 1], siz = seeds[id * 3 + 2]
    let faces = cubeFaces(bbMin, bbMax)
    for (let j = 0; j < nSeeds && faces.length > 0; j++) {
      if (j === id) continue
      // bisector: keep points closer to seed i → n·x ≤ n·m, n = sj−si, m = midpoint
      n.set(seeds[j * 3] - six, seeds[j * 3 + 1] - siy, seeds[j * 3 + 2] - siz)
      const m = n.dot(new THREE.Vector3((seeds[j * 3] + six) / 2, (seeds[j * 3 + 1] + siy) / 2, (seeds[j * 3 + 2] + siz) / 2))
      faces = clipByPlane(faces, n.clone(), m)
    }
    if (faces.length === 0) continue
    tmp.set(grainColorHex(id))
    // bind helper: nearest atom of this grain (subsampled for big grains)
    const stride = atomIdx.length > 1500 ? Math.ceil(atomIdx.length / 1500) : 1
    const bindNearest = (p: THREE.Vector3): number => {
      let best = atomIdx[0], bd = Infinity
      for (let k = 0; k < atomIdx.length; k += stride) {
        const ai = atomIdx[k]
        const dx = positions[ai * 3] - p.x, dy = positions[ai * 3 + 1] - p.y, dz = positions[ai * 3 + 2] - p.z
        const dist = dx * dx + dy * dy + dz * dz
        if (dist < bd) { bd = dist; best = ai }
      }
      return best
    }
    for (const f of faces) {
      // fan-triangulate each planar face
      for (let k = 1; k + 1 < f.length; k++) {
        for (const p of [f[0], f[k], f[k + 1]]) {
          const ai = bindNearest(p)
          posParts.push(p.x, p.y, p.z)
          colParts.push(tmp.r, tmp.g, tmp.b)
          atomParts.push(ai)
          offParts.push(p.x - positions[ai * 3], p.y - positions[ai * 3 + 1], p.z - positions[ai * 3 + 2])
        }
      }
    }
  }

  return {
    positions: new Float32Array(posParts),
    colors: new Float32Array(colParts),
    atomIndex: new Uint32Array(atomParts),
    offsets: new Float32Array(offParts),
    vertexCount: atomParts.length,
  }
}
