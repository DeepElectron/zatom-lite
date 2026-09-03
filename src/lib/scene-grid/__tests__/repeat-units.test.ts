import { describe, expect, it } from 'vitest'

import {
  ZATOM_STRUCTURE_SCHEMA,
  type ZatomStructure,
  type ZatomStructureAtom,
  type ZatomStructureBond,
} from '../../../agent/contracts'
import { findRepeatUnits } from '../repeat-units'

/* ------------------------------------------------------------------ */
/* Builders                                                            */
/* ------------------------------------------------------------------ */

/**
 * A pendant group hanging off one backbone site.
 * 'H' / 'Cl' / 'F' are single atoms; 'CH3' is a carbon carrying three hydrogens.
 */
type Pendant = 'H' | 'Cl' | 'F' | 'CH3' | 'Ph'

interface Site {
  element: string
  pendants: Pendant[]
}

/**
 * Build a chain with declared bonds.
 *
 * Bonds are declared rather than inferred so the tests exercise repeat-unit
 * logic and never the geometry of bond inference. Positions are spaced out but
 * otherwise irrelevant: buildBondGraph ignores geometry when bonds are declared.
 */
const chain = (sites: Site[], options: { closeRing?: boolean } = {}): ZatomStructure => {
  const atoms: ZatomStructureAtom[] = []
  const bonds: ZatomStructureBond[] = []
  const backboneIds: string[] = []
  let serial = 0

  const push = (element: string, position: [number, number, number]): string => {
    const id = `a${serial++}`
    atoms.push({ id, element, position })
    return id
  }
  const bond = (a: string, b: string): void => {
    bonds.push({ id: `b${bonds.length}`, atomIds: [a, b], order: 1 })
  }

  sites.forEach((site, siteIndex) => {
    const backboneId = push(site.element, [siteIndex * 1.5, 0, 0])
    backboneIds.push(backboneId)
    if (siteIndex > 0) bond(backboneIds[siteIndex - 1], backboneId)

    site.pendants.forEach((pendant, pendantIndex) => {
      const offset = 1 + pendantIndex
      if (pendant === 'Ph') {
        // Six-carbon ring attached at its first carbon: a ring that is a side
        // group, not the backbone.
        const ring: string[] = []
        for (let r = 0; r < 6; r++) {
          ring.push(push('C', [siteIndex * 1.5 + 0.4 * r, offset + 1, 0.4 * r]))
        }
        for (let r = 0; r < 6; r++) bond(ring[r], ring[(r + 1) % 6])
        bond(backboneId, ring[0])
        return
      }
      if (pendant === 'CH3') {
        const carbon = push('C', [siteIndex * 1.5, offset, 0])
        bond(backboneId, carbon)
        for (let h = 0; h < 3; h++) {
          const hydrogen = push('H', [siteIndex * 1.5 + 0.3 * h, offset + 1, 0])
          bond(carbon, hydrogen)
        }
        return
      }
      const atom = push(pendant, [siteIndex * 1.5, offset, 0])
      bond(backboneId, atom)
    })
  })

  if (options.closeRing && backboneIds.length > 2) {
    bond(backboneIds[backboneIds.length - 1], backboneIds[0])
  }

  return { schemaVersion: ZATOM_STRUCTURE_SCHEMA, atoms, bonds }
}

const carbon = (pendants: Pendant[]): Site => ({ element: 'C', pendants })

/** A reported unit must explain at least this much backbone to be meaningful. */
const MIN_COVERED = 4

/** Alkane chain: CH3 caps, CH2 interior. */
const polyethylene = (interiorCount: number): ZatomStructure =>
  chain([
    carbon(['H', 'H', 'H']),
    ...Array.from({ length: interiorCount }, () => carbon(['H', 'H'])),
    carbon(['H', 'H', 'H']),
  ])

/* ------------------------------------------------------------------ */
/* End groups: the case that breaks naive period detection             */
/* ------------------------------------------------------------------ */

describe('findRepeatUnits end groups', () => {
  it('finds a period-1 unit on an alkane chain despite non-matching termini', () => {
    // The full backbone is NOT periodic: terminal carbons read C[HHH] and
    // interior carbons read C[HH]. A detector that tests the whole backbone
    // finds nothing here, which is the common failure on real polymers.
    const report = findRepeatUnits(polyethylene(20))

    expect(report.connectivityMissing).toBe(false)
    expect(report.bondSource).toBe('declared')
    expect(report.units).toHaveLength(1)

    const unit = report.units[0]
    expect(unit.period).toBe(1)
    expect(unit.backboneLength).toBe(22)
    // One terminal carbon trimmed at each end.
    expect(unit.leadingEndGroupIds).toHaveLength(1)
    expect(unit.trailingEndGroupIds).toHaveLength(1)
    expect(unit.repeats).toBe(20)
    expect(unit.backboneCovered).toBe(20)
    expect(unit.unitSignature).toEqual(['C[HH]'])
  })

  it('strips terminal hydrogens so the backbone is the heavy-atom chain', () => {
    // The raw graph diameter runs H-C-...-C-H. If those hydrogens stayed on the
    // backbone the length would be 24, not 22, and the signatures would be
    // H[] at both ends.
    const report = findRepeatUnits(polyethylene(20))
    expect(report.units[0].backboneLength).toBe(22)
    expect(report.units[0].unitSignature.join()).not.toContain('H[]')
  })
})

