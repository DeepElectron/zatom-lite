import { describe, expect, it } from 'vitest'
import { createCrystalStore } from '../crystalStore'
import { cartesianToFractional } from '../../lib/crystal/lattice'
import { generateSupercell, scaleLatticeVectorsForSupercell } from '../../lib/crystal/supercell-utils'
import { __computeDisplayImagesForTest } from '../../ui/components/crystal-viewer/use-display-image-offsets'
import { displayPositionOf } from '../../lib/crystal/cell-overflow'
import type { Atom, LatticeVectors } from '../../lib/crystal/types'
import { createStructureAssetFrame } from '../record-structure-asset'

const lattice: LatticeVectors = { a: [10, 0, 0], b: [0, 10, 0], c: [0, 0, 10] }
function fixture(nx = 1) {
  const s = createCrystalStore()
  const unit: Atom[] = [{ id: 'site', element: 'Pt', position: [.2, .2, .3] }]
  const params = { nx, ny: 1, nz: 1 }
  s.setState({ periodic: true, periodicDirs: { a: true, b: true, c: true }, crystalSystem: 'orthorhombic',
    latticeParams: { a: 10, b: 10, c: 10, alpha: 90, beta: 90, gamma: 90 }, latticeVectors: lattice,
    supercellParams: params, unitCellAtoms: unit, atoms: generateSupercell(unit, params, lattice),
    cellOverflowMode: 'fold-in', supercellMode: 'normal', bonds: [],
  })
  return s
}

