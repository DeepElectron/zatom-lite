/**
 * Wulff-construction builder.
 *
 * Wulff's theorem: the equilibrium shape of a crystal minimises Σ_i γ_i · A_i
 * at fixed volume, which is achieved by placing each face's plane at distance
 * proportional to its surface energy: d_i = γ_i / γ_ref × size, where γ_ref is
 * the smallest γ in the input set.
 *
 * Pipeline:
 *   1. For each user-supplied (hkl, γ) pair, compute the plane normal in
 *      cartesian coordinates: n_i = h·b1 + k·b2 + l·b3 (reciprocal-lattice
 *      direction), then normalise.
 *   2. Plane distance: d_i = (γ_i / γ_min) · size_angstrom.
 *   3. The polyhedron is the intersection of all half-spaces {r : n_i · r ≤ d_i}.
 *      Vertices = intersections of 3 planes that satisfy every other half-
 *      space. Faces = polygons of all vertices that lie on a single plane,
 *      ordered angularly around the plane normal.
 *   4. Volume via signed tetrahedron decomposition; face areas via 2D fan
 *      from the polygon centroid.
 *
 * v1 limitation (documented): no automatic symmetry expansion. The caller is
 * expected to pre-expand symmetry-equivalent planes. For a cubic crystal a
 * full {100} family is six entries (±x, ±y, ±z), {111} is eight entries
 * (octants), etc. See the tests for examples.
 *
 * Output:
 *   - extended-XYZ: a small "marker" structure consisting of single atoms
 *     placed at each face centroid plus the centre of the polyhedron, so the
 *     viewport shows where the Wulff faces lie.
 *   - polyhedron geometry: vertices, faces (with hkl + area), and total
 *     volume — exposed on WulffResult.polyhedron for future viewer integration.
 *
 * No CatGo / AGPL source consulted.
 */

import type { BuilderResult } from './types'

type Vec3 = [number, number, number]
type Mat3 = [Vec3, Vec3, Vec3]

export interface WulffFace {
  hkl: [number, number, number]
  surface_energy: number
}

export interface WulffOptions {
  /** Real-space lattice (row vectors a1, a2, a3). */
  lattice: Mat3
  /** Pre-expanded set of (hkl, γ) faces. Symmetry expansion not done in v1. */
  faces: WulffFace[]
  /** Element used for marker atoms placed at face centroids. */
  element: string
  /** Overall scale (Å) — controls the d_min plane distance. Default 20 Å. */
  size_angstrom?: number
  /** Vacuum padding around the polyhedron's bounding box (Å). Default 10 Å. */
  vacuum_angstrom?: number
}

export interface WulffPolyhedron {
  vertices: Vec3[]
  faces: Array<{
    hkl: [number, number, number]
    vertex_indices: number[]
    area: number
    /** Cartesian centroid of the face (useful for marker placement). */
    centroid: Vec3
  }>
  volume: number
}

export interface WulffResult extends BuilderResult {
  polyhedron?: WulffPolyhedron
}

// ── linear-algebra helpers ─────────────────────────────────────────────────

function dot(u: Vec3, v: Vec3): number { return u[0] * v[0] + u[1] * v[1] + u[2] * v[2] }
function cross(u: Vec3, v: Vec3): Vec3 {
  return [
    u[1] * v[2] - u[2] * v[1],
    u[2] * v[0] - u[0] * v[2],
    u[0] * v[1] - u[1] * v[0],
  ]
}
function add(u: Vec3, v: Vec3): Vec3 { return [u[0] + v[0], u[1] + v[1], u[2] + v[2]] }
function sub(u: Vec3, v: Vec3): Vec3 { return [u[0] - v[0], u[1] - v[1], u[2] - v[2]] }
function scale(v: Vec3, s: number): Vec3 { return [v[0] * s, v[1] * s, v[2] * s] }
function norm(v: Vec3): number { return Math.sqrt(dot(v, v)) }
function unit(v: Vec3): Vec3 {
  const n = norm(v)
  if (n < 1e-12) return [0, 0, 1]
  return [v[0] / n, v[1] / n, v[2] / n]
}

