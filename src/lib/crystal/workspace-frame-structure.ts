import { atomicNumberToSymbol } from '../../chemistry/periodic-table'
import type { WorkspaceFrame } from '../../host/ports'
import { cartesianToFractional } from './lattice'
import type { Atom, LatticeVectors } from './types'

/**
 * Restore a periodic WorkspaceFrame without losing presentation-only crystal
 * identity. Ordinary coordinate frames still derive fractional coordinates;
 * presentation frames carry the exact normalized supercell coordinates.
 */
export function crystalAtomsFromWorkspaceFrame(
  frame: WorkspaceFrame,
  latticeVectors: LatticeVectors,
): Atom[] {
  return frame.atoms.map((snapshot, index) => {
    const cartesian = [...snapshot.position] as [number, number, number]
    return {
      id: snapshot.id ?? `frame-atom-${index}`,
      element: atomicNumberToSymbol(snapshot.element),
      position: snapshot.fractionalPosition
        ? [...snapshot.fractionalPosition] as [number, number, number]
        : cartesianToFractional(cartesian, latticeVectors),
      cartesian,
      ...(snapshot.cellIndex ? { cellIndex: [...snapshot.cellIndex] as [number, number, number] } : {}),
      ...(snapshot.siteIndex === undefined ? {} : { siteIndex: snapshot.siteIndex }),
      ...(snapshot.groupId === undefined ? {} : { groupId: snapshot.groupId }),
    }
  })
}
