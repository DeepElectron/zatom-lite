/**
 * Fuzzy ladder search and merged multi-selection bounds.
 *
 * Protect subsequence matching, search-scope boundaries, and a merged sphere that contains every
 * selected item rather than merely averaging centers.
 */

import { describe, expect, it } from 'vitest'
import { fuzzyScore, searchLadder } from '../lib/biomolecule/ladder-search'
import { ladderNodesBounds, type LadderNode, type StructureLadder } from '../lib/biomolecule/structure-ladder'

function node(
  id: string,
  level: LadderNode['level'],
  label: string,
  detail: string | null = null,
  center: [number, number, number] = [0, 0, 0],
  radius = 1.4,
): LadderNode {
  return {
    id,
    level,
    label,
    detail,
    center,
    radius,
    parentId: null,
    childIds: [],
    atomIndices: [],
    secondaryStructure: null,
    secondaryStructureSource: null,
  } as unknown as LadderNode
}

function ladderOf(nodes: LadderNode[]): StructureLadder {
  return { rootId: nodes[0].id, nodes: new Map(nodes.map((n) => [n.id, n])) }
}

describe('fuzzyScore', () => {
  it('匹配跳字缩写 —— 这是不用 includes 的全部理由', () => {
    // "h5" is not a substring of "Helix 5" but is an ordered subsequence.
    expect('Helix 5'.toLowerCase().includes('h5')).toBe(false)
    expect(fuzzyScore('h5', 'Helix 5')).not.toBeNull()
  })

  it('非子序列返回 null', () => {
    expect(fuzzyScore('xz', 'Helix 5')).toBeNull()
    // Reversed order is not an ordered subsequence.
    expect(fuzzyScore('5h', 'Helix 5')).toBeNull()
  })

  it('空查询返回 0 而非 null(全都匹配、无偏好)', () => {
    expect(fuzzyScore('', 'Chain A')).toBe(0)
    expect(fuzzyScore('   ', 'Chain A')).toBe(0)
  })

  it('大小写不敏感', () => {
    expect(fuzzyScore('GLU', 'glu34')).not.toBeNull()
    expect(fuzzyScore('glu', 'GLU34')).not.toBeNull()
  })

  it('连续命中优于跳字命中', () => {
    const consecutive = fuzzyScore('ab', 'ab')
    const scattered = fuzzyScore('ab', 'axxxb')
    expect(consecutive).not.toBeNull()
    expect(scattered).not.toBeNull()
    expect(consecutive as number).toBeGreaterThan(scattered as number)
  })

  it('字母→数字的交界算词首,让 GLU34 里的 3 拿到加分', () => {
    // 3 begins the numeric segment in GLU|34 while 4 lies inside it.
    const atBoundary = fuzzyScore('3', 'GLU34')
    const midNumber = fuzzyScore('4', 'GLU34')
    expect(atBoundary as number).toBeGreaterThan(midNumber as number)
  })
})

describe('searchLadder', () => {
  const ladder = ladderOf([
    node('assembly', 'assembly', '1CRN.pdb', '1 chains · 327 atoms'),
    node('c:A', 'chain', 'Chain A', '46 residues · protein'),
    node('e:h3', 'element', 'Helix 3', 'ILE7–PRO19'),
    node('e:h5', 'element', 'Helix 5', 'GLU23–THR30'),
    node('r:glu34', 'residue', 'GLU34', 'Chain A · 9 atoms'),
    node('r:glu3', 'residue', 'GLU3', 'Chain A · 6 atoms'),
  ])

  it('空查询不返回任何结果(而不是返回全部)', () => {
    expect(searchLadder(ladder, '')).toEqual([])
    expect(searchLadder(ladder, '  ')).toEqual([])
  })

  it('按缩写找到元件', () => {
    const labels = searchLadder(ladder, 'h5').map((n) => n.label)
    expect(labels).toContain('Helix 5')
  })

  it('精确输入时把最贴合的那条排在最前', () => {
    expect(searchLadder(ladder, 'GLU34')[0].label).toBe('GLU34')
  })

  it('也能按 detail 命中(残基范围这类补充线索)', () => {
    const labels = searchLadder(ladder, 'ILE7').map((n) => n.label)
    expect(labels).toContain('Helix 3')
  })

  it('搜索范围不含原子层', () => {
    // ladder.nodes intentionally omits prebuilt atom nodes, so search cannot return atom level.
    for (const hit of searchLadder(ladder, 'a')) {
      expect(hit.level).not.toBe('atom')
    }
  })

  it('尊重条数上限', () => {
    expect(searchLadder(ladder, 'a', 2)).toHaveLength(2)
  })
})

describe('ladderNodesBounds', () => {
  it('空选区返回 null', () => {
    expect(ladderNodesBounds([])).toBeNull()
  })

  it('并集必须覆盖每一个选中项 —— 分散选区不能漏掉任一端', () => {
    const nodes = [
      node('a', 'residue', 'A', null, [-40, 0, 0], 3),
      node('b', 'residue', 'B', null, [40, 0, 0], 3),
      node('c', 'residue', 'C', null, [0, 25, 0], 2),
    ]
    const bounds = ladderNodesBounds(nodes)
    expect(bounds).not.toBeNull()
    const { center, radius } = bounds as { center: readonly number[]; radius: number }

    for (const n of nodes) {
      const distance = Math.hypot(
        n.center[0] - center[0],
        n.center[1] - center[1],
        n.center[2] - center[2],
      )
      // The merged sphere contains every selected item's complete bounding sphere.
      expect(distance + n.radius).toBeLessThanOrEqual(radius + 1e-6)
    }
  })

  it('单个节点也留住最小半径,相机不会收敛到零', () => {
    const bounds = ladderNodesBounds([node('a', 'atom', 'CA', null, [1, 2, 3], 0)])
    expect(bounds?.radius).toBeGreaterThan(0)
    expect(bounds?.center).toEqual([1, 2, 3])
  })
})
