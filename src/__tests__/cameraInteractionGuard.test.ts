import {
  CAMERA_TRACK_NO_POINTER_IDLE_MS,
  CAMERA_TRACK_RELEASE_GRACE_MS,
  CAMERA_TRACK_STALE_POINTER_IDLE_MS,
  beginCameraManualInteraction,
  createCameraInteractionGuardState,
  recordCameraManualActivity,
  recordCameraPointerDown,
  recordCameraPointerRelease,
  releaseAllCameraPointers,
  watchdogCameraInteraction,
} from '../lib/render/camera-interaction-guard'
import { assertDeepEqual, assertEqual } from '../testing/assert'

function run() {
  let guard = createCameraInteractionGuardState()
  guard = recordCameraPointerDown(guard, 7, 10)
  guard = beginCameraManualInteraction(guard, 20)
  assertEqual(guard.manualActive, true, 'OrbitControls start must suppress the recorded camera track')
  assertDeepEqual(guard.activePointerIds, [7], 'the guard must retain the browser pointer lifecycle')

  // Regression: OrbitControls may lose its `end` event. A window-level pointer
  // release must still end the manual phase and preserve the damping grace.
  guard = recordCameraPointerRelease(guard, 7, 100)
  assertEqual(guard.manualActive, false, 'pointer release must recover from a missing controls end event')
  assertEqual(guard.graceUntil, 100 + CAMERA_TRACK_RELEASE_GRACE_MS, 'manual release must retain the 600ms grace')

  // Damping changes during the grace window move its trailing edge; camera
  // keyframes may resume only after the actual tail has gone quiet.
  guard = recordCameraManualActivity(guard, 400)
  assertEqual(guard.graceUntil, 400 + CAMERA_TRACK_RELEASE_GRACE_MS, 'damping activity must extend the release grace')
  const guardedDuringGrace = watchdogCameraInteraction(guard, 400 + CAMERA_TRACK_RELEASE_GRACE_MS - 1)
  assertEqual(guardedDuringGrace.graceUntil, guard.graceUntil, 'the camera track must stay blocked for the complete grace window')
  guard = watchdogCameraInteraction(guard, 400 + CAMERA_TRACK_RELEASE_GRACE_MS)
  assertEqual(guard.graceUntil, 0, 'grace expiry must wake demand rendering for a queued camera track pose')

  // A wheel/start path has no active pointer. If controls end is lost, the
  // shorter no-pointer watchdog releases it deterministically.
  guard = beginCameraManualInteraction(createCameraInteractionGuardState(), 1_000)
  guard = watchdogCameraInteraction(guard, 1_000 + CAMERA_TRACK_NO_POINTER_IDLE_MS - 1)
  assertEqual(guard.manualActive, true, 'the watchdog must not pre-empt a live no-pointer interaction')
  guard = watchdogCameraInteraction(guard, 1_000 + CAMERA_TRACK_NO_POINTER_IDLE_MS)
  assertEqual(guard.manualActive, false, 'the watchdog must recover a start event with no matching end')

  // Even a lost pointerup cannot make the state permanent. Activity refreshes
  // the generous pointer watchdog, then expiry clears the stale pointer id.
  guard = recordCameraPointerDown(createCameraInteractionGuardState(), 9, 2_000)
  guard = beginCameraManualInteraction(guard, 2_000)
  guard = recordCameraManualActivity(guard, 2_500)
  guard = watchdogCameraInteraction(guard, 2_500 + CAMERA_TRACK_STALE_POINTER_IDLE_MS - 1)
  assertEqual(guard.manualActive, true, 'recent pointer activity must keep manual control authoritative')
  guard = watchdogCameraInteraction(guard, 2_500 + CAMERA_TRACK_STALE_POINTER_IDLE_MS)
  assertEqual(guard.manualActive, false, 'the hard watchdog must recover a lost pointer lifecycle')
  assertDeepEqual(guard.activePointerIds, [], 'hard recovery must discard stale pointer ids')

  guard = beginCameraManualInteraction(createCameraInteractionGuardState(), 5_000)
  guard = releaseAllCameraPointers(guard, 5_050)
  assertEqual(guard.manualActive, false, 'window blur or hidden visibility must release all manual input')
}

run()
