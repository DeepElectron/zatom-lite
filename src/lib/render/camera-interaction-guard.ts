export const CAMERA_TRACK_RELEASE_GRACE_MS = 600
export const CAMERA_TRACK_NO_POINTER_IDLE_MS = 1_000
export const CAMERA_TRACK_STALE_POINTER_IDLE_MS = 30_000

/**
 * Framework-free state for arbitrating recorded camera poses and manual
 * OrbitControls input. Pointer ids are kept in the state so a lost controls
 * `end` event cannot leave the recorded track disabled forever.
 */
export interface CameraInteractionGuardState {
  manualActive: boolean
  activePointerIds: readonly number[]
  lastActivityAt: number
  graceUntil: number
}

export function createCameraInteractionGuardState(): CameraInteractionGuardState {
  return {
    manualActive: false,
    activePointerIds: [],
    lastActivityAt: 0,
    graceUntil: 0,
  }
}

function withPointer(
  pointerIds: readonly number[],
  pointerId: number,
): readonly number[] {
  return pointerIds.includes(pointerId) ? pointerIds : [...pointerIds, pointerId]
}

export function recordCameraPointerDown(
  state: CameraInteractionGuardState,
  pointerId: number,
  now: number,
): CameraInteractionGuardState {
  return {
    ...state,
    activePointerIds: withPointer(state.activePointerIds, pointerId),
    lastActivityAt: state.manualActive ? now : state.lastActivityAt,
  }
}

export function beginCameraManualInteraction(
  state: CameraInteractionGuardState,
  now: number,
): CameraInteractionGuardState {
  return {
    ...state,
    manualActive: true,
    lastActivityAt: now,
    graceUntil: 0,
  }
}

export function recordCameraManualActivity(
  state: CameraInteractionGuardState,
  now: number,
): CameraInteractionGuardState {
  if (!state.manualActive && now >= state.graceUntil) return state

  // While active this refreshes the watchdog; after release OrbitControls
  // `change` events extend the grace to cover the real damping tail.
  return {
    ...state,
    lastActivityAt: now,
    graceUntil: state.manualActive ? 0 : now + CAMERA_TRACK_RELEASE_GRACE_MS,
  }
}

export function endCameraManualInteraction(
  state: CameraInteractionGuardState,
  now: number,
): CameraInteractionGuardState {
  return {
    ...state,
    manualActive: false,
    graceUntil: Math.max(state.graceUntil, now + CAMERA_TRACK_RELEASE_GRACE_MS),
  }
}

export function recordCameraPointerRelease(
  state: CameraInteractionGuardState,
  pointerId: number,
  now: number,
): CameraInteractionGuardState {
  const activePointerIds = state.activePointerIds.filter((id) => id !== pointerId)
  const next = { ...state, activePointerIds }
  return state.manualActive && activePointerIds.length === 0
    ? endCameraManualInteraction(next, now)
    : next
}

export function releaseAllCameraPointers(
  state: CameraInteractionGuardState,
  now: number,
): CameraInteractionGuardState {
  const next = { ...state, activePointerIds: [] }
  return state.manualActive ? endCameraManualInteraction(next, now) : next
}

/**
 * Recovers from either half of an incomplete browser gesture lifecycle:
 * controls `start` without a matching `end`, or a pointer that never emitted
 * `up`/`cancel`/`lostpointercapture`. The latter gets a deliberately generous
 * idle window so a legitimate long press is not pre-empted.
 */
export function watchdogCameraInteraction(
  state: CameraInteractionGuardState,
  now: number,
): CameraInteractionGuardState {
  if (!state.manualActive) {
    // In demand-render mode the damping tail may stop requesting frames before
    // its grace expires. Clearing the elapsed deadline gives the controller's
    // interval one state transition on which to invalidate and apply a queued
    // scrub/playhead pose.
    return state.graceUntil > 0 && now >= state.graceUntil
      ? { ...state, graceUntil: 0 }
      : state
  }
  const idleFor = Math.max(0, now - state.lastActivityAt)
  const idleLimit = state.activePointerIds.length > 0
    ? CAMERA_TRACK_STALE_POINTER_IDLE_MS
    : CAMERA_TRACK_NO_POINTER_IDLE_MS
  if (idleFor < idleLimit) return state
  return endCameraManualInteraction({ ...state, activePointerIds: [] }, now)
}
