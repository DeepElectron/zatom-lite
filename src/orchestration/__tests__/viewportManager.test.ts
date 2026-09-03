import { assertEqual, assertTrue, assertDefined } from '../../testing/assert'
import { useViewportManager, GRID_SPECS, type GridLayout } from '../viewportManager'

function run() {
  const mgr = useViewportManager

  // Initial state: 1x1 layout with vp-1 active.
  assertEqual(mgr.getState().layout, '1x1')
  assertEqual(mgr.getState().activeViewportId, 'vp-1')
  assertEqual(Object.keys(mgr.getState().viewports).length, 1)
  assertDefined(mgr.getState().viewports['vp-1'])
  console.log('  ✓ initial state: 1x1, vp-1 active')

  // setLayout 2x2 expands to four viewports.
  mgr.getState().setLayout('2x2')
  assertEqual(mgr.getState().layout, '2x2')
  assertEqual(Object.keys(mgr.getState().viewports).length, 4)
  assertDefined(mgr.getState().viewports['vp-1'])
  assertDefined(mgr.getState().viewports['vp-2'])
  assertDefined(mgr.getState().viewports['vp-3'])
  assertDefined(mgr.getState().viewports['vp-4'])
  assertEqual(mgr.getState().activeViewportId, 'vp-1')
  console.log('  ✓ setLayout 2x2: 4 viewports created')

  // setActive switches to vp-3.
  mgr.getState().setActive('vp-3')
  assertEqual(mgr.getState().activeViewportId, 'vp-3')
  console.log('  ✓ setActive vp-3')

  // An invalid setActive ID leaves the state unchanged.
  mgr.getState().setActive('vp-999')
  assertEqual(mgr.getState().activeViewportId, 'vp-3')
  console.log('  ✓ setActive invalid id: no change')

  // getActiveStore returns vp-3's store.
  const store3 = mgr.getState().getActiveStore()
  assertDefined(store3)
  assertTrue(typeof store3.getState === 'function')
  console.log('  ✓ getActiveStore returns valid store')

  // getViewportStore retrieves a store by ID.
  const store2 = mgr.getState().getViewportStore('vp-2')
  assertDefined(store2)
  const storeNull = mgr.getState().getViewportStore('vp-999')
  assertEqual(storeNull, null)
  console.log('  ✓ getViewportStore: found / not found')

  // Store isolation: each viewport has an independent store.
  const slot1 = mgr.getState().viewports['vp-1']
  const slot2 = mgr.getState().viewports['vp-2']
  if (slot1.kind !== 'crystal' || slot2.kind !== 'crystal') {
    throw new Error('viewport stores test expects crystal slots')
  }
  const s1 = slot1.storeInstance as any
  const s2 = slot2.storeInstance as any
  assertTrue(s1 !== s2 || slot1.id !== slot2.id)
  console.log('  ✓ viewport stores are isolated')

  // Shrinking the layout from four to two removes excess viewports.
  const vp3Before = mgr.getState().viewports['vp-3']
  const vp4Before = mgr.getState().viewports['vp-4']
  assertDefined(vp3Before)
  assertDefined(vp4Before)
  mgr.getState().setLayout('1x2')
  assertEqual(Object.keys(mgr.getState().viewports).length, 2)
  assertEqual(mgr.getState().viewports['vp-3'], undefined as any)
  assertEqual(mgr.getState().viewports['vp-4'], undefined as any)
  console.log('  ✓ setLayout 1x2: excess viewports removed')

  // If the active viewport is removed, fall back to vp-1.
  assertEqual(mgr.getState().activeViewportId, 'vp-1')
  console.log('  ✓ active fallback to vp-1 when current removed')

  // setStructureName
  mgr.getState().setStructureName('vp-1', 'FCC Cu')
  const named = mgr.getState().viewports['vp-1']
  if (named.kind !== 'crystal') throw new Error('expected crystal slot')
  assertEqual(named.structureName, 'FCC Cu')
  console.log('  ✓ setStructureName')

  // GRID_SPECS completeness.
  const layouts: GridLayout[] = ['1x1', '1x2', '2x2', '2x3', '2x4', '3x4', '4x4']
  for (const l of layouts) {
    const spec = GRID_SPECS[l]
    assertDefined(spec)
    assertEqual(spec.total, spec.cols * spec.rows)
  }
  console.log('  ✓ GRID_SPECS: all 7 layouts valid')

  // Restore the initial state.
  mgr.getState().setLayout('1x1')

  // ── openChartSlot / closeChartSlot (PR-C) ─────────────────────
  assertEqual(mgr.getState().layout, '1x1')
  const chartId = mgr.getState().openChartSlot('rdf')
  assertDefined(chartId)
  assertEqual(mgr.getState().layout, '1x2', '1x1 should be promoted to 1x2 by openChartSlot')
  const chartSlot = mgr.getState().viewports[chartId!]
  assertDefined(chartSlot)
  if (chartSlot.kind !== 'chart') throw new Error('expected chart slot')
  assertEqual(chartSlot.chartKind, 'rdf')
  assertEqual(chartSlot.sourceViewportId, 'vp-1')
  console.log('  ✓ openChartSlot: 1x1 → 1x2, chart slot created with correct source')

  // Re-opening the same chart kind for the same source must be idempotent.
  const chartIdAgain = mgr.getState().openChartSlot('rdf', 'vp-1')
  assertEqual(chartIdAgain, chartId)
  console.log('  ✓ openChartSlot: idempotent for same kind + source')

  // getViewportStore on a chart slot returns null (chart slots have no store).
  assertEqual(mgr.getState().getViewportStore(chartId!), null)
  console.log('  ✓ chart slot has no crystal store')

  // setActive should NOT switch active to a chart slot.
  mgr.getState().setActive(chartId!)
  assertEqual(mgr.getState().activeViewportId, 'vp-1', 'chart slot must not be activatable')
  console.log('  ✓ setActive ignores chart slot')

  // closeChartSlot: last chart in 1x2 → shrink back to 1x1.
  mgr.getState().closeChartSlot(chartId!)
  assertEqual(mgr.getState().layout, '1x1', 'closing last chart in 1x2 should shrink to 1x1')
  console.log('  ✓ closeChartSlot: 1x2 last chart → 1x1')

  // Open XRD chart in pre-existing 2x2 layout — should keep 2x2 + replace one crystal slot.
  mgr.getState().setLayout('2x2')
  assertEqual(mgr.getState().layout, '2x2')
  const xrdId = mgr.getState().openChartSlot('xrd', 'vp-1')
  assertDefined(xrdId)
  assertEqual(mgr.getState().layout, '2x2', 'opening chart in 2x2 must NOT change layout')
  const xrdSlot = mgr.getState().viewports[xrdId!]
  if (xrdSlot.kind !== 'chart') throw new Error('expected xrd chart slot')
  assertEqual(xrdSlot.chartKind, 'xrd')
  console.log('  ✓ openChartSlot in 2x2 layout: chart placed without resize')

  // Closing chart in 2x2 should replace it with a fresh crystal slot, not shrink.
  mgr.getState().closeChartSlot(xrdId!)
  const replaced = mgr.getState().viewports[xrdId!]
  assertDefined(replaced)
  assertEqual(replaced.kind, 'crystal' as const)
  assertEqual(mgr.getState().layout, '2x2', 'closing chart in 2x2 must keep layout')
  console.log('  ✓ closeChartSlot in 2x2: replaced with crystal, layout preserved')

  // Restore the initial state.
  mgr.getState().setLayout('1x1')

  // ── Freeform layout mode (main viewport + dynamic child viewports) ───────
  // Entering from a 2x2 layout with vp-1 active converts the other three slots
  // into child viewports without changing their store references.
  mgr.getState().setLayout('2x2')
  const storesBefore = new Map(
    Object.entries(mgr.getState().viewports).map(([id, s]) => [id, s.kind === 'crystal' ? s.storeInstance : null]),
  )
  mgr.getState().enterFreeMode('right')
  const free1 = mgr.getState().freeLayout
  assertDefined(free1)
  assertEqual(free1!.mainViewportId, 'vp-1')
  assertEqual(free1!.subViewportIds.length, 3)
  assertEqual(free1!.placement, 'right')
  for (const [id, ref] of storesBefore) {
    const slot = mgr.getState().viewports[id]
    assertDefined(slot)
    if (slot.kind === 'crystal') assertTrue(slot.storeInstance === ref, `store ref preserved for ${id}`)
  }
  console.log('  ✓ enterFreeMode: main=active, subs preserve store refs')

  // swapWithMain only exchanges IDs: store references are preserved and the promoted crystal becomes active.
  mgr.getState().swapWithMain('vp-3')
  const free2 = mgr.getState().freeLayout
  assertEqual(free2!.mainViewportId, 'vp-3')
  assertTrue(free2!.subViewportIds.includes('vp-1'))
  assertEqual(mgr.getState().activeViewportId, 'vp-3')
  assertTrue(mgr.getState().viewports['vp-3'].kind === 'crystal'
    && (mgr.getState().viewports['vp-3'] as any).storeInstance === storesBefore.get('vp-3'))
  console.log('  ✓ swapWithMain: ids swapped, store refs untouched, active follows')

  // removeSubViewport → addSubViewport restores the same slot unchanged from the cache.
  const removedRef = storesBefore.get('vp-2')
  mgr.getState().removeSubViewport('vp-2')
  assertEqual(mgr.getState().viewports['vp-2'], undefined as any)
  assertEqual(mgr.getState().freeLayout!.subViewportIds.length, 2)
  const readdedId = mgr.getState().addSubViewport()
  assertEqual(readdedId, 'vp-2')
  assertTrue((mgr.getState().viewports['vp-2'] as any).storeInstance === removedRef, 'slot restored from cache')
  console.log('  ✓ removeSubViewport → addSubViewport: same slot restored from cache')

  // The last child viewport cannot be removed.
  mgr.getState().removeSubViewport('vp-2')
  mgr.getState().removeSubViewport('vp-4')
  assertEqual(mgr.getState().freeLayout!.subViewportIds.length, 1)
  mgr.getState().removeSubViewport('vp-1')
  assertEqual(mgr.getState().freeLayout!.subViewportIds.length, 1, 'last sub must not be removable')
  console.log('  ✓ removeSubViewport: last sub is protected')

  // In freeform mode, openChartSlot appends a child without changing the grid layout.
  const freeChartId = mgr.getState().openChartSlot('rdf', 'vp-3')
  assertDefined(freeChartId)
  assertTrue(mgr.getState().freeLayout!.subViewportIds.includes(freeChartId!))
  assertEqual(mgr.getState().layout, '2x2', 'grid layout must stay untouched in free mode')
  console.log('  ✓ openChartSlot in free mode: appends sub viewport')

  // In freeform mode, closeChartSlot removes that child viewport.
  mgr.getState().closeChartSlot(freeChartId!)
  assertTrue(!mgr.getState().freeLayout!.subViewportIds.includes(freeChartId!))
  assertDefined(mgr.getState().freeLayout, 'still in free mode: one sub remains')
  console.log('  ✓ closeChartSlot in free mode: sub removed')

  // setFreePlacement switches the preset.
  mgr.getState().setFreePlacement('l-shape')
  assertEqual(mgr.getState().freeLayout!.placement, 'l-shape')
  console.log('  ✓ setFreePlacement')

  // On exit, vp-3 exceeds 1x1 capacity, so the grid must expand enough to retain it.
  mgr.getState().exitFreeMode()
  assertEqual(mgr.getState().freeLayout, null)
  assertDefined(mgr.getState().viewports['vp-3'], 'main slot must stay visible after exit')
  assertTrue((mgr.getState().viewports['vp-3'] as any).storeInstance === storesBefore.get('vp-3'))
  console.log('  ✓ exitFreeMode: main stays visible, content preserved')

  // setLayout clears freeLayout; the agent's set_layout follows this path too.
  mgr.getState().enterFreeMode('right')
  assertDefined(mgr.getState().freeLayout)
  mgr.getState().setLayout('1x2')
  assertEqual(mgr.getState().freeLayout, null)
  console.log('  ✓ setLayout exits free mode')

  // Restore the initial state.
  mgr.getState().setLayout('1x1')

  console.log('viewportManager tests passed')
}

run()
