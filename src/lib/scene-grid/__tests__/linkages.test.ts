import { describe, expect, it } from 'vitest'

import {
  ZATOM_STRUCTURE_SCHEMA,
  type ZatomStructure,
  type ZatomStructureAtom,
} from '../../../agent/contracts'
import { ZATOM_BIOMOLECULAR_IDENTITY_PROPERTIES as BIO } from '../../../agent/biomolecular-identity'
import { findDisulfides, findMetalSites } from '../linkages'

interface AtomSpec {
  id: string
  element: string
  position: [number, number, number]
  chain?: string
  residueName?: string
  residueId?: string
  atomName?: string
  altLoc?: string
}

const build = (specs: AtomSpec[]): ZatomStructure => ({
  schemaVersion: ZATOM_STRUCTURE_SCHEMA,
  atoms: specs.map((spec) => {
    const properties: Record<string, string> = {}
    if (spec.chain !== undefined) properties[BIO.chainId] = spec.chain
    if (spec.residueName !== undefined) properties[BIO.residueName] = spec.residueName
    if (spec.residueId !== undefined) properties[BIO.residueId] = spec.residueId
    if (spec.atomName !== undefined) properties[BIO.atomName] = spec.atomName
    const atom: ZatomStructureAtom = {
      id: spec.id,
      element: spec.element,
      position: spec.position,
      ...(Object.keys(properties).length > 0 ? { properties } : {}),
    }
    return atom
  }),
})

/** A cysteine reduced to the two atoms these passes actually read. */
const cysteine = (
  id: string,
  chain: string,
  residueId: string,
  sg: [number, number, number],
): AtomSpec[] => [
  {
    id: `${id}-ca`,
    element: 'C',
    position: [sg[0], sg[1], sg[2] + 2],
    chain,
    residueName: 'CYS',
    residueId,
    atomName: 'CA',
  },
  {
    id: `${id}-sg`,
    element: 'S',
    position: sg,
    chain,
    residueName: 'CYS',
    residueId,
    atomName: 'SG',
  },
]