function det3(m: Mat3): number {
  const [a, b, c] = m
  return (
    a[0] * (b[1] * c[2] - b[2] * c[1]) -
    a[1] * (b[0] * c[2] - b[2] * c[0]) +
    a[2] * (b[0] * c[1] - b[1] * c[0])
  )
}

/** Solve A · x = b for 3×3 system. Returns null if singular. */
function solve3(A: Mat3, b: Vec3): Vec3 | null {
  const d = det3(A)
  if (Math.abs(d) < 1e-9) return null
  const a0 = A[0], a1 = A[1], a2 = A[2]
  // Cramer's rule
  const dx = det3([[b[0], a0[1], a0[2]], [b[1], a1[1], a1[2]], [b[2], a2[1], a2[2]]])
  const dy = det3([[a0[0], b[0], a0[2]], [a1[0], b[1], a1[2]], [a2[0], b[2], a2[2]]])
  const dz = det3([[a0[0], a0[1], b[0]], [a1[0], a1[1], b[1]], [a2[0], a2[1], b[2]]])
  return [dx / d, dy / d, dz / d]
}

/** Reciprocal lattice (rows = b1, b2, b3) without 2π factor. */
function reciprocal(lattice: Mat3): Mat3 {
  const [a1, a2, a3] = lattice
  const V = det3(lattice)
  if (Math.abs(V) < 1e-12) {
    throw new Error('Lattice is singular')
  }
  return [
    scale(cross(a2, a3), 1 / V),
    scale(cross(a3, a1), 1 / V),
    scale(cross(a1, a2), 1 / V),
  ]
}

/** Cartesian normal direction for the (hkl) plane. */
function planeNormalCartesian(lattice: Mat3, hkl: [number, number, number]): Vec3 {
  const [b1, b2, b3] = reciprocal(lattice)
  return [
    hkl[0] * b1[0] + hkl[1] * b2[0] + hkl[2] * b3[0],
    hkl[0] * b1[1] + hkl[1] * b2[1] + hkl[2] * b3[1],
    hkl[0] * b1[2] + hkl[1] * b2[2] + hkl[2] * b3[2],
  ]
}

// ── polyhedron construction ────────────────────────────────────────────────

interface Plane {
  /** Unit normal (cartesian, outward-pointing). */
  n: Vec3
  /** Signed distance from origin: half-space is {r : n·r ≤ d}. */
  d: number
  hkl: [number, number, number]
  /** Original face index (for tagging vertices). */
  index: number
}

interface Vertex {
  pos: Vec3
  /** Indices of the planes that meet at this vertex (≥ 3). */
  plane_indices: number[]
}

/** Tolerance for "point lies on plane" tests, scaled by overall size. */
const EPS = 1e-6

/** Compute the convex polyhedron defined by half-space intersections.
 *  Returns vertices + face groupings. */
function intersectHalfSpaces(planes: Plane[]): { vertices: Vertex[]; faceVertexIndices: number[][] } {
  const vertices: Vertex[] = []
  // For each triple of planes, solve for the intersection point and accept
  // it if it satisfies every other half-space (within EPS).
  const N = planes.length
  // To merge duplicate vertices, we deduplicate by rounded position.
  const seen = new Map<string, number>()  // key → index into vertices

  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
      for (let k = j + 1; k < N; k++) {
        const A: Mat3 = [planes[i].n, planes[j].n, planes[k].n]
        const b: Vec3 = [planes[i].d, planes[j].d, planes[k].d]
        const p = solve3(A, b)
        if (!p) continue
        // Check p satisfies all other planes (with small tolerance).
        let ok = true
        for (let q = 0; q < N; q++) {
          if (q === i || q === j || q === k) continue
          if (dot(planes[q].n, p) > planes[q].d + EPS) { ok = false; break }
        }
        if (!ok) continue
        // Deduplicate.
        const key = `${p[0].toFixed(4)}|${p[1].toFixed(4)}|${p[2].toFixed(4)}`
        const existing = seen.get(key)
        if (existing !== undefined) {
          // Add planes to existing vertex's plane list.
          const v = vertices[existing]
          for (const idx of [i, j, k]) {
            if (!v.plane_indices.includes(idx)) v.plane_indices.push(idx)
          }
        } else {
          seen.set(key, vertices.length)
          vertices.push({ pos: p, plane_indices: [i, j, k] })
        }
      }
    }
  }

  // Group vertices by which plane they belong to.
  const faceVertexIndices: number[][] = planes.map(() => [])
  for (let vi = 0; vi < vertices.length; vi++) {
    for (const pIdx of vertices[vi].plane_indices) {
      faceVertexIndices[pIdx].push(vi)
    }
  }
  return { vertices, faceVertexIndices }
}

