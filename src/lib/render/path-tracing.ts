import type * as THREE from 'three'
import { Euler, Scene } from 'three'
import type { WebGLPathTracer } from 'three-gpu-pathtracer'

/** Light-bounce limit after which molecular-scene improvements are negligible. */
export const PATH_TRACING_BOUNCES = 5

/**
 * Convergence target. Monte Carlo noise falls as 1/√N, so quadrupling 256
 * samples only halves residual noise while quadrupling render time.
 */
export const PATH_TRACING_TARGET_SAMPLES = 256

/** Scene representation that cannot be path traced correctly. */
export type PathTracingBlocker = 'instanced' | 'impostor' | 'scene-build-failed'

export const PATH_TRACING_BLOCKER_MESSAGE: Record<PathTracingBlocker, string> = {
  instanced:
    '结构过大，已切换到实例化渲染，路径追踪不支持。缩小结构或提高 Detail threshold 后可用。',
  impostor:
    '结构过大，已切换到 impostor 渲染（球面只存在于着色器里），路径追踪不支持。',
  // Preserve raster output when BVH construction fails.
  'scene-build-failed': '路径追踪场景构建失败，已保持光栅渲染。',
}

interface MaybeInstanced {
  isInstancedMesh?: boolean
  isPoints?: boolean
  count?: number
}

/**
 * Inspect visible scene objects for unsupported geometry. The pinned path tracer
 * ignores `InstancedMesh.instanceMatrix`, collapsing many atoms into one, while
 * shader impostors contain only camera-facing quads rather than real spheres.
 * Runtime inspection stays aligned with the actual LOD path without duplicating
 * its conditions. Hidden objects do not participate in baking and do not block.
 */
export function findPathTracingBlocker(scene: THREE.Scene): PathTracingBlocker | null {
  let blocker: PathTracingBlocker | null = null
  scene.traverseVisible((object) => {
    if (blocker) return
    const candidate = object as unknown as MaybeInstanced
    // A single instance bakes identically to a regular mesh.
    if (candidate.isInstancedMesh && (candidate.count ?? 0) > 1) blocker = 'instanced'
    else if (candidate.isPoints) blocker = 'impostor'
  })
  return blocker
}

/**
 * Supply the `Scene` rotation properties expected by three-gpu-pathtracer
 * 0.0.23 but introduced only in Three r163. The path tracer constructs its own
 * Scene, so compatibility must live on the prototype. Lazy accessors create an
 * independent zero Euler per instance and become a no-op once Three provides
 * the properties itself.
 */
let scenePrototypePatched = false

export function ensurePathTracerSceneCompat(): void {
  if (scenePrototypePatched) return
  scenePrototypePatched = true

  const proto = Scene.prototype as unknown as Record<string, unknown>
  for (const prop of ['backgroundRotation', 'environmentRotation'] as const) {
    // Leave native r163+ properties untouched.
    if (prop in proto) continue
    Object.defineProperty(proto, prop, {
      configurable: true,
      get(this: object) {
        // Materialize an independent property on first access.
        const own = new Euler()
        Object.defineProperty(this, prop, { value: own, writable: true, configurable: true })
        return own
      },
      set(this: object, value: unknown) {
        Object.defineProperty(this, prop, { value, writable: true, configurable: true })
      },
    })
  }
}

/**
 * Release path-tracer GPU resources. Version 0.0.23's public `dispose()` refers
 * to a nonexistent `_renderQuad`, so known private targets are released
 * defensively until that dependency is upgraded.
 */
export function disposePathTracer(tracer: WebGLPathTracer): void {
  const internals = tracer as unknown as {
    _quad?: { dispose?: () => void; material?: { dispose?: () => void } }
    _pathTracer?: { dispose?: () => void }
    _lowResPathTracer?: { dispose?: () => void }
  }
  try {
    internals._quad?.material?.dispose?.()
    internals._quad?.dispose?.()
    internals._pathTracer?.dispose?.()
    internals._lowResPathTracer?.dispose?.()
  } catch (error) {
    console.warn('[zatom] Path tracer disposal failed', error)
  }
}
