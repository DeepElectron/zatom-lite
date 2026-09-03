import type { CompactStructure } from './compact-structure'
import type { Atom } from '../crystal/types'

/**
 * Materialize a small set of compact indices into real Atom objects (for the
 * existing detail/instanced render + interaction). id = `c${index}` is stable so
 * re-focusing the same region yields the same ids.
 */
export function materializeNeighborhood(c: CompactStructure, indices: number[]): Atom[] {
  const out: Atom[] = []
  for (const i of indices) {
    const x = c.positions[i * 3], y = c.positions[i * 3 + 1], z = c.positions[i * 3 + 2]
    const atom: Atom = {
      id: `c${i}`,
      element: c.elements[c.elementIndex[i]],
      position: [x, y, z],
      cartesian: [x, y, z],
    }
    if (c.grainId) atom.props = { grain_id: { kind: 'scalar', value: c.grainId[i] } }
    out.push(atom)
  }
  return out
}
