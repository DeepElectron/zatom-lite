/**
 * Main periodic-layer flow: merge import, create sublayer, scope edits, and delete layer.
 *
 * Invariant: atoms.length > 0 iff a Base layer exists, and groups[0] is always Base.
 */
import { describe, expect, it } from 'vitest'
import { createCrystalStore } from '../orchestration/crystalStore'
import { atomBelongsToGroup, hiddenGroupIds } from '../orchestration/slices/structure-groups-slice'

const baseAtoms = [
  {
    id: 'Pt-1',
    element: 'Pt',
    position: [0, 0, 0] as [number, number, number],
    cartesian: [0, 0, 0] as [number, number, number],
  },
  {
    id: 'Pt-2',
    element: 'Pt',
    position: [2, 0, 0] as [number, number, number],
    cartesian: [2, 0, 0] as [number, number, number],
  },
]

/** Install a base structure and create its Base layer. */
function storeWithBase() {
  const store = createCrystalStore()
  store.setState({ atoms: baseAtoms, history: [], historyIndex: -1 })
  store.getState().resetStructureGroupsToBase()
  return store
}

/** Import CO and confirm the merge. */
function dropCO(store: ReturnType<typeof storeWithBase>) {
  store.getState().startMergePlacement(
    'CO',
    [
      { element: 'C', cartesian: [0, 0, 5] },
      { element: 'O', cartesian: [0, 0, 6.2] },
    ],
    [1, 0, 5],
  )
  expect(store.getState().mergePlacement).not.toBeNull()
  store.getState().confirmMergePlacement()
}

function countIn(store: ReturnType<typeof storeWithBase>, groupId: string): number {
  const { atoms, structureGroups } = store.getState()
  return atoms.filter((atom) => atomBelongsToGroup(atom, groupId, structureGroups)).length
}

