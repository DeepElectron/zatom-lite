/**
 * Groups three closely related sets of visual and performance settings:
 *
 *   1) UI rendering: viewMode (ball-stick, space-fill, etc.), toolMode,
 *      selectedElement + showBonds/Lattice + atomScale/bondScale + focusedAtomOpacity
 *      + focusFadesBonds
 *
 *   2) Periodic-direction controls for Assembly export: periodicDirs + freeDirPadding
 *
 *   3) Performance / LOD: lodThreshold (instanced-rendering threshold) + ultraLowThreshold
 *      + useLowDetailMode + useUltraLowMode + solidBoxManual + massive/veryLargeSceneThreshold
 *      + adaptivePerformance{Enabled,Level,Dpr} + interactionPerformanceActive
 *
 * Setters clamp opacity to [0.1, 1], adaptive level to [0, 3], DPR to
 * [0.75, 2], and the applicable scales to their documented ranges.
 * Leaving drag-atom mode disables translateMode across slices. Setting the
 * solid-box override also updates useUltraLowMode, which drives viewport rendering.
 */

import type { StateCreator } from 'zustand'
import type {
  AtomLabelContent,
  AtomLabelPosition,
  AtomLabelScope,
  ToolMode,
  ViewMode,
} from '../../lib/crystal/types'
import type { BondAnnotation, BondToolSubmode, CrystalStore } from '../crystal-store-types'
import { isCellOverflowMode, type CellOverflowMode } from '../../lib/crystal/cell-overflow'

/**
 * Modeler mouse preset defining OrbitControls.mouseButtons for LMB/MMB/RMB.
 *
 *  - 'default'  L=rotate · M=dolly · R=pan  (Three.js default, like PyMOL/Chimera)
 *  - 'maestro'  L=rotate · M=pan · R=dolly  (Schrödinger Maestro style)
 *  - 'gaussian' L=rotate · M=pan · R=pan   (GaussView style; wheel-only dolly)
 *
 * This controls mouse-button roles only, not modifier keys. Wheel-only dolly
 * leaves RMB for panning to improve one-handed operation.
 */
export type CameraControlPreset = 'default' | 'maestro' | 'gaussian'
export type CameraProjection = 'perspective' | 'orthographic'

/** Four snap target classes matching geometry-snap SnapKind and pick priority:
 *  - atomCenter   atom center
 *  - division     midpoint or fractional point on a segment (1/2, 1/3, 2/3, 1/4, 3/4)
 *  - extension    point beyond a segment or free perpendicular projection onto its line
 *  - intersection intersection of two lines, including their extensions */
export interface GeometrySnapTargets {
  atomCenter: boolean
  division: boolean
  extension: boolean
  intersection: boolean
}

const CAMERA_PRESET_STORAGE_KEY = 'zatom:modeler:cameraPreset'
const CAMERA_PROJECTION_STORAGE_KEY = 'zatom:modeler:cameraProjection'

function loadCameraPresetFromStorage(): CameraControlPreset {
  if (typeof window === 'undefined') return 'default'
  try {
    const raw = window.localStorage.getItem(CAMERA_PRESET_STORAGE_KEY)
    if (raw === 'maestro' || raw === 'gaussian' || raw === 'default') return raw
  } catch {
    /* Fall back to the default when localStorage is unavailable in private mode or SSR. */
  }
  return 'default'
}

function saveCameraPresetToStorage(preset: CameraControlPreset): void {
  if (typeof window === 'undefined') return
  try { window.localStorage.setItem(CAMERA_PRESET_STORAGE_KEY, preset) } catch { /* ignore */ }
}

function loadCameraProjectionFromStorage(): CameraProjection {
  if (typeof window === 'undefined') return 'perspective'
  try {
    const raw = window.localStorage.getItem(CAMERA_PROJECTION_STORAGE_KEY)
    if (raw === 'perspective' || raw === 'orthographic') return raw
  } catch {
    /* Fall back to the default when localStorage is unavailable in private mode or SSR. */
  }
  return 'perspective'
}

