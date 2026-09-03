/**
 * Behavioral contract for mapping selections to epitopes.
 *
 * Chain or residue mistakes can silently target an unrelated surface while still producing a
 * successful job, so preserve each mapping behavior explicitly.
 */

import { describe, expect, it } from 'vitest'
import { authorNumbersToPositions, epitopeFromSelection, primaryEpitope } from '../boltz-epitope'
import type { BioAtom, BioChain, BioResidue, BioStructure } from '../../lib/biomolecule/types'

/**
 * Build a minimal residue-to-atoms structure with two atoms per residue.
 *
 * Chains are required because buildBioSequenceChains defines positions from ordered polymer
 * residueIndices.
 */
function structureOf(
  spec: readonly { chainId: string; sequenceNumber: number; name?: string }[],
): BioStructure {
  const atoms: BioAtom[] = []
  const residues: BioResidue[] = []
  const byChain = new Map<string, number[]>()

  spec.forEach((entry, residueIndex) => {
    const atomStart = atoms.length
    for (let i = 0; i < 2; i += 1) {
      atoms.push({
        id: `${entry.chainId}${entry.sequenceNumber}-a${i}`,
        index: atoms.length,
        residueIndex,
      } as BioAtom)
    }
    residues.push({
      index: residueIndex,
      name: entry.name ?? 'ALA',
      identity: { chainId: entry.chainId, sequenceNumber: entry.sequenceNumber, insertionCode: '' },
      atomStart,
      atomEnd: atoms.length,
      atomIndices: [atomStart, atomStart + 1],
      // Supply only identity, name, and residueIndex relationships used by the mapping.
    } as unknown as BioResidue)

    const bucket = byChain.get(entry.chainId) ?? []
    bucket.push(residueIndex)
    byChain.set(entry.chainId, bucket)
  })

  const chains: BioChain[] = [...byChain.entries()].map(([identifier, residueIndices], index) => ({
    index,
    identifier,
    polymerType: 'protein',
    residueIndices,
  } as unknown as BioChain))

  return { atoms, residues, chains } as unknown as BioStructure
}

describe('选择 → 表位残基', () => {
  const structure = structureOf([
    { chainId: 'A', sequenceNumber: 10 },
    { chainId: 'A', sequenceNumber: 11 },
    { chainId: 'B', sequenceNumber: 55 },
  ])

  it('残基里任一原子被选中即命中', () => {
    // Box selection rarely covers every atom in a residue exactly.
    const picked = primaryEpitope(structure, new Set(['A10-a0']))
    expect(picked).toEqual({ chainId: 'A', residues: [10], positions: [1] })
  })

  it('同一残基的多个原子只产生一个残基号', () => {
    const picked = primaryEpitope(structure, new Set(['A10-a0', 'A10-a1']))
    expect(picked?.residues).toEqual([10])
  })

  it('残基号升序输出', () => {
    // Downstream compact ranges such as 10-18 require sorted input.
    const picked = primaryEpitope(structure, new Set(['A11-a0', 'A10-a0']))
    expect(picked?.residues).toEqual([10, 11])
  })

  it('跨链选择按链分开，不把号码混进一个列表', () => {
    // Request positions are relative to one target chain and must never be mixed.
    const groups = epitopeFromSelection(structure, new Set(['A10-a0', 'B55-a0']))
    expect(groups).toHaveLength(2)
    expect(groups.map((g) => g.chainId).sort()).toEqual(['A', 'B'])
  })

  it('主表位取命中残基最多的链', () => {
    const picked = primaryEpitope(structure, new Set(['A10-a0', 'A11-a0', 'B55-a0']))
    expect(picked).toEqual({ chainId: 'A', residues: [10, 11], positions: [1, 2] })
  })

  it('空选择返回空，不返回伪造的表位', () => {
    expect(epitopeFromSelection(structure, new Set())).toEqual([])
    expect(primaryEpitope(structure, new Set())).toBeNull()
  })

  it('忽略不属于本结构的原子 id', () => {
    // Selection state can retain ids from a previous structure; ignore those stale ids.
    expect(primaryEpitope(structure, new Set(['stale-atom-id']))).toBeNull()
  })
})

describe('作者残基号 vs 序列位置', () => {
  /**
   * Model realistic author numbering that starts at 333 and contains a gap, as in the 6M0J receptor.
   * Boltz accepts sequence positions, not these author numbers.
   */
  const offset = structureOf([
    { chainId: 'A', sequenceNumber: 333 },
    { chainId: 'A', sequenceNumber: 334 },
    // Author number 335 is unresolved.
    { chainId: 'A', sequenceNumber: 336 },
  ])

  it('位置从 1 起连续，不跟随作者号', () => {
    const picked = primaryEpitope(offset, new Set(['A333-a0', 'A334-a0', 'A336-a0']))
    expect(picked?.residues).toEqual([333, 334, 336])
    // A numbering gap does not create a sequence gap: author number 336 is position 3.
    expect(picked?.positions).toEqual([1, 2, 3])
  })

  it('手输入的作者号能换算成位置', () => {
    // Literature supplies author numbers such as K417, while the request needs positions.
    expect(authorNumbersToPositions(offset, 'A', [334, 336])).toEqual([2, 3])
  })

  it('认不出的作者号被丢弃而不是当位置发出去', () => {
    // Drop typos and numbers absent from this chain instead of forwarding them as positions.
    expect(authorNumbersToPositions(offset, 'A', [999])).toEqual([])
    expect(authorNumbersToPositions(offset, 'Z', [333])).toEqual([])
  })

  it('非聚合物残基不产生表位号', () => {
    // Water and ions have no sequence positions and are excluded from Boltz chains.
    const withWater = structureOf([
      { chainId: 'A', sequenceNumber: 1 },
      { chainId: 'A', sequenceNumber: 2, name: 'HOH' },
    ])
    const picked = primaryEpitope(withWater, new Set(['A1-a0', 'A2-a0']))
    expect(picked?.residues).toEqual([1])
    expect(picked?.positions).toEqual([1])
  })
})
