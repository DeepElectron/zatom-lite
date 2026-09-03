/**
 * SBU topology refinement. Given an already-classified SBU plus the
 * source atoms / bonds, produce a short human-readable label.
 *
 * This function does NOT change `sbu.kind` — it only enriches the
 * description. UI layers (Inspector / sidebar) can present it next to
 * the kind tag.
 */

import { isMetal } from './metal-table'
import type { SBU } from './types'

type Vec3 = [number, number, number]

interface InputAtom {
  id: string
  element: string
  cartesian: Vec3
}

interface InputBond {
  atom1Id: string
  atom2Id: string
}

/**
 * Produce a short topology label for an SBU.
 *
 * Examples of returned strings:
 *   - 'Cu2 paddle-wheel (square-planar carboxylate)'
 *   - 'Zn4O (basic zinc acetate)'
 *   - 'Cr3(μ3-O) trinuclear oxo'
 *   - 'BDC linker (1,4-benzenedicarboxylate)'
 *   - 'BTC linker (1,3,5-benzenetricarboxylate)'
 *   - 'methyl-imidazolate'
 *   - 'organic linker (24 atoms, 1 aromatic ring)' (fallback)
 *   - 'capping H2O / OH'
 */
export function describeSbuTopology(
  sbu: SBU,
  atoms: InputAtom[],
  bonds: InputBond[],
): string {
  const atomById = new Map<string, InputAtom>(atoms.map((a) => [a.id, a]))
  const inSet = new Set(sbu.atom_ids)
  const localAtoms = sbu.atom_ids.map((id) => atomById.get(id)).filter(Boolean) as InputAtom[]
  const counts = countElements(localAtoms)

  if (sbu.kind === 'metal_paddlewheel') {
    // Two metals, e.g. Cu2 / Zn2.
    const metalEl = localAtoms.find((a) => isMetal(a.element))?.element ?? 'M'
    const nM = countMetals(localAtoms)
    return `${metalEl}${nM} paddle-wheel (square-planar carboxylate)`
  }

  if (sbu.kind === 'metal_oxocluster') {
    const metalEl = localAtoms.find((a) => isMetal(a.element))?.element ?? 'M'
    const nM = countMetals(localAtoms)
    if (metalEl === 'Zn' && nM === 4) return 'Zn4O (basic zinc acetate)'
    if (metalEl === 'Cr' && nM === 3) return 'Cr3(μ3-O) trinuclear oxo'
    if (metalEl === 'Fe' && nM === 3) return 'Fe3(μ3-O) trinuclear oxo'
    if (metalEl === 'Zr' && nM === 6) return 'Zr6 cluster (UiO-family)'
    return `${metalEl}${nM}(μ-O) oxocluster`
  }

  if (sbu.kind === 'metal_monomer') {
    const metalEl = localAtoms[0]?.element ?? 'M'
    return `${metalEl} monomer (isolated metal centre)`
  }

  if (sbu.kind === 'metal_cluster') {
    const metalEl = localAtoms.find((a) => isMetal(a.element))?.element ?? 'M'
    const nM = countMetals(localAtoms)
    return `${metalEl}${nM} metal cluster`
  }

  if (sbu.kind === 'capping') {
    if (counts['O'] === 1 && (counts['H'] ?? 0) >= 1) return 'capping OH / H2O'
    if (sbu.atom_ids.length === 1 && counts['O'] === 1) return 'capping μ-O'
    return `capping (${sbu.atom_ids.length} atoms)`
  }

  // Linker — try canonical templates first.
  const linkerLabel = identifyLinkerTemplate(localAtoms, bonds, inSet)
  if (linkerLabel) return linkerLabel

  const localBonds = bonds.filter((b) => inSet.has(b.atom1Id) && inSet.has(b.atom2Id))
  const ringCount = approximateAromaticRings(localAtoms, localBonds)
  return `organic linker (${sbu.atom_ids.length} atoms, ${ringCount} aromatic ring${ringCount === 1 ? '' : 's'})`
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function countElements(atoms: InputAtom[]): Record<string, number> {
  const c: Record<string, number> = {}
  for (const a of atoms) c[a.element] = (c[a.element] ?? 0) + 1
  return c
}

function countMetals(atoms: InputAtom[]): number {
  return atoms.filter((a) => isMetal(a.element)).length
}

/**
 * Heuristic linker template matcher.
 *
 * Recognises:
 *   - BDC (1,4-benzenedicarboxylate): C8H4O4²⁻ → 8 C, 4 O, ≥4 H, 1 ring
 *   - BTC (1,3,5-benzenetricarboxylate): C9H3O6³⁻ → 9 C, 6 O, ≥3 H, 1 ring
 *   - methyl-imidazolate (mIm): C4H5N2⁻ → 4 C, 2 N, ≥3 H, 1 five-ring
 *
 * Returns null when no template matches.
 */
function identifyLinkerTemplate(
  atoms: InputAtom[],
  bonds: InputBond[],
  inSet: Set<string>,
): string | null {
  const counts = countElements(atoms)
  const localBonds = bonds.filter((b) => inSet.has(b.atom1Id) && inSet.has(b.atom2Id))
  const sixRings = approximateAromaticRings(atoms, localBonds)

  // BDC: 8 C, 4 O, 1 aromatic ring (H count is approximate due to capping).
  if (counts['C'] === 8 && counts['O'] === 4 && sixRings >= 1) {
    return 'BDC linker (1,4-benzenedicarboxylate)'
  }

  // BTC: 9 C, 6 O, 1 aromatic ring.
  if (counts['C'] === 9 && counts['O'] === 6 && sixRings >= 1) {
    return 'BTC linker (1,3,5-benzenetricarboxylate)'
  }

  // methyl-imidazolate: 4 C, 2 N, no O.
  if (counts['C'] === 4 && (counts['N'] ?? 0) === 2 && !counts['O']) {
    const fiveRings = approximateNRings(atoms, localBonds, 5)
    if (fiveRings >= 1) return 'methyl-imidazolate'
  }

  return null
}

/**
 * Count six-membered rings in the bond graph. Pure graph-cycle search,
 * not aromaticity-aware — but for the linker library MOFs target the two
 * are interchangeable. Cycles are detected by DFS up to depth 6.
 *
 * Note: this is intentionally cheap. It over-counts in fused systems; for
 * a publication-grade description swap in a proper SSSR.
 */
function approximateAromaticRings(atoms: InputAtom[], bonds: InputBond[]): number {
  return approximateNRings(atoms, bonds, 6)
}

function approximateNRings(atoms: InputAtom[], bonds: InputBond[], n: number): number {
  const adj = new Map<string, string[]>()
  for (const a of atoms) adj.set(a.id, [])
  for (const b of bonds) {
    adj.get(b.atom1Id)?.push(b.atom2Id)
    adj.get(b.atom2Id)?.push(b.atom1Id)
  }

  // Only count rings whose atoms are all C / N (typical aromatic systems).
  const elementOf = new Map<string, string>()
  for (const a of atoms) elementOf.set(a.id, a.element)
  const aromaticElement = (id: string) => {
    const e = elementOf.get(id)
    return e === 'C' || e === 'N'
  }

  const found = new Set<string>()
  for (const start of adj.keys()) {
    if (!aromaticElement(start)) continue
    const stack: { node: string; path: string[] }[] = [{ node: start, path: [start] }]
    while (stack.length > 0) {
      const { node, path } = stack.pop()!
      if (path.length === n) {
        for (const nb of adj.get(node) ?? []) {
          if (nb === start && pathIsCycle(path)) {
            const key = [...path].sort().join('|')
            found.add(key)
          }
        }
        continue
      }
      for (const nb of adj.get(node) ?? []) {
        if (!aromaticElement(nb)) continue
        if (path.includes(nb)) continue
        stack.push({ node: nb, path: [...path, nb] })
      }
    }
  }
  return found.size
}

function pathIsCycle(path: string[]): boolean {
  return new Set(path).size === path.length
}
