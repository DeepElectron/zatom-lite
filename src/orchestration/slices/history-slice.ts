/**
 * history-slice — primary undo/redo (atoms, bonds, unitCellAtoms, etc.) and Assembly undo/redo
 * (sceneObjects/buildingBlocks/assemblyScenes).
 *
 * The histories are independent:
 *   - Primary history snapshots atom/bond edits via pushHistory and keeps up to 50 entries.
 *   - Assembly history separately snapshots scene operations via pushAssemblyHistory.
 *
 * Implementation details:
 *   - Snapshots are deep-cloned because atoms contain nested arrays.
 *   - Undo stores the current state at historyIndex+1 as the redo candidate, appending
 *     or replacing as needed so every undo remains redoable.
 *   - pushHistory marks boundFrameRef dirty synchronously to avoid losing edits during
 *     a fast Asset switch.
 *   - resetStructureHistory isolates Undo/Redo between Asset documents.
 *   - Undo/redo clear selectedAtomIds and focusedAtomIds so restored selections cannot
 *     reference atoms that no longer exist.
 *
 * Cross-slice: undo/redo writes atoms, bonds, unitCellAtoms, userDeletedPositions,
 * userAddedAtomIds, supercellParams, selectedAtomIds, and focusedAtomIds. Zustand's
 * set is not restricted by slice boundaries.
 */

import type { StateCreator } from 'zustand'
import type { AssemblyHistoryState, CrystalStore, HistoryState } from '../crystal-store-types'
import {
  createBiomoleculePresentationArtifact,
  restoreBiomoleculePresentationArtifact,
} from '../biomolecule-presentation-artifact'

function clone<T>(value: T): T {
  return structuredClone(value)
}

function structureSnapshot(state: CrystalStore): HistoryState {
  return {
    atoms: clone(state.atoms),
    bonds: clone(state.bonds),
    measurements: clone(state.measurements),
    crystalSystem: state.crystalSystem,
    latticeParams: { ...state.latticeParams },
    latticeVectors: clone(state.latticeVectors),
    unitCellAtoms: clone(state.unitCellAtoms),
    userDeletedPositions: new Set(state.userDeletedPositions),
    userAddedAtomIds: new Set(state.userAddedAtomIds),
    supercellParams: { ...state.supercellParams },
    bondSettings: {
      defaultRadius: state.bondSettings.defaultRadius,
      elementPairRadii: { ...state.bondSettings.elementPairRadii },
      restrictToConfiguredPairs: state.bondSettings.restrictToConfiguredPairs,
      tolerance: state.bondSettings.tolerance,
      periodicBonds: state.bondSettings.periodicBonds,
    },
    biomoleculePresentation: createBiomoleculePresentationArtifact(state) ?? null,
    trajectoryCurrentFrame: state.trajectoryCurrentFrame,
    trajectoryFrames: state.trajectoryFrames ? clone(state.trajectoryFrames) : null,
    structureGroups: clone(state.structureGroups),
    activeGroupId: state.activeGroupId,
  }
}