function saveCameraProjectionToStorage(projection: CameraProjection): void {
  if (typeof window === 'undefined') return
  try { window.localStorage.setItem(CAMERA_PROJECTION_STORAGE_KEY, projection) } catch { /* ignore */ }
}

// When false, selecting or adding atoms skips focusOnAtoms and preserves the
// current view during rapid modeling. Defaults to true.
const AUTO_FOCUS_ON_ATOM_STORAGE_KEY = 'zatom:modeler:autoFocusOnAtom'

function loadAutoFocusOnAtomFromStorage(): boolean {
  if (typeof window === 'undefined') return true
  try {
    return window.localStorage.getItem(AUTO_FOCUS_ON_ATOM_STORAGE_KEY) !== 'false'
  } catch {
    return true
  }
}

function saveAutoFocusOnAtomToStorage(enabled: boolean): void {
  if (typeof window === 'undefined') return
  try { window.localStorage.setItem(AUTO_FOCUS_ON_ATOM_STORAGE_KEY, String(enabled)) } catch { /* ignore */ }
}

// Optional extended tooltips. Native title text remains available when disabled;
// the animated dwell treatment is opt-in so it never competes with modeling.
const HOVER_HINTS_STORAGE_KEY = 'zatom:modeler:hoverHints'

function loadHoverHintsFromStorage(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(HOVER_HINTS_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

function saveHoverHintsToStorage(enabled: boolean): void {
  if (typeof window === 'undefined') return
  try { window.localStorage.setItem(HOVER_HINTS_STORAGE_KEY, String(enabled)) } catch { /* ignore */ }
}

// Geometry snapping is enabled by default and shows candidates in add-atom mode
// when exactly two atoms are selected.
const GEOMETRY_SNAP_STORAGE_KEY = 'zatom:modeler:geometrySnap'

function loadGeometrySnapFromStorage(): boolean {
  if (typeof window === 'undefined') return true
  try {
    return window.localStorage.getItem(GEOMETRY_SNAP_STORAGE_KEY) !== 'false'
  } catch {
    return true
  }
}

function saveGeometrySnapToStorage(enabled: boolean): void {
  if (typeof window === 'undefined') return
  try { window.localStorage.setItem(GEOMETRY_SNAP_STORAGE_KEY, String(enabled)) } catch { /* ignore */ }
}

// Per-class snap switches apply only while geometrySnapEnabled is true. Store all
// four in one object and storage key so each class does not need separate persistence.
const SNAP_TARGETS_STORAGE_KEY = 'zatom:modeler:geometrySnapTargets'

const DEFAULT_SNAP_TARGETS: GeometrySnapTargets = {
  atomCenter: true,
  division: true,
  extension: true,
  intersection: true,
}

function loadSnapTargetsFromStorage(): GeometrySnapTargets {
  if (typeof window === 'undefined') return { ...DEFAULT_SNAP_TARGETS }
  try {
    const raw = window.localStorage.getItem(SNAP_TARGETS_STORAGE_KEY)
    if (!raw) return { ...DEFAULT_SNAP_TARGETS }
    const parsed = JSON.parse(raw) as Partial<GeometrySnapTargets>
    // Validate each key independently so missing or invalid stored values fall back safely.
    return {
      atomCenter: typeof parsed.atomCenter === 'boolean' ? parsed.atomCenter : true,
      division: typeof parsed.division === 'boolean' ? parsed.division : true,
      extension: typeof parsed.extension === 'boolean' ? parsed.extension : true,
      intersection: typeof parsed.intersection === 'boolean' ? parsed.intersection : true,
    }
  } catch {
    return { ...DEFAULT_SNAP_TARGETS }
  }
}

function saveSnapTargetsToStorage(targets: GeometrySnapTargets): void {
  if (typeof window === 'undefined') return
  try { window.localStorage.setItem(SNAP_TARGETS_STORAGE_KEY, JSON.stringify(targets)) } catch { /* ignore */ }
}


/**
 * Semantics for atoms moved outside the unit cell; see lib/crystal/cell-overflow.
 * The default 'tile-images' retains canonical in-cell coordinates while rendering
 * the image to which the atom was dragged, without jumping or changing lattice constants.
 */
const CELL_OVERFLOW_MODE_STORAGE_KEY = 'zatom:modeler:cellOverflowMode'

function loadCellOverflowModeFromStorage(): CellOverflowMode {
  if (typeof window === 'undefined') return 'tile-images'
  try {
    const raw = window.localStorage.getItem(CELL_OVERFLOW_MODE_STORAGE_KEY)
    return isCellOverflowMode(raw) ? raw : 'tile-images'
  } catch {
    return 'tile-images'
  }
}

function saveCellOverflowModeToStorage(mode: CellOverflowMode): void {
  if (typeof window === 'undefined') return
  try { window.localStorage.setItem(CELL_OVERFLOW_MODE_STORAGE_KEY, mode) } catch { /* ignore */ }
}

/**
 * Independent switch for completing molecules across boundaries along chemical bonds.
 *
 * This is orthogonal to the three overflow modes: they control atoms moved out
 * of the cell, while this controls whether cross-boundary molecules render continuously.
 *
 * For a molecule with O at f=0.98 and H wrapped to f=0.02, enabling this chooses
 * the continuous periodic image along each bond instead of drawing a box-spanning bond.
 */
const WHOLE_MOLECULES_STORAGE_KEY = 'zatom:modeler:wholeMolecules'

function loadWholeMoleculesFromStorage(): boolean {
  if (typeof window === 'undefined') return false
  try { return window.localStorage.getItem(WHOLE_MOLECULES_STORAGE_KEY) === 'true' } catch { return false }
}

function saveWholeMoleculesToStorage(enabled: boolean): void {
  if (typeof window === 'undefined') return
  try { window.localStorage.setItem(WHOLE_MOLECULES_STORAGE_KEY, String(enabled)) } catch { /* ignore */ }
}

export interface ViewSettingsSlice {
  viewMode: ViewMode
  toolMode: ToolMode
  /** Current Bond tool submode: select, create a bond, annotate a link, or show contacts. */
  bondToolSubmode: BondToolSubmode
  /** Updates the stored submode preference without changing toolMode or selectMode. */
  setBondToolSubmode: (submode: BondToolSubmode) => void
  /**
   * Activates a bond operation by setting its submode and corresponding toolMode/selectMode.
   * This is the canonical mapping used by toolbar, submode strip, and keyboard actions.
   */
  activateBondSubmode: (submode: BondToolSubmode) => void
  /** Annotation kind created by Link mode: custom, hydrogen-bond, or salt-bridge. */
  bondAnnotationKind: BondAnnotation['kind']
  setBondAnnotationKind: (kind: BondAnnotation['kind']) => void
  /** View-only Link annotations; these are not written to bonds. */
  bondAnnotations: BondAnnotation[]
  /** Toggles an annotation for an atom pair, removing an existing one or adding a new one. */
  addBondAnnotation: (atomId1: string, atomId2: string) => void
  removeBondAnnotation: (id: string) => void
  clearBondAnnotations: () => void
  selectedElement: string
  showBonds: boolean
  showLattice: boolean
  /** Optional subdivisions inside the current supercell boundary. */
  showCellGrid: boolean
  /** Element-symbol labels rendered above ordinary crystal and molecule atoms. */
  showAtomLabels: boolean
  atomLabelSize: number
  /** null derives contrast from the viewport background; otherwise uses the chosen color. */
  atomLabelColor: string | null
  atomLabelScope: AtomLabelScope
  atomLabelContent: AtomLabelContent
  atomLabelOutline: boolean
  atomLabelPosition: AtomLabelPosition
  atomLabelGap: number
  /** Whether selecting or adding atoms focuses the camera; false preserves the current view. */
  autoFocusOnAtom: boolean
  /** Whether prolonged button hover shows the radial progress hint; defaults to true. */
  hoverHintsEnabled: boolean
  /** Master geometry-snap switch for add-atom and drag-atom modes; defaults to true.
   *  When enabled, geometrySnapTargets selects the active target classes. */
  geometrySnapEnabled: boolean
  /** Per-class snap switches, effective only while the master switch is enabled. */
  geometrySnapTargets: GeometrySnapTargets
  setGeometrySnapTarget: (target: keyof GeometrySnapTargets, enabled: boolean) => void
  /**
   * Semantics for atoms moved outside the unit cell: expand the cell, retain the
   * cell and tile images, or wrap atoms back inside. Defaults to 'tile-images'.
   */
  cellOverflowMode: CellOverflowMode
  setCellOverflowMode: (mode: CellOverflowMode) => void
  /** Renders cross-boundary molecules continuously along bonds, independently of overflow mode. */
  wholeMolecules: boolean
  setWholeMolecules: (enabled: boolean) => void
  /** Shows periodic image atoms at cell boundaries, such as 4 FCC atoms as 14 spheres.
   *  Images share source IDs, so picking one selects its source. Rendering only; defaults to false. */
  showPeriodicImages: boolean
  /** Hides hydrogen, including D/T, together with its bonds and labels. Rendering only. */
  hideHydrogens: boolean
  /** Hydrogens retained while hiding others, as 1-based display indices such as `1,3,5-8`.
   *  See lib/render/hydrogen-visibility. */
  keptHydrogens: string
  /** Draws three orthogonal mechanism-diagram rings around each ball-stick or space-fill atom. */
  showAtomRings: boolean
  /** Shows draggable CELL "Resize in 3D" handles that update a/b/c in real time. */
  cellResizeMode: boolean
  /** Whether cell contents scale at fixed fractional coordinates; false resizes only the box. */
  cellResizeScaleContents: boolean
  /** Whether a cell handle is being dragged, used to lock camera OrbitControls. */
  cellResizeDragging: boolean
  atomScale: number
  bondScale: number
  /** Element-radius variation in [0, 1]: 1 preserves differences; 0 uses the smallest radius. */
  elementRadiusVariance: number
  periodicDirs: { a: boolean; b: boolean; c: boolean }
  setPeriodicDirs: (dirs: { a: boolean; b: boolean; c: boolean }) => void
  /** Axis-menu cleave request; the inspector opens slab-builder, prefills Miller, then clears it. */
  axisCleaveRequest: { h: number; k: number; l: number } | null
  requestAxisCleave: (miller: { h: number; k: number; l: number }) => void
  clearAxisCleaveRequest: () => void
  freeDirPadding: { a: [number, number]; b: [number, number]; c: [number, number] }
  setFreeDirPadding: (padding: { a: [number, number]; b: [number, number]; c: [number, number] }) => void
  focusedAtomOpacity: number
  focusFadesBonds: boolean

  lodThreshold: number
  ultraLowThreshold: number
  useLowDetailMode: boolean
  useUltraLowMode: boolean
  solidBoxManual: boolean
  setSolidBoxManual: (enabled: boolean) => void
  massiveSceneThreshold: number
  veryLargeSceneThreshold: number
  setMassiveSceneThreshold: (v: number) => void
  setVeryLargeSceneThreshold: (v: number) => void
  adaptivePerformanceEnabled: boolean
  adaptivePerformanceLevel: number
  adaptivePerformanceDpr: number
  interactionPerformanceActive: boolean

  /** Mouse-button preset; see CameraControlPreset. */
  cameraControlPreset: CameraControlPreset
  setCameraControlPreset: (preset: CameraControlPreset) => void
  cameraProjection: CameraProjection
  setCameraProjection: (projection: CameraProjection) => void

  /** Move-axis constraint. An a/b/c lock retains only displacement along that lattice axis;
   *  null permits free movement. 'auto' selects the dominant lattice axis per drag with
   *  hysteresis, then re-evaluates from the new position on the next drag. */
  dragAxisLock: 'auto' | 'a' | 'b' | 'c' | null
  /** Setting the current value again unlocks it; shared toggle behavior for pills and shortcuts. */
  setDragAxisLock: (axis: 'auto' | 'a' | 'b' | 'c' | null) => void

  setViewMode: (mode: ViewMode) => void
  setToolMode: (mode: ToolMode) => void
  setSelectedElement: (element: string) => void
  setShowBonds: (show: boolean) => void
  setShowLattice: (show: boolean) => void
  setShowCellGrid: (show: boolean) => void
  setShowAtomLabels: (show: boolean) => void
  setAtomLabelSize: (size: number) => void
  /** Pass null to restore automatic contrast against the background. */
  setAtomLabelColor: (color: string | null) => void
  setAtomLabelScope: (scope: AtomLabelScope) => void
  setAtomLabelContent: (content: AtomLabelContent) => void
  setAtomLabelOutline: (outline: boolean) => void
  setAtomLabelPosition: (position: AtomLabelPosition) => void
  setAtomLabelGap: (gap: number) => void
  setAutoFocusOnAtom: (enabled: boolean) => void
  setHoverHintsEnabled: (enabled: boolean) => void
  setGeometrySnapEnabled: (enabled: boolean) => void

  setShowPeriodicImages: (enabled: boolean) => void
  setHideHydrogens: (enabled: boolean) => void
  setKeptHydrogens: (text: string) => void
  setShowAtomRings: (enabled: boolean) => void
  setCellResizeMode: (enabled: boolean) => void
  setCellResizeScaleContents: (enabled: boolean) => void
  setCellResizeDragging: (active: boolean) => void
  setAtomScale: (scale: number) => void
  setElementRadiusVariance: (v: number) => void
  setBondScale: (scale: number) => void
  setFocusedAtomOpacity: (opacity: number) => void
  setFocusFadesBonds: (fades: boolean) => void
  setLodThreshold: (threshold: number) => void
  setUltraLowThreshold: (threshold: number) => void
  setUseLowDetailMode: (use: boolean) => void
  setUseUltraLowMode: (use: boolean) => void
  setAdaptivePerformanceEnabled: (enabled: boolean) => void
  setAdaptivePerformanceLevel: (level: number) => void
  setAdaptivePerformanceDpr: (dpr: number) => void
  setInteractionPerformanceActive: (active: boolean) => void
}

export const createViewSettingsSlice: StateCreator<CrystalStore, [], [], ViewSettingsSlice> = (set, get) => ({
  // —— UI render ——
  viewMode: 'ball-stick',
  toolMode: 'select',
  bondToolSubmode: 'create',
  setBondToolSubmode: (submode) => set({
    bondToolSubmode: submode,
    // Clear the pending start so a partial create operation cannot leak into Link mode.
    pendingBondAtomId: null,
  }),
  activateBondSubmode: (submode) => {
    if (submode === 'select') {
      // Order matters: setToolMode resets selectMode to atom outside select mode,
      // so selectMode must be written afterward.
      get().setToolMode('select')
      get().setSelectMode('bond')
    } else {
      get().setToolMode('add-bond')
    }
    get().setBondToolSubmode(submode)
  },
  bondAnnotationKind: 'custom',
  setBondAnnotationKind: (kind) => set({ bondAnnotationKind: kind }),
  bondAnnotations: [],
  addBondAnnotation: (atomId1, atomId2) => {
    if (atomId1 === atomId2) return
    const state = get()
    const existing = state.bondAnnotations.find(
      (a) =>
        (a.atomId1 === atomId1 && a.atomId2 === atomId2) ||
        (a.atomId1 === atomId2 && a.atomId2 === atomId1),
    )
    if (existing) {
      set({ bondAnnotations: state.bondAnnotations.filter((a) => a.id !== existing.id) })
      return
    }
    set({
      bondAnnotations: [
        ...state.bondAnnotations,
        {
          id: `bond-annotation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          atomId1,
          atomId2,
          kind: state.bondAnnotationKind,
        },
      ],
    })
  },
  removeBondAnnotation: (id) => set((state) => ({
    bondAnnotations: state.bondAnnotations.filter((a) => a.id !== id),
  })),
  clearBondAnnotations: () => set({ bondAnnotations: [] }),
  selectedElement: 'C',
  showBonds: true,
  showLattice: true,
  showCellGrid: false,
  showAtomLabels: true,
  atomLabelSize: .8,
  // Automatic contrast uses gunmetal on dark scenes and near-black on light scenes.
  atomLabelColor: null,
  atomLabelScope: 'selected',
  atomLabelContent: 'element-number',
  atomLabelOutline: true,
  atomLabelPosition: 'center',
  atomLabelGap: 0,
  autoFocusOnAtom: loadAutoFocusOnAtomFromStorage(),
  hoverHintsEnabled: loadHoverHintsFromStorage(),
  geometrySnapEnabled: loadGeometrySnapFromStorage(),
  geometrySnapTargets: loadSnapTargetsFromStorage(),
  cellOverflowMode: loadCellOverflowModeFromStorage(),
  wholeMolecules: loadWholeMoleculesFromStorage(),
  // Enabled by default: show equivalent boundary atoms when a crystal loads.
  // Image spheres stay on the display-box surface with fractional coordinates in
  // [0, 1], enforced by edgeImageOffsets and bondClosureOffsets. Neighbors outside
  // the box are omitted, matching VESTA/OVITO. Nonperiodic structures short-circuit.
  showPeriodicImages: true,
  hideHydrogens: false,
  keptHydrogens: '',
  showAtomRings: false,
  cellResizeMode: false,
  cellResizeScaleContents: true,
  cellResizeDragging: false,
  atomScale: 0.9,
  elementRadiusVariance: 1,
  bondScale: 1.5,
  periodicDirs: { a: true, b: true, c: true },
  setPeriodicDirs: (dirs) => set({ periodicDirs: dirs }),
  axisCleaveRequest: null,
  requestAxisCleave: (miller) => set({ axisCleaveRequest: miller }),
  clearAxisCleaveRequest: () => set({ axisCleaveRequest: null }),
  freeDirPadding: { a: [2, 2], b: [2, 2], c: [2, 2] },
  setFreeDirPadding: (padding) => set({ freeDirPadding: padding }),
  focusedAtomOpacity: 0.18,
  focusFadesBonds: true,

  // —— Performance / LOD ——
  lodThreshold: 300,
  ultraLowThreshold: 5000,
  useLowDetailMode: false,
  useUltraLowMode: false,
  solidBoxManual: false,
  setSolidBoxManual: (enabled) => set({ solidBoxManual: enabled, useUltraLowMode: enabled }),
  massiveSceneThreshold: 6000,
  veryLargeSceneThreshold: 12000,
  setMassiveSceneThreshold: (v) => set({ massiveSceneThreshold: v }),
  setVeryLargeSceneThreshold: (v) => set({ veryLargeSceneThreshold: v }),
  adaptivePerformanceEnabled: true,
  adaptivePerformanceLevel: 0,
  adaptivePerformanceDpr: 2,
  interactionPerformanceActive: false,

  cameraControlPreset: loadCameraPresetFromStorage(),
  setCameraControlPreset: (preset) => {
    saveCameraPresetToStorage(preset)
    set({ cameraControlPreset: preset })
  },
  cameraProjection: loadCameraProjectionFromStorage(),
  setCameraProjection: (projection) => {
    if (projection === get().cameraProjection) return
    saveCameraProjectionToStorage(projection)
    // Projection changes deliberately establish a new full-scene framing. Drop
    // focus in the same transaction so a reset camera never leaves the rest of
    // the structure dimmed, and stop any focus animation authored for the old
    // camera type.
    set({
      cameraProjection: projection,
      savedCameraState: null,
      cameraTarget: null,
      isAnimatingCamera: false,
      focusedAtomIds: new Set<string>(),
      massiveSceneVisualFocusAtomIds: new Set<string>(),
      massiveSceneVisualFocusCenter: null,
      massiveSceneVisualFocusDistance: null,
    })
  },

  setViewMode: (mode) => {
    if (mode === 'stick' && get().compactStructure) return
    set({ viewMode: mode, stylePresetId: 'custom' })
  },

  // Default to `auto` because unconstrained screen-plane dragging has ambiguous
  // depth. It follows a lattice axis unless the user explicitly requests free motion.
  dragAxisLock: 'auto',
  setDragAxisLock: (axis) => set({ dragAxisLock: get().dragAxisLock === axis ? null : axis }),

  setToolMode: (mode) => {
    // Main tools are exclusive. End Measure and its pending picks so measurementMode
    // cannot keep intercepting clicks intended for Add Atom or Box Select.
    set({
      toolMode: mode,
      measurementMode: 'none',
      pendingMeasurementAtoms: [],
      selectionRegionPreview: null,
      pendingBondAtomId: mode === 'add-bond' ? get().pendingBondAtomId : null,
      ...(mode !== 'select' ? {
        selectMode: 'atom',
        selectedEdgeIds: new Set(),
        selectedFaceIds: new Set(),
        selectedBondIds: new Set(),
        hoveredEdgeId: null,
        hoveredFaceId: null,
        hoveredBondId: null,
      } : {}),
    // Leaving Move restores the safe `auto` default; a temporary free-motion
    // choice must not silently persist into the next Move session.
      ...(mode !== 'drag-atom' ? { translateMode: false, translationPreview: null, dragAxisLock: 'auto' as const } : {}),
      ...(mode !== 'select' ? {
        boxSelectModeEnabled: false,
        isBoxSelecting: false,
        boxStart: null,
        boxEnd: null,
      } : {}),
    })
  },

  setSelectedElement: (element) => set({ selectedElement: element }),
  setShowBonds: (show) => set({ showBonds: show, stylePresetId: 'custom' }),
  setShowLattice: (show) => set({ showLattice: show }),
  setShowCellGrid: (show) => set({ showCellGrid: show }),
  setShowAtomLabels: (show) => set({ showAtomLabels: show }),
  setAtomLabelSize: (size) => set((state) => ({
    atomLabelSize: Number.isFinite(size) ? Math.max(.5, Math.min(3, size)) : state.atomLabelSize,
  })),
  setAtomLabelColor: (color) => set({ atomLabelColor: color }),
  setAtomLabelScope: (scope) => set({ atomLabelScope: scope }),
  setAtomLabelContent: (content) => set({ atomLabelContent: content }),
  setAtomLabelOutline: (outline) => set({ atomLabelOutline: outline }),
  setAtomLabelPosition: (position) => set({ atomLabelPosition: position }),
  setAtomLabelGap: (gap) => set((state) => ({
    atomLabelGap: Number.isFinite(gap) ? Math.max(0, Math.min(2, gap)) : state.atomLabelGap,
  })),
  setAutoFocusOnAtom: (enabled) => {
    saveAutoFocusOnAtomToStorage(enabled)
    set({ autoFocusOnAtom: enabled })
  },
  setHoverHintsEnabled: (enabled) => {
    saveHoverHintsToStorage(enabled)
    set({ hoverHintsEnabled: enabled })
  },
  setGeometrySnapEnabled: (enabled) => {
    saveGeometrySnapToStorage(enabled)
    set({ geometrySnapEnabled: enabled })
  },
  setGeometrySnapTarget: (target, enabled) => {
    const next = { ...get().geometrySnapTargets, [target]: enabled }
    saveSnapTargetsToStorage(next)
    set({ geometrySnapTargets: next })
  },
  setCellOverflowMode: (mode) => {
    saveCellOverflowModeToStorage(mode)
    // Clear displayImage when leaving `tile-images`; it is meaningful only while
    // images are tiled. Otherwise fold-in can leave atoms visibly outside the cell,
    // while grow-cell can apply a second offset on top of real coordinates.
    if (mode !== 'tile-images') {
      const atoms = get().atoms
      if (atoms.some((a) => a.displayImage)) {
        set({ atoms: atoms.map((a) => (a.displayImage ? { ...a, displayImage: undefined } : a)) })
      }
    }
    set({ cellOverflowMode: mode })
  },
  setWholeMolecules: (enabled) => {
    saveWholeMoleculesToStorage(enabled)
    set({ wholeMolecules: enabled })
  },
  setShowPeriodicImages: (enabled) => set({ showPeriodicImages: enabled }),
  setHideHydrogens: (enabled) => set({ hideHydrogens: enabled }),
  setKeptHydrogens: (text) => set({ keptHydrogens: text }),
  setShowAtomRings: (enabled) => set({ showAtomRings: enabled }),
  setCellResizeMode: (enabled) => set({ cellResizeMode: enabled }),
  setCellResizeScaleContents: (enabled) => set({ cellResizeScaleContents: enabled }),
  setCellResizeDragging: (active) => set({ cellResizeDragging: active }),
  setAtomScale: (scale) => {
    const state = get()
    const atomScale = Number.isFinite(scale) ? Math.max(.3, Math.min(2, scale)) : state.atomScale
    set({
      atomScale,
      ...(state.bioStructure || state.viewMode === 'stick'
        ? {}
        : { radiusScale: Math.max(.1, Math.min(1.2, atomScale / 2)) }),
      stylePresetId: 'custom',
    })
  },
  setElementRadiusVariance: (v) => set({
    elementRadiusVariance: Math.max(0, Math.min(1, v)),
    stylePresetId: 'custom',
  }),
  setBondScale: (scale) => {
    const state = get()
    const bondScale = Number.isFinite(scale) ? Math.max(.3, Math.min(2, scale)) : state.bondScale
    set({
      bondScale,
      ...(state.bioStructure || state.viewMode === 'stick'
        ? {}
        : { bondRadius: Math.max(.02, Math.min(.4, .08 * bondScale)) }),
      stylePresetId: 'custom',
    })
  },
  setFocusedAtomOpacity: (opacity) => set({ focusedAtomOpacity: Math.max(0.1, Math.min(1, opacity)) }),
  setFocusFadesBonds: (fades) => set({ focusFadesBonds: fades }),

  setLodThreshold: (threshold) => set({ lodThreshold: Math.max(50, threshold) }),
  setUltraLowThreshold: (threshold) => set({ ultraLowThreshold: Math.max(100, threshold) }),
  setUseLowDetailMode: (use) => set({ useLowDetailMode: use }),
  setUseUltraLowMode: (use) => set({ useUltraLowMode: use }),

  setAdaptivePerformanceEnabled: (enabled) => {
    set((state) => ({
      adaptivePerformanceEnabled: enabled,
      adaptivePerformanceLevel: enabled ? state.adaptivePerformanceLevel : 0,
    }))
  },
  setAdaptivePerformanceLevel: (level) => set({ adaptivePerformanceLevel: Math.max(0, Math.min(3, Math.round(level))) }),
  setAdaptivePerformanceDpr: (dpr) => set({ adaptivePerformanceDpr: Math.max(0.75, Math.min(2, dpr)) }),
  setInteractionPerformanceActive: (active) => set({ interactionPerformanceActive: active }),
})
