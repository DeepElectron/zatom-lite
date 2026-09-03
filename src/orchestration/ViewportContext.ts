import { createContext, useContext, useMemo } from 'react'
import { useStore } from 'zustand'
import { useCrystalStore, createCrystalStore } from './crystalStore'
import { useViewportManager } from './viewportManager'

type CrystalStoreHook = ReturnType<typeof createCrystalStore>
type CrystalState = ReturnType<CrystalStoreHook['getState']>

// ── Context: each ViewportCell provides its own store instance ──────────────
const ViewportStoreContext = createContext<CrystalStoreHook | null>(null)

// React's external-store snapshot must be referentially stable while Zustand's
// source state is unchanged. Cache the derived presentation view by source
// object so no-selector Canvas consumers can safely read the whole state.
const presentationStateCache = new WeakMap<CrystalState, CrystalState>()

function presentationState(state: CrystalState): CrystalState {
  if (!state.presentationStylePreview) return state
  const cached = presentationStateCache.get(state)
  if (cached) return cached
  const effective = { ...state, ...state.presentationStylePreview }
  presentationStateCache.set(state, effective)
  return effective
}

export const ViewportStoreProvider = ViewportStoreContext.Provider

// ── Used by components within a viewport ───────────────────────────────────
// Hook mode: used during React rendering to read the current viewport's store.
// .getState() mode: used in event callbacks to read the active viewport's store.
//   Users can only operate the active viewport, so this is correct for callbacks.
// With no selector, the overload returns the entire CrystalState, like Zustand's native hook.
//
// react-hooks/rules-of-hooks false positive: this hook selects a store based on
// ViewportStoreContext availability, the standard Zustand + React Context pattern.
// The Provider is stable for each render (switching it remounts the subtree), so
// the actual hook call order remains consistent.
function _useViewportStoreHook(): CrystalState
function _useViewportStoreHook<T>(selector: (state: CrystalState) => T): T
function _useViewportStoreHook<T>(selector?: (state: CrystalState) => T): T | CrystalState {
  const store = useContext(ViewportStoreContext)
  if (!store) {
    if (selector) {
      // eslint-disable-next-line react-hooks/rules-of-hooks
      return useCrystalStore((state) => selector(presentationState(state)))
    }
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useCrystalStore(presentationState)
  }
  if (selector) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useStore(store, (state) => selector(presentationState(state)))
  }
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useStore(store, presentationState)
}

type CrystalStateSetter =
  | Partial<CrystalState>
  | ((state: CrystalState) => Partial<CrystalState>)

export const useViewportStore = Object.assign(
  _useViewportStoreHook,
  {
    getState: () => {
      const mgr = useViewportManager.getState()
      return mgr.getActiveStore().getState()
    },
    setState: (partial: CrystalStateSetter, replace?: false) => {
      const mgr = useViewportManager.getState()
      return mgr.getActiveStore().setState(partial as Partial<CrystalState>, replace)
    },
    subscribe: (...args: Parameters<CrystalStoreHook['subscribe']>) => {
      const mgr = useViewportManager.getState()
      return mgr.getActiveStore().subscribe(...args)
    },
  },
)

// ── Used by surrounding panels to read the active viewport's store ─────────
// As above, the store branch depends on ViewportStore availability; activeId and
// viewport availability remain stable within each render, preserving hook order.
export function useActiveViewportStore<T>(selector: (state: CrystalState) => T): T {
  const activeId = useViewportManager((s) => s.activeViewportId)
  const viewports = useViewportManager((s) => s.viewports)
  const store = useMemo(() => {
    const slot = viewports[activeId]
    if (!slot || slot.kind !== 'crystal') return null
    return slot.storeInstance as unknown as CrystalStoreHook
  }, [activeId, viewports])

  if (!store) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useCrystalStore(selector)
  }
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useStore(store, selector)
}

// ── Imperative access to the active viewport ────
export function getActiveViewportStoreApi(): CrystalStoreHook {
  const mgr = useViewportManager.getState()
  return mgr.getActiveStore()
}

// ── Components read their own viewport store API (not necessarily active) ──
// The visual-modeling screenshot registry is keyed by this identity. Each Canvas
// registers against its own viewport store so captureViewport can resolve the
// exact canvas for the active store.
export function useViewportStoreApi(): CrystalStoreHook {
  const store = useContext(ViewportStoreContext)
  return store ?? useCrystalStore
}

// ── Drop-in replacement for panels ──────────
// As above, selector presence chooses between two useActiveViewportStore call
// forms consistently across renders; ESLint cannot prove that statically.
function _useActiveCrystalStoreHook(): CrystalState
function _useActiveCrystalStoreHook<T>(selector: (state: CrystalState) => T): T
function _useActiveCrystalStoreHook<T>(
  selector?: (state: CrystalState) => T,
): T | CrystalState {
  return selector
    // eslint-disable-next-line react-hooks/rules-of-hooks
    ? useActiveViewportStore(selector)
    // eslint-disable-next-line react-hooks/rules-of-hooks
    : useActiveViewportStore((s) => s as unknown as T)
}

export const useActiveCrystalStore = Object.assign(_useActiveCrystalStoreHook, {
  getState: () => getActiveViewportStoreApi().getState(),
  setState: (partial: CrystalStateSetter, replace?: false) =>
    getActiveViewportStoreApi().setState(partial as Partial<CrystalState>, replace),
  subscribe: (...args: Parameters<CrystalStoreHook['subscribe']>) =>
    getActiveViewportStoreApi().subscribe(...args),
})
