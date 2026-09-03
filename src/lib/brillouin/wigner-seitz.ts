/**
 * Dependency-free Wigner–Seitz construction of the first Brillouin zone.
 * Reciprocal neighbors define Bragg half-spaces; intersections of plane triples
 * that satisfy every half-space become vertices. Coplanar vertices are sorted
 * into faces, and pairs sharing at least two planes become edges.
 */

export type Vec3 = readonly [number, number, number]
export type Matrix3 = readonly [Vec3, Vec3, Vec3]

const DEFAULT_TOL = 1e-6

// ── Basic geometry ──────────────────────────────────────────────────────────

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ]
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

export function scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s]
}

export function norm(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2])
}

export function normalize(a: Vec3): Vec3 {
  const n = norm(a)
  if (n < 1e-12) return [0, 0, 0]
  return [a[0] / n, a[1] / n, a[2] / n]
}

/** Convert direct to reciprocal basis: b_i = 2π(a_j×a_k)/V. */
export function reciprocalLattice(a1: Vec3, a2: Vec3, a3: Vec3): Matrix3 {
  const v = dot(a1, cross(a2, a3))
  if (Math.abs(v) < 1e-12) {
    throw new Error('reciprocalLattice: lattice vectors are coplanar (V=0)')
  }
  const factor = (2 * Math.PI) / v
  return [
    scale(cross(a2, a3), factor),
    scale(cross(a3, a1), factor),
    scale(cross(a1, a2), factor),
  ]
}

// ── Plane intersection ───────────────────────────────────────────────────────────

interface BraggPlane {
  /** normalized normal vector (points from origin towards the lattice point) */
  normal: Vec3
  /** signed distance from origin to plane: N · p = d (>0, half of |G|) */
  d: number
  /** original G vector index (for dedup) */
  index: number
}

/** Intersect three planes, returning null for a singular normal matrix. */
function intersectThreePlanes(p1: BraggPlane, p2: BraggPlane, p3: BraggPlane): Vec3 | null {
  const n1 = p1.normal, n2 = p2.normal, n3 = p3.normal
  const det = dot(n1, cross(n2, n3))
  if (Math.abs(det) < 1e-10) return null
  // x = (d1·(n2×n3) + d2·(n3×n1) + d3·(n1×n2)) / det
  const c23 = cross(n2, n3)
  const c31 = cross(n3, n1)
  const c12 = cross(n1, n2)
  return [
    (p1.d * c23[0] + p2.d * c31[0] + p3.d * c12[0]) / det,
    (p1.d * c23[1] + p2.d * c31[1] + p3.d * c12[1]) / det,
    (p1.d * c23[2] + p2.d * c31[2] + p3.d * c12[2]) / det,
  ]
}

// ── BZ construction ─────────────────────────────────────────────────────────

export interface BrillouinZone {
  /** unique vertices of the BZ polyhedron */
  vertices: Vec3[]
  /** each face = list of vertex indices forming a (closed, ordered) polygon */
  faces: number[][]
  /** unique edges as [vertex_i_index, vertex_j_index] */
  edges: [number, number][]
  /** volume of the polyhedron (should match (2π)^3 / V_direct) */
  volume: number
  /** the 3 reciprocal lattice vectors used */
  reciprocal: Matrix3
}

/**
 * Given 3 reciprocal lattice vectors, construct the first Brillouin zone (Wigner-Seitz cell of reciprocal lattice).
 *
 * @param b1 reciprocal lattice vector 1
 * @param b2 reciprocal lattice vector 2
 * @param b3 reciprocal lattice vector 3
 * @param options.range Search grid range (default ±2 covers the nearest neighbors of the standard 14 Bravais lattice)
 * @param options.tolerance Vertex / coplanar judgment tolerance
 */
