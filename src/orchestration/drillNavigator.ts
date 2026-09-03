/**
 * Executes a hierarchical drill-down.
 *
 * Responsibility boundaries:
 * - Pure functions in lib/render/drill-choreography choose destinations and durations.
 * - CameraController owns interpolation, easing, and manual takeover.
 * - This module advances steps serially and yields immediately to manual input.
 *
 * Each focus replaces cameraTarget, so starting a new step before the previous
 * 1.2-second flight lands would reinitialize the controller in the same frame.
 * Waiting for each landing prevents visible camera jumps.
 */

import type { StoreApi } from 'zustand'
import type { CrystalStore } from './crystal-store-types'
import {
  drillStopsAreEquivalent,
  planDrillFlight,
  type DrillStop,
} from '../lib/render/drill-choreography'

/** Extra wait budget for one flight before it is considered unable to land. */
const SETTLE_GRACE_MS = 700
const SETTLE_POLL_MS = 40

export type DrillOutcome = 'completed' | 'interrupted' | 'noop'

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Waits for the camera to land.
 *
 * Polls isAnimatingCamera instead of waiting for durationMs because manual
 * dragging clears the flag early and must be detected immediately.
 *
 * Returns false if the camera has not landed before the timeout.
 */
export async function awaitCameraSettle(
  api: StoreApi<CrystalStore>,
  expectedDurationMs: number,
): Promise<boolean> {
  if (!api.getState().isAnimatingCamera) return true
  const deadline = Date.now() + expectedDurationMs + SETTLE_GRACE_MS
  while (api.getState().isAnimatingCamera) {
    if (Date.now() >= deadline) return false
    await new Promise((resolve) => setTimeout(resolve, SETTLE_POLL_MS))
  }
  return true
}

export interface DrillFlightRequest {
  /** Complete hierarchy path from the current level through the target level. */
  path: readonly DrillStop[]
  /**
   * Called after each landing to synchronize breadcrumbs, highlights, and similar UI.
   * Throwing aborts the remaining steps.
   */
  onLegSettled?: (stop: DrillStop, legIndex: number) => void
}

/**
 * Runs one drill-down flight.
 *
 * If the user drags the camera during a flight, the controller clears
 * isAnimatingCamera. The navigator then abandons the remaining steps and
 * returns 'interrupted' so it never retakes control from the user.
 */
export async function runDrillFlight(
  api: StoreApi<CrystalStore>,
  request: DrillFlightRequest,
): Promise<DrillOutcome> {
  const { path, onLegSettled } = request
  if (path.length < 2) return 'noop'

  const from = path[0]
  const to = path[path.length - 1]
  // Avoid a pointless camera twitch when already at the target.
  if (drillStopsAreEquivalent(from, to)) return 'noop'

  const legs = planDrillFlight(path, { reducedMotion: prefersReducedMotion() })
  if (legs.length === 0) return 'noop'

  for (let legIndex = 0; legIndex < legs.length; legIndex += 1) {
    const leg = legs[legIndex]
    const focusOnPoint = api.getState().focusOnPoint
    if (typeof focusOnPoint !== 'function') return 'interrupted'

    // Snapshot the interruption counter before the flight. CameraController
    // increments it on manual takeover. isAnimatingCamera alone is insufficient:
    // both takeover and normal landing end with the flag cleared.
    const interruptionsBefore = api.getState().cameraFlightInterruptions

    focusOnPoint([leg.center[0], leg.center[1], leg.center[2]], leg.spread, leg.durationMs)

    const settled = await awaitCameraSettle(api, leg.durationMs)
    if (!settled) return 'interrupted'
    if (api.getState().cameraFlightInterruptions !== interruptionsBefore) return 'interrupted'

    onLegSettled?.(
      { center: leg.center, radius: leg.spread, label: leg.label },
      legIndex,
    )
  }

  return 'completed'
}
