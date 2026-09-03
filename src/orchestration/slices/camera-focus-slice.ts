/**
 * camera-focus-slice — camera targets, animation, atom focus, and large-scene visual focus.
 *
 * focusOnAtoms computes the selected atoms' geometric center and estimates a
 * suitable distance for the current viewMode and visual atom radii. Selections of
 * at most 70 atoms also persist massiveSceneVisualFocusXxx for large-scene highlighting.
 *
 * clearFocusedAtoms returns the camera to initialCameraPosition/LookAt, when set,
 * and clears focusedAtomIds. Without an initial pose it only clears focus.
 *
 * State:
 *   - cameraTarget / isAnimatingCamera: current target and animation flag
 *   - focusedAtomIds: currently focused atoms
 *   - initialCameraPosition/LookAt: viewport-mount pose used for reset
 *   - savedCameraState: pose preserved across viewport switches
 *   - cameraAutoResetVersion: counter watched externally to trigger reset
 *   - massiveSceneVisualFocus*: persistent visual focus for large scenes
 *
 * Cross-slice: focusOnAtoms reads atoms, viewMode, and atomScale.
 */

import type { StateCreator } from 'zustand'
import { getElement } from '../../lib/crystal/elements'
import type { BioCameraPose } from '../../lib/biomolecule/camera-track'
import {
  cameraSceneClearanceFromBounds,
  cameraSceneClearanceFromPoints,
  focusFramingSpan,
} from '../../lib/render/camera-framing'
import type { CameraTarget, CrystalStore } from '../crystal-store-types'

export interface CameraFocusSlice {
  cameraTarget: CameraTarget | null
  isAnimatingCamera: boolean
  focusedAtomIds: Set<string>
  initialCameraPosition: [number, number, number] | null
  initialCameraLookAt: [number, number, number] | null
  initialCameraZoom: number | null
  savedCameraState: BioCameraPose | null
  setSavedCameraState: (state: BioCameraPose | null) => void
  cameraAutoResetVersion: number
  /**
   * Cumulative number of camera flights interrupted by manual user control.
   *
   * A counter distinguishes interruption from normal completion because both end at
   * isAnimatingCamera=false and cameraTarget=null. A boolean can also become stale
   * between drill-down legs. Callers compare the monotonic count before and after a
   * leg, following the cameraAutoResetVersion convention.
   */
  cameraFlightInterruptions: number
  massiveSceneVisualFocusAtomIds: Set<string>
  massiveSceneVisualFocusCenter: [number, number, number] | null
  massiveSceneVisualFocusDistance: number | null

  /** For periodic images, retain the canonical atom ID but fly to the clicked copy's displayCenter. */
  focusOnAtoms: (atomIds: string[], displayCenter?: [number, number, number]) => void
  /** Animate the camera to a 3D point (no Atom needed). Used by compact mode where
   *  the bulk lives in typed arrays, not store.atoms. `spread` ≈ the radius of the
   *  region to frame. Dollies to a fitting distance, preserving the view angle. */
  /** Omit `durationMs` for the camera-controller default; drill-down legs pass it based on span. */
  focusOnPoint: (center: [number, number, number], spread: number, durationMs?: number) => void
  clearFocusedAtoms: () => void
  clearMassiveSceneVisualFocus: () => void
  /** Bump cameraAutoResetVersion so the camera-controller re-fits to the current
   *  atoms. Loaders that bypass loadFromXYZ/regenerateSupercell (e.g. setAtomsDirectly
   *  for generated molecule-mode structures) must call this, or Home/reset keeps a
   *  stale initial view. */
  triggerCameraAutoReset: () => void
  /** Start a new camera document without inheriting any pose/focus from its predecessor. */
  beginCameraDocument: () => void
  resetCameraToInitial: () => void
  setCameraTarget: (target: CameraTarget | null) => void
  setIsAnimatingCamera: (isAnimating: boolean) => void
  /**
   * Abort the current flight and leave the camera where it is, without snapping back
   * or resuming. Dragging must immediately return control to the user.
   */
  abortCameraFlight: () => void
  setInitialCameraPosition: (
    position: [number, number, number],
    lookAt: [number, number, number],
    zoom?: number,
  ) => void
}

