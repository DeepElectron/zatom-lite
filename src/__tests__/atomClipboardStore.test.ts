/**
 * Store-level copy and paste, including across structures.
 *
 * The real store directly verifies that a clipboard fragment survives structure replacement without
 * browser timing or HMR interference.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createCrystalStore } from '../orchestration/crystalStore'
import { setClipboardFragment } from '../lib/atom-clipboard'
import type { Atom } from '../lib/crystal/types'

function atom(id: string, element: string, c: [number, number, number]): Atom {
  return { id, element, position: c, cartesian: c } as unknown as Atom
}

describe('原子复制/粘贴（store 级）', () => {
  beforeEach(() => {
    // Clear the module-level clipboard between cases.
    setClipboardFragment(null)
  })

  it('复制 + 粘贴：原子数增加，且新原子成为当前选区', () => {
    const store = createCrystalStore()
    store.setState({
      atoms: [atom('a', 'Cu', [0, 0, 0]), atom('b', 'Cu', [1, 1, 1])],
      selectedAtomIds: new Set(['a']),
    })

    expect(store.getState().copySelectedAtoms()).toBe(1)
    expect(store.getState().pasteClipboardAtoms()).toBe(1)

    expect(store.getState().atoms.length).toBe(3)
    // Select newly pasted atoms for immediate Ctrl-drag placement.
    const sel = store.getState().selectedAtomIds
    expect(sel.size).toBe(1)
    expect(sel.has('a')).toBe(false)
  })

  it('粘贴不与原件重叠，且连续粘贴依次偏移', () => {
    const store = createCrystalStore()
    store.setState({
      atoms: [atom('a', 'Cu', [0, 0, 0])],
      selectedAtomIds: new Set(['a']),
    })
    store.getState().copySelectedAtoms()

    store.getState().pasteClipboardAtoms()
    const first = store.getState().atoms.at(-1)!.cartesian!
    store.getState().pasteClipboardAtoms()
    const second = store.getState().atoms.at(-1)!.cartesian!

    // Neither paste may overlap the source at the origin.
    expect(first).not.toEqual([0, 0, 0])
    expect(second).not.toEqual([0, 0, 0])
    // Consecutive pastes must not overlap each other.
    expect(second).not.toEqual(first)
  })

  it('跨结构：换成另一个结构后仍可粘贴（片段跨结构存活）', () => {
    const store = createCrystalStore()
    store.setState({
      atoms: [atom('cu1', 'Cu', [0, 0, 0])],
      selectedAtomIds: new Set(['cu1']),
    })
    expect(store.getState().copySelectedAtoms()).toBe(1)

    // Simulate loading another structure by replacing atoms and clearing selection.
    store.setState({
      atoms: [atom('na1', 'Na', [5, 5, 5]), atom('cl1', 'Cl', [6, 6, 6])],
      selectedAtomIds: new Set<string>(),
    })

    expect(store.getState().pasteClipboardAtoms()).toBe(1)
    expect(store.getState().atoms.length).toBe(3)
    // The pasted Cu comes from the source structure rather than the current elements.
    expect(store.getState().atoms.some((a) => a.element === 'Cu')).toBe(true)
  })

  it('粘贴可被一次 undo 撤销', () => {
    const store = createCrystalStore()
    store.setState({
      atoms: [atom('a', 'Cu', [0, 0, 0])],
      selectedAtomIds: new Set(['a']),
    })
    store.getState().copySelectedAtoms()
    store.getState().pasteClipboardAtoms()
    expect(store.getState().atoms.length).toBe(2)

    store.getState().undo()
    expect(store.getState().atoms.length).toBe(1)
  })

  it('空剪贴板粘贴是安全的空操作', () => {
    const store = createCrystalStore()
    store.setState({ atoms: [atom('a', 'Cu', [0, 0, 0])], selectedAtomIds: new Set<string>() })
    expect(store.getState().pasteClipboardAtoms()).toBe(0)
    expect(store.getState().atoms.length).toBe(1)
  })

  it('外部 XYZ 文本可直接粘贴进来', () => {
    const store = createCrystalStore()
    store.setState({ atoms: [], selectedAtomIds: new Set<string>() })

    const xyz = ['2', 'from gaussian', 'O 1.0 2.0 3.0', 'H 4.0 5.0 6.0'].join('\n')
    expect(store.getState().pasteClipboardAtoms(xyz)).toBe(2)
    expect(store.getState().atoms.map((a) => a.element)).toEqual(['O', 'H'])
  })
})
