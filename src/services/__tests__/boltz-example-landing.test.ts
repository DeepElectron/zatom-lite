/**
 * Protect example-landing properties that can fail silently while still rendering a scene:
 *
 * 1. Candidates enter viewports in descending score order.
 * 2. The display is limited to eight candidates.
 * 3. One missing structure does not abort the batch.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  exampleScore,
  landExampleCandidates,
  type StoredExample,
  type StoredExampleCandidate,
} from '../boltz-example-landing'
import { useModelerBridge } from '../../host/modelerBridge'
import { useViewportManager } from '../../orchestration/viewportManager'

/**
 * Minimal but genuinely parseable mmCIF, so parsing cannot obscure ordering and limit assertions.
 */
const MINIMAL_MMCIF = `data_model
loop_
_atom_site.group_PDB
_atom_site.id
_atom_site.type_symbol
_atom_site.label_atom_id
_atom_site.label_comp_id
_atom_site.label_asym_id
_atom_site.label_seq_id
_atom_site.Cartn_x
_atom_site.Cartn_y
_atom_site.Cartn_z
_atom_site.B_iso_or_equiv
ATOM 1 N N ALA A 1 0.000 0.000 0.000 90.00
ATOM 2 C CA ALA A 1 1.458 0.000 0.000 90.00
ATOM 3 C C ALA A 1 2.009 1.420 0.000 90.00
`

function candidate(
  id: string,
  score: number,
  options?: { withStructure?: boolean },
): StoredExampleCandidate {
  return {
    score,
    structure: options?.withStructure === false ? '' : `boltz-examples/x/${id}.cif`,
  }
}

function example(candidates: readonly StoredExampleCandidate[]): StoredExample {
  return {
    id: 'x',
    candidates,
  }
}

/** Structure names received by each viewport in order. */
let landed: string[] = []
/** Cleared viewport ids used to verify that extra slots do not retain an earlier case. */
let cleared: string[] = []

beforeEach(() => {
  landed = []
  cleared = []

  // Provide eight viewport slots and record their assigned structure names.
  const viewports = Object.fromEntries(
    Array.from({ length: 8 }, (_, index) => [`vp-${index + 1}`, {}]),
  )
  vi.spyOn(useViewportManager, 'getState').mockReturnValue({
    ...useViewportManager.getState(),
    viewports,
    setLayout: () => {},
    setActive: () => {},
    getViewportStore: (viewportId: string) =>
      ({
        getState: () => ({
          loadBiomolecule: () => {},
          resetStructureGroupsToBase: () => {},
          // clearStructure must remove both the biomolecule and its mirrored atoms.
          clearStructure: () => {
            cleared.push(viewportId)
          },
        }),
      }) as unknown as ReturnType<
        ReturnType<typeof useViewportManager.getState>['getViewportStore']
      >,
    setStructureName: (_viewportId: string, name: string) => {
      if (name !== '') landed.push(name)
    },
  } as unknown as ReturnType<typeof useViewportManager.getState>)

  vi.spyOn(useModelerBridge, 'getState').mockReturnValue({
    ...useModelerBridge.getState(),
    switchToModeler: () => {},
  } as ReturnType<typeof useModelerBridge.getState>)

  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(MINIMAL_MMCIF, { status: 200 })),
  )
})

describe('landExampleCandidates', () => {
  it('按分数降序进面板，最优候选在第一格', async () => {
    const result = await landExampleCandidates(
      example([candidate('low', 0.2), candidate('high', 0.9), candidate('mid', 0.5)]),
    )

    expect(result.landed).toBe(3)
    // The rank prefix and score show that 0.90 appears first.
    expect(landed).toEqual(['1 · 0.90', '2 · 0.50', '3 · 0.20'])
  })

  it('候选少于网格槽位时，多余面板被清空而不是留着上一个案例的结构', async () => {
    // A 2x3 layout for five candidates leaves slots that must not retain the previous case.
    const result = await landExampleCandidates(
      example(Array.from({ length: 5 }, (_, index) => candidate(`c${index}`, (index + 1) / 10))),
    )

    expect(result.landed).toBe(5)
    // The first five mock slots receive candidates and the remaining three are cleared.
    expect(cleared).toEqual(['vp-6', 'vp-7', 'vp-8'])
  })

  it('最多 8 个面板，超出的候选被截掉而不是开成 4x4', async () => {
    const many = Array.from({ length: 12 }, (_, index) => candidate(`c${index}`, index / 12))
    const result = await landExampleCandidates(example(many))

    expect(result.landed).toBe(8)
    expect(landed).toHaveLength(8)
    // Low-scoring candidates are truncated, leaving the global maximum first.
    expect(landed[0]).toBe('1 · 0.92')
  })

  it('个别候选没有结构产物时，其余照常落地', async () => {
    const result = await landExampleCandidates(
      example([
        candidate('ok1', 0.8),
        candidate('missing', 0.9, { withStructure: false }),
        candidate('ok2', 0.7),
      ]),
    )

    expect(result.landed).toBe(2)
    expect(result.skipped).toBe(1)
  })

  it('全部候选都没有结构时不落地，也不抛错', async () => {
    const result = await landExampleCandidates(
      example([candidate('a', 0.5, { withStructure: false })]),
    )

    expect(result.landed).toBe(0)
    expect(landed).toHaveLength(0)
  })
})

describe('exampleScore', () => {
  it('uses the stable score stored in the public manifest', () => {
    expect(exampleScore({ score: 0.7, structure: 'boltz-examples/x/a.cif' })).toBe(0.7)
    expect(exampleScore({ score: Number.NaN, structure: 'boltz-examples/x/b.cif' })).toBe(0)
  })

  it('normalizes a non-finite score to zero so sorting remains deterministic', () => {
    expect(exampleScore({ score: Number.POSITIVE_INFINITY, structure: 'boltz-examples/x/c.cif' })).toBe(0)
  })
})
