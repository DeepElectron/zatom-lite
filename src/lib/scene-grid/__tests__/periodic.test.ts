import { describe, expect, it } from 'vitest'

import { ZATOM_STRUCTURE_SCHEMA, type ZatomStructure } from '../../../agent/contracts'
import {
  analyzePeriodicScaffold,
  analyzeSlabLayering,
  cellIndex,
  cellOffset,
  minimumImageDelta,
} from '../periodic'

type Vec3 = [number, number, number]

const build = (
  atoms: { element: string; position: Vec3 }[],
  vectors: [Vec3, Vec3, Vec3],
  periodic: [boolean, boolean, boolean] = [true, true, true],
): ZatomStructure => ({
  schemaVersion: ZATOM_STRUCTURE_SCHEMA,
  atoms: atoms.map((a, i) => ({ id: `a${i}`, element: a.element, position: a.position })),
  lattice: { vectors, periodic },
})

/** Simple-cubic supercell: one atom per primitive cell of edge `edge`. */
const cubicSupercell = (na: number, nb: number, nc: number, edge = 4, element = 'Cu') => {
  const atoms: { element: string; position: Vec3 }[] = []
  for (let i = 0; i < na; i++) {
    for (let j = 0; j < nb; j++) {
      for (let k = 0; k < nc; k++) {
        atoms.push({ element, position: [i * edge, j * edge, k * edge] })
      }
    }
  }
  return build(atoms, [
    [na * edge, 0, 0],
    [0, nb * edge, 0],
    [0, 0, nc * edge],
  ])
}

describe('rounding primitives', () => {
  it('cellIndex floors so that cells tile the axis', () => {
    expect(cellIndex(1.3)).toBe(1)
    expect(cellIndex(0.9)).toBe(0)
    // The case Math.round would get wrong: a negative coordinate belongs to the
    // cell below, not to cell 0.
    expect(cellIndex(-0.2)).toBe(-1)
    expect(cellIndex(1.6)).toBe(1)
  })

  it('cellOffset wraps negatives into [0,1)', () => {
    expect(cellOffset(0.25)).toBeCloseTo(0.25)
    // A bare `f % 1` returns -0.2 here and would compare unequal to 0.8.
    expect(cellOffset(-0.2)).toBeCloseTo(0.8)
    expect(cellOffset(2.75)).toBeCloseTo(0.75)
  })

  it('minimumImageDelta rounds so boundary-straddling atoms stay close', () => {
    // 0.9 cells apart one way is 0.1 cells apart the other way.
    expect(minimumImageDelta(0.9)).toBeCloseTo(-0.1)
    expect(minimumImageDelta(-0.9)).toBeCloseTo(0.1)
    expect(minimumImageDelta(0.4)).toBeCloseTo(0.4)
    expect(Math.abs(minimumImageDelta(0.5))).toBeCloseTo(0.5)
  })

  it('the two rules genuinely differ, which is why both exist by name', () => {
    // If these agreed there would be no bug to guard against.
    expect(cellIndex(0.9)).not.toBe(Math.round(0.9))
    expect(Math.abs(minimumImageDelta(0.9))).toBeLessThan(0.9)
  })
})

