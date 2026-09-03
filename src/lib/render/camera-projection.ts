import * as THREE from 'three'
import type { FrustumPlane } from './atom-tile-grid'
import type { ProjectFn } from './cpu-box-select'

/**
 * THREE-coupled (but non-React) projection helpers bridging the live camera to the pure CPU
 * pick/box-select core (hard bone C, tens of millions of atoms). `gpu-id-picker.ts` already imports THREE in this
 * folder, so these live beside it. Kept out of the pure modules so those stay unit-testable; these
 * are themselves testable with THREE's camera math (no WebGL) — see cameraProjection.test.ts.
 */

/**
 * A `ProjectFn` over a live camera, mirroring `selection-box.tsx:projectToScreen` exactly (CSS px,
 * y-flipped, NDC z passed through; null when non-finite). Owns its scratch Vector3 because
 * `Vector3.project` mutates its receiver.
 */
export function makeProjectClosure(camera: THREE.Camera, size: { width: number; height: number }): ProjectFn {
  const scratch = new THREE.Vector3()
  return (x, y, z) => {
    scratch.set(x, y, z).project(camera)
    if (!Number.isFinite(scratch.x) || !Number.isFinite(scratch.y) || !Number.isFinite(scratch.z)) return null
    return {
      sx: (scratch.x * 0.5 + 0.5) * size.width,
      sy: (-scratch.y * 0.5 + 0.5) * size.height,
      ndcZ: scratch.z,
    }
  }
}

/**
 * Six inward-facing world-space planes for the drag rect (CSS px), uniform for perspective AND
 * orthographic cameras: unproject the rect's 4 corners at near (z=-1) and far (z=+1) NDC to 8 world
 * points, build planes from the side/near/far quads, then orient each so the rect-centre reference
 * point is inside (matching `FrustumPlane`'s `n·p + c ≥ 0`). Returns null for a zero-area rect —
 * never `[]`, which `AtomTileGrid.frustumCandidates` would read as "no planes → all tiles".
 */
export function frustumPlanesFromDragRect(
  camera: THREE.Camera,
  boxStart: { x: number; y: number },
  boxEnd: { x: number; y: number },
  size: { width: number; height: number },
): FrustumPlane[] | null {
  const minX = Math.min(boxStart.x, boxEnd.x), maxX = Math.max(boxStart.x, boxEnd.x)
  const minY = Math.min(boxStart.y, boxEnd.y), maxY = Math.max(boxStart.y, boxEnd.y)
  if (!(maxX - minX > 0) || !(maxY - minY > 0)) return null // zero-area / degenerate

  camera.updateMatrixWorld(true)
  const toNdc = (cssX: number, cssY: number): [number, number] => [
    (cssX / size.width) * 2 - 1,
    1 - (cssY / size.height) * 2, // y-flip matches selection-box.tsx
  ]
  const unproject = (ndc: [number, number], z: number): THREE.Vector3 =>
    new THREE.Vector3(ndc[0], ndc[1], z).unproject(camera)

  const tl = toNdc(minX, minY), tr = toNdc(maxX, minY), br = toNdc(maxX, maxY), bl = toNdc(minX, maxY)
  const nearTL = unproject(tl, -1), nearTR = unproject(tr, -1), nearBR = unproject(br, -1), nearBL = unproject(bl, -1)
  const farTL = unproject(tl, 1), farTR = unproject(tr, 1), farBR = unproject(br, 1), farBL = unproject(bl, 1)
  const inside = unproject(toNdc((minX + maxX) / 2, (minY + maxY) / 2), 0)

  const planes = [
    planeFromTriangle(nearBL, nearTL, farTL),  // left
    planeFromTriangle(nearTR, nearBR, farBR),  // right
    planeFromTriangle(nearTL, nearTR, farTR),  // top
    planeFromTriangle(nearBR, nearBL, farBL),  // bottom
    planeFromTriangle(nearTL, nearBL, nearBR), // near
    planeFromTriangle(farTR, farBR, farBL),    // far
  ]
  for (const pl of planes) {
    if (!pl) return null // degenerate (collinear corners from a singular camera)
    orientInward(pl, inside)
  }
  return planes as FrustumPlane[]
}

/** Plane through 3 points with a unit normal, or null if the points are collinear. */
function planeFromTriangle(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): FrustumPlane | null {
  const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z
  const vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
  const len = Math.hypot(nx, ny, nz)
  if (!(len > 0)) return null
  nx /= len; ny /= len; nz /= len
  return { nx, ny, nz, c: -(nx * a.x + ny * a.y + nz * a.z) }
}

/** Flip the plane so the reference point is on the inside (n·p + c ≥ 0). */
function orientInward(pl: FrustumPlane, inside: THREE.Vector3): void {
  if (pl.nx * inside.x + pl.ny * inside.y + pl.nz * inside.z + pl.c < 0) {
    pl.nx = -pl.nx; pl.ny = -pl.ny; pl.nz = -pl.nz; pl.c = -pl.c
  }
}