/** Order vertices of one face polygon angularly around the face normal. */
function orderFaceVertices(
  faceVertIdx: number[],
  vertices: Vertex[],
  normal: Vec3,
): number[] {
  if (faceVertIdx.length < 3) return [...faceVertIdx]
  // Compute centroid in cartesian.
  const c: Vec3 = [0, 0, 0]
  for (const i of faceVertIdx) {
    c[0] += vertices[i].pos[0]
    c[1] += vertices[i].pos[1]
    c[2] += vertices[i].pos[2]
  }
  c[0] /= faceVertIdx.length
  c[1] /= faceVertIdx.length
  c[2] /= faceVertIdx.length
  // Build an in-plane orthonormal basis (u, v) perpendicular to normal.
  const n = unit(normal)
  // Pick a reference direction not parallel to n.
  const ref: Vec3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]
  const u = unit(sub(ref, scale(n, dot(ref, n))))
  const v = cross(n, u)
  // Compute polar angles around centroid in (u, v) frame.
  const angles = faceVertIdx.map((vi) => {
    const r = sub(vertices[vi].pos, c)
    const x = dot(r, u)
    const y = dot(r, v)
    return { vi, angle: Math.atan2(y, x) }
  })
  angles.sort((a, b) => a.angle - b.angle)
  // Deduplicate consecutive vertices that have identical positions.
  const ordered: number[] = []
  for (const a of angles) {
    if (ordered.length === 0 || ordered[ordered.length - 1] !== a.vi) ordered.push(a.vi)
  }
  return ordered
}

/** Polygon area via fan from centroid. */
function polygonArea(verts: Vec3[]): { area: number; centroid: Vec3 } {
  const n = verts.length
  if (n < 3) return { area: 0, centroid: [0, 0, 0] }
  const c: Vec3 = [0, 0, 0]
  for (const p of verts) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2] }
  c[0] /= n; c[1] /= n; c[2] /= n
  let area = 0
  for (let i = 0; i < n; i++) {
    const a = sub(verts[i], c)
    const b = sub(verts[(i + 1) % n], c)
    area += 0.5 * norm(cross(a, b))
  }
  return { area, centroid: c }
}

/** Total polyhedron volume via signed tetrahedra from origin. We assume the
 *  origin is inside the polyhedron (which holds when all d_i ≥ 0). */
function polyhedronVolume(
  vertices: Vertex[],
  faceVertexIndices: number[][],
  planes: Plane[],
): number {
  let V = 0
  for (let f = 0; f < faceVertexIndices.length; f++) {
    const ordered = orderFaceVertices(faceVertexIndices[f], vertices, planes[f].n)
    if (ordered.length < 3) continue
    const v0 = vertices[ordered[0]].pos
    for (let i = 1; i < ordered.length - 1; i++) {
      const v1 = vertices[ordered[i]].pos
      const v2 = vertices[ordered[i + 1]].pos
      // Signed tetrahedral volume between (origin, v0, v1, v2).
      V += dot(v0, cross(v1, v2)) / 6
    }
  }
  return Math.abs(V)
}

// ── main entry ─────────────────────────────────────────────────────────────

