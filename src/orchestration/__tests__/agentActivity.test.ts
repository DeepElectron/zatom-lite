/**
 * Three activity-stack invariants that keep the indicator truthful:
 * a leaked stack entry leaves it lit forever, while an incorrect skip state
 * either makes the button inert or hides it when needed.
 */

import { assertTrue, assertFalse, assertEqual } from '../../testing/assert'
import {
  useAgentActivity,
  selectCurrentActivity,
  selectHasSkippableAnimation,
} from '../agentActivityStore'

function reset(): void {
  useAgentActivity.setState({ running: [] })
}

/**
 * The finish function must be idempotent. An explicit call may overlap with
 * try/finally; the second call must not remove a newer entry with the same name,
 * which would hide the indicator while work is still active.
 */
function testEndIsIdempotent(): void {
  reset()
  const store = useAgentActivity.getState()
  const endFirst = store.begin({ label: 'first', tier: 'observe', interruptible: false })
  endFirst()
  endFirst() // Call it again.
  const endSecond = useAgentActivity.getState().begin({
    label: 'second',
    tier: 'mutate',
    interruptible: false,
  })
  assertEqual(
    selectCurrentActivity(useAgentActivity.getState())?.label,
    'second',
    'repeated end() must not remove a later activity',
  )
  endSecond()
  assertEqual(useAgentActivity.getState().running.length, 0, 'stack drains')
}

/** The stack top is the most specific layer, so nested work shows the inner label. */
function testStackTopIsMostSpecific(): void {
  reset()
  const endTool = useAgentActivity.getState().begin({
    label: 'Applying a structure change',
    tier: 'mutate',
    interruptible: false,
  })
  const endReplay = useAgentActivity.getState().begin({
    label: 'Showing what changed',
    tier: 'mutate',
    interruptible: true,
  })
  assertEqual(
    selectCurrentActivity(useAgentActivity.getState())?.label,
    'Showing what changed',
    'nested replay is shown over the outer tool',
  )
  endReplay()
  assertEqual(
    selectCurrentActivity(useAgentActivity.getState())?.label,
    'Applying a structure change',
    'outer tool resurfaces after the inner replay ends',
  )
  endTool()
}

/**
 * Skippability depends on the entire stack, not only its top.
 *
 * A non-skippable mutate tool may contain a skippable replay. If the replay
 * finishes while the tool continues, the skip button must disappear because it
 * no longer has any effect.
 */
function testSkippabilityScansWholeStack(): void {
  reset()
  const endTool = useAgentActivity.getState().begin({
    label: 'tool',
    tier: 'mutate',
    interruptible: false,
  })
  assertFalse(
    selectHasSkippableAnimation(useAgentActivity.getState()),
    'a tool call alone is never skippable',
  )

  const endReplay = useAgentActivity.getState().begin({
    label: 'replay',
    tier: 'mutate',
    interruptible: true,
  })
  assertTrue(
    selectHasSkippableAnimation(useAgentActivity.getState()),
    'nested replay makes the stack skippable even under a non-skippable tool',
  )

  endReplay()
  assertFalse(
    selectHasSkippableAnimation(useAgentActivity.getState()),
    'skip affordance disappears when the replay ends, even though the tool still runs',
  )
  endTool()
}

export function main(): void {
  testEndIsIdempotent()
  testStackTopIsMostSpecific()
  testSkippabilityScansWholeStack()
}

main()