describe('analyzePeriodicScaffold', () => {
  it('reports a primitive cell as unrepeated', () => {
    const result = analyzePeriodicScaffold(cubicSupercell(1, 1, 1))
    expect(result?.repeats).toEqual([1, 1, 1])
    expect(result?.isSupercell).toBe(false)
    expect(result?.cellCount).toBe(1)
  })

  it('detects an anisotropic supercell per axis', () => {
    const result = analyzePeriodicScaffold(cubicSupercell(2, 1, 3))
    expect(result?.repeats).toEqual([2, 1, 3])
    expect(result?.cellCount).toBe(6)
    expect(result?.unmatchedAtomIds).toEqual([])
  })

  it('reports the largest multiplicity, not a divisor of it', () => {
    // A 1/4 translation being a symmetry implies 1/2 is too, so taking the
    // smallest working n would understate a 4x supercell as 2x.
    const result = analyzePeriodicScaffold(cubicSupercell(4, 4, 4))
    expect(result?.repeats).toEqual([4, 4, 4])
    expect(result?.cellCount).toBe(64)
  })

  it('detects the supercell and the vacancy together', () => {
    const structure = cubicSupercell(4, 4, 4)
    const removedAtom = structure.atoms[21]
    const removed = removedAtom.id
    const withVacancy: ZatomStructure = {
      ...structure,
      atoms: structure.atoms.filter((a) => a.id !== removed),
    }
    const result = analyzePeriodicScaffold(withVacancy)
    // Periodicity survives a single defect...
    expect(result?.repeats).toEqual([4, 4, 4])
    // ...and the atoms that can no longer find a partner are reported.
    expect(result?.unmatchedAtomIds.length).toBeGreaterThan(0)
    expect(result?.reason).toContain('break it')
    const vacancy = result?.missingSiteCandidates[0]
    expect(vacancy?.element).toBe('Cu')
    expect(vacancy?.supportingAxes).toEqual(['a', 'b', 'c'])
    expect(vacancy?.confidence).toBe(1)
    expect(vacancy?.position).toEqual(removedAtom.position)
  })

  it('does not fold a two-element lattice onto itself', () => {
    // Rock-salt style alternation: a 1/2 shift maps Na onto Cl. That is not a
    // translation symmetry, and ignoring the element would report 2x.
    const structure = build(
      [
        { element: 'Na', position: [0, 0, 0] },
        { element: 'Cl', position: [4, 0, 0] },
      ],
      [
        [8, 0, 0],
        [0, 4, 0],
        [0, 0, 4],
      ],
    )
    expect(analyzePeriodicScaffold(structure)?.repeats).toEqual([1, 1, 1])
  })

  it('works on a non-orthogonal cell', () => {
    // Monoclinic-ish: b is tilted into x. A transposed inverse would leak the
    // tilt into the wrong fractional component and lose the symmetry.
    const edge = 4
    const atoms: { element: string; position: Vec3 }[] = []
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 2; j++) {
        atoms.push({ element: 'Cu', position: [i * edge + j * 1.5, j * edge, 0] })
      }
    }
    const structure = build(atoms, [
      [2 * edge, 0, 0],
      [3, 2 * edge, 0],
      [0, 0, edge],
    ])
    const result = analyzePeriodicScaffold(structure)
    expect(result?.repeats[0]).toBe(2)
    expect(result?.repeats[1]).toBe(2)
  })

  it('finds atoms across a periodic boundary', () => {
    // An atom at fractional 0.999 must match one at 0.001 of the next image.
    const structure = build(
      [
        { element: 'Cu', position: [0.004, 0, 0] },
        { element: 'Cu', position: [4.0, 0, 0] },
      ],
      [
        [8, 0, 0],
        [0, 4, 0],
        [0, 0, 4],
      ],
    )
    expect(analyzePeriodicScaffold(structure)?.repeats[0]).toBe(2)
  })

  it('ignores aperiodic axes rather than inventing symmetry along them', () => {
    const structure = cubicSupercell(2, 2, 2)
    const slab: ZatomStructure = {
      ...structure,
      lattice: { vectors: structure.lattice!.vectors, periodic: [true, true, false] },
    }
    const result = analyzePeriodicScaffold(slab)
    expect(result?.repeats).toEqual([2, 2, 1])
  })

  it('returns null without a usable lattice', () => {
    const noLattice: ZatomStructure = {
      schemaVersion: ZATOM_STRUCTURE_SCHEMA,
      atoms: [{ id: 'a0', element: 'C', position: [0, 0, 0] }],
    }
    expect(analyzePeriodicScaffold(noLattice)).toBeNull()
    const degenerate = build([{ element: 'C', position: [0, 0, 0] }], [
      [0, 0, 0],
      [0, 4, 0],
      [0, 0, 4],
    ])
    expect(analyzePeriodicScaffold(degenerate)).toBeNull()
  })
})

describe('analyzeSlabLayering', () => {
  const slab = (positions: Vec3[], c: Vec3 = [0, 0, 20]): ZatomStructure =>
    build(
      positions.map((p) => ({ element: 'Pt', position: p })),
      [[4, 0, 0], [0, 4, 0], c],
      [true, true, false],
    )

  it('groups atoms into layers and measures spacing', () => {
    const result = analyzeSlabLayering(
      slab([
        [0, 0, 0], [2, 2, 0],
        [0, 0, 2], [2, 2, 2],
        [0, 0, 4], [2, 2, 4],
      ]),
    )
    expect(result?.layers).toHaveLength(3)
    expect(result?.medianSpacing).toBeCloseTo(2, 5)
    expect(result?.axis).toBe(2)
    expect(result?.layers[0].atomIds).toHaveLength(2)
  })

  it('measures along the surface normal, not the tilted c vector', () => {
    // One flat layer at z=0, spread in x. Projecting onto a c tilted into x
    // would spread it over ~1 A and split the layer in two.
    const result = analyzeSlabLayering(
      slab([[0, 0, 0], [4, 0, 0], [8, 0, 0]], [5, 0, 20]),
    )
    expect(result?.layers).toHaveLength(1)
    expect(result?.layers[0].atomIds).toHaveLength(3)
  })

  it('tolerates in-layer corrugation without splitting', () => {
    // A relaxed surface buckles by a fraction of an Angstrom; that is one layer.
    const result = analyzeSlabLayering(
      slab([[0, 0, 0], [2, 2, 0.3], [0, 2, -0.25], [0, 0, 2.1]]),
    )
    expect(result?.layers).toHaveLength(2)
    expect(result?.layers[0].atomIds).toHaveLength(3)
  })

  it('returns null when layering is not the right description', () => {
    // Fully periodic bulk has no surface.
    expect(analyzeSlabLayering(cubicSupercell(2, 2, 2))).toBeNull()
    // Two aperiodic axes is a wire, which needs a different decomposition.
    const wire = build([{ element: 'C', position: [0, 0, 0] }], [
      [4, 0, 0],
      [0, 4, 0],
      [0, 0, 4],
    ], [true, false, false])
    expect(analyzeSlabLayering(wire)).toBeNull()
  })
})
