/** Pure planning for one continuous hierarchy drill-down camera flight. */

export interface DrillStop {
  center: readonly [number, number, number]
  /** Bounding radius in Å used for framing. */
  radius: number
  label: string
}

export interface DrillLeg {
  center: readonly [number, number, number]
  /** Spread passed to the focus operation. */
  spread: number
  durationMs: number
  label: string
}

/** Duration bounds that preserve direction without making the user wait. */
export const DRILL_MIN_DURATION_MS = 450
export const DRILL_MAX_DURATION_MS = 1_400
/** Base duration near an e-fold span change. */
const DRILL_BASE_DURATION_MS = 700

/** Scale duration logarithmically with framing-span ratio. */
export function drillLegDurationMs(fromRadius: number, toRadius: number): number {
  const from = Math.max(fromRadius, 1e-6)
  const to = Math.max(toRadius, 1e-6)
  const ratio = Math.max(from / to, to / from)
  const scaled = DRILL_BASE_DURATION_MS * (1 + Math.log(ratio))
  if (!Number.isFinite(scaled)) return DRILL_BASE_DURATION_MS
  return Math.min(Math.max(scaled, DRILL_MIN_DURATION_MS), DRILL_MAX_DURATION_MS)
}

export interface DrillFlightOptions {
  /** Reach the same endpoint instantly when reduced motion is requested. */
  reducedMotion?: boolean
  /** Framing margin; values above one retain surrounding context. */
  framingMargin?: number
}

const DEFAULT_FRAMING_MARGIN = 1.35

/** Plan one flight from the first path node to the last, or none if already there. */
export function planDrillFlight(
  path: readonly DrillStop[],
  options: DrillFlightOptions = {},
): DrillLeg[] {
  if (path.length < 2) return []
  const margin = options.framingMargin ?? DEFAULT_FRAMING_MARGIN
  const from = path[0]
  const to = path[path.length - 1]

  if (options.reducedMotion) {
    return [{ center: to.center, spread: to.radius * margin, durationMs: 0, label: to.label }]
  }

  return [
    {
      center: to.center,
      spread: to.radius * margin,
      durationMs: drillLegDurationMs(from.radius, to.radius),
      label: to.label,
    },
  ]
}

/** Return whether two stops differ only below the visible motion threshold. */
export function drillStopsAreEquivalent(a: DrillStop, b: DrillStop): boolean {
  const dx = a.center[0] - b.center[0]
  const dy = a.center[1] - b.center[1]
  const dz = a.center[2] - b.center[2]
  const centerShift = Math.sqrt(dx * dx + dy * dy + dz * dz)
  const scale = Math.max(a.radius, b.radius, 1e-6)
  return centerShift / scale < 0.02 && Math.abs(a.radius - b.radius) / scale < 0.02
}
