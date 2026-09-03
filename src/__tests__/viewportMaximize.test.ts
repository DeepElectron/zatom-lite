import { beforeEach, describe, expect, it } from 'vitest'
import { useViewportManager } from '../orchestration/viewportManager'

/**
 * Maximizing a viewport and switching layouts must preserve mounted content.
 *
 * Maximize is display-only state. Slots removed by a layout change remain cached rather than being
 * destroyed and recreated empty when the layout returns.
 */

/** Assign a recognizable structure name as a content-preservation probe. */
function markViewport(viewportId: string, name: string) {
  useViewportManager.getState().setStructureName(viewportId, name)
}

function nameOf(viewportId: string): string | undefined {
  const slot = useViewportManager.getState().viewports[viewportId]
  return slot?.kind === 'crystal' ? slot.structureName ?? undefined : undefined
}

beforeEach(() => {
  useViewportManager.getState().setLayout('1x1')
  useViewportManager.setState({ maximizedViewportId: null })
})

describe('视口放大与布局保持', () => {
  it('放大不改布局，退出后所有面板内容都在', () => {
    const manager = useViewportManager.getState()
    manager.setLayout('2x2')
    markViewport('vp-1', 'A')
    markViewport('vp-4', 'D')

    useViewportManager.getState().toggleMaximized('vp-4')

    // Maximizing changes display state without changing layout or slot count.
    expect(useViewportManager.getState().maximizedViewportId).toBe('vp-4')
    expect(useViewportManager.getState().layout).toBe('2x2')
    expect(Object.keys(useViewportManager.getState().viewports)).toHaveLength(4)
    // The maximized viewport becomes active and remains editable.
    expect(useViewportManager.getState().activeViewportId).toBe('vp-4')

    useViewportManager.getState().toggleMaximized('vp-4')
    expect(useViewportManager.getState().maximizedViewportId).toBeNull()
    expect(nameOf('vp-1')).toBe('A')
    expect(nameOf('vp-4')).toBe('D')
  })

  it('缩小再放大布局，被移出的面板内容原样接回', () => {
    const manager = useViewportManager.getState()
    manager.setLayout('2x4')
    markViewport('vp-1', 'A')
    markViewport('vp-8', 'H')

    // Shrinking to 1x1 must cache rather than destroy vp-2 through vp-8.
    useViewportManager.getState().setLayout('1x1')
    expect(Object.keys(useViewportManager.getState().viewports)).toHaveLength(1)

    useViewportManager.getState().setLayout('2x4')
    expect(nameOf('vp-1')).toBe('A')
    expect(nameOf('vp-8')).toBe('H')
  })

  it('手动换布局时退出最大化，新布局不被残留的独占视口挡住', () => {
    const manager = useViewportManager.getState()
    manager.setLayout('2x2')
    useViewportManager.getState().toggleMaximized('vp-4')

    // Clear maximization when its viewport no longer belongs to the new layout.
    useViewportManager.getState().setLayout('1x1')
    expect(useViewportManager.getState().maximizedViewportId).toBeNull()
  })
})