describe('findDisulfides', () => {
  it('pairs two cysteines at bonding distance within one chain', () => {
    const structure = build([
      ...cysteine('c1', 'A', '10', [0, 0, 0]),
      ...cysteine('c2', 'A', '40', [2.05, 0, 0]),
    ])
    const report = findDisulfides(structure)

    expect(report.bonds).toHaveLength(1)
    expect(report.bonds[0].distance).toBeCloseTo(2.05, 2)
    expect(report.bonds[0].interChain).toBe(false)
    expect(report.intraChainCount).toBe(1)
    expect(report.freeCysteineCount).toBe(0)
  })

  it('flags a disulfide that staples two chains together', () => {
    const structure = build([
      ...cysteine('c1', 'A', '7', [0, 0, 0]),
      ...cysteine('c2', 'B', '7', [2.04, 0, 0]),
    ])
    const report = findDisulfides(structure)

    expect(report.bonds).toHaveLength(1)
    expect(report.bonds[0].interChain).toBe(true)
    expect(report.interChainCount).toBe(1)
    expect(report.bonds[0].chainA).not.toBe(report.bonds[0].chainB)
  })

  it('does not pair methionine sulfurs, which are SD and cannot form disulfides', () => {
    // Same geometry as the bonding case; only the atom name differs. Matching on
    // element S alone would report a disulfide here.
    const structure = build([
      {
        id: 'm1-sd',
        element: 'S',
        position: [0, 0, 0],
        chain: 'A',
        residueName: 'MET',
        residueId: '1',
        atomName: 'SD',
      },
      {
        id: 'm2-sd',
        element: 'S',
        position: [2.05, 0, 0],
        chain: 'A',
        residueName: 'MET',
        residueId: '2',
        atomName: 'SD',
      },
    ])
    const report = findDisulfides(structure)

    expect(report.bonds).toHaveLength(0)
    expect(report.cysteineSulfurCount).toBe(0)
  })

  it('never gives one sulfur two disulfides when candidates chain together', () => {
    // Three SG in a line: outer-middle 2.1 A, middle-other 2.0 A, outer-outer
    // 4.1 A and out of range. The middle sulfur is in bonding range of both
    // neighbours, so an implementation that emits every in-range pair gives it
    // two disulfides, which no sulfur can have.
    //
    // The losing candidate is placed FIRST so its index is lowest. Order matters
    // here: the i<j de-duplication alone silently hides the second bond when the
    // loser sorts last, so a test built the other way round passes even without
    // the mutual-nearest requirement it is meant to protect.
    const structure = build([
      ...cysteine('c3', 'A', '30', [-2.1, 0, 0]),
      ...cysteine('c1', 'A', '10', [0, 0, 0]),
      ...cysteine('c2', 'A', '20', [2.0, 0, 0]),
    ])
    const report = findDisulfides(structure)

    expect(report.bonds).toHaveLength(1)
    // The closest pair wins: c1-c2 at 2.0 A.
    expect(report.bonds[0].distance).toBeCloseTo(2.0, 2)
    expect(report.ambiguousCount).toBeGreaterThan(0)

    // No sulfur may appear in two bonds.
    const bondedAtoms = report.bonds.flatMap((bond) => [bond.atomIdA, bond.atomIdB])
    expect(new Set(bondedAtoms).size).toBe(bondedAtoms.length)
    expect(report.freeCysteineCount).toBe(1)
  })

  it('does not bond a residue to itself when one residue carries two unlabelled SG', () => {
    // resolvePrimaryConformer short-circuits when no altLoc codes are present,
    // so both SG survive into primaryAtomIds and reach the pairing loop.
    const structure = build([
      {
        id: 'x-ca',
        element: 'C',
        position: [0, 0, 3],
        chain: 'A',
        residueName: 'CYS',
        residueId: '5',
        atomName: 'CA',
      },
      {
        id: 'x-sg1',
        element: 'S',
        position: [0, 0, 0],
        chain: 'A',
        residueName: 'CYS',
        residueId: '5',
        atomName: 'SG',
      },
      {
        id: 'x-sg2',
        element: 'S',
        position: [2.1, 0, 0],
        chain: 'A',
        residueName: 'CYS',
        residueId: '5',
        atomName: 'SG',
      },
    ])
    const report = findDisulfides(structure)

    expect(report.bonds).toHaveLength(0)
    expect(report.freeCysteineCount).toBe(2)
  })

  it('counts a lone cysteine as free rather than bonded', () => {
    const structure = build(cysteine('c1', 'A', '10', [0, 0, 0]))
    const report = findDisulfides(structure)

    expect(report.bonds).toHaveLength(0)
    expect(report.cysteineSulfurCount).toBe(1)
    expect(report.freeCysteineCount).toBe(1)
  })

  it('leaves cysteines beyond the bonding window unpaired', () => {
    const structure = build([
      ...cysteine('c1', 'A', '10', [0, 0, 0]),
      ...cysteine('c2', 'A', '40', [4.5, 0, 0]),
    ])
    const report = findDisulfides(structure)

    expect(report.bonds).toHaveLength(0)
    expect(report.freeCysteineCount).toBe(2)
  })

  it('reports unnamed sulfur separately so undetectable is not read as absent', () => {
    const structure = build([
      { id: 's1', element: 'S', position: [0, 0, 0] },
      { id: 's2', element: 'S', position: [2.05, 0, 0] },
    ])
    const report = findDisulfides(structure)

    expect(report.cysteineSulfurCount).toBe(0)
    expect(report.unnamedSulfurCount).toBe(2)
    expect(report.bonds).toHaveLength(0)
  })
})

/* ------------------------------------------------------------------ */

/** Place donors on unit directions scaled to `radius` around the origin. */
const shell = (
  directions: [number, number, number][],
  radius: number,
  element = 'O',
): AtomSpec[] =>
  directions.map((direction, i) => {
    const length = Math.hypot(...direction) || 1
    return {
      id: `d${i}`,
      element,
      position: [
        (direction[0] / length) * radius,
        (direction[1] / length) * radius,
        (direction[2] / length) * radius,
      ] as [number, number, number],
    }
  })

const TETRAHEDRAL: [number, number, number][] = [
  [1, 1, 1],
  [1, -1, -1],
  [-1, 1, -1],
  [-1, -1, 1],
]
const SQUARE_PLANAR: [number, number, number][] = [
  [1, 0, 0],
  [0, 1, 0],
  [-1, 0, 0],
  [0, -1, 0],
]
const OCTAHEDRAL: [number, number, number][] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
]

