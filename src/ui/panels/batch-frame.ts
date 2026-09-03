import type { WorkspaceFrame } from '../../host'

/** Replace only the editable structure payload; the Asset keeps its identity and provenance. */
export function replaceWorkspaceFrameStructure(
  frame: WorkspaceFrame,
  atoms: WorkspaceFrame['atoms'],
  bonds: WorkspaceFrame['bonds'],
  latticeMatrix: WorkspaceFrame['latticeMatrix'],
): WorkspaceFrame {
  return {
    ...frame,
    atoms,
    bonds,
    latticeMatrix,
    periodicity: latticeMatrix ? 'periodic' : 'molecular',
  }
}