describe('周期性体系结构图层', () => {
  it('安装文档即建立 Base 层，覆盖全部原子', () => {
    const store = storeWithBase()
    const { structureGroups } = store.getState()
    expect(structureGroups.map((g) => g.name)).toEqual(['Base'])
    expect(countIn(store, structureGroups[0].id)).toBe(2)
  })

  it('拖入合并建立子层，新层成为活动层', () => {
    const store = storeWithBase()
    dropCO(store)

    const { structureGroups, atoms, activeGroupId } = store.getState()
    expect(structureGroups.map((g) => g.name)).toEqual(['Base', 'CO'])
    expect(atoms).toHaveLength(4)
    expect(activeGroupId).toBe(structureGroups[1].id)
  })

  it('活动子层限定编辑范围：其他层的原子不可选', () => {
    const store = storeWithBase()
    dropCO(store)

    store.getState().selectAtom('Pt-1')
    expect(store.getState().selectedAtomIds.size).toBe(0)

    const coAtomId = store.getState().atoms.find((a) => a.element === 'C')!.id
    store.getState().selectAtom(coAtomId)
    expect(store.getState().selectedAtomIds.has(coAtomId)).toBe(true)
  })

  it('切到母层：全部原子可选，且切换清空选择', () => {
    const store = storeWithBase()
    dropCO(store)
    const coAtomId = store.getState().atoms.find((a) => a.element === 'C')!.id
    store.getState().selectAtom(coAtomId)

    store.getState().setActiveGroup(null)
    expect(store.getState().selectedAtomIds.size).toBe(0)
    store.getState().selectAtom('Pt-1')
    expect(store.getState().selectedAtomIds.has('Pt-1')).toBe(true)
  })

  it('undo/redo 跨越合并事务', () => {
    const store = storeWithBase()
    dropCO(store)

    store.getState().undo()
    // Undo to the post-Base snapshot from before the merge.
    expect(store.getState().structureGroups.map((g) => g.name)).toEqual(['Base'])
    expect(store.getState().atoms).toHaveLength(2)

    store.getState().redo()
    expect(store.getState().structureGroups).toHaveLength(2)
    expect(store.getState().atoms).toHaveLength(4)
  })

  it('删除子层删掉其原子但保留 Base', () => {
    const store = storeWithBase()
    dropCO(store)

    store.getState().removeGroup(store.getState().structureGroups[1].id)

    const { structureGroups, atoms, activeGroupId } = store.getState()
    expect(structureGroups.map((g) => g.name)).toEqual(['Base'])
    expect(atoms).toHaveLength(2)
    expect(activeGroupId).toBeNull()
    expect(countIn(store, structureGroups[0].id)).toBe(2)
  })

  it('Base 不可删除', () => {
    const store = storeWithBase()
    store.getState().removeGroup(store.getState().structureGroups[0].id)
    expect(store.getState().structureGroups.map((g) => g.name)).toEqual(['Base'])
    expect(store.getState().atoms).toHaveLength(2)
  })

  it('从选区提取新层：原子改归属，Base 相应减少', () => {
    const store = storeWithBase()
    store.getState().selectAtom('Pt-1')

    const created = store.getState().createGroupFromSelection('Fragment')
    expect(created).not.toBeNull()

    const { structureGroups } = store.getState()
    expect(structureGroups.map((g) => g.name)).toEqual(['Base', 'Fragment'])
    expect(countIn(store, created!)).toBe(1)
    expect(countIn(store, structureGroups[0].id)).toBe(1)
    expect(store.getState().activeGroupId).toBe(created!)
  })

  it('复制图层：原子数翻倍且沿 X 平移不重叠', () => {
    const store = storeWithBase()
    dropCO(store)
    const coGroupId = store.getState().structureGroups[1].id

    const copyId = store.getState().duplicateGroup(coGroupId)
    expect(copyId).not.toBeNull()
    expect(store.getState().atoms).toHaveLength(6)
    expect(countIn(store, copyId!)).toBe(2)

    const sourceMaxX = Math.max(
      ...store.getState().atoms.filter((a) => a.groupId === coGroupId).map((a) => (a.cartesian ?? a.position)[0]),
    )
    const copyMinX = Math.min(
      ...store.getState().atoms.filter((a) => a.groupId === copyId).map((a) => (a.cartesian ?? a.position)[0]),
    )
    expect(copyMinX).toBeGreaterThan(sourceMaxX)
  })

  it('solo 隔离只留该层，退出后恢复', () => {
    const store = storeWithBase()
    dropCO(store)
    const [base, co] = store.getState().structureGroups

    store.getState().toggleSoloGroup(co.id)
    let hidden = hiddenGroupIds(store.getState().structureGroups, store.getState().soloGroupId)
    expect(hidden.has(base.id)).toBe(true)
    expect(hidden.has(co.id)).toBe(false)

    store.getState().toggleSoloGroup(co.id)
    hidden = hiddenGroupIds(store.getState().structureGroups, store.getState().soloGroupId)
    expect(hidden.size).toBe(0)
  })

  it('隐藏图层只影响显示，不改变原子数', () => {
    const store = storeWithBase()
    dropCO(store)
    const coGroupId = store.getState().structureGroups[1].id

    store.getState().toggleGroupVisible(coGroupId)

    expect(store.getState().atoms).toHaveLength(4)
    expect(hiddenGroupIds(store.getState().structureGroups, null).has(coGroupId)).toBe(true)
  })

  it('孤儿原子归 Base：各层计数之和恒等于总原子数', () => {
    const store = storeWithBase()
    dropCO(store)
    const { structureGroups } = store.getState()

    // Create an orphan whose groupId references a missing group.
    store.setState({
      atoms: store.getState().atoms.map((a) => (a.element === 'C' ? { ...a, groupId: 'ghost' } : a)),
    })

    const total = structureGroups.reduce((sum, g) => sum + countIn(store, g.id), 0)
    expect(total).toBe(store.getState().atoms.length)
  })
})
