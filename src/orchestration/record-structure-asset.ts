/**
 * Canonical "file the active structure as an Asset frame" path.
 *
 * Lives outside React because two callers need it: the `StructureAssetProvider`
 * hook used across the panels, and the agent tools, which run with no component
 * tree. The React provider is a thin wrapper over this function rather than a
 * second implementation, so a frame recorded by the agent is byte-identical to
 * one recorded by a click.
 */

import { getElement } from '../lib/crystal/elements'
import { scaleLatticeVectorsForSupercell } from '../lib/crystal/supercell-utils'
import type { WorkspaceFrame } from '../host'
import { appendLocalWorkspaceFrame, commitLocalWorkspaceState, readLocalWorkspaceState } from '../host/localWorkspace'
import { useActiveCrystalStore } from './ViewportContext'
import { createBiomoleculePresentationArtifact } from './biomolecule-presentation-artifact'
import { createCrystalPresentationArtifact } from './crystal-presentation-artifact'
import { serializeStructureGroups } from './slices/structure-groups-slice'
import type { Atom, Bond, LatticeParameters, LatticeVectors, SupercellParams } from '../lib/crystal/types'

export type StructureAssetOrigin = 'import' | 'template' | 'search' | 'editor'

export function createStructureAssetFrame(
  frameId: string,
  label: string,
  origin: StructureAssetOrigin,
  atoms: Atom[],
  bonds: Bond[],
  periodic: boolean,
  latticeVectors: LatticeVectors,
  latticeParams: LatticeParameters,
  supercellParams: SupercellParams,
  biomoleculePresentation?: WorkspaceFrame['biomoleculePresentation'],
  crystalPresentation?: WorkspaceFrame['crystalPresentation'],
  structureGroups?: WorkspaceFrame['structureGroups'],
): WorkspaceFrame {
  const atomIndices = new Map(atoms.map((atom, index) => [atom.id, index]))
  // Crystal presentation artifacts retain the canonical unit cell and Nx×Ny×Nz
  // separately. Their WorkspaceFrame therefore uses the same unit-cell lattice
  // as the source project; coordinate-only frames keep the fully
  // materialized cell representation.
  const savedLattice = crystalPresentation
    ? latticeVectors
    : scaleLatticeVectorsForSupercell(latticeVectors, supercellParams)
  return {
    id: frameId,
    label: label.trim() || 'Imported Structure',
    createdAt: new Date().toISOString(),
    atoms: atoms.map((atom, atomIndex) => ({
      element: getElement(atom.element).atomicNumber,
      position: (atom.cartesian ?? atom.position) as [number, number, number],
      selected: 0,
      ...(crystalPresentation ? {
        id: atom.id,
        fractionalPosition: [...atom.position] as [number, number, number],
        ...(atom.cellIndex ? { cellIndex: [...atom.cellIndex] as [number, number, number] } : {}),
        siteIndex: atom.siteIndex ?? atomIndex,
      } : {}),
      ...(atom.groupId === undefined ? {} : { groupId: atom.groupId }),
    })),
    bonds: bonds
      .filter((bond) => atomIndices.has(bond.atom1Id) && atomIndices.has(bond.atom2Id))
      .map((bond) => ({
        from: atomIndices.get(bond.atom1Id)!,
        to: atomIndices.get(bond.atom2Id)!,
        type: bond.type,
        ...(bond.latticeOffset ? { latticeOffset: [...bond.latticeOffset] as [number, number, number] } : {}),
      })),
    ...(periodic ? {
      latticeMatrix: [
        [...savedLattice.a] as [number, number, number],
        [...savedLattice.b] as [number, number, number],
        [...savedLattice.c] as [number, number, number],
      ],
    } : {}),
    periodicity: periodic ? 'periodic' : 'molecular',
    settings: {
      stiffness: 100,
      cutoff: 2,
      forceField: 'none',
      method: 'steepest_descent',
    },
    meta: {
      eventType: 'FUNCTION_SNAPSHOT_MANUAL',
      functionId: `structure_${origin}`,
      runState: 'idle',
      ...(periodic && latticeParams.centeringType ? { centeringType: latticeParams.centeringType } : {}),
      ...(periodic && latticeParams.spaceGroupNumber ? { spaceGroupNumber: latticeParams.spaceGroupNumber } : {}),
    },
    ...(biomoleculePresentation ? { biomoleculePresentation } : {}),
    ...(crystalPresentation ? { crystalPresentation } : {}),
    ...(structureGroups && structureGroups.length > 0 ? { structureGroups } : {}),
  }
}

export interface RecordedStructureAsset {
  frameId: string
  workspaceId: string
  batchId: string
}

/**
 * Snapshots the active viewport structure into the active batch.
 *
 * Returns null when there is no batch to file into or the viewport is empty —
 * both are ordinary states, not faults, so callers decide how to report them.
 */
export function recordActiveStructureAsset(
  label: string,
  origin: StructureAssetOrigin,
): RecordedStructureAsset | null {
  const state = readLocalWorkspaceState()
  const workspace = state.workspaces.find((item) => item.id === state.activeWorkspaceId) ?? state.workspaces[0]
  const batch = workspace?.batches.find((item) => item.id === workspace.activeBatchId) ?? workspace?.batches[0]
  if (!workspace || !batch) return null

  const store = useActiveCrystalStore.getState()
  if (store.atoms.length === 0) return null

  const frameId = `frame-${crypto.randomUUID()}`
  const frame = createStructureAssetFrame(
    frameId,
    label,
    origin,
    store.atoms,
    store.bonds,
    store.periodic,
    store.latticeVectors,
    store.latticeParams,
    store.supercellParams,
    createBiomoleculePresentationArtifact(store),
    createCrystalPresentationArtifact(store),
    store.structureGroups.length > 0 ? serializeStructureGroups(store.structureGroups) : undefined,
  )

  commitLocalWorkspaceState((current) => appendLocalWorkspaceFrame(current, workspace.id, batch.id, frame, true))
  // Recording a newly created/imported structure establishes a new document
  // boundary. Pre-creation snapshots must not be replayed into this Asset.
  store.resetStructureHistory()
  store.bindToFrame(workspace.id, batch.id, frameId)
  return { frameId, workspaceId: workspace.id, batchId: batch.id }
}
