import { describe, expect, it } from 'vitest'
import { analyzeLocalEnvironment } from '../../agent/local-environment'
import { readViewportStructure } from '../../agent/viewer-context'
import type { Vec3 } from '../../agent/contracts'
import type { Atom } from '../../lib/crystal/types'
import { cartesianToFractional } from '../../lib/crystal/lattice'
import { createCrystalStore } from '../crystalStore'
import { CELL_OVERFLOW_MODES, displayPositionOf, splitIntoCellImage } from '../../lib/crystal/cell-overflow'

function fixture() {
  const store = createCrystalStore()
  store.setState({ periodic: true, periodicDirs: { a: true, b: true, c: true },
    latticeParams: { a: 10, b: 10, c: 10, alpha: 90, beta: 90, gamma: 90 },
    latticeVectors: { a: [10,0,0], b: [0,10,0], c: [0,0,10] },
    supercellParams: { nx: 1, ny: 1, nz: 1 }, cellOverflowMode: 'fold-in',
    atoms: [{id:'a',element:'Pt',position:[-1,2,3],cartesian:[-1,2,3]},
      {id:'b',element:'Pt',position:[2,2,3],cartesian:[2,2,3]}], bonds: [],
  })
  return store
}
describe('overflow modes on imported coordinates',()=>{
  it('applies Fold in even when already selected, then allows undo',()=>{
    const s=fixture();s.getState().setCellOverflowMode('fold-in')
    expect(s.getState().atoms[0].cartesian).toEqual([9,2,3])
    expect(s.getState().latticeParams.a).toBe(10)
    s.getState().undo()
    expect(s.getState().atoms[0].cartesian).toEqual([-1,2,3])
  })
  it('Images stores a canonical position and Fold in removes only the displayed offset',()=>{
    const s=fixture();s.getState().setCellOverflowMode('tile-images')
    const a=s.getState().atoms[0]
    expect(a.cartesian).toEqual([9,2,3]);expect(a.displayImage).toEqual([-1,0,0])
    expect(displayPositionOf(a.cartesian!,a.displayImage,s.getState().latticeVectors)).toEqual([-1,2,3])
    s.getState().setCellOverflowMode('fold-in')
    expect(s.getState().atoms[0].cartesian).toEqual([9,2,3])
    expect(s.getState().atoms[0].displayImage).toBeUndefined()
    s.getState().undo()
    expect(s.getState().cellOverflowMode).toBe('tile-images')
    expect(s.getState().atoms[0].displayImage).toEqual([-1, 0, 0])
  })
  it('uses supercell-sized offsets and preserves the displayed position', () => {
    const s = fixture()
    s.setState({ supercellParams: { nx: 2, ny: 1, nz: 1 } })
    s.getState().setCellOverflowMode('tile-images')
    const a = s.getState().atoms[0]
    expect(a.cartesian![0]).toBeCloseTo(19)
    expect(a.displayImage).toEqual([-2, 0, 0])
    expect(displayPositionOf(a.cartesian!, a.displayImage, s.getState().latticeVectors)[0]).toBeCloseTo(-1)
  })
  it('preserves explicit bond identity, order and length through folding', () => {
    const s = fixture()
    s.setState({ atoms: s.getState().atoms.map(a => ({...a, props: {
      'zatom.explicitBondTopology': {kind: 'scalar' as const, value: 1},
    }})), bonds: [{id: 'bond', atom1Id: 'a', atom2Id: 'b', type: 'double', length: 3}] })
    s.getState().setCellOverflowMode('tile-images')
    s.getState().setCellOverflowMode('fold-in')
    expect(s.getState().bonds).toHaveLength(1)
    expect(s.getState().bonds[0]).toMatchObject({id: 'bond', type: 'double', latticeOffset: [1, 0, 0]})
    expect(s.getState().bonds[0].length).toBeCloseTo(3)
  })
  it('does not create a neighboring tile from skew-cell roundoff',()=>{
    const r=splitIntoCellImage([4,7,3],{a:[8,0,0],b:[4,7,0],c:[0,0,25]})
    expect(r.image).toEqual([0,1,0])
  })
})