/* ------------------------------------------------------------------ */
/* Period detection                                                    */
/* ------------------------------------------------------------------ */

describe('findRepeatUnits period', () => {
  it('reports period 2 for an alternating backbone', () => {
    // Polypropylene-like: CH2 alternating with CH(CH3).
    const sites: Site[] = [carbon(['H', 'H', 'H'])]
    for (let i = 0; i < 10; i++) {
      sites.push(carbon(['H', 'H']))
      sites.push(carbon(['H', 'CH3']))
    }
    sites.push(carbon(['H', 'H', 'H']))

    const unit = findRepeatUnits(chain(sites)).units[0]
    expect(unit.period).toBe(2)
    expect(unit.repeats).toBe(10)
    expect(new Set(unit.unitSignature).size).toBe(2)
  })

  it('separates substituent elements, not just substituent counts', () => {
    // PVC-like: CH2 alternating with CHCl. Both sites carry two pendants, so a
    // fingerprint that counted pendants without naming them would see period 1.
    const sites: Site[] = [carbon(['H', 'H', 'H'])]
    for (let i = 0; i < 8; i++) {
      sites.push(carbon(['H', 'H']))
      sites.push(carbon(['H', 'Cl']))
    }
    sites.push(carbon(['H', 'H', 'H']))

    const unit = findRepeatUnits(chain(sites)).units[0]
    expect(unit.period).toBe(2)
    expect(unit.unitSignature.some((s) => s.includes('CL'))).toBe(true)
  })

  it('is independent of the order pendants appear in the file', () => {
    const forward: Site[] = [carbon(['H', 'H', 'H'])]
    const reversed: Site[] = [carbon(['H', 'H', 'H'])]
    for (let i = 0; i < 8; i++) {
      forward.push(carbon(['H', 'H']))
      forward.push(carbon(['H', 'Cl']))
      reversed.push(carbon(['H', 'H']))
      reversed.push(carbon(['Cl', 'H']))
    }
    forward.push(carbon(['H', 'H', 'H']))
    reversed.push(carbon(['H', 'H', 'H']))

    const a = findRepeatUnits(chain(forward)).units[0]
    const b = findRepeatUnits(chain(reversed)).units[0]
    expect(b.period).toBe(a.period)
    expect(b.unitSignature.slice().sort()).toEqual(a.unitSignature.slice().sort())
  })

  it('requires the period to hold across the whole window', () => {
    // Matches with period 2 for the first four sites, then breaks. Accepting a
    // period from the opening blocks alone would report a polymer here.
    const sites: Site[] = [
      carbon(['H', 'H', 'H']),
      carbon(['H', 'H']),
      carbon(['H', 'Cl']),
      carbon(['H', 'H']),
      carbon(['H', 'Cl']),
      carbon(['H', 'F']),
      carbon(['Cl', 'Cl']),
      carbon(['F', 'F']),
      carbon(['H', 'H', 'H']),
    ]
    const report = findRepeatUnits(chain(sites))
    for (const unit of report.units) {
      // Whatever is reported must be consistent: the covered span is a whole
      // number of periods and never exceeds the backbone.
      expect(unit.backboneCovered).toBe(unit.repeats * unit.period)
      expect(unit.backboneCovered).toBeLessThanOrEqual(unit.backboneLength)
      expect(unit.repeats).toBeGreaterThanOrEqual(2)
    }
  })
})

/* ------------------------------------------------------------------ */
/* Declining to answer                                                 */
/* ------------------------------------------------------------------ */

