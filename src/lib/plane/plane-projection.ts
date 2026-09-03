/**
 * Plane projection math - Project 3D points to a plane 2D coordinate system, and back-projection.
 *
 * Extracted from plane-2d-view.tsx three inline useMemo/useCallback: buildPlaneBasis /
 * projectTo2D/unprojectTo3D. Pure function, zero React dependency; continue to use useMemo for caching on the component side
 * basis and useCallback include closure for JSX use.
 */

import type { Atom, Bond, ConstructedPlane, LatticeVectors, SupercellParams } from '../../contracts/crystal'
import type { Molecule2D } from '../molecule/smiles-parser'

export interface PlaneBasis {
  /** in-plane axis u (unit vector) */
  u: [number, number, number]
  /** in-plane axis v = normal × u (unit vector) */
  v: [number, number, number]
  /** plane center */
  center: [number, number, number]
  /** plane normal (unit vector) */
  normal: [number, number, number]
  /** plane equation constant: n·x + d = 0 */
  d: number
}

export interface Projected2DPoint {
  x: number
  y: number
  /** signed distance from plane along normal */
  dist: number
}

/** Build orthonormal basis (u, v) on the plane. Returns null if plane is null. */
export function buildPlaneBasis(constructedPlane: ConstructedPlane | null): PlaneBasis | null {
  if (!constructedPlane) return null

  const { normal, center } = constructedPlane

  let u: [number, number, number]
  if (Math.abs(normal[0]) < 0.9) {
    u = [0, -normal[2], normal[1]]
  } else {
    u = [normal[2], 0, -normal[0]]
  }
  const uLen = Math.sqrt(u[0] ** 2 + u[1] ** 2 + u[2] ** 2)
  u = [u[0] / uLen, u[1] / uLen, u[2] / uLen]

  const v: [number, number, number] = [
    normal[1] * u[2] - normal[2] * u[1],
    normal[2] * u[0] - normal[0] * u[2],
    normal[0] * u[1] - normal[1] * u[0],
  ]

  return { u, v, center, normal, d: constructedPlane.d }
}

/** Project a 3D point onto the plane's 2D coordinate system. */
export function projectTo2D(basis: PlaneBasis, point: [number, number, number]): Projected2DPoint {
  const { u, v, center, normal, d } = basis

  const dist = normal[0] * point[0] + normal[1] * point[1] + normal[2] * point[2] + d

  const projX = point[0] - dist * normal[0]
  const projY = point[1] - dist * normal[1]
  const projZ = point[2] - dist * normal[2]

  const dx = projX - center[0]
  const dy = projY - center[1]
  const dz = projZ - center[2]

  const x2d = dx * u[0] + dy * u[1] + dz * u[2]
  const y2d = dx * v[0] + dy * v[1] + dz * v[2]

  return { x: x2d, y: y2d, dist }
}

/** Convert 2D plane coordinates back to 3D (assumes 0 distance from plane). */
export function unprojectTo3D(basis: PlaneBasis, x2d: number, y2d: number): [number, number, number] {
  const { u, v, center } = basis

  return [
    center[0] + x2d * u[0] + y2d * v[0],
    center[1] + x2d * u[1] + y2d * v[1],
    center[2] + x2d * u[2] + y2d * v[2],
  ]
}

export interface ProjectedAtom {
  id: string
  element: string
  x: number
  y: number
  distance: number
  isSelected: boolean
  isSourceAtom: boolean
}

export interface ProjectedAtomsResult {
  onPlane: ProjectedAtom[]
  positive: ProjectedAtom[]
  negative: ProjectedAtom[]
  bounds: { minX: number; maxX: number; minY: number; maxY: number }
}

/**
 * Project all atoms to the plane 2D coordinate system, and bucket them according to the signature distance onPlane / positive / negative.
 * onPlaneThreshold defaults to 0.5 (constant used by plane-2d-view).
 *
 * When lr (constructedPlane.localRadius) is not empty, only atoms from center ≤ lr are retained.
 * Avoid N² projection overhead in large scenes.
 */
