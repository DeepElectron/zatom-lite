import { describe, expect, it } from 'vitest'

import {
  buildGeneral2DInterface,
  buildInteger2DSupercell,
  findGeneral2DInterfaceMatches,
} from '../general-interface'
import { ZATOM_STRUCTURE_SCHEMA, type Mat3, type ZatomStructure } from '../contracts'

function monolayer(label: string, a: [number, number, number], b: [number, number, number], element = 'C'): ZatomStructure {
  return {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    label,
    lattice: { vectors: [a, b, [0, 0, 10]] as Mat3, periodic: [true, true, true] },
    atoms: [{ id: `${label}-1`, element, position: [0, 0, 2] }],
  }
}

const square = monolayer('square', [1, 0, 0], [0, 1, 0])
const oblique = monolayer('oblique', [1, 0, 0], [0.5, 0.5, 0], 'Si')

describe('general 2D interface matching', () => {
  it('finds an exact off-diagonal match that diagonal repeats cannot express', () => {
    const result = findGeneral2DInterfaceMatches({
      bottom: square,
      top: oblique,
      maxAreaMultiple: 2,
      maxPrincipalStrain: 1e-10,
      maxOutputAtoms: 20,
    })
    expect(result.recommended.bottomMatrix).toEqual([[1, 0], [0, 1]])
    expect(result.recommended.topMatrix).toEqual([[1, 0], [-1, 2]])
    expect(result.recommended.maxAbsPrincipalStrain).toBeLessThan(1e-12)
    expect(result.recommended.totalAtomCount).toBe(3)
    expect(result.checks.find((check) => check.id === 'general_interface.match_found')?.status).toBe('pass')
  })

  it('builds exact matrix-supercell counts, gap, vacuum, and layer identities', () => {
    const result = buildGeneral2DInterface({
      bottom: square,
      top: oblique,
      maxAreaMultiple: 2,
      maxPrincipalStrain: 1e-10,
      gapA: 3,
      vacuumA: 10,
    })
    expect(result.structure.atoms).toHaveLength(3)
    expect(result.metrics.measuredGapA).toBeCloseTo(3, 10)
    expect(result.metrics.measuredVacuumA).toBeCloseTo(10, 10)
    expect(result.metrics.minimumCrossInterfaceDistanceA).toBeCloseTo(3, 10)
    expect(result.structure.atoms.filter((atom) => atom.properties?.['zatom.interfaceLayer'] === 'bottom')).toHaveLength(1)
    expect(result.structure.atoms.filter((atom) => atom.properties?.['zatom.interfaceLayer'] === 'top')).toHaveLength(2)
    expect(result.checks.find((check) => check.id === 'general_interface.supercell_counts')?.status).toBe('pass')
    expect(result.checks.find((check) => check.id === 'general_interface.inplane_strain')?.status).toBe('pass')
    expect(result.inspectionTargets.some((target) => target.id === 'general-interface-contact')).toBe(true)
  })

  it('shares mismatch between both layers in the requested fraction', () => {
    const bottom = monolayer('bottom-2', [2, 0, 0], [0, 2, 0])
    const top = monolayer('top-2.2', [2.2, 0, 0], [0, 2.2, 0])
    const fullTop = findGeneral2DInterfaceMatches({
      bottom,
      top,
      maxAreaMultiple: 1,
      maxPrincipalStrain: 0.2,
      strainShareTop: 1,
    }).recommended
    const shared = findGeneral2DInterfaceMatches({
      bottom,
      top,
      maxAreaMultiple: 1,
      maxPrincipalStrain: 0.2,
      strainShareTop: 0.5,
    }).recommended
    expect(fullTop.bottomPrincipalStrains[0]).toBeCloseTo(0, 12)
    expect(fullTop.topPrincipalStrains[0]).toBeCloseTo(-1 / 11, 12)
    expect(shared.bottomPrincipalStrains[0]).toBeCloseTo(0.05, 12)
    expect(shared.topPrincipalStrains[0]).toBeCloseTo(-0.0454545454545, 12)
    expect(shared.maxAbsPrincipalStrain).toBeLessThan(fullTop.maxAbsPrincipalStrain)
  })

  it('retains symmetry-equivalent bases needed for a zero-strain twist target', () => {
    const triangular = monolayer('triangular', [1, 0, 0], [0.5, Math.sqrt(3) / 2, 0])
    const result = findGeneral2DInterfaceMatches({
      bottom: triangular,
      top: triangular,
      maxAreaMultiple: 7,
      maxPrincipalStrain: 1e-10,
      targetRotationDeg: 21.786789,
      maxRotationErrorDeg: 1e-3,
      maxOutputAtoms: 100,
    })
    expect(result.acceptedCandidateCount).toBeGreaterThan(0)
    expect(result.recommended.alignmentRotationDeg).toBeCloseTo(21.7867892983, 8)
    expect(result.recommended.rotationErrorDeg).toBeLessThan(1e-6)
    expect(result.recommended.maxAbsPrincipalStrain).toBeLessThan(1e-12)
    expect(result.recommended.bottomAreaMultiple).toBe(7)
    expect(result.recommended.topAreaMultiple).toBe(7)
  })

  it('replicates explicit topology once per integer-lattice coset', () => {
    const moleculeLayer: ZatomStructure = {
      ...square,
      atoms: [
        { id: 'a', element: 'C', position: [0, 0, 2] },
        { id: 'b', element: 'H', position: [0.5, 0, 2] },
      ],
      bonds: [{ id: 'a-b', atomIds: ['a', 'b'], order: 1 }],
    }
    const result = buildInteger2DSupercell(moleculeLayer, [[1, 0], [-1, 2]])
    expect(result.atoms).toHaveLength(4)
    expect(result.bonds).toHaveLength(2)
    expect(new Set(result.atoms.map((atom) => atom.id)).size).toBe(4)
    expect(result.bonds?.every((bond) => bond.atomIds.every((id) => result.atoms.some((atom) => atom.id === id)))).toBe(true)
  })
})
