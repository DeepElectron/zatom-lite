import { describe, expect, it } from 'vitest'
import {
  BIO_CARTOON_MODELS,
  buildBioCartoonGeometry,
  type BioCartoonMeshData,
  type BioCartoonModel,
} from '../lib/biomolecule/cartoon-geometry'
import { parseLegacyPdb } from '../lib/biomolecule/pdb'
import type { BioSecondaryStructure, BioStructure } from '../lib/biomolecule/types'

const PROFILE_SEGMENTS = 24

function atomLine(options: {
  serial: number
  name: string
  residue: string
  chain?: string
  sequence: number
  x: number
  y: number
  z: number
  bFactor?: number
  element: string
}): string {
  const coordinate = (value: number) => value.toFixed(3).padStart(8)
  return `${'ATOM'.padEnd(6)}${String(options.serial).padStart(5)} ${options.name.padStart(4)} ${options.residue.padStart(3)} ${(options.chain ?? 'A')}${String(options.sequence).padStart(4)}    ${coordinate(options.x)}${coordinate(options.y)}${coordinate(options.z)}${'1.00'.padStart(6)}${(options.bFactor ?? 0).toFixed(2).padStart(6)}          ${options.element.padStart(2)}`
}

function proteinFixture(
  secondary: readonly BioSecondaryStructure[] = ['helix', 'helix', 'sheet', 'sheet', 'coil', 'coil'],
  bFactors: readonly number[] = [0, 20, 40, 60, 80, 100],
  carbonylSign: (index: number) => number = () => 1,
  bFactorSemantics: BioStructure['bFactorSemantics'] = 'temperature-factor',
): BioStructure {
  let serial = 1
  const lines: string[] = []
  for (let index = 0; index < secondary.length; index += 1) {
    const x = index * 3.8
    lines.push(atomLine({
      serial: serial++, name: 'CA', residue: 'ALA', sequence: index + 1,
      x, y: 0, z: 0, bFactor: bFactors[index] ?? 0, element: 'C',
    }))
    lines.push(atomLine({
      serial: serial++, name: 'O', residue: 'ALA', sequence: index + 1,
      x, y: 0, z: carbonylSign(index), bFactor: bFactors[index] ?? 0, element: 'O',
    }))
  }
  const structure = parseLegacyPdb(lines.join('\n'), { inferBonds: false, bFactorSemantics })
  structure.residues.forEach((residue, index) => {
    residue.secondaryStructure = secondary[index]
    residue.secondaryStructureSource = 'pdb-record'
  })
  return structure
}

function nucleicFixture(withBaseAtoms: boolean): BioStructure {
  let serial = 1
  const lines: string[] = []
  for (let residueIndex = 0; residueIndex < 2; residueIndex += 1) {
    const x = residueIndex * 5.5
    const residue = residueIndex === 0 ? 'DA' : 'DT'
    lines.push(atomLine({
      serial: serial++, name: 'P', residue, sequence: residueIndex + 1,
      x, y: 0, z: 0, element: 'P',
    }))
    if (!withBaseAtoms) continue
    lines.push(
      atomLine({ serial: serial++, name: 'N1', residue, sequence: residueIndex + 1, x, y: 2, z: 0, element: 'N' }),
      atomLine({ serial: serial++, name: 'C2', residue, sequence: residueIndex + 1, x, y: 2.4, z: .5, element: 'C' }),
      atomLine({ serial: serial++, name: 'N3', residue, sequence: residueIndex + 1, x, y: 2.4, z: -.5, element: 'N' }),
    )
  }
  return parseLegacyPdb(lines.join('\n'), { inferBonds: false })
}

function build(
  structure: BioStructure,
  model: BioCartoonModel = 'ribbon',
  quality = 4,
): BioCartoonMeshData {
  return buildBioCartoonGeometry(
    structure,
    structure.residues.map((_, index) => index % 2 === 0 ? '#ff0000' : '#0000ff'),
    { model, quality, smooth: 1, width: 1, thickness: 1 },
  )
}

function ringRadius(data: BioCartoonMeshData, ringIndex: number): number {
  const firstVertex = ringIndex * PROFILE_SEGMENTS
  let centerX = 0
  let centerY = 0
  let centerZ = 0
  for (let profileIndex = 0; profileIndex < PROFILE_SEGMENTS; profileIndex += 1) {
    const offset = (firstVertex + profileIndex) * 3
    centerX += data.positions[offset]
    centerY += data.positions[offset + 1]
    centerZ += data.positions[offset + 2]
  }
  centerX /= PROFILE_SEGMENTS
  centerY /= PROFILE_SEGMENTS
  centerZ /= PROFILE_SEGMENTS
  let maximum = 0
  for (let profileIndex = 0; profileIndex < PROFILE_SEGMENTS; profileIndex += 1) {
    const offset = (firstVertex + profileIndex) * 3
    maximum = Math.max(maximum, Math.hypot(
      data.positions[offset] - centerX,
      data.positions[offset + 1] - centerY,
      data.positions[offset + 2] - centerZ,
    ))
  }
  return maximum
}

