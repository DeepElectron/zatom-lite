/**
 * Layout planning and confirmation tokens for mounting many structures at once.
 *
 * Mounting ten structures rearranges the user's whole viewport, so a batch
 * mount above a small threshold returns a plan for confirmation instead of
 * acting. The token is a digest of the normalized plan rather than a
 * server-side pending record: there is no expiry to tune and no state to leak,
 * and a token stops matching the moment the plan it described changes.
 *
 * The token is an integrity check against plan drift, not an authorization
 * secret. It answers "is this still the plan the user agreed to?" for a caller
 * that already has viewport write access, so a fast portable digest is the
 * right tool; anyone able to forge one could simply mount directly. These
 * tools also run in the browser adapter, so this deliberately uses the
 * project's portable hasher instead of `node:crypto`.
 */

import { createFnv1a64Hasher } from './structure-math'
import { GRID_SPECS, LAYOUTS_BY_CAPACITY, type GridLayout } from '../orchestration/viewportManager'

/** Mounts at or below this size apply directly; larger batches ask first. */
export const MOUNT_CONFIRMATION_THRESHOLD = 4

export interface MountCandidate {
  /** Caller-supplied label used to identify the structure in the plan. */
  readonly label: string
  readonly atomCount?: number
}

export interface MountSlotAssignment {
  readonly slotIndex: number
  readonly slotId: string | null
  readonly expectedStructureFingerprint: string | null
  readonly expectedTrajectoryFingerprint: string | null
  readonly expectedWorkspaceRevision: number | null
  readonly label: string
  readonly atomCount: number | null
}

export interface MountPlan {
  readonly instanceId: string
  readonly layout: GridLayout
  readonly slotCapacity: number
  readonly assignments: readonly MountSlotAssignment[]
  readonly emptySlots: number
  /** Null when no candidate carried an atom count. */
  readonly totalAtomCount: number | null
  readonly overflow: readonly string[]
  readonly preservedSlotCount: number
  /** Targets not visible during planning cannot be safely confirmation-bound. */
  readonly unboundTargetCount: number
}

/**
 * Chooses the smallest layout that holds every candidate. Requesting a layout
 * explicitly is honored even when it overflows, so the plan can report exactly
 * which structures would not fit rather than silently expanding the grid.
 */
export function planMount(
  instanceId: string,
  candidates: readonly MountCandidate[],
  requestedLayout?: GridLayout,
  options: {
    preserveExisting?: boolean
    occupiedSlotIndices?: readonly number[]
    slotBindings?: ReadonlyArray<{
      slotIndex: number
      slotId: string
      structureFingerprint: string | null
      trajectoryFingerprint: string | null
      workspaceRevision: number | null
    }>
  } = {},
): MountPlan {
  if (candidates.length === 0) throw new Error('Provide at least one structure to mount')
  const occupied = options.preserveExisting
    ? [...new Set(options.occupiedSlotIndices ?? [])].filter((index) => Number.isSafeInteger(index) && index >= 0)
    : []
  const minimumCapacity = Math.max(
    occupied.length + candidates.length,
    occupied.length ? Math.max(...occupied) + 1 : 0,
  )
  const layout = requestedLayout
    ?? LAYOUTS_BY_CAPACITY.find((candidate) => GRID_SPECS[candidate].total >= minimumCapacity)
    ?? LAYOUTS_BY_CAPACITY[LAYOUTS_BY_CAPACITY.length - 1]
  const capacity = GRID_SPECS[layout].total
  const availableIndices = Array.from({ length: capacity }, (_, index) => index)
    .filter((index) => !occupied.includes(index))
  const placed = candidates.slice(0, availableIndices.length)
  const overflow = candidates.slice(availableIndices.length).map((candidate) => candidate.label)
  const counted = placed.filter((candidate) => typeof candidate.atomCount === 'number')
  const bindingByIndex = new Map((options.slotBindings ?? []).map((binding) => [binding.slotIndex, binding]))
  const assignments = placed.map((candidate, index) => {
    const slotIndex = availableIndices[index]
    const binding = bindingByIndex.get(slotIndex)
    return {
      slotIndex,
      slotId: binding?.slotId ?? null,
      expectedStructureFingerprint: binding?.structureFingerprint ?? null,
      expectedTrajectoryFingerprint: binding?.trajectoryFingerprint ?? null,
      expectedWorkspaceRevision: binding?.workspaceRevision ?? null,
      label: candidate.label,
      atomCount: typeof candidate.atomCount === 'number' ? candidate.atomCount : null,
    }
  })
  return {
    instanceId,
    layout,
    slotCapacity: capacity,
    assignments,
    emptySlots: Math.max(0, capacity - occupied.length - placed.length),
    totalAtomCount: counted.length === 0
      ? null
      : counted.reduce((sum, candidate) => sum + (candidate.atomCount ?? 0), 0),
    overflow,
    preservedSlotCount: occupied.length,
    unboundTargetCount: assignments.filter((assignment) => assignment.slotId === null).length,
  }
}