// A skew 3×3 four-layer FCC(111) slab. Shift individual sites by whole cells
// to reproduce imported outside coordinates without changing the crystal.
function ptSlabFixture() {
  const s = createCrystalStore()
  const d = 2.771858582251266, bY = d * Math.sqrt(3) / 2
  const vectors = { a: [3 * d, 0, 0] as Vec3, b: [1.5 * d, 3 * bY, 0] as Vec3, c: [0, 0, 25] as Vec3 }
  const atoms: Atom[] = []
  for (let layer = 0; layer < 4; layer++) {
    for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) {
      const id = atoms.length, stack = layer % 3
      const image = id % 7 === 0 ? -1 : 0
      const cartesian: Vec3 = [d * (i + j / 2 + stack / 2) + image * vectors.a[0],
        bY * (j + stack / 3), 9 + layer * d * Math.sqrt(2 / 3)]
      atoms.push({id: `pt-${id}`, element: 'Pt', cartesian, position: cartesianToFractional(cartesian, vectors)})
    }
  }
  s.setState({ periodic: true, periodicDirs: {a: true, b: true, c: true},
    latticeVectors: vectors, latticeParams: {a: 3 * d, b: 3 * d, c: 25, alpha: 90, beta: 90, gamma: 60},
    supercellParams: {nx: 1, ny: 1, nz: 1}, cellOverflowMode: 'fold-in',
    atoms, unitCellAtoms: atoms, bonds: [],
  })
  return s
}

function ptEnvironment(s: ReturnType<typeof createCrystalStore>) {
  return analyzeLocalEnvironment({structure: readViewportStructure(s)!, cutoffA: 3.3, periodic: true,
    neighborElements: ['Pt'], minimumCoordination: 9, maximumCoordination: 12})
}

it('all periodic modes preserve the cell and the complete Pt neighbor graph through folding and supercell expansion', () => {
  for (const mode of CELL_OVERFLOW_MODES) {
    const s = ptSlabFixture(), original = s.getState()
    const before = ptEnvironment(s)
    expect(before.statistics.coordinationHistogram).toEqual({'9': 18, '12': 18})
    s.getState().setCellOverflowMode(mode)
    s.getState().setShowPeriodicImages(true)
    const after = ptEnvironment(s)
    expect(s.getState().latticeVectors).toEqual(original.latticeVectors)
    expect(s.getState().latticeParams).toEqual(original.latticeParams)
    expect(after.statistics).toEqual(before.statistics)
    after.centers.forEach((center, i) => {
      const signature = (c: typeof center) => c.neighbors.map(n => `${n.atomId}:${n.distanceA.toFixed(8)}`).sort()
      expect(signature(center)).toEqual(signature(before.centers[i]))
    })
    // Both legitimate expansion paths must replicate independent sites while
    // maintaining the physical neighborhood at the new periodic boundary.
    for (const expansion of ['normal', 'fork'] as const) {
      s.setState({supercellMode: expansion})
      s.getState().setSupercellParams({nx: 2})
      expect(s.getState().atoms).toHaveLength(72)
      expect(ptEnvironment(s).statistics.coordinationHistogram).toEqual({'9': 36, '12': 36})
      s.getState().undo()
      expect(s.getState().atoms).toHaveLength(36)
    }
  }
})


it('merging an outside fragment uses the selected image without resizing the periodic cell', () => {
  for (const mode of CELL_OVERFLOW_MODES) {
    const s = fixture()
    s.setState({cellOverflowMode: mode})
    const lattice = s.getState().latticeVectors
    s.getState().startMergePlacement('H', [{element: 'H', cartesian: [12, 4, 3]}], [12, 4, 3])
    s.getState().confirmMergePlacement()
    const added = s.getState().atoms.find(atom => atom.element === 'H')!
    added.cartesian!.forEach((value, axis) => expect(value).toBeCloseTo([2, 4, 3][axis], 10))
    const displayed = displayPositionOf(added.cartesian!, added.displayImage, lattice)
    const expected = mode === 'tile-images' ? [12, 4, 3] : [2, 4, 3]
    displayed.forEach((value, axis) => expect(value).toBeCloseTo(expected[axis], 10))
    expect(s.getState().latticeVectors).toEqual(lattice)
    s.getState().undo()
    expect(s.getState().atoms).toHaveLength(2)
  }
})
