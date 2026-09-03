// Correctness of display-position and scalar-range caches.
//
// These caches remove per-atom O(N^2) scene work and must not alter observable results. Identical
// inputs must hit exactly, while any changed input must invalidate stale display state.

import { describe, expect, it, beforeEach } from 'vitest'
import {
  __clearDisplayPositionCache,
  __computeDisplayPositionsForTest,
} from '../ui/components/crystal-viewer/use-display-positions'
import { scalarRange, scalarRangeCached } from '../lib/viz/trajectory-color'

// LatticeLike and PeriodicMask use named {a,b,c} axes rather than tuples.
const LATTICE = {
  a: [10, 0, 0] as [number, number, number],
  b: [0, 10, 0] as [number, number, number],
  c: [0, 0, 10] as [number, number, number],
}
const FULLY_PERIODIC = { a: true, b: true, c: true }

function atom(id: string, cartesian: [number, number, number], scalars?: Record<string, number>) {
  // Props use AuxValue wrappers; raw numbers are not readable by this path.
  const props = scalars
    ? Object.fromEntries(
        Object.entries(scalars).map(([k, v]) => [k, { kind: 'scalar' as const, value: v }]),
      )
    : undefined
  return { id, element: 'C', cartesian, position: cartesian, props }
}

// A two-atom boundary-crossing chain requires unwrap to move the second atom into an image.
function splitPair() {
  return {
    atoms: [atom('a', [0.5, 0.5, 0.5]), atom('b', [9.5, 0.5, 0.5])],
    bonds: [{ id: 'ab', atom1Id: 'a', atom2Id: 'b' }],
  }
}

function baseInputs() {
  const { atoms, bonds } = splitPair()
  return {
    atoms,
    bonds,
    cellOverflowMode: 'wrap',
    wholeMolecules: true,
    periodic: true,
    latticeVectors: LATTICE,
    periodicDirs: FULLY_PERIODIC,
    draggingAtomId: null,
  } as Parameters<typeof __computeDisplayPositionsForTest>[0]
}

function snapshot(map: Map<string, [number, number, number]> | null) {
  if (!map) return null
  return [...map.entries()].map(([id, p]) => `${id}:${p.map((v) => v.toFixed(4)).join(',')}`).sort()
}

describe('display position cache', () => {
  beforeEach(() => {
    __clearDisplayPositionCache()
  })

  it('returns an identical result for repeated identical inputs', () => {
    const inputs = baseInputs()
    const first = __computeDisplayPositionsForTest(inputs)
    const second = __computeDisplayPositionsForTest(inputs)
    // Reference identity proves identical input hit the cache without recomputation.
    expect(second).toBe(first)
    expect(snapshot(first)).toEqual(snapshot(second))
  })

  it('recomputes when any input changes', () => {
    const inputs = baseInputs()
    const withWholeMolecules = __computeDisplayPositionsForTest(inputs)
    expect(snapshot(withWholeMolecules)).not.toBeNull()

    // Disabling whole-molecule display removes offsets and must return null instead of stale data.
    const withoutWholeMolecules = __computeDisplayPositionsForTest({
      ...inputs,
      wholeMolecules: false,
    })
    expect(withoutWholeMolecules).toBeNull()

    // Returning to the original input must recover its correct cached result.
    expect(snapshot(__computeDisplayPositionsForTest(inputs))).toEqual(snapshot(withWholeMolecules))
  })

  it('recomputes when the atom array identity changes', () => {
    const inputs = baseInputs()
    __computeDisplayPositionsForTest(inputs)

    // Editing moves the atom away from the boundary and supplies a new array reference.
    const moved = {
      ...inputs,
      atoms: [atom('a', [0.5, 0.5, 0.5]), atom('b', [1.9, 0.5, 0.5])],
    }
    const afterEdit = __computeDisplayPositionsForTest(moved)
    // Adjacent atoms need no unwrap offset and must not reuse the previous image position.
    expect(snapshot(afterEdit)).not.toEqual(snapshot(__computeDisplayPositionsForTest(inputs)))
  })

  it('keeps distinct concurrent input sets addressable', () => {
    // Main, semantic-layer, and image inputs in one frame must remain independently addressable.
    const a = baseInputs()
    const b = { ...baseInputs(), draggingAtomId: 'a' }
    const resultA = __computeDisplayPositionsForTest(a)
    const resultB = __computeDisplayPositionsForTest(b)
    expect(__computeDisplayPositionsForTest(a)).toBe(resultA)
    expect(__computeDisplayPositionsForTest(b)).toBe(resultB)
  })
})

describe('scalarRangeCached', () => {
  it('matches the uncached range and invalidates on input change', () => {
    const atoms = [atom('a', [0, 0, 0], { charge: -1 }), atom('b', [1, 0, 0], { charge: 3 })]
    expect(scalarRangeCached(atoms, 'charge')).toEqual(scalarRange(atoms, 'charge'))

    // A new frame array must recompute range so colors do not remain locked to the previous frame.
    const nextFrame = [atom('a', [0, 0, 0], { charge: 10 }), atom('b', [1, 0, 0], { charge: 20 })]
    expect(scalarRangeCached(nextFrame, 'charge')).toEqual(scalarRange(nextFrame, 'charge'))
    expect(scalarRangeCached(nextFrame, 'charge')).not.toEqual(scalarRange(atoms, 'charge'))
  })

  it('keys on the property name', () => {
    const atoms = [
      atom('a', [0, 0, 0], { charge: -1, force: 5 }),
      atom('b', [1, 0, 0], { charge: 3, force: 9 }),
    ]
    expect(scalarRangeCached(atoms, 'charge')).toEqual([-1, 3])
    // A different property name must not hit the charge entry for the same atoms.
    expect(scalarRangeCached(atoms, 'force')).toEqual([5, 9])
  })
})
