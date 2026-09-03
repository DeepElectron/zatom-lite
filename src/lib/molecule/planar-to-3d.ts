/**
 * Lift a flat 2D sketch into usable 3D geometry.
 *
 * This is the missing link between the 2D editor and the structure library. What
 * the editor holds is a drawing: `Atom2D` carries `{x, y}` in canvas units with
 * no z at all, so storing it as a 3D structure by asserting the type through
 * `unknown` (what the save path used to do) produced entries whose coordinates
 * were meaningless — everything collapsed onto z=0 at whatever pixel scale the
 * canvas happened to use.
 *
 * Two things therefore have to happen before the sketch is a structure:
 *
 * 1. Rescale. Canvas units are arbitrary (they follow zoom and lattice spacing),
 *    while `quickOptimizeGeometry` works in Ångström against covalent-radii
 *    targets. Feeding raw pixel coordinates in would start the relaxation
 *    hundreds of Å from any sane bond length; the optimiser's per-step clamp
 *    (0.1 Å) means it would run out of iterations long before recovering. So the
 *    drawing is scaled by the ratio between its own median bond length and a
 *    typical single bond, which makes the result independent of canvas zoom.
 *
 * 2. Relax. A perfectly planar structure is a saddle point of the force field:
 *    every force stays in-plane, so an sp3 centre drawn flat would remain flat.
 *    `quickOptimizeGeometry` already handles this — for non-periodic input it
 *    applies deterministic seeded jitter with extra z bias — so this module does
 *    NOT add its own randomisation. Doing it here as well would only make the
 *    output non-reproducible for no gain.
 *
 * Median rather than mean bond length: a sketch with one accidentally long bond
 * (a stretched ring closure, an atom dragged away) would drag a mean upward and
 * shrink the whole molecule. The median ignores such outliers, and the optimiser
 * fixes the individual bond anyway.
 */

import { quickOptimizeGeometry } from './quick-optimize'
import type { Atom2D, Bond2D } from './smiles-parser'

/** Typical single bond in Å. The relaxation refines per-element targets from here. */
const TARGET_BOND_LENGTH = 1.45

/** Fallback span for a sketch with no bonds at all (isolated atoms). */
const TARGET_ATOM_SPACING = 2.5

export interface LiftedStructure {
  /** Ready for `CustomFragment.atoms` — real Cartesian coordinates, centred on the origin. */
  atoms: Array<{ element: string; position: [number, number, number] }>
  /** Ready for `CustomFragment.bonds` — indices into `atoms`, matching input order. */
  bonds: Array<{ from: number; to: number; type: string }>
  formula: string
  /** Clash count after relaxation; surfaced so the caller can warn on a bad sketch. */
  clashes: number
}

function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle]
}

/**
 * Scale factor that maps the sketch's own units onto Ångström. Derived from bond
 * lengths when there are bonds, otherwise from the overall extent so a handful of
 * unbonded atoms still lands at a plausible separation instead of on top of
 * itself.
 */
function unitScale(atoms: Atom2D[], bonds: Bond2D[], byId: Map<string, Atom2D>): number {
  const lengths: number[] = []
  for (const bond of bonds) {
    const a = byId.get(bond.atom1Id)
    const b = byId.get(bond.atom2Id)
    if (!a || !b) continue
    const length = Math.hypot(b.x - a.x, b.y - a.y)
    if (length > 1e-6) lengths.push(length)
  }
  if (lengths.length > 0) return TARGET_BOND_LENGTH / medianOf(lengths)

  if (atoms.length < 2) return 1
  const xs = atoms.map((atom) => atom.x)
  const ys = atoms.map((atom) => atom.y)
  const extent = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
  if (extent < 1e-6) return 1
  return (TARGET_ATOM_SPACING * Math.sqrt(atoms.length)) / extent
}

/** Hill notation: carbon first, then hydrogen, then the rest alphabetically. */
export function hillFormula(elements: string[]): string {
  const counts = new Map<string, number>()
  for (const raw of elements) {
    const element = raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase()
    counts.set(element, (counts.get(element) ?? 0) + 1)
  }
  const rest = [...counts.keys()].filter((el) => el !== 'C' && el !== 'H').sort()
  const ordered = [...(counts.has('C') ? ['C'] : []), ...(counts.has('H') ? ['H'] : []), ...rest]
  return ordered
    .map((element) => {
      const count = counts.get(element) ?? 0
      return count > 1 ? `${element}${count}` : element
    })
    .join('')
}

/**
 * Turn a 2D sketch into relaxed 3D geometry. Never throws: an empty sketch comes
 * back as an empty structure so callers can treat "nothing to save" as data
 * rather than as an error path.
 */
export function liftPlanarSketchTo3D(atoms2D: Atom2D[], bonds2D: Bond2D[]): LiftedStructure {
  if (atoms2D.length === 0) {
    return { atoms: [], bonds: [], formula: '', clashes: 0 }
  }

  const byId = new Map(atoms2D.map((atom) => [atom.id, atom]))
  const indexById = new Map(atoms2D.map((atom, index) => [atom.id, index]))
  const scale = unitScale(atoms2D, bonds2D, byId)

  // Drop bonds referencing atoms outside the sketch; a dangling endpoint would
  // otherwise be silently ignored by the optimiser but still be saved as a bond.
  const validBonds = bonds2D.filter((bond) => byId.has(bond.atom1Id) && byId.has(bond.atom2Id))

  const optimized = quickOptimizeGeometry(
    atoms2D.map((atom) => ({
      id: atom.id,
      element: atom.element,
      position: [atom.x * scale, atom.y * scale, 0] as [number, number, number],
    })),
    validBonds.map((bond) => ({ atom1Id: bond.atom1Id, atom2Id: bond.atom2Id, type: bond.type })),
  )

  const positions = atoms2D.map((atom) => optimized.positions[atom.id] ?? [0, 0, 0])

  // Centre on the centroid so the structure inserts around the cursor / origin
  // instead of being offset by wherever it happened to sit on the canvas.
  const centroid = positions.reduce<[number, number, number]>(
    (sum, position) => [sum[0] + position[0], sum[1] + position[1], sum[2] + position[2]],
    [0, 0, 0],
  ).map((total) => total / positions.length) as [number, number, number]

  return {
    atoms: atoms2D.map((atom, index) => ({
      element: atom.element,
      position: [
        positions[index][0] - centroid[0],
        positions[index][1] - centroid[1],
        positions[index][2] - centroid[2],
      ] as [number, number, number],
    })),
    bonds: validBonds.map((bond) => ({
      from: indexById.get(bond.atom1Id) as number,
      to: indexById.get(bond.atom2Id) as number,
      type: bond.type,
    })),
    formula: hillFormula(atoms2D.map((atom) => atom.element)),
    clashes: optimized.stats.clashesAfter,
  }
}
