import { describe, it, expect } from 'vitest'
import { summarizeCharge, checkCrystalValence, formatCharge } from '../lib/crystal/charge'
import type { Atom, Bond } from '../lib/crystal/types'

type TestAtom = Pick<Atom, 'id' | 'element' | 'charge'>
type TestBond = Pick<Bond, 'atom1Id' | 'atom2Id' | 'type'>

const atom = (id: string, element: string, charge?: number): TestAtom => ({ id, element, charge })
const bond = (atom1Id: string, atom2Id: string, type: Bond['type'] = 'single'): TestBond =>
  ({ atom1Id, atom2Id, type })

describe('summarizeCharge', () => {
  it('treats a missing charge as neutral', () => {
    const summary = summarizeCharge([atom('a', 'C'), atom('b', 'O')])
    expect(summary.totalCharge).toBe(0)
    expect(summary.chargedAtomCount).toBe(0)
    expect(summary.byElement.size).toBe(0)
  })

  it('sums signed charges across atoms', () => {
    // Na+ and Cl- cancel to net zero while both atoms remain charged.
    const summary = summarizeCharge([atom('a', 'Na', 1), atom('b', 'Cl', -1)])
    expect(summary.totalCharge).toBe(0)
    expect(summary.chargedAtomCount).toBe(2)
    expect(summary.byElement.get('Na')).toBe(1)
    expect(summary.byElement.get('Cl')).toBe(-1)
  })

  it('reports a non-zero net charge for an unbalanced ion', () => {
    // Sulfate SO4^2- places formal charges on two terminal oxygens.
    const summary = summarizeCharge([
      atom('s', 'S'), atom('o1', 'O'), atom('o2', 'O'),
      atom('o3', 'O', -1), atom('o4', 'O', -1),
    ])
    expect(summary.totalCharge).toBe(-2)
    expect(summary.byElement.get('O')).toBe(-2)
  })
})

describe('checkCrystalValence', () => {
  it('accepts a neutral saturated molecule', () => {
    // Methane has four carbon bonds and one bond per hydrogen.
    const atoms = [atom('c', 'C'), atom('h1', 'H'), atom('h2', 'H'), atom('h3', 'H'), atom('h4', 'H')]
    const bonds = [bond('c', 'h1'), bond('c', 'h2'), bond('c', 'h3'), bond('c', 'h4')]
    expect(checkCrystalValence(atoms, bonds)).toEqual([])
  })

  it('flags an over-coordinated carbon', () => {
    // A five-coordinate carbon must be reported as invalid.
    const atoms = [atom('c', 'C'), ...['h1', 'h2', 'h3', 'h4', 'h5'].map((id) => atom(id, 'H'))]
    const bonds = ['h1', 'h2', 'h3', 'h4', 'h5'].map((h) => bond('c', h))
    const issues = checkCrystalValence(atoms, bonds)
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ atomId: 'c', element: 'C', current: 5, expected: 4, kind: 'over' })
  })

  it('lets a positive formal charge raise the expected valence', () => {
    // Positive formal charge raises nitrogen's expected valence from three to four in NH4+.
    const atoms = [atom('n', 'N', 1), ...['h1', 'h2', 'h3', 'h4'].map((id) => atom(id, 'H'))]
    const bonds = ['h1', 'h2', 'h3', 'h4'].map((h) => bond('n', h))
    expect(checkCrystalValence(atoms, bonds)).toEqual([])
  })

  it('lets a negative formal charge lower the expected valence', () => {
    // Negative formal charge lowers oxygen's expected valence from two to one in OH-.
    const atoms = [atom('o', 'O', -1), atom('h', 'H')]
    expect(checkCrystalValence(atoms, [bond('o', 'h')])).toEqual([])
  })

  it('counts bond order, not bond count', () => {
    // Two double bonds give carbon a total bond order of four in CO2.
    const atoms = [atom('c', 'C'), atom('o1', 'O'), atom('o2', 'O')]
    const bonds = [bond('c', 'o1', 'double'), bond('c', 'o2', 'double')]
    expect(checkCrystalValence(atoms, bonds)).toEqual([])
  })

  it('ignores partial bonds', () => {
    // Partial hydrogen-bond or coordination visuals do not count toward valence.
    const atoms = [atom('o', 'O'), atom('h1', 'H'), atom('h2', 'H'), atom('h3', 'H')]
    const bonds = [bond('o', 'h1'), bond('o', 'h2'), bond('o', 'h3', 'partial')]
    expect(checkCrystalValence(atoms, bonds)).toEqual([])
  })

  it('does not flag isolated atoms', () => {
    // Newly placed atoms and unbonded ions should not be reported as under-valent.
    expect(checkCrystalValence([atom('na', 'Na', 1), atom('cl', 'Cl', -1)], [])).toEqual([])
  })

  it('skips elements without standard valence data', () => {
    // Broad metal coordination ranges make main-group valence rules unsuitable.
    const atoms = [atom('fe', 'Fe'), ...['a', 'b', 'c', 'd', 'e', 'f'].map((id) => atom(id, 'O'))]
    const bonds = ['a', 'b', 'c', 'd', 'e', 'f'].map((o) => bond('fe', o))
    expect(checkCrystalValence(atoms, bonds).some((i) => i.atomId === 'fe')).toBe(false)
  })
})

describe('formatCharge', () => {
  it('omits the magnitude for single charges', () => {
    expect(formatCharge(1)).toBe('+')
    expect(formatCharge(-1)).toBe('−')
  })

  it('prefixes the magnitude for multiple charges', () => {
    expect(formatCharge(2)).toBe('2+')
    expect(formatCharge(-3)).toBe('3−')
  })

  it('renders neutral as empty', () => {
    expect(formatCharge(0)).toBe('')
  })
})
