/**
 * Monotonic per-viewport workspace revisions.
 *
 * Fingerprints answer whether two snapshots contain the same canonical data;
 * revisions answer whether anything changed in between (A → B → A). The
 * latter is required for compare-and-set writes after a user has edited and
 * undone back to the same fingerprint.
 */

interface StoreLike {
  getState(): Record<string, unknown>
  subscribe(listener: (state: Record<string, unknown>, previous: Record<string, unknown>) => void): () => void
}

interface RevisionEntry {
  revision: number
  unsubscribe: () => void
}

const revisions = new WeakMap<object, RevisionEntry>()

function workspaceChanged(state: Record<string, unknown>, previous: Record<string, unknown>): boolean {
  return state.atoms !== previous.atoms
    || state.unitCellAtoms !== previous.unitCellAtoms
    || state.bonds !== previous.bonds
    || state.latticeVectors !== previous.latticeVectors
    || state.supercellParams !== previous.supercellParams
    || state.periodic !== previous.periodic
    || state.compactStructure !== previous.compactStructure
    || state.bioStructure !== previous.bioStructure
    || state.structureGroups !== previous.structureGroups
    || state.crystalLayers !== previous.crystalLayers
    || state.molecularOrbital !== previous.molecularOrbital
    || state.constructedPlane !== previous.constructedPlane
    || state.atomAttributes !== previous.atomAttributes
    || state.measurements !== previous.measurements
    || state.domainWallReview !== previous.domainWallReview
    || state.regionSeeds !== previous.regionSeeds
    || state.cameraKeyframes !== previous.cameraKeyframes
    || state.baseStyleKeyframes !== previous.baseStyleKeyframes
    || state.trajectoryFrames !== previous.trajectoryFrames
    || state.trajectoryMetadata !== previous.trajectoryMetadata
    || state.trajectoryFormatKind !== previous.trajectoryFormatKind
}

function ensureEntry(store: StoreLike): RevisionEntry {
  const key = store as unknown as object
  const existing = revisions.get(key)
  if (existing) return existing
  const entry: RevisionEntry = { revision: 0, unsubscribe: () => {} }
  entry.unsubscribe = store.subscribe((state, previous) => {
    if (workspaceChanged(state, previous)) entry.revision += 1
  })
  revisions.set(key, entry)
  return entry
}

/** Current monotonic revision; observing installs the lightweight tracker. */
export function readWorkspaceRevision(store: StoreLike): number {
  return ensureEntry(store).revision
}
