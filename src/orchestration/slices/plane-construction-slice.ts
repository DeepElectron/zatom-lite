/**
 * plane-construction-slice -- Construct helper planes from 3 atoms, 2 edges, or N faces;
 * select atoms by plane side; and control the 2D plane view.
 *
 * Three construction modes:
 *   - constructPlaneFromAtoms: three atoms define a triangular plane
 *   - constructPlaneFromEdges: three non-collinear endpoints from two bonds define a plane
 *   - constructPlaneFromFaces: selected lattice faces determine the normal, while the
 *     selected cell determines the center
 *
 * All modes write a ConstructedPlane with normal and d in Hessian normal form, plus
 * center, sourceIds, and localRadius for large-scene optimization.
 *
 * Construction does not open the 2D plane view automatically; the user opts in.
 *
 * Cross-slice operations read atoms, bonds, latticeVectors, and supercellParams, and write
 * constructedPlane, show2DPlaneView, and selectedAtomIds when selecting a side.
 */

import type { StateCreator } from 'zustand'
import type { ConstructedPlane } from '../../lib/crystal/types'
import { EMPTY_CUBE_FIELD_SLICE_SAMPLE } from '../../lib/molecular-orbitals/cube-field-slice'
import { buildDomainWallInterfacePlane } from '../../lib/plane/domain-wall-interface-plane'
import type { CrystalStore } from '../crystal-store-types'

export interface PlaneConstructionSlice {
  constructedPlane: ConstructedPlane | null
  show2DPlaneView: boolean
  domainWallReview: Record<string, unknown> | null
  constructPlaneFromAtoms: (atomIds: string[]) => void
  constructPlaneFromEdges: (edgeIds: string[]) => void
  constructPlaneFromFaces: (faceIds: string[]) => void
  /** Construct a crystallographic plane from Miller indices (h k l); periodic systems only.
   * Optional anchor:
   *   - omitted: pass through the unit-cell center by convention
   *   - [x, y, z] Cartesian: pass through that point, such as an atom or three-atom centroid
   * Any translation within an (hkl) family is valid; the anchor changes position, not orientation. */
  constructPlaneFromMiller: (h: number, k: number, l: number, anchor?: [number, number, number]) => void
  constructPlaneFromDomainWallMetadata: (domainWall: Record<string, unknown> | null | undefined) => boolean
  setDomainWallReview: (review: Record<string, unknown> | null | undefined) => void
  clearDomainWallReview: () => void
  clearConstructedPlane: () => void
  setShow2DPlaneView: (show: boolean) => void
  selectAtomsOnPlaneSide: (side: 'positive' | 'negative') => void
}