export function buildWulffShape(opts: WulffOptions): WulffResult {
  if (opts.faces.length < 4) {
    throw new Error('Wulff construction needs at least 4 faces (to bound a polyhedron)')
  }
  const size = opts.size_angstrom ?? 20
  const vacuum = opts.vacuum_angstrom ?? 10

  // 1. Compute (n_i, d_i) for every face.
  const gammaMin = Math.min(...opts.faces.map((f) => f.surface_energy))
  if (gammaMin <= 0) {
    throw new Error('All surface energies must be positive')
  }
  const planes: Plane[] = opts.faces.map((f, i) => {
    const nRaw = planeNormalCartesian(opts.lattice, f.hkl)
    if (norm(nRaw) < 1e-12) {
      throw new Error(`Face #${i} has zero-length normal (hkl = ${f.hkl.join(',')})`)
    }
    const n = unit(nRaw)
    const d = (f.surface_energy / gammaMin) * size
    return { n, d, hkl: f.hkl, index: i }
  })

  // 2. Build polyhedron.
  const { vertices, faceVertexIndices } = intersectHalfSpaces(planes)
  if (vertices.length < 4) {
    throw new Error(
      `Wulff polyhedron is degenerate — only ${vertices.length} vertices found. ` +
      `Likely the face list does not enclose a bounded region (need pre-expanded symmetry-equivalent planes).`,
    )
  }

  // 3. Order each face's vertices + compute area and centroid.
  const builtFaces: WulffPolyhedron['faces'] = []
  for (let f = 0; f < planes.length; f++) {
    const ordered = orderFaceVertices(faceVertexIndices[f], vertices, planes[f].n)
    if (ordered.length < 3) continue
    const verts: Vec3[] = ordered.map((i) => vertices[i].pos)
    const { area, centroid } = polygonArea(verts)
    builtFaces.push({
      hkl: planes[f].hkl,
      vertex_indices: ordered,
      area,
      centroid,
    })
  }
  const volume = polyhedronVolume(vertices, faceVertexIndices, planes)

  // 4. Build a small extended-XYZ output: one marker atom at the polyhedron
  //    centre + one marker atom at each face centroid. Lattice = bounding box
  //    of polyhedron + vacuum.
  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  for (const v of vertices) {
    if (v.pos[0] < minX) minX = v.pos[0]; if (v.pos[0] > maxX) maxX = v.pos[0]
    if (v.pos[1] < minY) minY = v.pos[1]; if (v.pos[1] > maxY) maxY = v.pos[1]
    if (v.pos[2] < minZ) minZ = v.pos[2]; if (v.pos[2] > maxZ) maxZ = v.pos[2]
  }
  const spanX = maxX - minX
  const spanY = maxY - minY
  const spanZ = maxZ - minZ
  const cellX = spanX + 2 * vacuum
  const cellY = spanY + 2 * vacuum
  const cellZ = spanZ + 2 * vacuum
  const shift: Vec3 = [vacuum - minX, vacuum - minY, vacuum - minZ]

  // Emit markers: centre atom + one per face centroid.
  const markers: Array<{ element: string; pos: Vec3 }> = []
  markers.push({ element: opts.element, pos: [0, 0, 0] })
  for (const face of builtFaces) {
    markers.push({ element: opts.element, pos: face.centroid })
  }
  const shiftedMarkers = markers.map((m) => ({ element: m.element, pos: add(m.pos, shift) }))

  const lines: string[] = []
  lines.push(String(shiftedMarkers.length))
  lines.push(
    `Lattice="${cellX.toFixed(6)} 0 0 0 ${cellY.toFixed(6)} 0 0 0 ${cellZ.toFixed(6)}" ` +
    `Properties=species:S:1:pos:R:3 Wulff faces=${builtFaces.length} volume=${volume.toFixed(4)}`,
  )
  for (const m of shiftedMarkers) {
    lines.push(`${m.element} ${m.pos[0].toFixed(6)} ${m.pos[1].toFixed(6)} ${m.pos[2].toFixed(6)}`)
  }

  const desc =
    `Wulff polyhedron · ${builtFaces.length} faces · ${vertices.length} vertices · ` +
    `volume = ${volume.toFixed(2)} Å³`
  return {
    xyz: lines.join('\n'),
    description: desc,
    n_atoms: shiftedMarkers.length,
    polyhedron: {
      vertices: vertices.map((v) => v.pos),
      faces: builtFaces,
      volume,
    },
  }
}
