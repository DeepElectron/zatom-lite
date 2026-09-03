/**
 * Fit studio shadows across molecular scales ranging from small fragments to
 * large proteins and supercells. Both the orthographic shadow frustum and bias
 * scale with visible geometry.
 */

import { Box3, Sphere, Vector3 } from 'three'
import type { DirectionalLight, InstancedMesh, Mesh, Object3D, Scene } from 'three'

/** 2048 balances sphere-contact edge quality against GPU memory and bandwidth. */
const SHADOW_MAP_SIZE = 2048

/** PCF radius for softbox-like contact shadows. */
const SHADOW_SOFTNESS = 4

const _box = new Box3()
const _sphere = new Sphere()
const _center = new Vector3()

function isGeometryCarrier(object: Object3D): boolean {
  const mesh = object as Mesh & InstancedMesh
  return Boolean((mesh.isMesh || mesh.isInstancedMesh) && mesh.geometry)
}

/**
 * Cheap visible-geometry fingerprint used to avoid recomputing instanced bounds
 * every frame. `instanceMatrix.version` follows Three's own invalidation signal.
 */
export function sceneGeometryFingerprint(scene: Scene): number {
  let fingerprint = 0
  scene.traverseVisible((object) => {
    if (!isGeometryCarrier(object)) return
    const mesh = object as InstancedMesh
    const version = mesh.isInstancedMesh ? mesh.count + mesh.instanceMatrix.version : 0
    // A 32-bit rolling hash avoids collisions from simple component sums.
    fingerprint = (fingerprint * 31 + version + (mesh.geometry?.id ?? 0)) | 0
  })
  return fingerprint
}

/** Return the world-space sphere enclosing visible geometry. */
export function computeSceneBounds(scene: Scene): Sphere | null {
  _box.makeEmpty()
  let found = false

  scene.traverseVisible((object) => {
    if (!isGeometryCarrier(object)) return
    const mesh = object as Mesh & InstancedMesh

    // Instanced bounds must be refreshed after instance-matrix updates.
    if (mesh.isInstancedMesh) mesh.computeBoundingBox()

    found = true
    _box.expandByObject(mesh)
  })

  if (!found || _box.isEmpty()) return null
  return _box.getBoundingSphere(_sphere)
}

/**
 * Fit the shadow camera to a bounding sphere. A negative orthographic near plane
 * keeps large structures visible even when the directional light lies inside
 * their bounds, without changing the shared light position.
 */
export function fitDirectionalShadow(light: DirectionalLight, bounds: Sphere): void {
  const radius = Math.max(bounds.radius, 1e-3)

  // Preserve lighting direction and grow the frustum for off-origin content.
  const offset = _center.copy(bounds.center).length()
  const extent = (radius + offset) * 1.1

  light.castShadow = true
  if (light.shadow.mapSize.x !== SHADOW_MAP_SIZE) {
    light.shadow.mapSize.setScalar(SHADOW_MAP_SIZE)
    // Reallocate the render target after changing map size.
    light.shadow.map?.dispose()
    light.shadow.map = null
  }

  const camera = light.shadow.camera
  camera.left = -extent
  camera.right = extent
  camera.top = extent
  camera.bottom = -extent
  camera.near = -(radius + offset) * 2
  camera.far = light.position.length() + (radius + offset) * 2
  camera.updateProjectionMatrix()

  light.shadow.radius = SHADOW_SOFTNESS
  // Scale normal bias with the structure to balance contact leaks and acne.
  light.shadow.normalBias = radius * 0.02
  light.shadow.bias = 0
}

/** Disable shadows and release their resident render target. */
export function releaseDirectionalShadow(light: DirectionalLight): void {
  light.castShadow = false
  light.shadow.map?.dispose()
  light.shadow.map = null
}
