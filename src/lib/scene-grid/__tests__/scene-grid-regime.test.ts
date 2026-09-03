/**
 * Behavioral tests for the regime-aware encoding layer.
 *
 * These lock the properties that actually make the grid readable to an LLM:
 * regime is chosen and reported, biomolecular cells carry residue identity
 * instead of a uniform C/N/O smear, density never hides behind a marker, the
 * selection channel survives into the output, and contacts return true 3D
 * distances that the projection structurally cannot express.
 */
import { describe, expect, it } from 'vitest'

import { ZATOM_STRUCTURE_SCHEMA } from '../../../agent/contracts'
import type { ZatomStructure, ZatomStructureAtom } from '../../../agent/contracts'
import { findContacts } from '../contacts'
import { detectSceneRegime } from '../regime'
import { buildSceneGrid } from '../scene-grid'

function atom(
  id: string,
  element: string,
  position: [number, number, number],
  properties?: Record<string, string | number>,
): ZatomStructureAtom {
  return { id, element, position, ...(properties ? { properties } : {}) }
}

/** Residue-tagged atoms, mimicking a PDB import. */
function bioAtom(
  id: string,
  element: string,
  position: [number, number, number],
  chainId: string,
  residueName: string,
  residueId: number,
  atomName: string,
): ZatomStructureAtom {
  return atom(id, element, position, {
    'zatom.bio.chainId': chainId,
    'zatom.bio.residueName': residueName,
    'zatom.bio.residueId': residueId,
    'zatom.bio.atomName': atomName,
  })
}

function structure(atoms: ZatomStructureAtom[], lattice?: ZatomStructure['lattice']): ZatomStructure {
  return {
    atoms,
    bonds: [],
    ...(lattice ? { lattice } : {}),
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
  }
}

/** A small protein-like scene: two residues plus a heme-like ligand. */
function proteinLike(): ZatomStructure {
  const atoms: ZatomStructureAtom[] = []
  // Chain A, residue HIS 93 — a compact cluster near the origin.
  atoms.push(bioAtom('a1', 'N', [0, 0, 0], 'A', 'HIS', 93, 'N'))
  atoms.push(bioAtom('a2', 'C', [1.4, 0, 0], 'A', 'HIS', 93, 'CA'))
  atoms.push(bioAtom('a3', 'C', [2.4, 1.0, 0], 'A', 'HIS', 93, 'CB'))
  atoms.push(bioAtom('a4', 'N', [3.6, 1.6, 0], 'A', 'HIS', 93, 'NE2'))
  // Chain A, residue VAL 68 — far away so it lands in a different cell.
  atoms.push(bioAtom('a5', 'N', [20, 20, 0], 'A', 'VAL', 68, 'N'))
  atoms.push(bioAtom('a6', 'C', [21.4, 20, 0], 'A', 'VAL', 68, 'CA'))
  // A hetero ligand: iron, 2.1 Å from the HIS NE2.
  atoms.push(bioAtom('h1', 'Fe', [5.7, 1.6, 0], 'A', 'HEM', 142, 'FE'))
  return structure(atoms)
}

describe('scene regime detection', () => {
  it('classifies a residue-tagged scene as biomolecular and reports why', () => {
    const info = detectSceneRegime(proteinLike())
    expect(info.regime).toBe('biomolecular')
    expect(info.unit).toBe('residue')
    expect(info.overridden).toBe(false)
    // The reason is echoed to the LLM so the lens is never implicit.
    expect(info.reason.length).toBeGreaterThan(0)
  })

  it('classifies a small untagged scene as molecular', () => {
    const info = detectSceneRegime(structure([
      atom('a', 'O', [0, 0, 0]),
      atom('b', 'H', [1, 0, 0]),
    ]))
    expect(info.regime).toBe('molecular')
    expect(info.unit).toBe('atom')
  })

  it('honours an explicit override and marks it as forced', () => {
    const info = detectSceneRegime(proteinLike(), 'molecular')
    expect(info.regime).toBe('molecular')
    expect(info.overridden).toBe(true)
  })
})

