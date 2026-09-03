/**
 * Programmatic Cu(111) slab (+ optional CO on a top site) for perception tests.
 * Built through the same surface tools an agent would use, so the fixture
 * exercises the real pipeline rather than a hand-typed coordinate list.
 */

import type { ZatomStructure } from '../../contracts'
import { ZATOM_STRUCTURE_SCHEMA } from '../../contracts'
import { buildMillerSlab, detectAdsorptionSites, placeAdsorbate } from '../../surface'

const CU_A = 3.615

export const fccCu: ZatomStructure = {
  schemaVersion: ZATOM_STRUCTURE_SCHEMA,
  label: 'fcc Cu',
  atoms: [
    { id: 'Cu1', element: 'Cu', position: [0, 0, 0] },
    { id: 'Cu2', element: 'Cu', position: [0, CU_A / 2, CU_A / 2] },
    { id: 'Cu3', element: 'Cu', position: [CU_A / 2, 0, CU_A / 2] },
    { id: 'Cu4', element: 'Cu', position: [CU_A / 2, CU_A / 2, 0] },
  ],
  lattice: {
    vectors: [
      [CU_A, 0, 0],
      [0, CU_A, 0],
      [0, 0, CU_A],
    ],
    periodic: [true, true, true],
  },
}

export function cu111Slab(options: { layers?: number; vacuumA?: number } = {}): ZatomStructure {
  return buildMillerSlab({
    structure: fccCu,
    miller: [1, 1, 1],
    layers: options.layers ?? 4,
    vacuumA: options.vacuumA ?? 15,
  }).structure
}

export function cu111SlabWithCO(options: { layers?: number; vacuumA?: number } = {}): {
  structure: ZatomStructure
  addedAtomIds: string[]
  siteId: string
} {
  const slab = cu111Slab(options)
  const sites = detectAdsorptionSites({ structure: slab })
  const top = sites.sites.find((s) => s.kind === 'top') ?? sites.sites[0]
  const placed = placeAdsorbate({
    structure: slab,
    fragment: 'CO',
    siteId: top.id,
    expectedSourceFingerprint: sites.sourceFingerprint,
  })
  return { structure: placed.structure, addedAtomIds: placed.addedAtomIds, siteId: top.id }
}

export const water: ZatomStructure = {
  schemaVersion: ZATOM_STRUCTURE_SCHEMA,
  label: 'water',
  atoms: [
    { id: 'O1', element: 'O', position: [0, 0, 0.117] },
    { id: 'H1', element: 'H', position: [0, 0.757, -0.469] },
    { id: 'H2', element: 'H', position: [0, -0.757, -0.469] },
  ],
}