describe('buildBioCartoonGeometry', () => {
  it('produces finite indexed unit-normal geometry with independent caps for all seven models', () => {
    const structure = proteinFixture()
    expect(BIO_CARTOON_MODELS.map(({ value }) => value)).toEqual([
      'ribbon', 'oval', 'rectangle', 'tube', 'rocket', 'putty', 'trace',
    ])
    for (const { value: model } of BIO_CARTOON_MODELS) {
      const data = build(structure, model)
      const sampleCount = (structure.residues.length - 1) * 4 + 1
      const expectedVertices = sampleCount * PROFILE_SEGMENTS + 2 * (PROFILE_SEGMENTS + 1)
      const expectedIndices = (sampleCount - 1) * PROFILE_SEGMENTS * 6 + 2 * PROFILE_SEGMENTS * 3
      expect(data.positions.length / 3, model).toBe(expectedVertices)
      expect(data.normals.length, model).toBe(data.positions.length)
      expect(data.colors.length, model).toBe(data.positions.length)
      expect(data.indices.length, model).toBe(expectedIndices)
      expect([...data.positions].every(Number.isFinite), model).toBe(true)
      expect([...data.normals].every(Number.isFinite), model).toBe(true)
      expect([...data.colors].every(Number.isFinite), model).toBe(true)
      expect([...data.indices].every((index) => index < expectedVertices), model).toBe(true)
      for (let offset = 0; offset < data.normals.length; offset += 3) {
        expect(Math.hypot(
          data.normals[offset],
          data.normals[offset + 1],
          data.normals[offset + 2],
        ), `${model} normal ${offset / 3}`).toBeCloseTo(1, 4)
      }
    }
  })

  it('keeps the RMF/twist field continuous when beta carbonyl references alternate by 180 degrees', () => {
    const structure = proteinFixture(
      new Array(6).fill('sheet'),
      new Array(6).fill(0),
      (index) => index % 2 === 0 ? 1 : -1,
    )
    const data = buildBioCartoonGeometry(
      structure,
      new Array(structure.residues.length).fill('#ffffff'),
      { model: 'rectangle', quality: 4, smooth: 0, width: 1, thickness: 1 },
    )
    const sampleCount = (structure.residues.length - 1) * 4 + 1
    let maximumCorrespondingVertexStep = 0
    for (let ring = 1; ring < sampleCount; ring += 1) {
      for (let profileIndex = 0; profileIndex < PROFILE_SEGMENTS; profileIndex += 1) {
        const previous = ((ring - 1) * PROFILE_SEGMENTS + profileIndex) * 3
        const current = (ring * PROFILE_SEGMENTS + profileIndex) * 3
        maximumCorrespondingVertexStep = Math.max(maximumCorrespondingVertexStep, Math.hypot(
          data.positions[current] - data.positions[previous],
          data.positions[current + 1] - data.positions[previous + 1],
          data.positions[current + 2] - data.positions[previous + 2],
        ))
      }
    }
    // A missed 180-degree equivalence would add roughly twice the 1.2 Å half-width.
    expect(maximumCorrespondingVertexStep).toBeLessThan(1.25)
  })

  it('widens and then tapers a beta-sheet terminus into a non-degenerate arrow', () => {
    const structure = proteinFixture(['sheet', 'sheet', 'sheet', 'coil', 'coil'])
    const arrow = build(structure, 'ribbon', 8)
    const allSheet = build(proteinFixture(new Array(5).fill('sheet')), 'ribbon', 8)
    // residueFraction = ring / quality: 1.875 is the widened arrow shoulder.
    const shoulder = ringRadius(arrow, 15)
    const ordinarySheet = ringRadius(allSheet, 15)
    // residueFraction 2.75 lies on the taper, before the exact coil boundary.
    const taperedTip = ringRadius(arrow, 22)
    expect(shoulder).toBeGreaterThan(ordinarySheet * 1.35)
    expect(shoulder).toBeGreaterThan(taperedTip * 2.5)
    expect(taperedTip).toBeGreaterThan(0.19)
  })

  it('adds one cylindrical base-ladder rung per nucleic residue with a valid base centroid', () => {
    const backboneOnly = build(nucleicFixture(false), 'tube')
    const withBases = build(nucleicFixture(true), 'tube')
    expect(withBases.positions.length / 3 - backboneOnly.positions.length / 3).toBe(
      2 * 2 * 12,
    )
    expect(withBases.indices.length - backboneOnly.indices.length).toBe(2 * 12 * 6)
  })

  it('maps high temperature factor to a thicker putty radius and high pLDDT to a thinner radius', () => {
    const temperature = build(proteinFixture(
      new Array(6).fill('coil'),
      [0, 20, 40, 60, 80, 100],
    ), 'putty')
    const confidence = build(proteinFixture(
      new Array(6).fill('coil'),
      [0, 20, 40, 60, 80, 100],
      () => 1,
      'plddt',
    ), 'putty')
    const lastRing = (6 - 1) * 4
    expect(ringRadius(temperature, lastRing)).toBeGreaterThan(ringRadius(temperature, 0) * 3)
    expect(ringRadius(confidence, 0)).toBeGreaterThan(ringRadius(confidence, lastRing) * 3)
  })

  it('clamps quality to the same 4–24 range exposed by state and UI', () => {
    const structure = proteinFixture()
    const minimum = build(structure, 'tube', -100)
    const maximum = build(structure, 'tube', 100)
    expect(minimum.positions.length / 3).toBe((5 * 4 + 1) * PROFILE_SEGMENTS + 50)
    expect(maximum.positions.length / 3).toBe((5 * 24 + 1) * PROFILE_SEGMENTS + 50)
  })
})