function restoreHistorySnapshot(
  set: Parameters<StateCreator<CrystalStore, [], [], HistorySlice>>[0],
  get: () => CrystalStore,
  snapshot: HistoryState,
  patch: Partial<CrystalStore>,
): void {
  const current = get()
  const currentTrajectoryIntervalId = current.trajectoryIntervalId
  // Restoring a saved biomolecular document reuses the canonical document
  // installer, which intentionally clears history for ordinary navigation.
  // Undo/redo owns this history, so preserve its cursor across that install;
  // the caller's patch may then atomically replace either value.
  const preservedHistory = current.history
  const preservedHistoryIndex = current.historyIndex
  if (currentTrajectoryIntervalId) clearInterval(currentTrajectoryIntervalId)
  if (snapshot.biomoleculePresentation) {
    restoreBiomoleculePresentationArtifact({ getState: get, setState: set }, clone(snapshot.biomoleculePresentation))
  }
  set({
    atoms: clone(snapshot.atoms),
    bonds: clone(snapshot.bonds),
    measurements: clone(snapshot.measurements),
    crystalSystem: snapshot.crystalSystem,
    latticeParams: { ...snapshot.latticeParams },
    latticeVectors: clone(snapshot.latticeVectors),
    unitCellAtoms: clone(snapshot.unitCellAtoms),
    userDeletedPositions: new Set(snapshot.userDeletedPositions || []),
    userAddedAtomIds: new Set(snapshot.userAddedAtomIds || []),
    supercellParams: snapshot.supercellParams ?? get().supercellParams,
    bondSettings: {
      defaultRadius: snapshot.bondSettings.defaultRadius,
      elementPairRadii: { ...snapshot.bondSettings.elementPairRadii },
      restrictToConfiguredPairs: snapshot.bondSettings.restrictToConfiguredPairs,
      tolerance: snapshot.bondSettings.tolerance,
      periodicBonds: snapshot.bondSettings.periodicBonds,
    },
    ...(snapshot.biomoleculePresentation ? {
      trajectoryCurrentFrame: snapshot.trajectoryCurrentFrame,
      trajectoryFrames: snapshot.trajectoryFrames ? clone(snapshot.trajectoryFrames) : null,
      trajectoryTotalFrames: snapshot.trajectoryFrames?.length ?? 0,
      trajectoryPlaying: false,
      trajectoryIntervalId: null,
    } : {
      bioStructure: null,
      bioLayers: [],
      bioAlignmentGhost: null,
      // A snapshot without a biomolecule must also remove the drill-down outline;
      // otherwise it would remain over the restored crystal structure.
      bioDrillGhost: null,
      trajectoryFrames: snapshot.trajectoryFrames ? clone(snapshot.trajectoryFrames) : null,
      trajectoryTotalFrames: snapshot.trajectoryFrames?.length ?? 0,
      trajectoryPlaying: false,
      trajectoryIntervalId: null,
    }),
    trajectoryCurrentFrame: snapshot.trajectoryCurrentFrame,
    structureGroups: clone(snapshot.structureGroups ?? []),
    activeGroupId: snapshot.activeGroupId ?? null,
    history: preservedHistory,
    historyIndex: preservedHistoryIndex,
    ...patch,
  })
}

function historyPositionAfterRestoring(restoredSnapshotIndex: number): number {
  // historyIndex names the snapshot Undo will restore next. After restoring an
  // entry, the cursor therefore sits immediately before that entry.
  return restoredSnapshotIndex - 1
}

export interface HistorySlice {
  lastHistoryDomain: 'structure' | 'assembly'
  history: HistoryState[]
  historyIndex: number
  assemblyHistory: AssemblyHistoryState[]
  assemblyHistoryIndex: number
  pushHistory: () => void
  resetStructureHistory: () => void
  undo: () => void
  canUndo: () => boolean
  redo: () => void
  canRedo: () => boolean
  pushAssemblyHistory: () => void
  undoAssembly: () => void
  redoAssembly: () => void
  canUndoAssembly: () => boolean
  canRedoAssembly: () => boolean
}

