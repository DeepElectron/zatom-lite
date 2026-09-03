/**
 * Named-direction pose ops: translate_along and rotate_about_axis_through.
 * Uses the Cu(111)+CO fixture so "surface-normal" and bond axes are real.
 */
import assert from 'node:assert/strict'

import { cu111SlabWithCO } from './fixtures/cu111-co'
import { applyStructureOperations, parseStructureOperations, StructureOperationInputError } from '../operations'
import { resolveSurfaceNormal } from '../../lib/scene-grid/system-semantics'
import type { Vec3 } from '../contracts'

const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

const { structure } = cu111SlabWithCO()
const carbon = structure.atoms.find((a) => a.element === 'C')!
const oxygen = structure.atoms.find((a) => a.element === 'O')!
const normal = resolveSurfaceNormal(structure)!.normal
const height = (p: Vec3) => dot(p, normal)

// translate_along surface-normal moves CO outward by exactly 0.5 Å and nothing else.
{
  const ops = parseStructureOperations([
    { op: 'translate_along', selection: { atomIds: [carbon.id, oxygen.id] }, direction: 'surface-normal', distanceA: 0.5 },
  ])
  const result = applyStructureOperations({ structure, operations: ops })
  const c2 = result.structure.atoms.find((a) => a.id === carbon.id)!
  const o2 = result.structure.atoms.find((a) => a.id === oxygen.id)!
  assert.ok(Math.abs(height(c2.position) - height(carbon.position) - 0.5) < 1e-6, 'C rose 0.5 Å along normal')
  assert.ok(Math.abs(height(o2.position) - height(oxygen.position) - 0.5) < 1e-6, 'O rose 0.5 Å along normal')
  assert.ok(Math.abs(dist(c2.position, o2.position) - dist(carbon.position, oxygen.position)) < 1e-9, 'C–O length preserved')
  const movedCu = result.structure.atoms.filter((a) => a.element === 'Cu').filter((a) => {
    const before = structure.atoms.find((b) => b.id === a.id)!
    return dist(a.position, before.position) > 1e-9
  })
  assert.equal(movedCu.length, 0, 'slab untouched')
}

// translate_along {from,to}: pull O toward C by 0.1 Å shortens the bond by 0.1 Å.
{
  const ops = parseStructureOperations([
    { op: 'translate_along', selection: { atomIds: [oxygen.id] }, direction: { fromAtomId: oxygen.id, toAtomId: carbon.id }, distanceA: 0.1 },
  ])
  const result = applyStructureOperations({ structure, operations: ops })
  const o2 = result.structure.atoms.find((a) => a.id === oxygen.id)!
  assert.ok(Math.abs(dist(carbon.position, o2.position) - (dist(carbon.position, oxygen.position) - 0.1)) < 1e-6)
}

// rotate_about_axis_through a bond axis: tilt O 30° about an axis through C
// perpendicular to the surface normal. C stays put, C–O length is preserved,
// and the C–O vector now makes 30° with its old direction.
{
  const co: Vec3 = [oxygen.position[0] - carbon.position[0], oxygen.position[1] - carbon.position[1], oxygen.position[2] - carbon.position[2]]
  // Any axis perpendicular to CO through C tilts the molecule.
  const perp: Vec3 = Math.abs(co[0]) < 0.9 * Math.hypot(...co) ? [1, 0, 0] : [0, 1, 0]
  const ops = parseStructureOperations([
    { op: 'rotate_about_axis_through', selection: { atomIds: [oxygen.id] }, axis: perp, angleDeg: 30, pivot: { atomId: carbon.id } },
  ])
  const result = applyStructureOperations({ structure, operations: ops })
  const c2 = result.structure.atoms.find((a) => a.id === carbon.id)!
  const o2 = result.structure.atoms.find((a) => a.id === oxygen.id)!
  assert.ok(dist(c2.position, carbon.position) < 1e-9, 'pivot atom fixed')
  assert.ok(Math.abs(dist(c2.position, o2.position) - dist(carbon.position, oxygen.position)) < 1e-6, 'C–O length preserved')
  const co2: Vec3 = [o2.position[0] - c2.position[0], o2.position[1] - c2.position[1], o2.position[2] - c2.position[2]]
  const cosAngle = dot(co, co2) / (Math.hypot(...co) * Math.hypot(...co2))
  // perp is not exactly perpendicular to CO in general, so the apparent tilt is ≤ 30°.
  assert.ok(Math.acos(Math.min(1, cosAngle)) <= (30 * Math.PI) / 180 + 1e-6, 'tilted by at most 30°')
  assert.ok(Math.acos(Math.min(1, cosAngle)) > (5 * Math.PI) / 180, 'actually tilted')
}