describe('findRepeatUnits declines', () => {
  it('reports no unit for an aperiodic chain', () => {
    const sites: Site[] = [
      carbon(['H', 'H', 'H']),
      { element: 'N', pendants: ['H'] },
      carbon(['H', 'Cl']),
      { element: 'O', pendants: [] },
      carbon(['F', 'F']),
      { element: 'S', pendants: [] },
      carbon(['H', 'CH3']),
      carbon(['H', 'H', 'H']),
    ]
    expect(findRepeatUnits(chain(sites)).units).toHaveLength(0)
  })

  it('does not test a backbone shorter than the minimum window', () => {
    const report = findRepeatUnits(chain([carbon(['H', 'H', 'H']), carbon(['H', 'H', 'H'])]))
    expect(report.testedCount).toBe(0)
    expect(report.units).toHaveLength(0)
  })

  it('reports connectivityMissing when there is no connectivity to use', () => {
    const structure: ZatomStructure = {
      schemaVersion: ZATOM_STRUCTURE_SCHEMA,
      atoms: [
        { id: 'x0', element: 'C', position: [0, 0, 0] },
        { id: 'x1', element: 'C', position: [40, 0, 0] },
      ],
    }
    const report = findRepeatUnits(structure)
    expect(report.connectivityMissing).toBe(true)
    expect(report.units).toHaveLength(0)
  })

  it('will not manufacture a period by discarding most of a short chain', () => {
    // Six sites, all different. With an unbounded end trim a detector could
    // throw away four of them and call the remaining two a repeat unit.
    const sites: Site[] = [
      carbon(['H', 'H', 'H']),
      carbon(['H', 'H']),
      carbon(['H', 'Cl']),
      carbon(['F', 'F']),
      { element: 'N', pendants: ['H'] },
      carbon(['H', 'H', 'H']),
    ]
    const report = findRepeatUnits(chain(sites))
    for (const unit of report.units) {
      expect(unit.backboneCovered).toBeGreaterThanOrEqual(MIN_COVERED)
    }
  })
})

/* ------------------------------------------------------------------ */
/* Rings                                                               */
/* ------------------------------------------------------------------ */

describe('findRepeatUnits rings', () => {
  it('declines a ring backbone instead of reporting it as a chain', () => {
    // Benzene: six CH in a ring. This detector extracts a linear backbone, and a
    // ring has none — the diameter path of a six-ring spans only half of it, so
    // the two cut carbons see the remaining half as a pendant and the window is
    // not periodic. Declining is the correct outcome: the alternative would be a
    // period reported for a molecule that has no chain to repeat along.
    const benzene = chain(
      Array.from({ length: 6 }, () => carbon(['H'])),
      { closeRing: true },
    )
    expect(findRepeatUnits(benzene).units).toHaveLength(0)
  })

  it('fails closed on a long ring side group rather than reporting a wrong unit', () => {
    // Polystyrene-like: CH2/CH backbone carrying phenyl side groups. The graph
    // diameter detours through the rings — measured, the path is 15 atoms of
    // which only 7 are backbone, with 4 phenyl carbons at each end — so the
    // extracted "backbone" is mostly side group.
    //
    // This documents a real limit of diameter-based backbone extraction. What is
    // asserted is that the limit is safe: no unit is reported. A detector that
    // returned a period here would be describing the phenyl detour, not the
    // polymer.
    const sites: Site[] = [carbon(['H', 'H', 'H'])]
    for (let i = 0; i < 8; i++) {
      sites.push(carbon(['H', 'H']))
      sites.push(carbon(['H', 'Ph']))
    }
    sites.push(carbon(['H', 'H', 'H']))

    expect(findRepeatUnits(chain(sites)).units).toHaveLength(0)
  })

  it('still handles a chain whose substituents are short', () => {
    // The complement of the case above: a methyl side group is short enough that
    // the diameter stays on the backbone, so the same chain shape is analysable.
    const sites: Site[] = [carbon(['H', 'H', 'H'])]
    for (let i = 0; i < 8; i++) {
      sites.push(carbon(['H', 'H']))
      sites.push(carbon(['H', 'CH3']))
    }
    sites.push(carbon(['H', 'H', 'H']))

    expect(findRepeatUnits(chain(sites)).units[0].period).toBe(2)
  })
})

/* ------------------------------------------------------------------ */
/* Multiple molecules                                                  */
/* ------------------------------------------------------------------ */

describe('findRepeatUnits multiple components', () => {
  it('reports one unit per periodic molecule, largest first', () => {
    const long = polyethylene(20)
    const short = polyethylene(6)
    const merged: ZatomStructure = {
      schemaVersion: ZATOM_STRUCTURE_SCHEMA,
      atoms: [
        ...long.atoms,
        ...short.atoms.map((atom) => ({
          ...atom,
          id: `s_${atom.id}`,
          position: [atom.position[0], atom.position[1] + 100, atom.position[2]] as [
            number,
            number,
            number,
          ],
        })),
      ],
      bonds: [
        ...(long.bonds ?? []),
        ...(short.bonds ?? []).map((bond) => ({
          ...bond,
          id: `s_${bond.id}`,
          atomIds: [`s_${bond.atomIds[0]}`, `s_${bond.atomIds[1]}`] as [string, string],
        })),
      ],
    }

    const report = findRepeatUnits(merged)
    expect(report.componentCount).toBe(2)
    expect(report.units).toHaveLength(2)
    expect(report.units[0].backboneCovered).toBeGreaterThanOrEqual(
      report.units[1].backboneCovered,
    )
  })
})
