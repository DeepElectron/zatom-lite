import { create } from 'zustand'

import type { InspectionTarget } from '../agent/contracts'

export interface AgentInspectionOverlay {
  target: InspectionTarget
}

interface StructuralViewportState {
  atoms?: unknown
  unitCellAtoms?: unknown
  bonds?: unknown
  latticeVectors?: unknown
  supercellParams?: unknown
  periodic?: unknown
  compactStructure?: unknown
  trajectoryCurrentFrame?: unknown
}

interface StructuralViewportStore {
  getState: () => StructuralViewportState
  subscribe: (
    listener: (state: StructuralViewportState, previous: StructuralViewportState) => void,
  ) => () => void
}

interface AgentInspectionOverlayState {
  byViewport: Map<object, AgentInspectionOverlay>
  setOverlay: (viewport: object, overlay: AgentInspectionOverlay) => void
  clearOverlay: (viewport: object) => void
}

const structuralSubscriptions = new WeakMap<object, () => void>()

function isStructuralViewportStore(value: object): value is object & StructuralViewportStore {
  const candidate = value as Partial<StructuralViewportStore>
  return typeof candidate.getState === 'function' && typeof candidate.subscribe === 'function'
}

function cloneTarget(target: InspectionTarget): InspectionTarget {
  return {
    ...target,
    center: [...target.center],
    atomIds: [...target.atomIds],
  }
}

function structurePresentationChanged(
  state: StructuralViewportState,
  previous: StructuralViewportState,
): boolean {
  return state.atoms !== previous.atoms
    || state.unitCellAtoms !== previous.unitCellAtoms
    || state.bonds !== previous.bonds
    || state.latticeVectors !== previous.latticeVectors
    || state.supercellParams !== previous.supercellParams
    || state.periodic !== previous.periodic
    || state.compactStructure !== previous.compactStructure
    || state.trajectoryCurrentFrame !== previous.trajectoryCurrentFrame
}

function stopStructuralSubscription(viewport: object): void {
  structuralSubscriptions.get(viewport)?.()
  structuralSubscriptions.delete(viewport)
}

/**
 * Transient, viewport-local visual target. It is deliberately separate from the
 * canonical structure and clears as soon as the rendered structure or frame
 * changes, so a stale reticle can never survive as evidence for new geometry.
 */
export const useAgentInspectionOverlayStore = create<AgentInspectionOverlayState>((set, get) => ({
  byViewport: new Map(),

  setOverlay: (viewport, overlay) => {
    stopStructuralSubscription(viewport)
    const next = new Map(get().byViewport)
    next.set(viewport, {
      target: cloneTarget(overlay.target),
    })
    set({ byViewport: next })

    if (isStructuralViewportStore(viewport)) {
      const unsubscribe = viewport.subscribe((state, previous) => {
        if (structurePresentationChanged(state, previous)) {
          useAgentInspectionOverlayStore.getState().clearOverlay(viewport)
        }
      })
      structuralSubscriptions.set(viewport, unsubscribe)
    }
  },

  clearOverlay: (viewport) => {
    stopStructuralSubscription(viewport)
    const next = new Map(get().byViewport)
    next.delete(viewport)
    set({ byViewport: next })
  },
}))
