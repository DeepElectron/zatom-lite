import { describe, expect, it, vi } from 'vitest'
import { parseLegacyPdb } from '../lib/biomolecule/pdb'
import { dispatchExactAtomClick } from '../lib/measurement/atom-click-dispatch'
import { createCrystalStore } from '../orchestration/crystalStore'

function atomLine(options: {
  serial: number
  name: string
  x: number
  y: number
  z: number
}): string {
  const coordinate = (value: number) => value.toFixed(3).padStart(8)
  return [
    'ATOM  ', String(options.serial).padStart(5), ' ', options.name.padStart(4),
    ' ', 'ALA', ' ', 'A', String(options.serial).padStart(4), '    ',
    coordinate(options.x), coordinate(options.y), coordinate(options.z),
    '  1.00', '  0.00', '          ', options.name === 'N' ? ' N' : ' C',
  ].join('')
}

const FRAME_ONE = [
  atomLine({ serial: 1, name: 'N', x: 0, y: 0, z: 0 }),
  atomLine({ serial: 2, name: 'CA', x: 1, y: 0, z: 0 }),
  atomLine({ serial: 3, name: 'C', x: 1, y: 1, z: 0 }),
  atomLine({ serial: 4, name: 'CB', x: 2, y: 1, z: 0 }),
]

const FRAME_TWO = [
  atomLine({ serial: 1, name: 'N', x: 0, y: 0, z: 0 }),
  atomLine({ serial: 2, name: 'CA', x: 2, y: 0, z: 0 }),
  atomLine({ serial: 3, name: 'C', x: 2, y: 2, z: 0 }),
  atomLine({ serial: 4, name: 'CB', x: 2, y: 2, z: 2 }),
]

const MULTI_MODEL_PDB = [
  'MODEL        1', ...FRAME_ONE, 'ENDMDL',
  'MODEL        2', ...FRAME_TWO, 'ENDMDL', 'END',
].join('\n')

function measure(mode: 'distance' | 'angle' | 'dihedral', count: number) {
  const store = createCrystalStore()
  store.getState().loadBiomolecule(parseLegacyPdb(MULTI_MODEL_PDB, { id: 'measure', inferBonds: false }))
  store.getState().setTrajectoryFrame(1)
  store.getState().setMeasurementMode(mode)
  const atomIds = store.getState().atoms.slice(0, count).map((atom) => atom.id)
  for (const atomId of atomIds) store.getState().addMeasurementAtom(atomId)
  return { store, atomIds }
}

describe('biomolecule exact-atom measurement', () => {
  it.each([
    ['distance', 2, 2],
    ['angle', 3, 90],
    ['dihedral', 4, -90],
  ] as const)('creates a %s from the active MODEL coordinates', (mode, count, expected) => {
    const { store, atomIds } = measure(mode, count)
    expect(store.getState().trajectoryCurrentFrame).toBe(1)
    expect(store.getState().measurements).toEqual([expect.objectContaining({
      type: mode,
      atomIds,
      value: expected,
    })])
    expect(store.getState().pendingMeasurementAtoms).toEqual([])
  })

  it('routes measurement before a biomolecule residue-pick override', () => {
    const addMeasurementAtom = vi.fn()
    const promotedPick = vi.fn()
    const result = dispatchExactAtomClick({
      measurementActive: true,
      atomId: 'atom-17',
      event: { kind: 'click' },
      atom: { id: 'atom-17' },
      addMeasurementAtom,
      onAtomClick: promotedPick,
    })
    expect(result).toBe('measurement')
    expect(addMeasurementAtom).toHaveBeenCalledOnce()
    expect(addMeasurementAtom).toHaveBeenCalledWith('atom-17')
    expect(promotedPick).not.toHaveBeenCalled()
  })

  it('keeps the biomolecule presentation picker when measurement is inactive', () => {
    const addMeasurementAtom = vi.fn()
    const promotedPick = vi.fn()
    const result = dispatchExactAtomClick({
      measurementActive: false,
      atomId: 'atom-17',
      event: { kind: 'click' },
      atom: { id: 'atom-17' },
      addMeasurementAtom,
      onAtomClick: promotedPick,
    })
    expect(result).toBe('override')
    expect(addMeasurementAtom).not.toHaveBeenCalled()
    expect(promotedPick).toHaveBeenCalledOnce()
  })

  it('ignores inactive-mode and unknown atom ids at the store boundary', () => {
    const store = createCrystalStore()
    store.getState().loadBiomolecule(parseLegacyPdb(MULTI_MODEL_PDB, { id: 'guard', inferBonds: false }))
    const atomId = store.getState().atoms[0].id
    store.getState().addMeasurementAtom(atomId)
    expect(store.getState().pendingMeasurementAtoms).toEqual([])
    store.getState().setMeasurementMode('distance')
    store.getState().addMeasurementAtom('missing-atom')
    expect(store.getState().pendingMeasurementAtoms).toEqual([])
  })

  it('keeps a measurement edit synchronized with the active canonical MODEL frame', () => {
    const { store } = measure('distance', 2)
    const measurement = store.getState().measurements[0]
    const movingAtomIndex = store.getState().atoms.findIndex((atom) => atom.id === measurement.atomIds[1])
    const frameOffset = movingAtomIndex * 3
    const originalX = store.getState().atoms[movingAtomIndex].cartesian?.[0]
    expect(originalX).toBeDefined()
    expect(store.getState().bioStructure?.frames[1].positions[frameOffset]).toBe(originalX)

    store.getState().startMeasurementEdit(measurement.id, [0])
    store.getState().updateMeasurementEditTarget(4)
    const editedX = store.getState().atoms[movingAtomIndex].cartesian?.[0]
    expect(editedX).not.toBe(originalX)
    expect(store.getState().bioStructure?.frames[1].positions[frameOffset]).toBe(editedX)

    store.getState().cancelMeasurementEdit()
    expect(store.getState().atoms[movingAtomIndex].cartesian?.[0]).toBe(originalX)
    expect(store.getState().bioStructure?.frames[1].positions[frameOffset]).toBe(originalX)

    store.getState().startMeasurementEdit(measurement.id, [0])
    store.getState().updateMeasurementEditTarget(4)
    store.getState().applyMeasurementEdit()
    expect(store.getState().bioStructure?.frames[1].positions[frameOffset]).toBe(editedX)
    expect(store.getState().bioStructure?.frames[0].positions[frameOffset]).toBe(
      parseLegacyPdb(MULTI_MODEL_PDB, { id: 'reference', inferBonds: false }).frames[0].positions[frameOffset],
    )
    store.getState().undo()
    expect(store.getState().bioStructure?.frames[1].positions[frameOffset]).toBe(originalX)
  })
})
