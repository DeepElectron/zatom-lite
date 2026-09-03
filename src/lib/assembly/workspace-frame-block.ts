import type { WorkspaceFrame } from '../../host'
import { autoDetectBonds } from '../crystal/bonds'
import type { Atom, Bond, LatticeVectors } from '../crystal/types'

export function workspaceFrameBondsToCrystalBonds(
  frame: WorkspaceFrame,
  atoms: Atom[],
  latticeVectors: LatticeVectors,
): Bond[] {
  if (frame.bonds) {
    return frame.bonds.flatMap((bond, index) => {
      const atom1 = atoms[bond.from]
      const atom2 = atoms[bond.to]
      if (!atom1 || !atom2 || atom1.id === atom2.id) return []
      return [{
        id: `frame-bond-${index}-${atom1.id}-${atom2.id}`,
        atom1Id: atom1.id,
        atom2Id: atom2.id,
        type: bond.type,
        // Boundary-crossing bonds must keep their image offset, otherwise the
        // renderer draws atom2 at its wrapped in-cell position and the bond
        // becomes a line cutting straight through the cell interior.
        ...(bond.latticeOffset ? { latticeOffset: [...bond.latticeOffset] as [number, number, number] } : {}),
      }]
    })
  }
  return autoDetectBonds(atoms, latticeVectors)
}