export const createHistorySlice: StateCreator<CrystalStore, [], [], HistorySlice> = (set, get) => ({
  lastHistoryDomain: 'structure',
  history: [],
  historyIndex: -1,
  assemblyHistory: [],
  assemblyHistoryIndex: -1,

  pushHistory: () => {
    // An edit owns the currently bound frame synchronously. Delaying this flag
    // allowed a fast frame switch to miss the save and discard the edit.
    const editsBoundFrame = get().boundFrameRef !== null
    const { history, historyIndex } = get()
    const newState = structureSnapshot(get())
    // Truncate forward history if we're not at the end (discard redo states)
    const sliceEnd = historyIndex < 0 ? 0 : historyIndex + 1
    const newHistory = history.slice(0, sliceEnd)
    newHistory.push(newState)
    if (newHistory.length > 50) newHistory.shift()
    set({
      history: newHistory,
      historyIndex: newHistory.length - 1,
      lastHistoryDomain: 'structure',
      ...(editsBoundFrame ? { boundFrameDirty: true } : {}),
    })
  },

  resetStructureHistory: () => set({
    history: [],
    historyIndex: -1,
    lastHistoryDomain: 'structure',
  }),

  undo: () => {
    const { history, historyIndex, boundFrameRef } = get()
    if (historyIndex >= 0 && history[historyIndex]) {
      const currentState = structureSnapshot(get())
      const prevState = history[historyIndex]
      // The action that created this history entry belongs to the MODEL frame
      // recorded by the pre-edit snapshot. Moving the playhead before Undo must
      // not reassign the redo document to that later viewing frame.
      if (currentState.biomoleculePresentation && prevState.biomoleculePresentation) {
        const editedFrame = prevState.trajectoryCurrentFrame
        const editedStructure = clone(currentState.biomoleculePresentation.structure)
        const editedTrajectoryFrames = clone(currentState.trajectoryFrames)
        const currentFrame = currentState.trajectoryCurrentFrame
        const editedFrameSource = currentState.biomoleculePresentation.structure.frames[editedFrame]
        const editedAtoms = currentState.atoms.map((atom, atomIndex) => {
          if (!editedFrameSource) return clone(atom)
          const offset = atomIndex * 3
          const cartesian: [number, number, number] = [
            editedFrameSource.positions[offset],
            editedFrameSource.positions[offset + 1],
            editedFrameSource.positions[offset + 2],
          ]
          return { ...clone(atom), position: [...cartesian] as [number, number, number], cartesian }
        })
        const currentFrameData = editedTrajectoryFrames?.[currentFrame]
        if (currentFrameData) {
          currentFrameData.atoms = currentFrameData.atoms.map((atom, atomIndex) => {
            const original = prevState.trajectoryFrames?.[currentFrame]?.atoms[atomIndex]
            return original ? clone(original) : atom
          })
        }
        const editedFrameData = editedTrajectoryFrames?.[editedFrame]
        if (editedFrameData) editedFrameData.atoms = editedFrameData.atoms.map((atom, atomIndex) => {
          const edited = editedAtoms[atomIndex]
          if (!edited?.cartesian) return atom
          return {
            ...atom,
            position: [...edited.cartesian] as [number, number, number],
            cartesian: [...edited.cartesian] as [number, number, number],
          }
        })
        const editedBioFrame = editedStructure.frames[editedFrame]
        if (editedBioFrame) {
          const positions = new Float32Array(editedAtoms.length * 3)
          editedAtoms.forEach((atom, atomIndex) => {
            const position = atom.cartesian ?? atom.position
            const offset = atomIndex * 3
            positions[offset] = position[0]
            positions[offset + 1] = position[1]
            positions[offset + 2] = position[2]
          })
          editedStructure.frames[editedFrame] = { ...editedBioFrame, positions }
          editedStructure.atoms = editedStructure.atoms.map((atom, atomIndex) => {
            const edited = editedAtoms[atomIndex]
            const position = edited?.cartesian ?? edited?.position
            return position ? { ...atom, position: [...position] as [number, number, number] } : atom
          })
        }
        currentState.trajectoryCurrentFrame = editedFrame
        currentState.trajectoryFrames = editedTrajectoryFrames
        currentState.atoms = editedAtoms
        currentState.biomoleculePresentation = {
          ...currentState.biomoleculePresentation,
          structure: editedStructure,
        }
      }
      const newHistory = [...history]
      // Insert current state after historyIndex for redo
      if (historyIndex === history.length - 1) {
        newHistory.push(currentState)
      } else {
        newHistory[historyIndex + 1] = currentState
      }
      restoreHistorySnapshot(set, get, prevState, {
        history: newHistory,
        historyIndex: historyIndex - 1,
        selectedAtomIds: new Set(),
        focusedAtomIds: new Set(),
        ...(boundFrameRef ? { boundFrameDirty: true } : {}),
      })
    }
  },

  canUndo: () => get().historyIndex >= 0,

  redo: () => {
    const { history, historyIndex, boundFrameRef } = get()
    // historyIndex points at the next snapshot Undo would restore. Undo stores the
    // state it left at index + 1, then decrements the index, so Redo advances to
    // index + 2 (index + 1 is the state currently on screen).
    const redoIndex = historyIndex + 2
    if (redoIndex < history.length) {
      const nextState = history[redoIndex]
      restoreHistorySnapshot(set, get, nextState, {
        historyIndex: historyPositionAfterRestoring(redoIndex),
        selectedAtomIds: new Set(),
        focusedAtomIds: new Set(),
        ...(boundFrameRef ? { boundFrameDirty: true } : {}),
      })
    }
  },

  canRedo: () => {
    const { history, historyIndex } = get()
    return historyIndex + 2 < history.length
  },

  // ── Assembly undo/redo ──────────────────────────
  pushAssemblyHistory: () => {
    const { sceneObjects, buildingBlocks, assemblyScenes, assemblyHistory, assemblyHistoryIndex } = get()
    const newState: AssemblyHistoryState = {
      sceneObjects: JSON.parse(JSON.stringify(sceneObjects)),
      buildingBlocks: JSON.parse(JSON.stringify(buildingBlocks)),
      assemblyScenes: JSON.parse(JSON.stringify(assemblyScenes)),
    }
    const sliceEnd = assemblyHistoryIndex < 0 ? 0 : assemblyHistoryIndex + 1
    const newHistory = assemblyHistory.slice(0, sliceEnd)
    newHistory.push(newState)
    if (newHistory.length > 50) newHistory.shift()
    set({ assemblyHistory: newHistory, assemblyHistoryIndex: newHistory.length - 1, lastHistoryDomain: 'assembly' })
  },

  undoAssembly: () => {
    const { sceneObjects, buildingBlocks, assemblyScenes, assemblyHistory, assemblyHistoryIndex } = get()
    if (assemblyHistoryIndex >= 0 && assemblyHistory[assemblyHistoryIndex]) {
      const currentState: AssemblyHistoryState = {
        sceneObjects: JSON.parse(JSON.stringify(sceneObjects)),
        buildingBlocks: JSON.parse(JSON.stringify(buildingBlocks)),
        assemblyScenes: JSON.parse(JSON.stringify(assemblyScenes)),
      }
      const prevState = assemblyHistory[assemblyHistoryIndex]
      const newHistory = [...assemblyHistory]
      if (assemblyHistoryIndex === assemblyHistory.length - 1) {
        newHistory.push(currentState)
      } else {
        newHistory[assemblyHistoryIndex + 1] = currentState
      }
      set({
        sceneObjects: JSON.parse(JSON.stringify(prevState.sceneObjects)),
        buildingBlocks: JSON.parse(JSON.stringify(prevState.buildingBlocks)),
        assemblyScenes: JSON.parse(JSON.stringify(prevState.assemblyScenes)),
        assemblyHistory: newHistory,
        assemblyHistoryIndex: assemblyHistoryIndex - 1,
        selectedSceneObjectId: null,
      })
    }
  },

  redoAssembly: () => {
    const { assemblyHistory, assemblyHistoryIndex } = get()
    const redoIndex = assemblyHistoryIndex + 2
    if (redoIndex < assemblyHistory.length) {
      const nextState = assemblyHistory[redoIndex]
      set({
        sceneObjects: JSON.parse(JSON.stringify(nextState.sceneObjects)),
        buildingBlocks: JSON.parse(JSON.stringify(nextState.buildingBlocks)),
        assemblyScenes: JSON.parse(JSON.stringify(nextState.assemblyScenes)),
        assemblyHistoryIndex: assemblyHistoryIndex + 1,
        selectedSceneObjectId: null,
      })
    }
  },

  canUndoAssembly: () => get().assemblyHistoryIndex >= 0,
  canRedoAssembly: () => get().assemblyHistoryIndex + 2 < get().assemblyHistory.length,
})