/**
 * Canonical plan encoding. Only the fields that define what will happen are
 * included, so re-planning the same request reproduces the same token while any
 * change to targeting, layout, or ordering invalidates it.
 */
function canonicalPlan(plan: MountPlan): string {
  return JSON.stringify([
    plan.instanceId,
    plan.layout,
    plan.assignments.map((assignment) => [
      assignment.slotIndex,
      assignment.slotId,
      assignment.expectedStructureFingerprint,
      assignment.expectedTrajectoryFingerprint,
      assignment.expectedWorkspaceRevision,
      assignment.label,
    ]),
    plan.preservedSlotCount,
  ])
}

export function mountConfirmationToken(plan: MountPlan): string {
  const hasher = createFnv1a64Hasher()
  hasher.feed(canonicalPlan(plan))
  return `mnt_${hasher.digest().replace('fnv1a64:', '')}`
}

export function mountConfirmationTokenMatches(plan: MountPlan, token: string): boolean {
  return mountConfirmationToken(plan) === token
}

export type MountDecision =
  | { readonly kind: 'apply'; readonly plan: MountPlan }
  | { readonly kind: 'confirm'; readonly plan: MountPlan; readonly confirmationToken: string }

/**
 * Decides whether a mount request applies immediately or needs confirmation.
 * A supplied token that does not match the current plan is an error rather than
 * a silent re-prompt, because it means the request changed after the agent read
 * the plan back to the user.
 */
export function decideMount(
  plan: MountPlan,
  options: { readonly confirmationToken?: string; readonly threshold?: number } = {},
): MountDecision {
  const threshold = options.threshold ?? MOUNT_CONFIRMATION_THRESHOLD
  if (options.confirmationToken !== undefined) {
    if (!mountConfirmationTokenMatches(plan, options.confirmationToken)) {
      throw new Error(
        'confirmationToken does not match this mount plan. Call viewport_mount_structures without a token to get a current plan.',
      )
    }
    return { kind: 'apply', plan }
  }
  if (plan.assignments.length <= threshold && plan.overflow.length === 0) {
    return { kind: 'apply', plan }
  }
  return { kind: 'confirm', plan, confirmationToken: mountConfirmationToken(plan) }
}

/** One-line plan description for the agent to read back to the user. */
export function describeMountPlan(plan: MountPlan): string {
  const parts = [
    `${plan.assignments.length} structures into a ${plan.layout} grid (${plan.slotCapacity} slots)`,
  ]
  if (plan.emptySlots > 0) parts.push(`${plan.emptySlots} slots left empty`)
  if (plan.preservedSlotCount > 0) parts.push(`${plan.preservedSlotCount} existing slots preserved`)
  if (plan.unboundTargetCount > 0) parts.push(`${plan.unboundTargetCount} future slots require the layout to be shown before confirmation`)
  if (plan.totalAtomCount !== null) parts.push(`${plan.totalAtomCount} atoms total`)
  if (plan.overflow.length > 0) parts.push(`${plan.overflow.length} will not fit: ${plan.overflow.join(', ')}`)
  return parts.join('; ')
}