export function computeProjectedAtoms(
  basis: PlaneBasis | null,
  constructedPlane: ConstructedPlane | null,
  atoms: Atom[],
  selectedAtomIds: Set<string>,
  onPlaneThreshold: number,
): ProjectedAtomsResult {
  if (!basis || !constructedPlane) {
    return { onPlane: [], positive: [], negative: [], bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0 } }
  }

  const onPlane: ProjectedAtom[] = []
  const positive: ProjectedAtom[] = []
  const negative: ProjectedAtom[] = []

  let minX = Infinity, maxX = -Infinity
  let minY = Infinity, maxY = -Infinity

  const lr = constructedPlane.localRadius
  const cx = constructedPlane.center[0], cy = constructedPlane.center[1], cz = constructedPlane.center[2]

  for (const atom of atoms) {
    if (!atom.cartesian) continue

    if (lr != null) {
      const dx = atom.cartesian[0] - cx, dy = atom.cartesian[1] - cy, dz = atom.cartesian[2] - cz
      if (dx * dx + dy * dy + dz * dz > lr * lr) continue
    }

    const { x, y, dist } = projectTo2D(basis, atom.cartesian)

    const atomData: ProjectedAtom = {
      id: atom.id,
      element: atom.element,
      x,
      y,
      distance: dist,
      isSelected: selectedAtomIds.has(atom.id),
      isSourceAtom: constructedPlane.sourceIds?.includes(atom.id) ?? false,
    }

    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)

    if (Math.abs(dist) <= onPlaneThreshold) {
      onPlane.push(atomData)
    } else if (dist > 0) {
      positive.push(atomData)
    } else {
      negative.push(atomData)
    }
  }

  return { onPlane, positive, negative, bounds: { minX, maxX, minY, maxY } }
}

export interface ProjectedMirrorAtom {
  /**
  * Source atom id (mirror is not an independent entity, all interactions refer back to the source).
  */
  sourceId: string
  element: string
  x: number
  y: number
}

/**
 * Project the periodic mirror image of the adjacent atoms to the plane 2D, retaining only the on-plane (|dist| ≤ threshold).
 *
 * imageOffsets shares the same semantics as 3D rendering (display-periodic-images): id → display box
 * Integer offset list (excluding [0,0,0] is guaranteed by caller, home is skipped here). displayBox is
 * Supercell scaled lattice - consistent with the offset units returned by edgeImageOffsets.
 *
 * Only one remains for the same 2D position (toFixed(3)): multiple mirror images of the angular atoms may overlap.
 */
