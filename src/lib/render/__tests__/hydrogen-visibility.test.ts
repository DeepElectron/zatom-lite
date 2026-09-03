import { describe, expect, it } from 'vitest'

import { hiddenHydrogenIds, parseKeptHydrogenOrdinals } from '../hydrogen-visibility'

describe('parseKeptHydrogenOrdinals', () => {
  it('reads singles, ranges, and mixed separators the way the label shows them', () => {
    const { ordinals, rejected } = parseKeptHydrogenOrdinals(' 1, 3 ;5-8  10')
    expect([...ordinals].sort((a, b) => a - b)).toEqual([1, 3, 5, 6, 7, 8, 10])
    expect(rejected).toEqual([])
  })

  it('normalises a reversed range instead of producing nothing', () => {
    expect([...parseKeptHydrogenOrdinals('8-5').ordinals].sort((a, b) => a - b)).toEqual([5, 6, 7, 8])
  })

  it('reports unreadable tokens rather than dropping them', () => {
    // The dangerous failure is a typo that silently hides the hydrogen the
    // user meant to keep. Surfacing the token lets the UI say so.
    const { ordinals, rejected } = parseKeptHydrogenOrdinals('1, H3, 0, 5-x')
    expect([...ordinals]).toEqual([1])
    expect(rejected).toEqual(['H3', '0', '5-x'])
  })

  it('refuses an absurd range instead of allocating it', () => {
    const { ordinals, rejected } = parseKeptHydrogenOrdinals('1-99999999')
    expect(ordinals.size).toBe(0)
    expect(rejected).toEqual(['1-99999999'])
  })
})

describe('hiddenHydrogenIds', () => {
  // Ordinals are 1-based positions in this array, exactly as the label layer
  // numbers them (atomIndex + 1). H at ordinals 2, 3, 5; C at 1, 4.
  const atoms = [
    { id: 'c1', element: 'C' },
    { id: 'h2', element: 'H' },
    { id: 'h3', element: 'H' },
    { id: 'c4', element: 'C' },
    { id: 'h5', element: 'H' },
    { id: 'd6', element: 'D' },
  ]

  it('hides nothing when the switch is off, whatever the keep-list says', () => {
    expect(hiddenHydrogenIds(atoms, { hideHydrogens: false, keptHydrogens: '2' }).size).toBe(0)
  })

  it('hides every hydrogen isotope and never a heavy atom', () => {
    const hidden = hiddenHydrogenIds(atoms, { hideHydrogens: true, keptHydrogens: '' })
    expect([...hidden].sort()).toEqual(['d6', 'h2', 'h3', 'h5'])
  })

  it('keeps hydrogens by on-screen ordinal, ignoring ordinals that are not hydrogens', () => {
    // 1 and 4 are carbons: naming them must not un-hide anything else.
    const hidden = hiddenHydrogenIds(atoms, { hideHydrogens: true, keptHydrogens: '1,3-4' })
    expect([...hidden].sort()).toEqual(['d6', 'h2', 'h5'])
  })
})
