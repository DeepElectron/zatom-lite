/**
 * WebMCP host implementation of `ZatomCameraSurface`.
 *
 * Existing focus actions own framing and clearance. An explicit view only
 * rewrites the framed target with `forceOrientation`, then waits for the store
 * to finish the flight. Manual camera input increments the interruption count,
 * which lets callers stop a tour without fighting the user.
 */

import { CameraInputError, resolveViewDirection } from '../lib/render/camera-directions'
export { CameraInputError } from '../lib/render/camera-directions'
import { getActiveViewportStoreApi } from '../orchestration/ViewportContext'
import type {
  CameraFlightResult,
  CameraLookAtRequest,
  CameraTargetSpec,
  CameraViewSpec,
  Vec3,
  ZatomCameraSurface,
} from './contracts'
import type { ZatomStructure } from './contracts'

/**
 * Where the agent last landed the camera. Read back by viewer_observe so the
 * agent can relate "what I just showed" to "what the user then clicked".
 */
const lastFocusByViewport = new WeakMap<object, { atomIds: string[]; center: Vec3; at: number }>()

export function readLastCameraFocus(
  api = getActiveViewportStoreApi(),
): { atomIds: string[]; center: Vec3; at: number } | null {
  const lastFocus = lastFocusByViewport.get(api as unknown as object)
  return lastFocus ? { atomIds: [...lastFocus.atomIds], center: [...lastFocus.center] as Vec3, at: lastFocus.at } : null
}

function resolveTargetAtoms(
  target: CameraTargetSpec,
  api: ReturnType<typeof getActiveViewportStoreApi>,
): { ids: string[]; center: Vec3 | null; radius: number } {
  const state = api.getState()
  if (typeof target === 'object' && 'point' in target) {
    return { ids: [], center: target.point, radius: target.radius ?? 3 }
  }
  let ids: string[]
  if (target === 'selection') ids = Array.from(state.selectedAtomIds ?? [])
  else if (target === 'all') ids = state.atoms.map((atom) => atom.id)
  else ids = target.atomIds
  if (ids.length === 0) {
    throw new CameraInputError(
      'empty_target',
      target === 'selection' ? 'Nothing is selected; pass atomIds or a point.' : 'Target resolved to zero atoms.',
    )
  }
  const known = new Set(state.atoms.map((atom) => atom.id))
  const missing = ids.filter((id) => !known.has(id))
  if (missing.length) {
    throw new CameraInputError('unknown_atoms', `Unknown atom ids: ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? '…' : ''}.`)
  }
  return { ids, center: null, radius: 0 }
}

/** Resolve when the flight lands (or is aborted). Falls back after a generous timeout. */
function awaitLanding(
  api: ReturnType<typeof getActiveViewportStoreApi>,
  durationMs: number | undefined,
  signal?: AbortSignal,
): Promise<boolean> {
  const interruptionsBefore = api.getState().cameraFlightInterruptions
  if (signal?.aborted) {
    return Promise.reject(signal.reason instanceof Error ? signal.reason : new Error('Camera operation was cancelled'))
  }
  return new Promise((resolve, reject) => {
    const finish = () => {
      unsub()
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      resolve(api.getState().cameraFlightInterruptions !== interruptionsBefore)
    }
    const onAbort = () => {
      unsub()
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      api.getState().abortCameraFlight()
      reject(signal?.reason instanceof Error ? signal.reason : new Error('Camera operation was cancelled'))
    }
    const unsub = api.subscribe((state) => {
      if (!state.isAnimatingCamera) finish()
    })
    const timer = setTimeout(finish, (durationMs ?? 1200) + 1500)
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) {
      onAbort()
      return
    }
    if (!api.getState().isAnimatingCamera) finish()
  })
}

function currentDirection(api: ReturnType<typeof getActiveViewportStoreApi>): Vec3 {
  const state = api.getState()
  const target = state.cameraTarget
  const position = target?.position ?? state.initialCameraPosition ?? [0, 0, 1]
  const lookAt = target?.lookAt ?? state.initialCameraLookAt ?? [0, 0, 0]
  const d: Vec3 = [position[0] - lookAt[0], position[1] - lookAt[1], position[2] - lookAt[2]]
  return Math.hypot(...d) < 1e-6 ? [0, 0, 1] : resolveViewDirection({ direction: d })
}

async function fly(
  target: CameraTargetSpec,
  view: CameraViewSpec | undefined,
  durationMs: number | undefined,
  readStructure: () => ZatomStructure | null,
  signal?: AbortSignal,
): Promise<CameraFlightResult> {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error('Camera operation was cancelled')
  }
  const api = getActiveViewportStoreApi()
  const resolved = resolveTargetAtoms(target, api)

  // Let the slice do the framing maths (distance, clearance, framingSpan).
  if (resolved.center) api.getState().focusOnPoint(resolved.center, resolved.radius, durationMs)
  else api.getState().focusOnAtoms(resolved.ids)

  const framed = api.getState().cameraTarget
  if (!framed) throw new CameraInputError('no_viewport', 'No active viewport accepted the camera request.')
  const center = framed.lookAt
  const distance = framed.distance ?? Math.hypot(
    framed.position[0] - center[0], framed.position[1] - center[1], framed.position[2] - center[2],
  )

  let direction = currentDirection(api)
  if (view !== undefined) {
    direction = resolveViewDirection(view, readStructure()?.lattice?.vectors)
    api.getState().setCameraTarget({
      ...framed,
      position: [center[0] + direction[0] * distance, center[1] + direction[1] * distance, center[2] + direction[2] * distance],
      preserveViewDirection: false,
      forceOrientation: true,
      ...(durationMs === undefined ? {} : { durationMs }),
    })
  } else if (durationMs !== undefined && framed.durationMs !== durationMs) {
    api.getState().setCameraTarget({ ...framed, durationMs })
  }
  api.getState().setIsAnimatingCamera(true)

  const interrupted = await awaitLanding(api, durationMs, signal)
  if (!interrupted) {
    lastFocusByViewport.set(api as unknown as object, {
      atomIds: [...resolved.ids], center: [...center] as Vec3, at: Date.now(),
    })
  }
  return { center: [...center] as Vec3, distance, direction, atomIds: resolved.ids, interrupted }
}

/**
 * Built by viewer-context, which owns the canonical structure reader; taking
 * it as a parameter keeps this module free of a back-edge into viewer-context.
 */
export function createActiveViewportCameraSurface(readStructure: () => ZatomStructure | null): ZatomCameraSurface {
  return {
    lookAt: (request: CameraLookAtRequest, signal) => fly(
      request.target,
      request.view,
      request.durationMs,
      readStructure,
      signal,
    ),
    setView: (view, durationMs, signal) => {
      const state = getActiveViewportStoreApi().getState()
      const lookAt = state.cameraTarget?.lookAt ?? state.initialCameraLookAt
      if (!lookAt) return fly('all', view, durationMs, readStructure, signal)
      return fly(
        { point: lookAt, radius: state.cameraTarget?.framingSpan ? state.cameraTarget.framingSpan / 2 : 3 },
        view,
        durationMs,
        readStructure,
        signal,
      )
    },
  }
}
