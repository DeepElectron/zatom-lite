import { describe, expect, it } from 'vitest'

import { decideMount, describeMountPlan, planMount } from '../mount-proposal'

const candidates = (count: number) => Array.from({ length: count }, (_, index) => ({
  label: `structure-${index + 1}`,
  atomCount: 100 + index,
}))

/**
 * These cover the contract the confirmation flow rests on: a batch large enough
 * to rearrange the viewport must not apply unasked, and a token must stop
 * working once the plan it described has changed.
 */
describe('mount proposal', () => {
  it('picks the smallest grid that fits and mounts small batches directly', () => {
    expect(planMount('app-1', candidates(3)).layout).toBe('2x2')
    expect(decideMount(planMount('app-1', candidates(3))).kind).toBe('apply')
  })

  it('proposes a 3x4 grid for ten structures instead of mounting them', () => {
    const plan = planMount('app-1', candidates(10))
    expect(plan.layout).toBe('3x4')
    expect(plan.slotCapacity).toBe(12)
    expect(plan.emptySlots).toBe(2)
    expect(plan.assignments).toHaveLength(10)

    const decision = decideMount(plan)
    if (decision.kind !== 'confirm') throw new Error('expected confirmation')
    expect(describeMountPlan(plan)).toContain('3x4')

    // Replanning the same request reproduces the token, so the agent can
    // confirm without the server holding pending state.
    const applied = decideMount(planMount('app-1', candidates(10)), {
      confirmationToken: decision.confirmationToken,
    })
    expect(applied.kind).toBe('apply')
  })

  it('rejects a token once the plan it described has changed', () => {
    const bindings = Array.from({ length: 12 }, (_, slotIndex) => ({
      slotIndex,
      slotId: `vp-${slotIndex + 1}`,
      structureFingerprint: null,
      trajectoryFingerprint: null,
      workspaceRevision: 1,
    }))
    const decision = decideMount(planMount('app-1', candidates(10), undefined, { slotBindings: bindings }))
    if (decision.kind !== 'confirm') throw new Error('expected confirmation')
    const token = decision.confirmationToken

    // Different structure set, different target instance, and a different
    // layout each describe a different outcome than the user agreed to.
    expect(() => decideMount(planMount('app-1', candidates(9)), { confirmationToken: token })).toThrow(/does not match/)
    expect(() => decideMount(planMount('app-2', candidates(10)), { confirmationToken: token })).toThrow(/does not match/)
    expect(() => decideMount(planMount('app-1', candidates(10), '4x4'), { confirmationToken: token })).toThrow(/does not match/)
    expect(() => decideMount(planMount('app-1', candidates(10), undefined, {
      slotBindings: bindings.map((binding, index) => index === 3
        ? { ...binding, structureFingerprint: 'changed', workspaceRevision: 2 }
        : binding),
    }), { confirmationToken: token })).toThrow(/does not match/)
  })

  it('reports structures that will not fit an explicitly requested layout', () => {
    const plan = planMount('app-1', candidates(6), '2x2')
    expect(plan.assignments).toHaveLength(4)
    expect(plan.overflow).toEqual(['structure-5', 'structure-6'])
    // Overflow always needs confirmation, even below the size threshold,
    // because structures would be silently dropped otherwise.
    expect(decideMount(planMount('app-1', candidates(3), '1x2')).kind).toBe('confirm')
  })

  it('preserves occupied panes and assigns candidates to empty/new panes', () => {
    const plan = planMount('in-page', candidates(2), undefined, {
      preserveExisting: true,
      occupiedSlotIndices: [0],
    })
    expect(plan.layout).toBe('2x2')
    expect(plan.preservedSlotCount).toBe(1)
    expect(plan.assignments.map((assignment) => assignment.slotIndex)).toEqual([1, 2])
    expect(plan.emptySlots).toBe(1)
    expect(describeMountPlan(plan)).toContain('1 existing slots preserved')
  })
})