function clearedFocusPatch() {
  return {
    focusedAtomIds: new Set<string>(),
    massiveSceneVisualFocusAtomIds: new Set<string>(),
    massiveSceneVisualFocusCenter: null,
    massiveSceneVisualFocusDistance: null,
    // Clear the drill level with focus here so every focus-clearing path also removes
    // the emphasis layer; handling call sites separately could leave stale emphasis.
    bioDrillLevel: null,
  }
}

function initialCameraTarget(state: CameraFocusSlice): CameraTarget | null {
  if (!state.initialCameraPosition || !state.initialCameraLookAt) return null
  return {
    position: [...state.initialCameraPosition],
    lookAt: [...state.initialCameraLookAt],
    ...(state.initialCameraZoom == null ? {} : { zoom: state.initialCameraZoom }),
    forceOrientation: true,
  }
}

function focusVisualRadius(
  element: string,
  viewMode: CrystalStore['viewMode'],
  atomScale: number,
  radiusScale: number,
  bondRadius: number,
): number {
  const elementRadius = getElement(element).radius
  if (viewMode === 'space-fill') return elementRadius
  if (viewMode === 'wireframe') return elementRadius * atomScale * .15
  if (viewMode === 'stick' || viewMode === 'hyper-stick') return bondRadius
  return elementRadius * radiusScale
}

