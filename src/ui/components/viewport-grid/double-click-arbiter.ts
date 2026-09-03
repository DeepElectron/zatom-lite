/**
 * Coordinate R3F content double-clicks with the outer viewport maximizer. A short
 * timestamp window avoids a sticky boolean when native bubbling crosses systems.
 */
let lastConsumedAt = 0

export function markDoubleClickConsumedBy3D(): void {
  lastConsumedAt = performance.now()
}

export function wasDoubleClickConsumedBy3D(): boolean {
  return performance.now() - lastConsumedAt < 80
}