// rotate about the Cu→C bond axis: default pivot is the bond's first atom.
{
  const topCu = structure.atoms
    .filter((a) => a.element === 'Cu')
    .sort((a, b) => dist(a.position, carbon.position) - dist(b.position, carbon.position))[0]
  const ops = parseStructureOperations([
    { op: 'rotate_about_axis_through', selection: { atomIds: [carbon.id, oxygen.id] }, axis: { fromAtomId: topCu.id, toAtomId: carbon.id }, angleDeg: 90 },
  ])
  const result = applyStructureOperations({ structure, operations: ops })
  const c2 = result.structure.atoms.find((a) => a.id === carbon.id)!
  // C lies on the axis, so it must not move.
  assert.ok(dist(c2.position, carbon.position) < 1e-6, 'atom on the axis stays')
}

// Bond directions use the nearest periodic image, not the raw across-cell delta.
{
  const periodic = {
    schemaVersion: 'zatom.structure/v1' as const,
    lattice: { vectors: [[10, 0, 0], [0, 10, 0], [0, 0, 10]] as [Vec3, Vec3, Vec3], periodic: [true, true, true] as [boolean, boolean, boolean] },
    atoms: [
      { id: 'edge-from', element: 'C', position: [9.8, 0, 0] as Vec3 },
      { id: 'edge-to', element: 'C', position: [0.2, 0, 0] as Vec3 },
      { id: 'mover', element: 'H', position: [5, 5, 5] as Vec3 },
    ],
  }
  const result = applyStructureOperations({
    structure: periodic,
    operations: parseStructureOperations([{
      op: 'translate_along',
      selection: { atomIds: ['mover'] },
      direction: { fromAtomId: 'edge-from', toAtomId: 'edge-to' },
      distanceA: 1,
    }]),
  })
  assert.ok(result.structure.atoms.find((atom) => atom.id === 'mover')!.position[0] > 5.9)
}

// surface-normal fails closed for a bulk crystal: fully periodic and no vacuum
// gap. (An explicitly aperiodic axis is a slab declaration and always resolves.)
{
  const crystal = {
    ...structure,
    lattice: {
      vectors: structure.lattice!.vectors.map((v) => [...v] as Vec3) as [Vec3, Vec3, Vec3],
      periodic: [true, true, true] as [boolean, boolean, boolean],
    },
  }
  // Collapse c to the slab thickness so there is no vacuum.
  const heights = crystal.atoms.map((a) => height(a.position))
  const thickness = Math.max(...heights) - Math.min(...heights) + 2.0
  const cLen = Math.hypot(...crystal.lattice.vectors[2])
  crystal.lattice.vectors[2] = crystal.lattice.vectors[2].map((x) => (x * thickness) / cLen) as Vec3
  const ops = parseStructureOperations([
    { op: 'translate_along', selection: { atomIds: [carbon.id] }, direction: 'surface-normal', distanceA: 0.5 },
  ])
  assert.throws(
    () => applyStructureOperations({ structure: crystal, operations: ops }),
    (error: unknown) => error instanceof StructureOperationInputError && error.code === 'no_surface_normal',
  )
}

// Parser rejects a degenerate direction.
assert.throws(
  () => parseStructureOperations([{ op: 'translate_along', selection: { all: true }, direction: { fromAtomId: 'a', toAtomId: 'a' }, distanceA: 1 }]),
  (error: unknown) => error instanceof StructureOperationInputError && error.code === 'invalid_direction',
)

console.log('pose-operations: all assertions passed')