describe('findMetalSites', () => {
  it('names a tetrahedral zinc from its angles, not its coordination number', () => {
    const structure = build([
      { id: 'zn', element: 'Zn', position: [0, 0, 0] },
      ...shell(TETRAHEDRAL, 2.1),
    ])
    const { sites } = findMetalSites(structure)

    expect(sites).toHaveLength(1)
    expect(sites[0].coordinationNumber).toBe(4)
    expect(sites[0].meanAngleDeg).toBeCloseTo(109.5, 0)
    expect(sites[0].geometry).toBe('tetrahedral')
  })

  it('distinguishes square planar from tetrahedral at the same coordination number', () => {
    const structure = build([
      { id: 'pt', element: 'Pt', position: [0, 0, 0] },
      ...shell(SQUARE_PLANAR, 2.0),
    ])
    const { sites } = findMetalSites(structure)

    expect(sites[0].coordinationNumber).toBe(4)
    expect(sites[0].meanAngleDeg).toBeCloseTo(120, 0)
    expect(sites[0].geometry).toBe('square planar')
  })

  it('names an octahedral site', () => {
    const structure = build([
      { id: 'fe', element: 'Fe', position: [0, 0, 0] },
      ...shell(OCTAHEDRAL, 2.05),
    ])
    const { sites } = findMetalSites(structure)

    expect(sites[0].coordinationNumber).toBe(6)
    expect(sites[0].geometry).toBe('octahedral')
  })

  it('declines to name a badly distorted six-coordinate site', () => {
    // Six donors crowded into one hemisphere: CN is 6 but the angles are nothing
    // like octahedral, and calling it octahedral would be the misleading answer.
    const structure = build([
      { id: 'fe', element: 'Fe', position: [0, 0, 0] },
      ...shell(
        [
          [1, 0, 0.2],
          [0.9, 0.4, 0],
          [0.8, -0.5, 0.1],
          [1, 0.2, -0.4],
          [0.85, 0.1, 0.5],
          [0.95, -0.2, -0.2],
        ],
        2.1,
      ),
    ])
    const { sites } = findMetalSites(structure)

    expect(sites[0].coordinationNumber).toBe(6)
    expect(sites[0].geometry).toBe('irregular')
  })

  it('excludes metal-metal contacts from the coordination number', () => {
    const structure = build([
      { id: 'fe1', element: 'Fe', position: [0, 0, 0] },
      { id: 'fe2', element: 'Fe', position: [2.4, 0, 0] },
      ...shell(TETRAHEDRAL, 2.1),
    ])
    const { sites } = findMetalSites(structure)
    const first = sites.find((site) => site.metalAtomId === 'fe1')!

    expect(first.metalNeighborCount).toBe(1)
    expect(first.coordinationNumber).toBe(4)
    expect(first.donors.every((donor) => !donor.isMetal)).toBe(true)
  })

  it('uses the wider ionic cutoff so a potassium shell is not truncated away', () => {
    // K-O at 2.9 A is real coordination and sits outside the 2.6 A cutoff that
    // suits transition metals.
    const structure = build([
      { id: 'k', element: 'K', position: [0, 0, 0] },
      ...shell(OCTAHEDRAL, 2.9),
    ])
    const { sites } = findMetalSites(structure)

    expect(sites[0].cutoffUsed).toBeGreaterThan(2.6)
    expect(sites[0].coordinationNumber).toBe(6)
  })

  it('keeps a transition metal on the narrow cutoff so second-shell water is excluded', () => {
    const structure = build([
      { id: 'zn', element: 'Zn', position: [0, 0, 0] },
      ...shell(TETRAHEDRAL, 2.1),
      // Second shell, well beyond a real Zn-O bond.
      { id: 'far', element: 'O', position: [2.95, 0, 0] },
    ])
    const { sites } = findMetalSites(structure)

    expect(sites[0].cutoffUsed).toBeCloseTo(2.6, 5)
    expect(sites[0].coordinationNumber).toBe(4)
  })

  it('ignores neighbours that are not plausible donors', () => {
    const structure = build([
      { id: 'zn', element: 'Zn', position: [0, 0, 0] },
      ...shell(TETRAHEDRAL, 2.1),
      { id: 'c1', element: 'C', position: [0, 0, 2.2] },
    ])
    const { sites } = findMetalSites(structure)

    expect(sites[0].coordinationNumber).toBe(4)
    expect(sites[0].donors.some((donor) => donor.element === 'C')).toBe(false)
  })

  it('separates water donors from protein donors', () => {
    const structure = build([
      { id: 'zn', element: 'Zn', position: [0, 0, 0] },
      {
        id: 'his-ne2',
        element: 'N',
        position: [2.1, 0, 0],
        chain: 'A',
        residueName: 'HIS',
        residueId: '94',
        atomName: 'NE2',
      },
      {
        id: 'wat-o',
        element: 'O',
        position: [-2.1, 0, 0],
        chain: 'A',
        residueName: 'HOH',
        residueId: '300',
        atomName: 'O',
      },
    ])
    const { sites } = findMetalSites(structure)

    expect(sites[0].coordinationNumber).toBe(2)
    expect(sites[0].waterDonorCount).toBe(1)
    expect(sites[0].polymerDonorCount).toBe(1)
  })

  it('reports no metal sites for an organic-only scene', () => {
    const structure = build([
      { id: 'c1', element: 'C', position: [0, 0, 0] },
      { id: 'o1', element: 'O', position: [1.4, 0, 0] },
    ])
    expect(findMetalSites(structure).metalCount).toBe(0)
  })
})