describe('regime-aware cell encoding', () => {
  it('encodes biomolecular cells by residue identity, not raw element', () => {
    const grid = buildSceneGrid(proteinLike(), { view: 'top', resolution: 16 })
    expect(grid.regime.regime).toBe('biomolecular')

    // At least one cell must be labelled with a residue, which is the whole
    // point: a uniform C/N/O smear carries no modelling information.
    const labels = grid.cells.map((c) => c.label)
    expect(labels.some((l) => l.includes('HIS') || l.includes('VAL') || l.includes('HEM'))).toBe(true)
  })

  it('reports per-cell density so truncation can never hide atoms', () => {
    // Stack four atoms into one cell along the view axis, with topK=1 so the
    // stack is truncated. The density digit must still report all four.
    const stacked = structure([
      atom('s1', 'C', [0, 0, 0]),
      atom('s2', 'C', [0, 0, 2]),
      atom('s3', 'C', [0, 0, 4]),
      atom('s4', 'C', [0, 0, 6]),
    ])
    const grid = buildSceneGrid(stacked, { view: 'top', resolution: 8, topK: 1 })
    const occupied = grid.cells.filter((c) => c.atomCount > 0)
    const densest = occupied.reduce((best, c) => (c.atomCount > best.atomCount ? c : best), occupied[0])

    expect(densest.atomCount).toBe(4)
    // Density rides in the code itself, not in a lossy '+' marker.
    expect(densest.code).toContain('4')
    expect(densest.stack.length).toBe(1)
  })

  it('carries the selection channel into the grid and the ascii', () => {
    const scene = proteinLike()
    const grid = buildSceneGrid(scene, {
      view: 'top',
      resolution: 16,
      selectedAtomIds: new Set(['h1']),
    })

    expect(grid.focus).not.toBeNull()
    expect(grid.focus!.atomCount).toBe(1)
    expect(grid.cells.some((c) => c.selected)).toBe(true)
    // Selected cells are bracketed so the strongest intent signal is visible.
    expect(grid.ascii).toContain('[')
  })

  it('omits the focus channel when nothing is selected', () => {
    const grid = buildSceneGrid(proteinLike(), { view: 'top', resolution: 16 })
    expect(grid.focus).toBeNull()
  })
})

describe('contacts channel', () => {
  it('returns true 3D distances between a focus atom and its neighbours', () => {
    const scene = proteinLike()
    const report = findContacts(scene, { focusAtomIds: new Set(['h1']), cutoff: 3.0 })

    // Fe at (5.7, 1.6, 0) is 2.1 Å from NE2 at (3.6, 1.6, 0).
    const ne2 = report.contacts.find((c) => c.toAtomId === 'a4')
    expect(ne2).toBeDefined()
    expect(ne2!.distance).toBeCloseTo(2.1, 5)
    // The label must carry residue identity, which is what makes the row
    // actionable: "HIS A93 NE2" rather than a bare atom id.
    expect(ne2!.toLabel).toContain('HIS')
  })

  it('excludes partners beyond the cutoff', () => {
    const scene = proteinLike()
    const report = findContacts(scene, { focusAtomIds: new Set(['h1']), cutoff: 3.0 })
    // VAL 68 sits ~24 Å away and must not appear.
    expect(report.contacts.some((c) => c.toAtomId === 'a5')).toBe(false)
  })

  it('stays linear on a large scene rather than degrading to O(N squared)', () => {
    // 8000 atoms on a 20x20x20 lattice. A pairwise scan would be 64M
    // comparisons; the spatial hash must keep this well under a second.
    const atoms: ZatomStructureAtom[] = []
    for (let x = 0; x < 20; x++) {
      for (let y = 0; y < 20; y++) {
        for (let z = 0; z < 20; z++) {
          atoms.push(atom(`p${x}-${y}-${z}`, 'C', [x * 2.5, y * 2.5, z * 2.5]))
        }
      }
    }
    const scene = structure(atoms)
    const started = Date.now()
    const report = findContacts(scene, { focusAtomIds: new Set(['p10-10-10']), cutoff: 3.0 })
    const elapsed = Date.now() - started

    expect(report.contacts.length).toBeGreaterThan(0)
    expect(elapsed).toBeLessThan(1000)
  })
})