describe('supercell and boundary rules compose without changing unrelated science', () => {
  it('Normal preserves existing atom identity, substitutions and displacements', () => {
    const s = fixture(2)
    const edited = { ...s.getState().atoms[1], element: 'Mg', cartesian: [13, 2, 3] as [number, number, number] }
    s.setState({ atoms: [s.getState().atoms[0], edited] })
    s.getState().setSupercellParams({ nx: 3 })
    expect(s.getState().atoms).toHaveLength(3)
    expect(s.getState().atoms.find(a => a.id === edited.id)).toMatchObject({element: 'Mg', cartesian: [13, 2, 3]})
    s.getState().undo()
    expect(s.getState().supercellParams.nx).toBe(2)
    expect(s.getState().atoms[1]).toEqual(edited)
  })

  it('editing lattice parameters after expansion deforms edited sites without rebuilding pristine ones', () => {
    const s = fixture(2)
    const edited = {...s.getState().atoms[1], element: 'Mg', cartesian: [13, 2, 3] as [number, number, number]}
    s.setState({atoms: [edited]}) // The first cell has an intentional vacancy.
    s.getState().setLatticeParams({a: 12})
    expect(s.getState().atoms).toHaveLength(1)
    expect(s.getState().atoms[0].id).toBe(edited.id)
    expect(s.getState().atoms[0].element).toBe('Mg')
    expect(s.getState().atoms[0].cartesian![0]).toBeCloseTo(15.6)
    s.getState().undo()
    expect(s.getState().atoms).toEqual([edited])
  })

  it('Fork rejects non-doubling dimensions before changing the cell or history', () => {
    const s = fixture(2)
    s.setState({ supercellMode: 'fork' })
    const before = s.getState()
    s.getState().setSupercellParams({ nx: 3 })
    expect(s.getState().supercellParams).toEqual(before.supercellParams)
    expect(s.getState().atoms).toBe(before.atoms)
    expect(s.getState().history).toBe(before.history)
  })

  it('expansion of an unwrapped unit basis produces distinct sites, not overlapping boundary copies', () => {
    const s = fixture()
    const unit: Atom[] = [{id: 'site', element: 'Pt', position: [-.1, .2, .3]}]
    s.setState({unitCellAtoms: unit, atoms: generateSupercell(unit, s.getState().supercellParams, lattice)})
    s.getState().setCellOverflowMode('fold-in')
    s.getState().setSupercellParams({nx: 2})
    expect(s.getState().atoms.map(a => a.cartesian![0]).sort((a, b) => a - b)).toEqual([9, 19])
  })

  it('folding never moves atoms along an open slab axis or grows that cell', () => {
    const s = fixture()
    s.setState({ periodicDirs: { a: true, b: true, c: false }, atoms: [{id: 'site', element: 'Pt', position: [12, 2, -3], cartesian: [12, 2, -3]}] })
    s.getState().setCellOverflowMode('fold-in')
    expect(s.getState().atoms[0].cartesian).toEqual([2, 2, -3])
    expect(s.getState().latticeVectors).toEqual(lattice)
  })

  it('boundary edits retain normalized supercell fractional coordinates', () => {
    const s = fixture(2)
    s.setState({ atoms: [{id: 'site', element: 'Pt', position: [21, 2, 3], cartesian: [21, 2, 3]}] })
    s.getState().setCellOverflowMode('fold-in')
    const state = s.getState(), atom = state.atoms[0]
    const expected = cartesianToFractional(atom.cartesian!, scaleLatticeVectorsForSupercell(state.latticeVectors, state.supercellParams))
    atom.position.forEach((v, i) => expect(v).toBeCloseTo(expected[i]))
  })

  it('supercell Images uses identical tiles during a drag and after release', () => {
    const s = fixture(2)
    const dragged: Atom = {id: 'site', element: 'Pt', position: [12, 2, 3], cartesian: [12, 2, 3]}
    const input = { atoms: [dragged], periodic: true, latticeVectors: lattice, periodicDirs: s.getState().periodicDirs,
      supercellParams: s.getState().supercellParams, showPeriodicImages: false, cellOverflowMode: 'tile-images' as const, draggingAtomId: 'site' }
    const dragging = __computeDisplayImagesForTest(input)
    s.setState({ atoms: [dragged] })
    s.getState().setCellOverflowMode('tile-images')
    const released = __computeDisplayImagesForTest({...input, atoms: s.getState().atoms, draggingAtomId: null})
    expect(dragging.effectiveImages).toEqual(released.effectiveImages)
    expect(dragging.tiling).toEqual(released.tiling)
  })

  it('Fork preserves explicit periodic bond orders and routes endpoints across the expanded box', () => {
    const s = fixture()
    const marker = { 'zatom.explicitBondTopology': {kind: 'scalar' as const, value: 1} }
    s.setState({supercellMode: 'fork', atoms: [
      {id: 'a', element: 'C', position: [.05, .2, .3], cartesian: [.5, 2, 3], props: marker},
      {id: 'b', element: 'C', position: [.95, .2, .3], cartesian: [9.5, 2, 3], props: marker},
    ], bonds: [{id: 'declared', atom1Id: 'a', atom2Id: 'b', type: 'triple', latticeOffset: [-1, 0, 0], length: 1}]})
    s.getState().setSupercellParams({nx: 2})
    const state = s.getState(), box = scaleLatticeVectorsForSupercell(state.latticeVectors, state.supercellParams)
    expect(state.atoms).toHaveLength(4)
    expect(state.bonds).toHaveLength(2)
    for (const bond of state.bonds) {
      expect(bond.type).toBe('triple')
      expect(bond.length).toBeCloseTo(1)
      const a = state.atoms.find(a => a.id === bond.atom1Id)!.cartesian!
      const b = state.atoms.find(a => a.id === bond.atom2Id)!.cartesian!
      const offset = bond.latticeOffset ?? [0, 0, 0]
      expect(Math.abs(b[0] + offset[0] * box.a[0] - a[0])).toBeCloseTo(1)
    }
    const frame = createStructureAssetFrame('test', 'Fork audit', 'editor', state.atoms, state.bonds,
      state.periodic, state.latticeVectors, state.latticeParams, state.supercellParams)
    expect(frame.atoms).toHaveLength(4)
    expect(frame.latticeMatrix![0][0]).toBe(20)
    expect(frame.bonds!.map(b => b.type)).toEqual(['triple', 'triple'])
  })

  it('Normal refuses to replace explicit topology with distance-inferred bonds', () => {
    const s = fixture()
    s.setState({atoms: s.getState().atoms.map(a => ({...a, props: {'zatom.explicitBondTopology': {kind: 'scalar', value: 1}}}))})
    const before = s.getState()
    s.getState().setSupercellParams({nx: 2})
    expect(s.getState().atoms).toBe(before.atoms)
    expect(s.getState().supercellParams).toBe(before.supercellParams)
  })

  it('dragging an existing image preserves declared bonds when it folds into the source cell', () => {
    const s = fixture()
    const props = {'zatom.explicitBondTopology': {kind: 'scalar' as const, value: 1}}
    s.setState({cellOverflowMode: 'tile-images', atoms: [
      {id: 'a', element: 'C', position: [.2, .2, .3], cartesian: [2, 2, 3], displayImage: [1, 0, 0], props},
      {id: 'b', element: 'C', position: [.4, .2, .3], cartesian: [4, 2, 3], props},
    ], bonds: [{id: 'bond', atom1Id: 'a', atom2Id: 'b', type: 'double', length: 2}]})
    s.getState().updateAtomPosition('a', [13, 2, 3])
    s.getState().applyBoundaryToAtoms(['a'])
    expect(s.getState().atoms[0].cartesian).toEqual([3, 2, 3])
    expect(s.getState().atoms[0].displayImage).toEqual([1, 0, 0])
    expect(s.getState().bonds[0]).toMatchObject({id: 'bond', type: 'double', length: 1})
  })

  it('an undone large expansion cannot publish its delayed atoms or dimensions', async () => {
    const s = fixture()
    s.setState({unitCellAtoms: Array.from({length: 2000}, (_, i) => ({id: `u${i}`, element: 'Pt', position: [0, 0, 0]}))})
    s.getState().setSupercellParams({nx: 2})
    expect(s.getState().structureProcessing.active).toBe(true)
    expect(s.getState().supercellParams.nx).toBe(1)
    s.getState().undo()
    const undone = s.getState().atoms
    await Promise.resolve()
    expect(s.getState().supercellParams.nx).toBe(1)
    expect(s.getState().atoms).toBe(undone)
    expect(s.getState().structureProcessing.active).toBe(false)
  })

  it('expanding Images materializes independent sites instead of duplicating an old display image', () => {
    const s = fixture()
    s.setState({ atoms: [{...s.getState().atoms[0], cartesian: [12, 2, 3]}] })
    s.getState().setCellOverflowMode('tile-images')
    s.getState().setSupercellParams({ nx: 2 })
    const state = s.getState(), atom = state.atoms.find(a => a.id === 'site')!
    expect(atom).toBeDefined()
    expect(displayPositionOf(atom.cartesian!, atom.displayImage, state.latticeVectors)[0]).toBeCloseTo(2)
    expect(state.atoms.map(a => a.cartesian![0]).sort((a, b) => a - b)).toEqual([2, 12])
    expect(atom.displayImage).toBeUndefined()
  })
})