export const createCameraFocusSlice: StateCreator<CrystalStore, [], [], CameraFocusSlice> = (set, get) => ({
  cameraTarget: null,
  isAnimatingCamera: false,
  focusedAtomIds: new Set<string>(),
  initialCameraPosition: null,
  initialCameraLookAt: null,
  initialCameraZoom: null,
  savedCameraState: null,
  setSavedCameraState: (state) => set({ savedCameraState: state }),
  cameraAutoResetVersion: 0,
  cameraFlightInterruptions: 0,
  triggerCameraAutoReset: () => set((state) => ({ cameraAutoResetVersion: state.cameraAutoResetVersion + 1 })),
  beginCameraDocument: () => set((state) => ({
    savedCameraState: null,
    initialCameraPosition: null,
    initialCameraLookAt: null,
    initialCameraZoom: null,
    cameraTarget: null,
    isAnimatingCamera: false,
    ...clearedFocusPatch(),
    cameraAutoResetVersion: state.cameraAutoResetVersion + 1,
  })),
  massiveSceneVisualFocusAtomIds: new Set<string>(),
  massiveSceneVisualFocusCenter: null,
  massiveSceneVisualFocusDistance: null,

  focusOnAtoms: (atomIds, displayCenter) => {
    const { atoms, viewMode, atomScale, radiusScale, bondRadius, cameraProjection } = get()
    // Use a Set: layer-wide focus would make array lookup O(atom count × layer atom
    // count), blocking the main thread for Base layers with tens of thousands of atoms.
    const wantedIds = new Set(atomIds)
    const selectedAtoms = atoms.filter(a => wantedIds.has(a.id))

    if (selectedAtoms.length === 0) return
    get().pausePresentation()

    let centerX = 0, centerY = 0, centerZ = 0
    for (const atom of selectedAtoms) {
      const position = atom.cartesian ?? atom.position
      centerX += position[0]
      centerY += position[1]
      centerZ += position[2]
    }
    centerX /= selectedAtoms.length
    centerY /= selectedAtoms.length
    centerZ /= selectedAtoms.length

    // Periodic copies share a canonical ID, so store.atoms cannot identify the clicked
    // copy. The renderer supplies world coordinates for a single image; multi-select
    // still uses the canonical geometric center.
    if (displayCenter && selectedAtoms.length === 1) {
      ;[centerX, centerY, centerZ] = displayCenter
    }

    let maxSpread = 0
    let maxVisualRadius = 0
    for (const atom of selectedAtoms) {
      const position = displayCenter && selectedAtoms.length === 1
        ? displayCenter
        : atom.cartesian ?? atom.position
      const dx = position[0] - centerX
      const dy = position[1] - centerY
      const dz = position[2] - centerZ
      maxSpread = Math.max(maxSpread, Math.sqrt(dx * dx + dy * dy + dz * dz))

      const visualRadius = focusVisualRadius(atom.element, viewMode, atomScale, radiusScale, bondRadius)
      if (visualRadius > maxVisualRadius) {
        maxVisualRadius = visualRadius
      }
    }

    const spreadDistance = selectedAtoms.length === 1
      ? maxSpread * 4.5 + 4
      : maxSpread * 3.2 + 2.5
    const radiusDistance = selectedAtoms.length === 1
      ? maxVisualRadius * 8.5 + 4.5
      : maxVisualRadius * 4.5 + 3
    const distance = Math.max(
      spreadDistance,
      radiusDistance,
      selectedAtoms.length === 1 ? 10.5 : 7.5,
    )
    const framingSpan = focusFramingSpan(maxSpread, maxVisualRadius)
    let maxSceneVisualRadius = 0
    for (const atom of atoms) {
      maxSceneVisualRadius = Math.max(
        maxSceneVisualRadius,
        focusVisualRadius(atom.element, viewMode, atomScale, radiusScale, bondRadius),
      )
    }
    const sceneClearance = cameraSceneClearanceFromPoints(
      atoms.map((atom) => atom.cartesian ?? atom.position),
      [centerX, centerY, centerZ],
      maxSceneVisualRadius,
    )
    const visualFocusDistance = cameraProjection === 'orthographic'
      ? Math.max(distance, sceneClearance)
      : distance
    const shouldPersistVisualFocus = atomIds.length <= 70

    set({
      cameraTarget: {
        position: [centerX, centerY, centerZ],
        lookAt: [centerX, centerY, centerZ],
        preserveViewDirection: true,
        distance,
        framingSpan,
        sceneClearance,
        scenePadding: maxSceneVisualRadius,
      },
      isAnimatingCamera: true,
      focusedAtomIds: new Set(atomIds),
      massiveSceneVisualFocusAtomIds: shouldPersistVisualFocus ? new Set(atomIds) : new Set<string>(),
      massiveSceneVisualFocusCenter: shouldPersistVisualFocus ? [centerX, centerY, centerZ] : null,
      massiveSceneVisualFocusDistance: shouldPersistVisualFocus ? visualFocusDistance : null,
    })
  },

  focusOnPoint: (center, spread, durationMs) => {
    get().pausePresentation()
    const distance = Math.max(spread * 3.2 + 4, 12)
    const compactBounds = get().compactStructure?.bbox
    set({
      cameraTarget: {
        position: [center[0], center[1], center[2]],
        lookAt: [center[0], center[1], center[2]],
        preserveViewDirection: true,
        distance,
        framingSpan: focusFramingSpan(spread, 0),
        ...(compactBounds
          ? { sceneClearance: cameraSceneClearanceFromBounds(compactBounds, center) }
          : {}),
        ...(durationMs === undefined ? {} : { durationMs }),
      },
      isAnimatingCamera: true,
    })
  },

  clearFocusedAtoms: () => {
    get().pausePresentation()
    const target = initialCameraTarget(get())
    if (target) {
      set({
        ...clearedFocusPatch(),
        cameraTarget: target,
        isAnimatingCamera: true,
      })
    } else {
      set({ ...clearedFocusPatch(), cameraTarget: null, isAnimatingCamera: false })
    }
  },

  resetCameraToInitial: () => {
    get().pausePresentation()
    const target = initialCameraTarget(get())
    if (target) {
      set({
        cameraTarget: target,
        isAnimatingCamera: true,
        ...clearedFocusPatch(),
      })
    } else {
      set({ ...clearedFocusPatch(), cameraTarget: null, isAnimatingCamera: false })
    }
  },

  clearMassiveSceneVisualFocus: () => {
    set({
      massiveSceneVisualFocusAtomIds: new Set<string>(),
      massiveSceneVisualFocusCenter: null,
      massiveSceneVisualFocusDistance: null,
    })
  },

  setCameraTarget: (target) => set({ cameraTarget: target }),
  setIsAnimatingCamera: (isAnimating) => set({ isAnimatingCamera: isAnimating }),
  abortCameraFlight: () => set((state) => (
    // Count only active flights; ordinary drags must not look like drill-down interruptions.
    state.isAnimatingCamera || state.cameraTarget
      ? {
        cameraTarget: null,
        isAnimatingCamera: false,
        cameraFlightInterruptions: state.cameraFlightInterruptions + 1,
      }
      : state
  )),
  setInitialCameraPosition: (position, lookAt, zoom) => set({
    initialCameraPosition: position,
    initialCameraLookAt: lookAt,
    initialCameraZoom: Number.isFinite(zoom) && (zoom ?? 0) > 0 ? zoom! : null,
  }),
})
