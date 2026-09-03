import * as THREE from 'three'
import { assertTrue } from '../testing/assert'
import { makeProjectClosure, frustumPlanesFromDragRect } from '../lib/render/camera-projection'
import type { FrustumPlane } from '../lib/render/atom-tile-grid'

type Vec3 = [number, number, number]
const SIZE = { width: 800, height: 400 }

function perspective(): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(50, SIZE.width / SIZE.height, 0.1, 1000)
  cam.position.set(20, 10, 120)
  cam.lookAt(0, 0, 0)
  cam.updateMatrixWorld(true)
  cam.updateProjectionMatrix()
  return cam
}

function ortho(): THREE.OrthographicCamera {
  const cam = new THREE.OrthographicCamera(-80, 80, 40, -40, 0.1, 1000)
  cam.position.set(0, 0, 120)
  cam.lookAt(0, 0, 0)
  cam.updateMatrixWorld(true)
  cam.updateProjectionMatrix()
  return cam
}

function planeEval(p: FrustumPlane, x: number, y: number, z: number): number {
  return p.nx * x + p.ny * y + p.nz * z + p.c
}

/** The project closure must equal selection-box.tsx's projectToScreen for the same camera. */
function projectEquivalenceTests() {
  const cam = perspective()
  const project = makeProjectClosure(cam, SIZE)
  const pts: [number, number, number][] = [[0, 0, 0], [10, 5, -3], [-30, 20, 15], [5, -25, 40]]
  for (const [x, y, z] of pts) {
    const v = new THREE.Vector3(x, y, z).project(cam)
    const want = { sx: (v.x * 0.5 + 0.5) * SIZE.width, sy: (-v.y * 0.5 + 0.5) * SIZE.height, ndcZ: v.z }
    const got = project(x, y, z)
    assertTrue(got !== null, `projects ${x},${y},${z}`)
    assertTrue(Math.abs(got!.sx - want.sx) < 1e-6, `sx matches selection-box (${got!.sx} vs ${want.sx})`)
    assertTrue(Math.abs(got!.sy - want.sy) < 1e-6, `sy matches selection-box`)
    assertTrue(Math.abs(got!.ndcZ - want.ndcZ) < 1e-6, `ndcZ matches`)
  }
}

/**
 * Composition correctness: a world point whose projected centre is INSIDE the drag rect (and within
 * near/far) MUST be inside every frustum plane (n·p+c ≥ 0). Otherwise the broad cull would drop a tile
 * the exact filter would select — a silent false negative. Tested for perspective AND orthographic.
 */
function frustumConsistency(cam: THREE.Camera, label: string) {
  const project = makeProjectClosure(cam, SIZE)
  const boxStart = { x: 300, y: 100 }, boxEnd = { x: 520, y: 300 }
  const planes = frustumPlanesFromDragRect(cam, boxStart, boxEnd, SIZE)
  assertTrue(planes !== null && planes.length === 6, `${label}: 6 planes built`)
  const minX = 300, maxX = 520, minY = 100, maxY = 300
  let insideCount = 0, horizTested = 0, vertTested = 0
  for (let x = -60; x <= 60; x += 6)
    for (let y = -60; y <= 60; y += 6)
      for (let z = -60; z <= 60; z += 12) {
        const p = project(x, y, z)
        if (!p) continue
        const depthOk = p.ndcZ > -0.999 && p.ndcZ < 0.999
        const inRect = p.sx >= minX && p.sx <= maxX && p.sy >= minY && p.sy <= maxY && depthOk
        if (inRect) {
          insideCount++
          for (const pl of planes!) {
            assertTrue(planeEval(pl, x, y, z) >= -1e-3, `${label}: in-rect point inside plane (got ${planeEval(pl, x, y, z).toFixed(4)})`)
          }
        } else if ((p.sx > maxX + 40 || p.sx < minX - 40) && p.sy >= minY && p.sy <= maxY && depthOk) {
          // clearly left/right of the rect (vertically within it) → must be outside ≥1 plane
          horizTested++
          assertTrue(planes!.some((pl) => planeEval(pl, x, y, z) < 0), `${label}: horizontally-outside point culled`)
        } else if ((p.sy > maxY + 40 || p.sy < minY - 40) && p.sx >= minX && p.sx <= maxX && depthOk) {
          // clearly above/below the rect (horizontally within it) → must be outside ≥1 plane (top/bottom)
          vertTested++
          assertTrue(planes!.some((pl) => planeEval(pl, x, y, z) < 0), `${label}: vertically-outside point culled`)
        }
      }
  assertTrue(insideCount > 5, `${label}: enough in-rect points sampled (${insideCount})`)
  assertTrue(horizTested > 0, `${label}: some horizontally-outside points culled (${horizTested})`)
  assertTrue(vertTested > 0, `${label}: some vertically-outside points culled (${vertTested})`)
}

