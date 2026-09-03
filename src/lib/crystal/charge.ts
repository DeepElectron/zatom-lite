// Formal-charge and bond-order plausibility for crystal Atom/Bond values. It
// reuses valence data without depending on the 2D editor's topology.

import { ELEMENT_STANDARD_VALENCE } from '../molecule/smiles-parser'
import type { Atom, Bond } from './types'

/** Bond order, matching the SMILES parser's aromatic value of 1.5. */
const BOND_ORDER: Record<Bond['type'], number> = {
  single: 1,
  double: 2,
  triple: 3,
  aromatic: 1.5,
  // Partial contacts are visual annotations, not covalent valence contributions.
  partial: 0,
}

export type ValenceIssueKind = 'over' | 'under'

export interface ValenceIssue {
  atomId: string
  element: string
  /** Sum of connected bond orders; aromatic bonds contribute 1.5. */
  current: number
  /** Expected valence after formal-charge correction. */
  expected: number
  kind: ValenceIssueKind
}

export interface ChargeSummary {
  /** Sum of formal charges, treating missing values as zero. */
  totalCharge: number
  /** Number of atoms carrying a nonzero formal charge. */
  chargedAtomCount: number
  /** Nonzero formal-charge subtotal by element. */
  byElement: Map<string, number>
}

/** Summarize formal charge, treating an omitted charge as neutral. */
export function summarizeCharge(atoms: readonly Pick<Atom, 'element' | 'charge'>[]): ChargeSummary {
  let totalCharge = 0
  let chargedAtomCount = 0
  const byElement = new Map<string, number>()

  for (const atom of atoms) {
    const charge = atom.charge ?? 0
    if (charge === 0) continue
    totalCharge += charge
    chargedAtomCount += 1
    byElement.set(atom.element, (byElement.get(atom.element) ?? 0) + charge)
  }

  return { totalCharge, chargedAtomCount, byElement }
}

/**
 * Compare each atom's bond-order sum with `standardValence + formalCharge`.
 * This gives four bonds for N(+1) in NH4+ and one for O(-1) in OH-. Elements
 * without a standard valence, especially metals, are skipped to avoid false
 * positives from variable coordination.
 */
export function checkCrystalValence(
  atoms: readonly Pick<Atom, 'id' | 'element' | 'charge'>[],
  bonds: readonly Pick<Bond, 'atom1Id' | 'atom2Id' | 'type'>[],
): ValenceIssue[] {
  const order = new Map<string, number>()
  for (const bond of bonds) {
    const increment = BOND_ORDER[bond.type] ?? 1
    if (increment === 0) continue
    order.set(bond.atom1Id, (order.get(bond.atom1Id) ?? 0) + increment)
    order.set(bond.atom2Id, (order.get(bond.atom2Id) ?? 0) + increment)
  }

  const issues: ValenceIssue[] = []
  for (const atom of atoms) {
    const standard = ELEMENT_STANDARD_VALENCE[atom.element]
    if (standard === undefined) continue

    const expected = standard + (atom.charge ?? 0)
    const current = Math.round(order.get(atom.id) ?? 0)

    // Isolated atoms and unbonded ions are not valence errors.
    if (current === 0) continue

    if (current > expected) issues.push({ atomId: atom.id, element: atom.element, current, expected, kind: 'over' })
    else if (current < expected) issues.push({ atomId: atom.id, element: atom.element, current, expected, kind: 'under' })
  }
  return issues
}

/** Format charge notation: +1 → `+`, -2 → `2−`. */
export function formatCharge(charge: number): string {
  if (charge === 0) return ''
  const magnitude = Math.abs(charge)
  const sign = charge > 0 ? '+' : '−'
  return magnitude === 1 ? sign : `${magnitude}${sign}`
}
