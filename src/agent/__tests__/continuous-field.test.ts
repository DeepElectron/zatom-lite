import { describe, expect, it } from 'vitest'

import { applySmoothDisplacementFields, displacementBetween } from '../continuous-field'
import { ZATOM_STRUCTURE_SCHEMA, type ZatomStructure } from '../contracts'

function lineStructure(withLattice = false): ZatomStructure {
  return {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    label: 'three atom line',
    atoms: [
      { id: 'left', element: 'C', position: [-2, 0, 0] },
      { id: 'center', element: 'C', position: [0, 0, 0] },
      { id: 'right', element: 'C', position: [2, 0, 0] },
    ],
    bonds: [
      { id: 'left-center', atomIds: ['left', 'center'], order: 1 },
      { id: 'center-right', atomIds: ['center', 'right'], order: 1 },
    ],
    ...(withLattice ? { lattice: { vectors: [[6, 0, 0], [0, 6, 0], [0, 0, 6]], periodic: [true, true, true] } } : {}),
  }
}

describe('smooth displacement fields', () => {
  it('recovers the analytic principal strain of a longitudinal sine wave', () => {
    const amplitudeA = 0.1
    const wavelengthA = 10
    const result = applySmoothDisplacementFields({
      structure: lineStructure(),
      fields: [{
        kind: 'sinusoidal',
        origin: [0, 0, 0],
        propagation: [1, 0, 0],
        direction: [1, 0, 0],
        amplitudeA,
        wavelengthA,
        phaseDeg: 0,
      }],
      maxPrincipalStrain: 0.1,
    })
    const center = result.atomAudits.find((audit) => audit.atomId === 'center')!
    expect(center.maxAbsPrincipalStrain).toBeCloseTo(2 * Math.PI * amplitudeA / wavelengthA, 7)
    expect(result.checks.find((check) => check.id === 'field.principal_strain')?.status).toBe('pass')
    expect(result.checks.find((check) => check.id === 'field.topology_preserved')?.status).toBe('pass')
    expect(result.structure.bonds).toEqual(lineStructure().bonds)
  })

  it('detects an orientation-reversing smooth step even when stretch magnitudes hide it', () => {
    const result = applySmoothDisplacementFields({
      structure: lineStructure(),
      fields: [{
        kind: 'smooth-step',
        origin: [0, 0, 0],
        normal: [1, 0, 0],
        direction: [-1, 0, 0],
        amplitudeA: 4,
        widthA: 1,
      }],
      maxPrincipalStrain: 2,
      minJacobianDeterminant: 0.1,
      minimumPairDistanceA: 0,
    })
    expect(result.audit.minJacobianDeterminant).toBeLessThan(0)
    expect(result.checks.find((check) => check.id === 'field.jacobian_orientation')?.status).toBe('fail')
  })

  it('requires explicit lattice removal and preserves the source lattice as metadata', () => {
    const source = lineStructure(true)
    const field = [{
      kind: 'gaussian' as const,
      center: [0, 0, 0] as [number, number, number],
      direction: [0, 1, 0] as [number, number, number],
      amplitudeA: 0.1,
      sigmaA: 3,
    }]
    expect(() => applySmoothDisplacementFields({ structure: source, fields: field })).toThrow(/dropLattice=true/)
    const result = applySmoothDisplacementFields({ structure: source, fields: field, dropLattice: true })
    expect(result.structure.lattice).toBeUndefined()
    expect(result.structure.metadata?.['zatom.field.sourceLattice']).toEqual(source.lattice)
    expect(result.checks.find((check) => check.id === 'field.periodicity_truthful')?.status).toBe('warn')
  })

  it('composes fields deterministically and leaves unselected identities untouched', () => {
    const source = lineStructure()
    const options = {
      structure: source,
      fields: [
        { kind: 'gaussian' as const, center: [0, 0, 0] as [number, number, number], direction: [0, 1, 0] as [number, number, number], amplitudeA: 0.2, sigmaA: 2 },
        { kind: 'torsion' as const, origin: [0, 0, 0] as [number, number, number], axis: [1, 0, 0] as [number, number, number], angleRateDegPerA: 2 },
      ],
      selection: { atomIds: ['center'] },
    }
    const first = applySmoothDisplacementFields(options)
    const second = applySmoothDisplacementFields(options)
    expect(first.structure).toEqual(second.structure)
    expect(displacementBetween(source, first.structure, 'left')).toBe(0)
    expect(displacementBetween(source, first.structure, 'right')).toBe(0)
    expect(displacementBetween(source, first.structure, 'center')).toBeGreaterThan(0)
    expect(first.checks.find((check) => check.id === 'field.selection_boundary')?.status).toBe('warn')
  })
})
