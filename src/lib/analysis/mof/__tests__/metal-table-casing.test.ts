/**
 * Element-symbol casing must not change classification.
 *
 * The periodic-table sets are written in standard mixed case (`Fe`), but symbols
 * do not always arrive that way: PDB and mmCIF store `type_symbol` uppercase,
 * and the agent's `structure_apply_operations` accepts a bare `element` string
 * with no enum and no normalization. Because every predicate here defaults to
 * "not a metal", a casing mismatch failed silently rather than throwing — an
 * all-iron structure reported zero metals and SBU detection found no nodes.
 */

import { describe, expect, it } from 'vitest'
import {
  isAlkaliOrAlkalineEarth,
  isCommonDonor,
  isMetal,
  isTransitionMetal,
  normalizeElementSymbol,
} from '../metal-table'
import { applyStructureOperations } from '../../../../agent/operations'
import { ZATOM_STRUCTURE_SCHEMA } from '../../../../agent/contracts'

describe('element symbol normalization', () => {
  it('canonicalizes to mixed case regardless of input casing', () => {
    expect(normalizeElementSymbol('FE')).toBe('Fe')
    expect(normalizeElementSymbol('fe')).toBe('Fe')
    expect(normalizeElementSymbol('Fe')).toBe('Fe')
    expect(normalizeElementSymbol('c')).toBe('C')
    expect(normalizeElementSymbol('')).toBe('')
  })
})

describe('metal predicates are casing-insensitive', () => {
  // Two-letter symbols are the ones that can break; single-letter symbols
  // ('C', 'O') are casing-proof and would hide the bug on their own.
  const metals = ['Fe', 'Cu', 'Zn', 'Zr', 'Mg', 'La', 'Al', 'Sn']

  it.each(metals)('classifies %s as a metal in any casing', (symbol) => {
    expect(isMetal(symbol)).toBe(true)
    expect(isMetal(symbol.toUpperCase())).toBe(true)
    expect(isMetal(symbol.toLowerCase())).toBe(true)
  })

  it('keeps non-metals non-metal in any casing', () => {
    for (const symbol of ['Si', 'Se', 'Cl', 'Br', 'He']) {
      expect(isMetal(symbol)).toBe(false)
      expect(isMetal(symbol.toUpperCase())).toBe(false)
      expect(isMetal(symbol.toLowerCase())).toBe(false)
    }
  })

  it('applies to the narrower predicates too', () => {
    expect(isTransitionMetal('FE')).toBe(true)
    expect(isTransitionMetal('fe')).toBe(true)
    expect(isAlkaliOrAlkalineEarth('MG')).toBe(true)
    expect(isAlkaliOrAlkalineEarth('mg')).toBe(true)
    // Mg is not d-block, so the narrower predicate must still reject it.
    expect(isTransitionMetal('MG')).toBe(false)
  })

  it('accepts two-letter halide donors in any casing', () => {
    // Cl and Br are the only COMMON_DONORS entries where casing can matter.
    for (const symbol of ['Cl', 'Br']) {
      expect(isCommonDonor(symbol)).toBe(true)
      expect(isCommonDonor(symbol.toUpperCase())).toBe(true)
    }
    expect(isCommonDonor('O')).toBe(true)
    expect(isCommonDonor('C')).toBe(false)
  })
})

describe('agent-authored elements reach the predicates intact', () => {
  it('counts metals substituted in via uppercase symbols', () => {
    // Reproduces the original failure: an agent that has read PDB files writes
    // 'FE', the operation stores it verbatim, and MOF detection saw no metals.
    const result = applyStructureOperations({
      structure: {
        schemaVersion: ZATOM_STRUCTURE_SCHEMA,
        atoms: [
          { id: 'a1', element: 'C', position: [0, 0, 0] },
          { id: 'a2', element: 'C', position: [1.5, 0, 0] },
        ],
      },
      operations: [{ op: 'substitute', selection: { elements: ['C'] }, element: 'FE' }],
      seed: 1,
    })

    const elements = result.structure.atoms.map((atom) => atom.element)
    expect(elements).toEqual(['FE', 'FE'])
    expect(elements.filter(isMetal)).toHaveLength(2)
  })
})
