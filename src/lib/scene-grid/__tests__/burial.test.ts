import { describe, expect, it } from 'vitest'

import { ZATOM_STRUCTURE_SCHEMA, type Vec3, type ZatomStructure } from '../../../agent/contracts'
import { ZATOM_BIOMOLECULAR_IDENTITY_PROPERTIES as BIO } from '../../../agent/biomolecular-identity'
import { buildResidueIndex } from '../residue-index'
import { computeEnclosure, computeResidueBurial } from '../burial'

/**
 * A protein residue reduced to its CA trace atom.
 *
 * The burial proxy only reads the trace position, so a one-atom alanine is a
 * faithful stand-in and keeps the neighbour arithmetic in these tests readable.
 */
const residue = (seq: number, position: Vec3) => ({
  id: `ca${seq}`,
  element: 'C',
  position,
  properties: {
    [BIO.chainId]: 'A',
    [BIO.residueName]: 'ALA',
    [BIO.residueId]: String(seq),
    [BIO.atomName]: 'CA',
  },
})

const structureOf = (positions: Vec3[]): ZatomStructure => ({
  schemaVersion: ZATOM_STRUCTURE_SCHEMA,
  atoms: positions.map((position, i) => residue(i + 1, position)),
})

/** Atoms far enough apart that none is inside another's 8 A probe sphere. */
const isolated = (count: number): Vec3[] =>
  Array.from({ length: count }, (_, i) => [i * 100, 0, 0] as Vec3)

/** A 3x3 blob at 2 A pitch: every atom sees all eight others inside 8 A. */
const tightCluster = (origin = 0): Vec3[] => {
  const out: Vec3[] = []
  for (let x = 0; x < 3; x++) {
    for (let y = 0; y < 3; y++) out.push([origin + x * 2, y * 2, 0])
  }
  return out
}

const classesOf = (structure: ZatomStructure) => {
  const result = computeResidueBurial(structure, buildResidueIndex(structure))
  return {
    result,
    classes: [...result.byResidueKey.values()].map((r) => r.burial),
  }
}

describe('computeResidueBurial — tercile collapse', () => {
  it('does not call fully solvent-exposed residues buried', () => {
    // Four residues with zero heavy neighbours inside the probe sphere. Both
    // tercile cuts land on 0, and the original `count >= buriedAbove` test then
    // matched every residue, reporting maximal exposure as 100% buried.
    const { result, classes } = classesOf(structureOf(isolated(4)))

    expect(classes).toHaveLength(4)
    expect(classes.every((c) => c === 'exposed')).toBe(true)
    expect(result.counts.buried).toBe(0)
    expect(result.separated).toBe(false)
  })

  it('reports no contrast rather than a class the distribution cannot support', () => {
    // Uniform packing: every residue has the same neighbour count, so the cuts
    // collapse again. There is a real answer here ("all equally packed") and it
    // is not "all buried".
    const { result, classes } = classesOf(structureOf(tightCluster()))

    expect(result.separated).toBe(false)
    expect(result.counts.buried).toBe(0)
    expect(classes.every((c) => c === 'intermediate')).toBe(true)
  })

  it('classifies a two-residue scene without inverting it', () => {
    // The smallest scene that still has a distribution. n=2 makes the tercile
    // indices coincide, which is the collapse case again.
    const { result } = classesOf(structureOf(isolated(2)))

    expect(result.separated).toBe(false)
    expect(result.counts.buried).toBe(0)
  })

  it('still separates three classes when the scene has real spread', () => {
    // Isolated residues, a loosely spaced run, and a dense blob — far enough
    // apart that the groups do not see each other. This is the healthy path that
    // masked the collapse bug, so it must keep working.
    const positions: Vec3[] = [
      ...isolated(3),
      [1000, 0, 0],
      [1006, 0, 0],
      [1012, 0, 0],
      [1018, 0, 0],
      ...tightCluster(3000),
    ]
    const { result, classes } = classesOf(structureOf(positions))

    expect(result.separated).toBe(true)
    expect(result.buriedAbove).toBeGreaterThan(result.exposedBelow)

    const byKey = [...result.byResidueKey.values()]
    // The dense blob is the buried end.
    const dense = byKey.filter((r) => r.neighborCount >= 8)
    expect(dense).toHaveLength(9)
    expect(dense.every((r) => r.burial === 'buried')).toBe(true)

    // The isolated residues are the exposed end.
    const alone = byKey.filter((r) => r.neighborCount === 0)
    expect(alone).toHaveLength(3)
    expect(alone.every((r) => r.burial === 'exposed')).toBe(true)

    expect(classes).toHaveLength(16)
  })

  it('returns an empty, unseparated result for a scene with no polymer residues', () => {
    const result = computeResidueBurial(
      { schemaVersion: ZATOM_STRUCTURE_SCHEMA, atoms: [] },
      buildResidueIndex({ schemaVersion: ZATOM_STRUCTURE_SCHEMA, atoms: [] }),
    )
    expect(result.byResidueKey.size).toBe(0)
    expect(result.separated).toBe(false)
  })
})

describe('computeEnclosure', () => {
  /** A hollow shell of carbons at `radius`, dense enough to block every ray. */
  const shell = (radius: number): Vec3[] => {
    const out: Vec3[] = []
    const step = Math.PI / 10
    for (let phi = step; phi < Math.PI; phi += step) {
      for (let theta = 0; theta < 2 * Math.PI; theta += step) {
        out.push([
          radius * Math.sin(phi) * Math.cos(theta),
          radius * Math.cos(phi),
          radius * Math.sin(phi) * Math.sin(theta),
        ])
      }
    }
    out.push([0, radius, 0], [0, -radius, 0])
    return out
  }

  const withLigand = (shellPositions: Vec3[]): ZatomStructure => ({
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    atoms: [
      { id: 'lig', element: 'C', position: [0, 0, 0] as Vec3 },
      ...shellPositions.map((position, i) => ({
        id: `w${i}`,
        element: 'C',
        position,
      })),
    ],
  })

  it('reads a fully enclosed ligand as a buried cavity', () => {
    const structure = withLigand(shell(6))
    const report = computeEnclosure(structure, new Set(['lig']))

    expect(report.enclosure).toBeGreaterThan(0.9)
    expect(report.site).toBe('buried')
  })

  it('reads an unobstructed ligand as surface, with an escape direction', () => {
    const structure: ZatomStructure = {
      schemaVersion: ZATOM_STRUCTURE_SCHEMA,
      atoms: [{ id: 'lig', element: 'C', position: [0, 0, 0] }],
    }
    const report = computeEnclosure(structure, new Set(['lig']))

    expect(report.enclosure).toBe(0)
    expect(report.site).toBe('surface')
    expect(report.openingDirection).not.toBeNull()
  })

  it('returns a neutral report when the entity has no atoms', () => {
    const report = computeEnclosure(
      { schemaVersion: ZATOM_STRUCTURE_SCHEMA, atoms: [] },
      new Set(['missing']),
    )
    expect(report.enclosure).toBe(0)
    expect(report.site).toBe('surface')
    expect(report.depthA).toBeNull()
  })
})