/** Depth culling: a point in front of the near plane and one behind the far plane must each fail the
 *  corresponding plane (near = planes[4], far = planes[5]). Built along the rect-centre depth axis,
 *  not unproject(z>1), which is unreliable for perspective. */
function depthCull(cam: THREE.Camera, label: string) {
  const planes = frustumPlanesFromDragRect(cam, { x: 300, y: 100 }, { x: 520, y: 300 }, SIZE)
  assertTrue(planes !== null, `${label}: planes built`)
  const cn: [number, number] = [(300 + 520) / 2 / SIZE.width * 2 - 1, 1 - (100 + 300) / 2 / SIZE.height * 2]
  const nearC = new THREE.Vector3(cn[0], cn[1], -1).unproject(cam)
  const farC = new THREE.Vector3(cn[0], cn[1], 1).unproject(cam)
  const dir: Vec3 = [farC.x - nearC.x, farC.y - nearC.y, farC.z - nearC.z]
  const front: Vec3 = [nearC.x - 0.1 * dir[0], nearC.y - 0.1 * dir[1], nearC.z - 0.1 * dir[2]]
  const back: Vec3 = [farC.x + 0.1 * dir[0], farC.y + 0.1 * dir[1], farC.z + 0.1 * dir[2]]
  const mid: Vec3 = [(nearC.x + farC.x) / 2, (nearC.y + farC.y) / 2, (nearC.z + farC.z) / 2]
  assertTrue(planeEval(planes![4], front[0], front[1], front[2]) < 0, `${label}: in-front-of-near point fails the near plane`)
  assertTrue(planeEval(planes![5], back[0], back[1], back[2]) < 0, `${label}: behind-far point fails the far plane`)
  for (const pl of planes!) assertTrue(planeEval(pl, mid[0], mid[1], mid[2]) >= -1e-3, `${label}: rect-centre mid-depth inside all planes`)
}

function depthCullTests() { depthCull(perspective(), 'perspective'); depthCull(ortho(), 'ortho') }

function frustumPerspectiveTests() { frustumConsistency(perspective(), 'perspective') }
function frustumOrthoTests() { frustumConsistency(ortho(), 'ortho') }

/** Zero-area (or inverted to zero) rects yield null — never [] (which AtomTileGrid reads as "all tiles"). */
function degenerateRectTests() {
  const cam = perspective()
  assertTrue(frustumPlanesFromDragRect(cam, { x: 100, y: 100 }, { x: 100, y: 300 }, SIZE) === null, 'zero width → null')
  assertTrue(frustumPlanesFromDragRect(cam, { x: 100, y: 100 }, { x: 300, y: 100 }, SIZE) === null, 'zero height → null')
  assertTrue(frustumPlanesFromDragRect(cam, { x: 100, y: 100 }, { x: 100, y: 100 }, SIZE) === null, 'point → null')
}

function run() {
  projectEquivalenceTests()
  frustumPerspectiveTests()
  frustumOrthoTests()
  depthCullTests()
  degenerateRectTests()
  console.log('camera-projection tests passed')
}

run()
