import { describe, expect, it } from 'vitest'
import { createCrystalStore } from '../crystalStore'
import { resolveViewDirection } from '../../lib/render/camera-directions'

const periodicXYZ = '2\nLattice="10 0 0 3 10 0 1 2 12" pbc="T T F"\nC 1 1 1\nC 2.4 1 1\n'
const moleculeXYZ = '2\nMolecule\nC 1 1 1\nC 2.4 1 1\n'

describe('new document bond defaults', () => {
  it('defaults crystals to hidden bonds without deleting bonds or resetting later edits', async () => {
    const store = createCrystalStore()
    expect((await store.getState().loadTemplate('hcp')).success).toBe(true)
    expect(store.getState().showBonds).toBe(false)
    expect((await store.getState().loadFromXYZ(periodicXYZ)).success).toBe(true)
    expect(store.getState().showBonds).toBe(false)
    expect(store.getState().bonds.length).toBeGreaterThan(0)
    store.getState().setShowBonds(true)
    await store.getState().loadFromXYZ(periodicXYZ, {documentMode: 'edit'})
    expect(store.getState().showBonds).toBe(true)
    await store.getState().loadFromXYZ(periodicXYZ)
    expect(store.getState().showBonds).toBe(false)
    await store.getState().loadFromXYZ(moleculeXYZ)
    expect(store.getState().showBonds).toBe(true)
    await store.getState().loadFromXYZ(periodicXYZ.replace('T T F', 'F F F'))
    expect(store.getState().showBonds).toBe(true)
  })
})

it('distinguishes an oblique lattice axis from its reciprocal plane normal', () => {
  const a: [number, number, number] = [10, 0, 0], b: [number, number, number] = [3, 10, 0], c: [number, number, number] = [1, 2, 12]
  const normal = resolveViewDirection({hkl: [1, 0, 0]}, [a, b, c])
  const dot = (v: number[], w: number[]) => v.reduce((sum, value, i) => sum + value * w[i], 0)
  expect(dot(normal, b)).toBeCloseTo(0, 12)
  expect(dot(normal, c)).toBeCloseTo(0, 12)
  expect(dot(normal, a)).toBeGreaterThan(0)
  expect(normal).not.toEqual(resolveViewDirection('a', [a, b, c]))
})

it('changes only the target pane camera, preserving the model, pivot and zoom', async () => {
  const store = createCrystalStore(), other = createCrystalStore()
  await store.getState().loadFromXYZ(periodicXYZ)
  store.getState().setSavedCameraState({position: [20, 10, 8], target: [5, 4, 3], zoom: 22})
  const prior = store.getState(), otherPrior = other.getState()
  store.getState().setPeriodicView({hkl: [0, 0, 1]}, 0)
  const after = store.getState(), target = after.cameraTarget!
  expect(after.atoms).toBe(prior.atoms)
  expect(after.latticeVectors).toBe(prior.latticeVectors)
  expect(after.bonds).toBe(prior.bonds)
  expect(after.history).toBe(prior.history)
  expect(target.lookAt).toEqual([5, 4, 3])
  expect(target.zoom).toBe(22)
  expect(target.position[0]).toBeCloseTo(5)
  expect(target.position[1]).toBeCloseTo(4)
  expect(target.position[2]).toBeGreaterThan(3)
  expect(target.forceOrientation).toBe(true)
  expect(target.durationMs).toBe(0)
  expect(other.getState()).toBe(otherPrior)
  await store.getState().loadFromXYZ(moleculeXYZ)
  const molecule = store.getState()
  store.getState().setPeriodicView('a')
  expect(store.getState()).toBe(molecule)
})