export const createPlaneConstructionSlice: StateCreator<CrystalStore, [], [], PlaneConstructionSlice> = (set, get) => ({
  constructedPlane: null,
  show2DPlaneView: false,
  domainWallReview: null,

  // Construct plane from 3 atoms
  constructPlaneFromAtoms: (atomIds: string[]) => {
    if (atomIds.length < 3) return

    const atoms = get().atoms
    // When a periodic image is picked, selection-slice records that image's world position
    // in atomPickAnchors. Use it so the plane crosses the picked image rather than the source;
    // both share an id, so atoms alone always yields the source coordinates.
    const anchors = get().atomPickAnchors
    const pickPoint = (id: string): [number, number, number] | null =>
      anchors.get(id) ?? atoms.find(a => a.id === id)?.cartesian ?? null
    const pts = atomIds.slice(0, 3).map(pickPoint).filter((p): p is [number, number, number] => p !== null)

    if (pts.length < 3) return
    
    const p1 = pts[0]
    const p2 = pts[1]
    const p3 = pts[2]
    
    // Calculate two vectors on the plane
    const v1: [number, number, number] = [p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]]
    const v2: [number, number, number] = [p3[0] - p1[0], p3[1] - p1[1], p3[2] - p1[2]]
    
    // Calculate normal (cross product)
    const normal: [number, number, number] = [
      v1[1] * v2[2] - v1[2] * v2[1],
      v1[2] * v2[0] - v1[0] * v2[2],
      v1[0] * v2[1] - v1[1] * v2[0],
    ]
    
    // Normalize
    const len = Math.sqrt(normal[0] ** 2 + normal[1] ** 2 + normal[2] ** 2)
    if (len <= 1e-9) return
    normal[0] /= len
    normal[1] /= len
    normal[2] /= len
    
    // Calculate d in plane equation (ax + by + cz + d = 0)
    const d = -(normal[0] * p1[0] + normal[1] * p1[1] + normal[2] * p1[2])
    
    // Calculate center
    const center: [number, number, number] = [
      (p1[0] + p2[0] + p3[0]) / 3,
      (p1[1] + p2[1] + p3[1]) / 3,
      (p1[2] + p2[2] + p3[2]) / 3,
    ]
    
    // Use the maximum distance between the three atoms as the local-radius basis.
    const dist = (a: number[], b: number[]) => Math.sqrt((a[0]-b[0])**2 + (a[1]-b[1])**2 + (a[2]-b[2])**2)
    const maxSpread = Math.max(dist(p1, p2), dist(p2, p3), dist(p1, p3))
    // Local radius is 1.5 times the longest triangle edge to leave editing margin.
    const localRadius = Math.max(maxSpread * 1.5, 5)

    const plane: ConstructedPlane = {
      id: `plane-${Date.now()}`,
      points: [p1, p2, p3],
      normal,
      d,
      center,
      method: 'three-atoms',
      sourceIds: atomIds.slice(0, 3),
      localRadius,
    }

    // Construct the plane without opening the 2D view; the Plane panel controls it.
    set({ constructedPlane: plane, clippingNormal: normal })
  },

  // Construct a plane from Miller indices (h k l) using the reciprocal-lattice direction.
  // normal ∝ h·(a2×a3) + k·(a3×a1) + l·(a1×a2) (= h*b1+k*b2+l*b3, omitting 2π).
  // It crosses the cell center by default; an anchor selects a parallel plane in the same family.
  // This applies only to periodic systems with latticeVectors.
  constructPlaneFromMiller: (h: number, k: number, l: number, anchor?: [number, number, number]) => {
    if (!get().periodic) return
    if (!Number.isInteger(h) || !Number.isInteger(k) || !Number.isInteger(l)) return
    if (h === 0 && k === 0 && l === 0) return  // (000) is undefined
    const lattice = get().latticeVectors as { a: [number, number, number]; b: [number, number, number]; c: [number, number, number] } | null
    if (!lattice) return
    const cross = (u: [number, number, number], v: [number, number, number]): [number, number, number] => [
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0],
    ]
    const a1 = lattice.a, a2 = lattice.b, a3 = lattice.c
    const c23 = cross(a2, a3), c31 = cross(a3, a1), c12 = cross(a1, a2)
    const normal: [number, number, number] = [
      h * c23[0] + k * c31[0] + l * c12[0],
      h * c23[1] + k * c31[1] + l * c12[1],
      h * c23[2] + k * c31[2] + l * c12[2],
    ]
    const len = Math.sqrt(normal[0] ** 2 + normal[1] ** 2 + normal[2] ** 2)
    if (len === 0) return
    normal[0] /= len; normal[1] /= len; normal[2] /= len

    // Prefer the anchor as a point on the plane; otherwise use the unit-cell center.
    const center: [number, number, number] = anchor ?? [
      (a1[0] + a2[0] + a3[0]) / 2,
      (a1[1] + a2[1] + a3[1]) / 2,
      (a1[2] + a2[2] + a3[2]) / 2,
    ]
    const d = -(normal[0] * center[0] + normal[1] * center[1] + normal[2] * center[2])

    // Use 0.8 times the longest lattice vector to cover one visible cell.
    const norm3 = (v: [number, number, number]) => Math.sqrt(v[0] ** 2 + v[1] ** 2 + v[2] ** 2)
    const localRadius = Math.max(norm3(a1), norm3(a2), norm3(a3)) * 0.8

    const plane: ConstructedPlane = {
      id: `plane-miller-${Date.now()}`,
      points: [],
      normal,
      d,
      center,
      method: 'miller',
      sourceIds: anchor ? [`miller-${h}-${k}-${l}-anchored`] : [`miller-${h}-${k}-${l}`],
      localRadius,
    }
    set({ constructedPlane: plane, clippingNormal: normal })
  },

  constructPlaneFromDomainWallMetadata: (domainWall) => {
    const plane = buildDomainWallInterfacePlane({
      latticeVectors: get().latticeVectors,
      domainWall,
    })
    if (!plane) return false
    set({ constructedPlane: plane, show2DPlaneView: false, clippingNormal: plane.normal })
    return true
  },

  setDomainWallReview: (review) => {
    set({ domainWallReview: review && typeof review === 'object' ? review : null })
  },

  clearDomainWallReview: () => {
    set({ domainWallReview: null })
  },

  // Construct plane from 2 edges (using their 4 endpoints)
  constructPlaneFromEdges: (edgeIds: string[]) => {
    if (edgeIds.length < 2) return
    
    const bonds = get().bonds
    const atoms = get().atoms
    
    // Get the first two edges (bonds)
    const edge1 = bonds.find(b => b.id === edgeIds[0])
    const edge2 = bonds.find(b => b.id === edgeIds[1])
    
    if (!edge1 || !edge2) return
    
    // Get atoms for each edge
    const a1 = atoms.find(a => a.id === edge1.atom1Id)
    const a2 = atoms.find(a => a.id === edge1.atom2Id)
    const a3 = atoms.find(a => a.id === edge2.atom1Id)
    const a4 = atoms.find(a => a.id === edge2.atom2Id)
    
    if (!a1?.cartesian || !a2?.cartesian || !a3?.cartesian || !a4?.cartesian) return
    
    const p1 = a1.cartesian
    const p2 = a2.cartesian
    const p3 = a3.cartesian
    const p4 = a4.cartesian
    
    // Use first 3 distinct points to define plane
    const points = [p1, p2]
    // Add p3 if it's not on the line p1-p2
    const v12: [number, number, number] = [p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]]
    const v13: [number, number, number] = [p3[0] - p1[0], p3[1] - p1[1], p3[2] - p1[2]]
    
    // Cross product to check if collinear
    const cross: [number, number, number] = [
      v12[1] * v13[2] - v12[2] * v13[1],
      v12[2] * v13[0] - v12[0] * v13[2],
      v12[0] * v13[1] - v12[1] * v13[0],
    ]
    
    const crossLen = Math.sqrt(cross[0] ** 2 + cross[1] ** 2 + cross[2] ** 2)
    
    if (crossLen > 0.001) {
      points.push(p3)
    } else {
      points.push(p4)
    }
    
    // Now calculate normal
    const v1: [number, number, number] = [points[1][0] - points[0][0], points[1][1] - points[0][1], points[1][2] - points[0][2]]
    const v2: [number, number, number] = [points[2][0] - points[0][0], points[2][1] - points[0][1], points[2][2] - points[0][2]]
    
    const normal: [number, number, number] = [
      v1[1] * v2[2] - v1[2] * v2[1],
      v1[2] * v2[0] - v1[0] * v2[2],
      v1[0] * v2[1] - v1[1] * v2[0],
    ]
    
    const len = Math.sqrt(normal[0] ** 2 + normal[1] ** 2 + normal[2] ** 2)
    if (len <= 1e-9) return
    normal[0] /= len
    normal[1] /= len
    normal[2] /= len
    
    const d = -(normal[0] * points[0][0] + normal[1] * points[0][1] + normal[2] * points[0][2])
    
    const center: [number, number, number] = [
      (p1[0] + p2[0] + p3[0] + p4[0]) / 4,
      (p1[1] + p2[1] + p3[1] + p4[1]) / 4,
      (p1[2] + p2[2] + p3[2] + p4[2]) / 4,
    ]
    
    const plane: ConstructedPlane = {
      id: `plane-${Date.now()}`,
      points: [p1, p2, p3, p4],
      normal,
      d,
      center,
      method: 'two-edges',
      sourceIds: edgeIds.slice(0, 2),
    }
    
    set({ constructedPlane: plane, show2DPlaneView: true, clippingNormal: normal })
  },

  // Construct plane from selected lattice faces (Direct mode)
  constructPlaneFromFaces: (faceIds: string[]) => {
    if (faceIds.length === 0) return
    
    const { latticeVectors } = get()
    
    // Import lattice utils to get faces
    // Since we store face IDs like "face-ab-0-0-0", we can parse them to get the plane info
    // Parse the first face to get the plane orientation
    const firstFaceId = faceIds[0]
    const parts = firstFaceId.split('-')
    
    if (parts.length < 5) return
    
    const planeType = parts[1] as 'ab' | 'bc' | 'ac'
    const { a, b, c } = latticeVectors
    
    // Calculate the plane normal based on the face type
    let normal: [number, number, number]
    let v1: [number, number, number]
    let v2: [number, number, number]
    
    switch (planeType) {
      case 'ab':
        v1 = a
        v2 = b
        break
      case 'bc':
        v1 = b
        v2 = c
        break
      case 'ac':
        v1 = a
        v2 = c
        break
      default:
        return
    }
    
    // Cross product for normal
    normal = [
      v1[1] * v2[2] - v1[2] * v2[1],
      v1[2] * v2[0] - v1[0] * v2[2],
      v1[0] * v2[1] - v1[1] * v2[0],
    ]
    
    // Normalize
    const len = Math.sqrt(normal[0] ** 2 + normal[1] ** 2 + normal[2] ** 2)
    if (len > 0) {
      normal[0] /= len
      normal[1] /= len
      normal[2] /= len
    }
    
    // Parse cell indices to get a point on the plane
    const i = parseInt(parts[2], 10)
    const j = parseInt(parts[3], 10)
    const k = parseInt(parts[4], 10)
    
    // Calculate a point on the plane
    const point: [number, number, number] = [
      i * a[0] + j * b[0] + k * c[0],
      i * a[1] + j * b[1] + k * c[1],
      i * a[2] + j * b[2] + k * c[2],
    ]
    
    // Calculate d in plane equation
    const d = -(normal[0] * point[0] + normal[1] * point[1] + normal[2] * point[2])
    
    // Collect all vertices from all selected faces to display
    const allPoints: [number, number, number][] = []
    
    for (const faceId of faceIds) {
      const faceParts = faceId.split('-')
      if (faceParts.length < 5) continue
      
      const fi = parseInt(faceParts[2], 10)
      const fj = parseInt(faceParts[3], 10)
      const fk = parseInt(faceParts[4], 10)
      const faceType = faceParts[1]
      
      // Calculate the 4 vertices of this face
      const base: [number, number, number] = [
        fi * a[0] + fj * b[0] + fk * c[0],
        fi * a[1] + fj * b[1] + fk * c[1],
        fi * a[2] + fj * b[2] + fk * c[2],
      ]
      
      let fv1: [number, number, number], fv2: [number, number, number]
      
      switch (faceType) {
        case 'ab':
          fv1 = a
          fv2 = b
          break
        case 'bc':
          fv1 = b
          fv2 = c
          break
        case 'ac':
          fv1 = a
          fv2 = c
          break
        default:
          continue
      }
      
      // Add the 4 corners
      allPoints.push(base)
      allPoints.push([base[0] + fv1[0], base[1] + fv1[1], base[2] + fv1[2]])
      allPoints.push([base[0] + fv1[0] + fv2[0], base[1] + fv1[1] + fv2[1], base[2] + fv1[2] + fv2[2]])
      allPoints.push([base[0] + fv2[0], base[1] + fv2[1], base[2] + fv2[2]])
    }
    
    // Calculate center from all points
    const center: [number, number, number] = [0, 0, 0]
    for (const p of allPoints) {
      center[0] += p[0]
      center[1] += p[1]
      center[2] += p[2]
    }
    if (allPoints.length > 0) {
      center[0] /= allPoints.length
      center[1] /= allPoints.length
      center[2] /= allPoints.length
    }
    
    const plane: ConstructedPlane = {
      id: `plane-${Date.now()}`,
      points: allPoints.slice(0, 4), // Just use first face's points for display
      normal,
      d,
      center,
      method: 'direct',
      sourceIds: faceIds,
    }
    
    set({ constructedPlane: plane, show2DPlaneView: true, clippingNormal: normal })
  },

  clearConstructedPlane: () => {
    set((state) => ({
      constructedPlane: null,
      show2DPlaneView: false,
      clippingEnabled: false,
      clippingNormal: null,
      molecularOrbital: {
        ...state.molecularOrbital,
        fieldSlice: { ...state.molecularOrbital.fieldSlice, enabled: false },
        fieldSliceSample: { ...EMPTY_CUBE_FIELD_SLICE_SAMPLE },
      },
    }))
  },

  setShow2DPlaneView: (show: boolean) => {
    set({ show2DPlaneView: show })
  },

  // Select atoms on one side of the constructed plane
  selectAtomsOnPlaneSide: (side: 'positive' | 'negative') => {
    const { constructedPlane, atoms } = get()
    if (!constructedPlane) return
    
    const { normal, d } = constructedPlane
    const selectedIds: string[] = []
    
    for (const atom of atoms) {
      if (!atom.cartesian) continue
      
      // Calculate signed distance to plane
      const dist = normal[0] * atom.cartesian[0] + 
                   normal[1] * atom.cartesian[1] + 
                   normal[2] * atom.cartesian[2] + d
      
      // Select based on side
      if (side === 'positive' && dist > 0.001) {
        selectedIds.push(atom.id)
      } else if (side === 'negative' && dist < -0.001) {
        selectedIds.push(atom.id)
      }
    }
    
    set({ selectedAtomIds: new Set(selectedIds) })
  },

})
