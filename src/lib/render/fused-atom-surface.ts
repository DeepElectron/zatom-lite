import * as THREE from 'three'
import type { Atom } from '../crystal/types'
import { bioVdwRadius } from '../biomolecule/surface-geometry'

export interface FusedAtomSurfaceData {
  positions: Float32Array
  normals: Float32Array
  indices: Uint32Array
  colors: Float32Array
}

interface SurfaceAtom {
  position: THREE.Vector3
  radius: number
  color: THREE.Color
}

// Start from a compact space-fill radius, then constrain each touching pair
// against its real centre distance. This keeps small molecules from becoming a
// few oversized, intersecting VDW balls.
const RADIUS_SCALE = 0.8
const CONTACT_OVERLAP = 1.22
const CAP_BLEND_WIDTH = 0.1
const EQUATOR_BULGE = 0.035
const CONTACT_EPSILON = 0.0015

function finitePosition(value: readonly number[]): value is [number, number, number] {
  return value.length === 3 && value.every(Number.isFinite)
}

/**
 * Builds distinct, high-detail atom shells with a small pressure deformation at
 * close contacts. This deliberately does not use a summed Gaussian field: that
 * approach wraps a whole molecule in one metaball envelope and destroys both
 * atom silhouettes and CPK color ownership.
 */
export function buildFusedAtomSurface(
  atoms: readonly Atom[],
  colorForElement: (element: string) => string,
): FusedAtomSurfaceData | null {
  const source: SurfaceAtom[] = []
  for (const atom of atoms) {
    const position = atom.cartesian ?? atom.position
    if (!finitePosition(position)) continue
    source.push({
      position: new THREE.Vector3(...position),
      radius: bioVdwRadius(atom.element) * RADIUS_SCALE,
      // MeshPhysicalMaterial consumes linear vertex colors. Let Three convert
      // the CPK hex from sRGB here instead of feeding raw gamma-space values.
      color: new THREE.Color().setStyle(colorForElement(atom.element)),
    })
  }
  if (!source.length) return null

  // Uniformly reduce each atom only as much as its tightest neighbour requires.
  // The resulting pair is allowed a controlled 12% overlap; that overlap is
  // removed geometrically below by flattening both facing caps, not by clipping.
  const radiusFactors = new Float32Array(source.length).fill(1)
  for (let first = 0; first < source.length; first += 1) {
    for (let second = first + 1; second < source.length; second += 1) {
      const distance = source[first].position.distanceTo(source[second].position)
      const radiusSum = source[first].radius + source[second].radius
      if (distance <= 1e-5 || distance >= radiusSum) continue
      const pairFactor = Math.min(1, (distance * CONTACT_OVERLAP) / radiusSum)
      radiusFactors[first] = Math.min(radiusFactors[first], pairFactor)
      radiusFactors[second] = Math.min(radiusFactors[second], pairFactor)
    }
  }
  source.forEach((atom, index) => {
    atom.radius *= radiusFactors[index]
  })

  // Preserve fine curvature for close-up stills, while keeping large crystals
  // bounded. Atoms are disconnected topologically so their CPK boundaries stay
  // crisp even where the shells visually press into one another.
  const widthSegments = source.length <= 96 ? 64 : source.length <= 320 ? 40 : 24
  const heightSegments = source.length <= 96 ? 40 : source.length <= 320 ? 28 : 18
  const template = new THREE.SphereGeometry(1, widthSegments, heightSegments)
  const basePositions = template.getAttribute('position') as THREE.BufferAttribute
  const baseIndices = template.getIndex()
  if (!baseIndices) {
    template.dispose()
    return null
  }

  const verticesPerAtom = basePositions.count
  const indicesPerAtom = baseIndices.count
  const positions = new Float32Array(verticesPerAtom * source.length * 3)
  const colors = new Float32Array(verticesPerAtom * source.length * 3)
  const indices = new Uint32Array(indicesPerAtom * source.length)
  const direction = new THREE.Vector3()
  const neighborDirection = new THREE.Vector3()

  source.forEach((atom, atomIndex) => {
    const contacts: Array<{ direction: THREE.Vector3; depth: number }> = []
    for (let otherIndex = 0; otherIndex < source.length; otherIndex += 1) {
      if (otherIndex === atomIndex) continue
      const other = source[otherIndex]
      neighborDirection.subVectors(other.position, atom.position)
      const distance = neighborDirection.length()
      const penetration = atom.radius + other.radius - distance
      if (distance <= 1e-5 || penetration <= 0) continue
      // Split the penetration in proportion to each radius. At the exact facing
      // points the two deformed shells meet, while the surrounding broad cap
      // creates the soft pressure bulge visible in the reference.
      contacts.push({
        direction: neighborDirection.clone().multiplyScalar(1 / distance),
        depth: penetration * (atom.radius / (atom.radius + other.radius)),
      })
    }

    const vertexOffset = atomIndex * verticesPerAtom
    const floatOffset = vertexOffset * 3
    for (let vertex = 0; vertex < verticesPerAtom; vertex += 1) {
      direction.fromBufferAttribute(basePositions, vertex).normalize()
      let radius = atom.radius
      for (const contact of contacts) {
        const facing = Math.max(0, direction.dot(contact.direction))
        const planeDistance = atom.radius - contact.depth - CONTACT_EPSILON
        const capCosine = planeDistance / atom.radius
        if (facing >= capCosine) {
          // Clamp a finite spherical cap to the shared contact plane. Unlike a
          // radial dent, this produces an actual contact patch rather than one
          // touching vertex surrounded by a visible gap.
          radius = Math.min(radius, planeDistance / Math.max(facing, 1e-4))
        } else if (facing > capCosine - CAP_BLEND_WIDTH) {
          // Preserve displaced volume as a very small shoulder outside the cap;
          // the smoothstep keeps the silhouette rounded without reopening it.
          const t = (facing - (capCosine - CAP_BLEND_WIDTH)) / CAP_BLEND_WIDTH
          const shoulder = contact.depth * EQUATOR_BULGE * Math.sin(Math.PI * t) ** 2
          radius = Math.max(radius, atom.radius + shoulder)
        }
      }
      radius = Math.max(atom.radius * 0.82, radius)
      const offset = floatOffset + vertex * 3
      positions[offset] = atom.position.x + direction.x * radius
      positions[offset + 1] = atom.position.y + direction.y * radius
      positions[offset + 2] = atom.position.z + direction.z * radius
      colors[offset] = atom.color.r
      colors[offset + 1] = atom.color.g
      colors[offset + 2] = atom.color.b
    }

    const indexOffset = atomIndex * indicesPerAtom
    for (let index = 0; index < indicesPerAtom; index += 1) {
      indices[indexOffset + index] = vertexOffset + baseIndices.getX(index)
    }
  })
  template.dispose()

  // Recalculate normals from the deformed shells instead of reusing radial
  // sphere normals; this is what makes the flattened contact caps read as
  // pressure rather than ordinary intersecting balls under studio lighting.
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setIndex(new THREE.BufferAttribute(indices, 1))
  geometry.computeVertexNormals()
  const normalAttribute = geometry.getAttribute('normal') as THREE.BufferAttribute
  const normals = new Float32Array(normalAttribute.array as Float32Array)
  geometry.dispose()

  return { positions, normals, indices, colors }
}