export function computeProjectedMirrorAtoms(
  basis: PlaneBasis | null,
  atoms: Atom[],
  imageOffsets: ReadonlyMap<string, readonly (readonly [number, number, number])[]> | null,
  displayBox: LatticeVectors | null,
  onPlaneThreshold: number,
): ProjectedMirrorAtom[] {
  if (!basis || !imageOffsets || !displayBox || imageOffsets.size === 0) return []
  const { a, b, c } = displayBox
  const out: ProjectedMirrorAtom[] = []
  const seen = new Set<string>()
  for (const atom of atoms) {
    if (!atom.cartesian) continue
    const offsets = imageOffsets.get(atom.id)
    if (!offsets) continue
    for (const [da, db, dc] of offsets) {
      if (da === 0 && db === 0 && dc === 0) continue
      const point: [number, number, number] = [
        atom.cartesian[0] + da * a[0] + db * b[0] + dc * c[0],
        atom.cartesian[1] + da * a[1] + db * b[1] + dc * c[1],
        atom.cartesian[2] + da * a[2] + db * b[2] + dc * c[2],
      ]
      const { x, y, dist } = projectTo2D(basis, point)
      if (Math.abs(dist) > onPlaneThreshold) continue
      const key = `${x.toFixed(3)},${y.toFixed(3)}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ sourceId: atom.id, element: atom.element, x, y })
    }
  }
  return out
}

export interface ProjectedBondLine {
  x1: number
  y1: number
  x2: number
  y2: number
}

/**
 * Cast bond to 2D: Output only when atoms at both ends of bond are near the plane (|dist| ≤ threshold).
 */
export function computeProjectedBonds(
  basis: PlaneBasis | null,
  bonds: Bond[],
  atoms: Atom[],
  onPlaneThreshold: number,
): ProjectedBondLine[] {
  if (!basis) return []
  const result: ProjectedBondLine[] = []
  for (const bond of bonds) {
    const atom1 = atoms.find(a => a.id === bond.atom1Id)
    const atom2 = atoms.find(a => a.id === bond.atom2Id)
    if (!atom1?.cartesian || !atom2?.cartesian) continue
    const p1 = projectTo2D(basis, atom1.cartesian)
    const p2 = projectTo2D(basis, atom2.cartesian)
    if (Math.abs(p1.dist) < onPlaneThreshold && Math.abs(p2.dist) < onPlaneThreshold) {
      result.push({ x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y })
    }
  }
  return result
}

export interface ProjectedLatticeEdge {
  x1: number
  y1: number
  x2: number
  y2: number
  /**
  * true when both ends are on the plane; false but retained when passing through the plane (p1.dist * p2.dist < 0)
  */
  onPlane: boolean
}

/**
 * Project the entire supercell's lattice edge mesh to 2D.
 *
 * Output two types of edges:
 * - onPlane: The unit cell edge with both ends attached to the plane (solid line, main reference).
 * - Plane ∩ Intersection polygon (weakening line) of the supercell box: When the plane cuts into the middle layer of the unit cell, all the unit cell edges are not on the surface.
 * The correct expression of the periodic boundary in 2D is this cutting contour - closed, falling within the area where the atoms are located,
 * Zoom along with the view. The previous "parallel edge projection" solution produced isolated broken lines that were out of content bounds
 * (unknown gray line seen by users), obsolete.
 */
export function computeProjectedLatticeEdges(
  basis: PlaneBasis | null,
  latticeVectors: LatticeVectors | null,
  supercellParams: SupercellParams | null,
  onPlaneThreshold: number,
): ProjectedLatticeEdge[] {
  if (!basis || !latticeVectors || !supercellParams) return []
  const { a, b, c } = latticeVectors
  const { nx, ny, nz } = supercellParams
  const edges: ProjectedLatticeEdge[] = []

  for (let i = 0; i <= nx; i++) {
    for (let j = 0; j <= ny; j++) {
      for (let k = 0; k <= nz; k++) {
        const base: [number, number, number] = [
          i * a[0] + j * b[0] + k * c[0],
          i * a[1] + j * b[1] + k * c[1],
          i * a[2] + j * b[2] + k * c[2],
        ]
        const addEdge = (end: [number, number, number]) => {
          const p1 = projectTo2D(basis, base)
          const p2 = projectTo2D(basis, end)
          if (Math.abs(p1.dist) < onPlaneThreshold && Math.abs(p2.dist) < onPlaneThreshold) {
            edges.push({ x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, onPlane: true })
          }
        }
        if (i < nx) addEdge([base[0] + a[0], base[1] + a[1], base[2] + a[2]])
        if (j < ny) addEdge([base[0] + b[0], base[1] + b[1], base[2] + b[2]])
        if (k < nz) addEdge([base[0] + c[0], base[1] + c[1], base[2] + c[2]])
      }
    }
  }

  // Plane ∩ Supercell box: Find the intersection points (linear interpolation) of the 12 edges of the box, and connect them into a closed polygon in order of the centroid polar angle.
  // The intersection between the plane and the convex box must be a convex polygon, and the polar angle sorting is sufficient.
  const A: [number, number, number] = [a[0] * nx, a[1] * nx, a[2] * nx]
  const B: [number, number, number] = [b[0] * ny, b[1] * ny, b[2] * ny]
  const C: [number, number, number] = [c[0] * nz, c[1] * nz, c[2] * nz]
  // Vertex order: idx = di*4 + dj*2 + dk(di,dj,dk ∈ {0,1} dictionary order)
  const corners: [number, number, number][] = []
  for (const di of [0, 1]) for (const dj of [0, 1]) for (const dk of [0, 1]) {
    corners.push([
      di * A[0] + dj * B[0] + dk * C[0],
      di * A[1] + dj * B[1] + dk * C[1],
      di * A[2] + dj * B[2] + dk * C[2],
    ])
  }
  const BOX_EDGES: readonly [number, number][] = [
    [0, 1], [0, 2], [1, 3], [2, 3],
    [4, 5], [4, 6], [5, 7], [6, 7],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ]
  const hits: { x: number; y: number }[] = []
  for (const [s, e] of BOX_EDGES) {
    const ps = projectTo2D(basis, corners[s])
    const pe = projectTo2D(basis, corners[e])
    // The edges of the veneer (both ends are close to zero) have been covered by the onPlane edge above. Only the ones that really penetrate the surface are needed here.
    if (ps.dist * pe.dist >= 0) continue
    const t = ps.dist / (ps.dist - pe.dist)
    hits.push({ x: ps.x + t * (pe.x - ps.x), y: ps.y + t * (pe.y - ps.y) })
  }
  if (hits.length >= 3) {
    const cx = hits.reduce((sum, p) => sum + p.x, 0) / hits.length
    const cy = hits.reduce((sum, p) => sum + p.y, 0) / hits.length
    hits.sort((p, q) => Math.atan2(p.y - cy, p.x - cx) - Math.atan2(q.y - cy, q.x - cx))
    for (let m = 0; m < hits.length; m++) {
      const p = hits[m]
      const q = hits[(m + 1) % hits.length]
      edges.push({ x1: p.x, y1: p.y, x2: q.x, y2: q.y, onPlane: false })
    }
  }
  return edges
}

export type SnapPointType = 'lattice' | 'bond' | 'atom' | 'intersection'

export interface SnapPoint {
  x: number
  y: number
  x3d: number
  y3d: number
  z3d: number
  type: SnapPointType
  label?: string
}

/**
 * Generate all snap points: on-plane atom, lattice vertex intersection, lattice edge bisection point, bond bisection point.
 * Deduplicate points with the same coordinates (toFixed(4)).
 */
export function computeSnapPoints(
  basis: PlaneBasis | null,
  enabled: boolean,
  projectedOnPlaneAtoms: ProjectedAtom[],
  bonds: Bond[],
  atoms: Atom[],
  latticeVectors: LatticeVectors | null,
  supercellParams: SupercellParams | null,
  snapDivision: number,
  onPlaneThreshold: number,
): SnapPoint[] {
  if (!basis || !enabled) return []

  const points: SnapPoint[] = []
  const addedPoints = new Set<string>()
  const addPoint = (x: number, y: number, x3d: number, y3d: number, z3d: number, type: SnapPointType, label?: string) => {
    const key = `${x.toFixed(4)},${y.toFixed(4)}`
    if (!addedPoints.has(key)) {
      addedPoints.add(key)
      points.push({ x, y, x3d, y3d, z3d, type, label })
    }
  }

  // 1. on-plane atom itself as snap target
  for (const atom of projectedOnPlaneAtoms) {
    const pos3d = unprojectTo3D(basis, atom.x, atom.y)
    addPoint(atom.x, atom.y, pos3d[0], pos3d[1], pos3d[2], 'atom', atom.element)
  }

  // 2 + 3. lattice vertex + bisection point
  if (latticeVectors && supercellParams) {
    const { a, b, c } = latticeVectors
    const { nx, ny, nz } = supercellParams

    for (let i = 0; i <= nx; i++) {
      for (let j = 0; j <= ny; j++) {
        for (let k = 0; k <= nz; k++) {
          const vertex: [number, number, number] = [
            i * a[0] + j * b[0] + k * c[0],
            i * a[1] + j * b[1] + k * c[1],
            i * a[2] + j * b[2] + k * c[2],
          ]
          const projected = projectTo2D(basis, vertex)
          if (Math.abs(projected.dist) < onPlaneThreshold) {
            addPoint(projected.x, projected.y, vertex[0], vertex[1], vertex[2], 'intersection', 'Lattice')
          }
        }
      }
    }

    const addEdgeDivisions = (start: [number, number, number], end: [number, number, number]) => {
      const p1 = projectTo2D(basis, start)
      const p2 = projectTo2D(basis, end)
      if (Math.abs(p1.dist) > onPlaneThreshold || Math.abs(p2.dist) > onPlaneThreshold) return
      for (let i = 1; i < snapDivision; i++) {
        const t = i / snapDivision
        const x = p1.x + (p2.x - p1.x) * t
        const y = p1.y + (p2.y - p1.y) * t
        const x3d = start[0] + (end[0] - start[0]) * t
        const y3d = start[1] + (end[1] - start[1]) * t
        const z3d = start[2] + (end[2] - start[2]) * t
        addPoint(x, y, x3d, y3d, z3d, 'lattice', `1/${snapDivision}`)
      }
    }

    for (let i = 0; i <= nx; i++) {
      for (let j = 0; j <= ny; j++) {
        for (let k = 0; k <= nz; k++) {
          const base: [number, number, number] = [
            i * a[0] + j * b[0] + k * c[0],
            i * a[1] + j * b[1] + k * c[1],
            i * a[2] + j * b[2] + k * c[2],
          ]
          if (i < nx) addEdgeDivisions(base, [base[0] + a[0], base[1] + a[1], base[2] + a[2]])
          if (j < ny) addEdgeDivisions(base, [base[0] + b[0], base[1] + b[1], base[2] + b[2]])
          if (k < nz) addEdgeDivisions(base, [base[0] + c[0], base[1] + c[1], base[2] + c[2]])
        }
      }
    }
  }

  // 4. on-plane bond equal points
  for (const bond of bonds) {
    const atom1 = atoms.find(a => a.id === bond.atom1Id)
    const atom2 = atoms.find(a => a.id === bond.atom2Id)
    if (!atom1?.cartesian || !atom2?.cartesian) continue
    const p1 = projectTo2D(basis, atom1.cartesian)
    const p2 = projectTo2D(basis, atom2.cartesian)
    if (Math.abs(p1.dist) > onPlaneThreshold || Math.abs(p2.dist) > onPlaneThreshold) continue
    for (let i = 1; i < snapDivision; i++) {
      const t = i / snapDivision
      const x = p1.x + (p2.x - p1.x) * t
      const y = p1.y + (p2.y - p1.y) * t
      const x3d = atom1.cartesian[0] + (atom2.cartesian[0] - atom1.cartesian[0]) * t
      const y3d = atom1.cartesian[1] + (atom2.cartesian[1] - atom1.cartesian[1]) * t
      const z3d = atom1.cartesian[2] + (atom2.cartesian[2] - atom1.cartesian[2]) * t
      addPoint(x, y, x3d, y3d, z3d, 'bond', `1/${snapDivision}`)
    }
  }

  return points
}

export interface DynamicConnectionLine {
  x1: number
  y1: number
  x2: number
  y2: number
  atom1Id: string
  atom2Id: string
  atom1Pos: [number, number, number]
  atom2Pos: [number, number, number]
}

export interface DynamicSnapPoint {
  x: number
  y: number
  x3d: number
  y3d: number
  z3d: number
  type: 'dynamic'
  label: string
}

export interface DynamicConnections {
  lines: DynamicConnectionLine[]
  snapPoints: DynamicSnapPoint[]
}

/**
 * When hovering on an on-plane atom, draw "the line connecting it to the surrounding on-plane atom + the bisection point"
 * Used as a snap prompt for the add-atom tool. Only targets with a 2D distance ≤ 8 units are retained.
 *
 * UI gating (hoveredAtomId/isLocked/toolMode==='add-atom') is determined by caller,
 * This function assumes that these conditions have been passed and returns null directly if null is passed.
 */
export function computeDynamicConnections(
  hoveredAtom: ProjectedAtom | null,
  hoveredAtomId: string | null,
  projectedOnPlaneAtoms: ProjectedAtom[],
  atoms: Atom[],
  snapDivision: number,
): DynamicConnections {
  const empty: DynamicConnections = { lines: [], snapPoints: [] }
  if (!hoveredAtom || !hoveredAtomId) return empty
  const sourceAtom = atoms.find(a => a.id === hoveredAtomId)
  if (!sourceAtom?.cartesian) return empty

  const lines: DynamicConnectionLine[] = []
  const dynSnapPoints: DynamicSnapPoint[] = []
  const addedPoints = new Set<string>()

  for (const targetAtom of projectedOnPlaneAtoms) {
    if (targetAtom.id === hoveredAtomId) continue
    const target = atoms.find(a => a.id === targetAtom.id)
    if (!target?.cartesian) continue

    const dx = targetAtom.x - hoveredAtom.x
    const dy = targetAtom.y - hoveredAtom.y
    const dist2D = Math.sqrt(dx * dx + dy * dy)
    if (dist2D > 8) continue

    lines.push({
      x1: hoveredAtom.x,
      y1: hoveredAtom.y,
      x2: targetAtom.x,
      y2: targetAtom.y,
      atom1Id: hoveredAtomId,
      atom2Id: targetAtom.id,
      atom1Pos: sourceAtom.cartesian,
      atom2Pos: target.cartesian,
    })

    for (let i = 1; i < snapDivision; i++) {
      const t = i / snapDivision
      const x = hoveredAtom.x + dx * t
      const y = hoveredAtom.y + dy * t
      const key = `${x.toFixed(4)},${y.toFixed(4)}`
      if (!addedPoints.has(key)) {
        addedPoints.add(key)
        const x3d = sourceAtom.cartesian[0] + (target.cartesian[0] - sourceAtom.cartesian[0]) * t
        const y3d = sourceAtom.cartesian[1] + (target.cartesian[1] - sourceAtom.cartesian[1]) * t
        const z3d = sourceAtom.cartesian[2] + (target.cartesian[2] - sourceAtom.cartesian[2]) * t
        dynSnapPoints.push({ x, y, x3d, y3d, z3d, type: 'dynamic', label: `1/${snapDivision}` })
      }
    }
  }

  return { lines, snapPoints: dynSnapPoints }
}

export interface InsertedMolecule3D {
  newAtoms: Array<{
    id: string
    element: string
    position: [number, number, number]
    cartesian: [number, number, number]
  }>
  newBonds: Array<{
    id: string
    atom1Id: string
    atom2Id: string
    type: 'single' | 'double' | 'triple'
  }>
}

/**
 * Project the molecules edited by the 2D molecule editor to 3D according to the current plane basis, and return the newly added
 * atoms/bonds (does not modify the original array). The caller just spreads them to the store.
 *
 * Behavior: First center the 2D coordinates according to the "center of gravity of the molecule", then rotate according to insertRotationDeg, and add user drag
 * offsetX/offsetY, finally multiply (u, v) to cast to the plane coordinate system, add plane center.
 *
 * Aromatic bond is not supported on the 3D side and is reduced to single.
 */
export function convert2DMoleculeTo3D(
  molecule2D: Molecule2D,
  basis: PlaneBasis,
  insertRotationDeg: number,
  offsetX: number,
  offsetY: number,
  idSeed: number,
): InsertedMolecule3D {
  const { u, v, center } = basis
  const rotRad = insertRotationDeg * Math.PI / 180
  const cosR = Math.cos(rotRad)
  const sinR = Math.sin(rotRad)

  // Molecular center of gravity
  let molCenterX = 0, molCenterY = 0
  if (molecule2D.atoms.length > 0) {
    molecule2D.atoms.forEach(a => {
      molCenterX += a.x
      molCenterY += a.y
    })
    molCenterX /= molecule2D.atoms.length
    molCenterY /= molecule2D.atoms.length
  }

  const newAtoms = molecule2D.atoms.map((atom, i) => {
    const cx = atom.x - molCenterX
    const cy = atom.y - molCenterY
    const rotX = cx * cosR - cy * sinR + molCenterX + offsetX
    const rotY = cx * sinR + cy * cosR + molCenterY + offsetY
    const x3d = center[0] + rotX * u[0] + rotY * v[0]
    const y3d = center[1] + rotX * u[1] + rotY * v[1]
    const z3d = center[2] + rotX * u[2] + rotY * v[2]
    return {
      id: `atom-${idSeed}-${i}`,
      element: atom.element,
      position: [x3d, y3d, z3d] as [number, number, number],
      cartesian: [x3d, y3d, z3d] as [number, number, number],
    }
  })

  const idMap = new Map<string, string>()
  molecule2D.atoms.forEach((oldAtom, i) => {
    idMap.set(oldAtom.id, newAtoms[i].id)
  })

  const newBonds = molecule2D.bonds.map((bond, i) => ({
    id: `bond-${idSeed}-${i}`,
    atom1Id: idMap.get(bond.atom1Id) || bond.atom1Id,
    atom2Id: idMap.get(bond.atom2Id) || bond.atom2Id,
    type: (bond.type === 'aromatic' ? 'single' : bond.type) as 'single' | 'double' | 'triple',
  }))

  return { newAtoms, newBonds }
}

/**
 * Fallback when there is no plane: the center of gravity of the molecule moves to the origin and falls on the XY plane (z=0).
 * Share the bond degradation rule of idSeed + aromatic→single with convert2DMoleculeTo3D.
 */
export function convert2DMoleculeAtOrigin(molecule2D: Molecule2D, idSeed: number): InsertedMolecule3D {
  let molCenterX = 0, molCenterY = 0
  if (molecule2D.atoms.length > 0) {
    molecule2D.atoms.forEach(a => {
      molCenterX += a.x
      molCenterY += a.y
    })
    molCenterX /= molecule2D.atoms.length
    molCenterY /= molecule2D.atoms.length
  }

  const newAtoms = molecule2D.atoms.map((atom, i) => ({
    id: `atom-${idSeed}-${i}`,
    element: atom.element,
    position: [atom.x - molCenterX, atom.y - molCenterY, 0] as [number, number, number],
    cartesian: [atom.x - molCenterX, atom.y - molCenterY, 0] as [number, number, number],
  }))

  const idMap = new Map<string, string>()
  molecule2D.atoms.forEach((oldAtom, i) => {
    idMap.set(oldAtom.id, newAtoms[i].id)
  })

  const newBonds = molecule2D.bonds.map((bond, i) => ({
    id: `bond-${idSeed}-${i}`,
    atom1Id: idMap.get(bond.atom1Id) || bond.atom1Id,
    atom2Id: idMap.get(bond.atom2Id) || bond.atom2Id,
    type: (bond.type === 'aromatic' ? 'single' : bond.type) as 'single' | 'double' | 'triple',
  }))

  return { newAtoms, newBonds }
}