export function constructBrillouinZone(
  b1: Vec3,
  b2: Vec3,
  b3: Vec3,
  options: { range?: number; tolerance?: number; maxPlanes?: number } = {},
): BrillouinZone {
  const range = options.range ?? 2
  const tol = options.tolerance ?? DEFAULT_TOL
  const maxPlanes = options.maxPlanes ?? 32

  // 1. Collect nonzero reciprocal-lattice vectors and retain the nearest planes.
  const gPoints: { g: Vec3; lenSq: number }[] = []
  for (let i = -range; i <= range; i++) {
    for (let j = -range; j <= range; j++) {
      for (let k = -range; k <= range; k++) {
        if (i === 0 && j === 0 && k === 0) continue
        const g: Vec3 = [
          i * b1[0] + j * b2[0] + k * b3[0],
          i * b1[1] + j * b2[1] + k * b3[1],
          i * b1[2] + j * b2[2] + k * b3[2],
        ]
        gPoints.push({ g, lenSq: g[0] ** 2 + g[1] ** 2 + g[2] ** 2 })
      }
    }
  }
  gPoints.sort((a, b) => a.lenSq - b.lenSq)
  const limited = gPoints.slice(0, maxPlanes)

  // 2. Generate Bragg plane.
  const planes: BraggPlane[] = limited.map((p, idx) => {
    const len = Math.sqrt(p.lenSq)
    return {
      normal: [p.g[0] / len, p.g[1] / len, p.g[2] / len],
      d: len / 2,
      index: idx,
    }
  })

  // 3. Enumeration of intersection points of three planes.
  type Cand = { point: Vec3; planeIdx: Set<number> }
  const cands: Cand[] = []
  for (let i = 0; i < planes.length; i++) {
    for (let j = i + 1; j < planes.length; j++) {
      for (let k = j + 1; k < planes.length; k++) {
        const p = intersectThreePlanes(planes[i], planes[j], planes[k])
        if (!p) continue
        // Inside all planes? (N_m · p ≤ d_m for all m)
        let inside = true
        for (let m = 0; m < planes.length; m++) {
          if (dot(planes[m].normal, p) > planes[m].d + tol) {
            inside = false
            break
          }
        }
        if (!inside) continue
        // Record every incident plane for later face and edge construction.
        const onPlanes = new Set<number>()
        for (let m = 0; m < planes.length; m++) {
          if (Math.abs(dot(planes[m].normal, p) - planes[m].d) < tol) onPlanes.add(m)
        }
        cands.push({ point: p, planeIdx: onPlanes })
      }
    }
  }

  // 4. Vertex deduplication.
  const vertices: Vec3[] = []
  const vertexPlanes: Set<number>[] = []
  for (const cand of cands) {
    let dup = -1
    for (let v = 0; v < vertices.length; v++) {
      if (
        Math.abs(vertices[v][0] - cand.point[0]) < tol &&
        Math.abs(vertices[v][1] - cand.point[1]) < tol &&
        Math.abs(vertices[v][2] - cand.point[2]) < tol
      ) { dup = v; break }
    }
    if (dup === -1) {
      vertices.push(cand.point)
      vertexPlanes.push(new Set(cand.planeIdx))
    } else {
      // Merge plane memberships when multiple plane triples produce one vertex.
      for (const m of cand.planeIdx) vertexPlanes[dup].add(m)
    }
  }

  // 5. Sort each plane's incident vertices into a polygon.
  const faces: number[][] = []
  for (let p = 0; p < planes.length; p++) {
    const onFace: number[] = []
    for (let v = 0; v < vertices.length; v++) {
      if (vertexPlanes[v].has(p)) onFace.push(v)
    }
    if (onFace.length < 3) continue

    // Establish local 2D coordinates with face center + normal direction, sorted by polar angle.
    let cx = 0, cy = 0, cz = 0
    for (const v of onFace) {
      cx += vertices[v][0]
      cy += vertices[v][1]
      cz += vertices[v][2]
    }
    const inv = 1 / onFace.length
    const center: Vec3 = [cx * inv, cy * inv, cz * inv]

    const n = planes[p].normal
    // Choose an axis that is not parallel to n to construct u
    const ref: Vec3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]
    const u = normalize(cross(ref, n))
    const w = cross(n, u)

    onFace.sort((a, b) => {
      const da = sub(vertices[a], center)
      const db = sub(vertices[b], center)
      return Math.atan2(dot(da, w), dot(da, u)) - Math.atan2(dot(db, w), dot(db, u))
    })
    faces.push(onFace)
  }

  // 6. Two vertices sharing at least two planes define an edge.
  const edges: [number, number][] = []
  const seen = new Set<string>()
  for (let i = 0; i < vertices.length; i++) {
    for (let j = i + 1; j < vertices.length; j++) {
      let shared = 0
      for (const p of vertexPlanes[i]) if (vertexPlanes[j].has(p)) shared++
      if (shared >= 2) {
        const key = `${i}-${j}`
        if (!seen.has(key)) {
          seen.add(key)
          edges.push([i, j])
        }
      }
    }
  }

  // 7. Volume: divergence theorem, ∑ (v0·(v1×v2))/6 over triangulated faces.
  let volume = 0
  for (const face of faces) {
    if (face.length < 3) continue
    const v0 = vertices[face[0]]
    for (let t = 1; t < face.length - 1; t++) {
      const v1 = vertices[face[t]]
      const v2 = vertices[face[t + 1]]
      volume += dot(v0, cross(v1, v2)) / 6
    }
  }
  volume = Math.abs(volume)

  return {
    vertices,
    faces,
    edges,
    volume,
    reciprocal: [b1, b2, b3],
  }
}
