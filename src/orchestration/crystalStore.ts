// Zustand store for crystal modeling state.
// Composes the 21 slices in ./slices and exports the default singleton.
// CrystalStore and all internal types are defined in ./crystal-store-types.ts.

import { create } from 'zustand'
import { createTrajectorySlice } from './slices/trajectory-slice'
import { createMeasurementSlice } from './slices/measurement-slice'
import { createElementFilterSlice } from './slices/element-filter-slice'
import { createBrillouinZoneSlice } from './slices/brillouin-zone-slice'
import { createBondSlice } from './slices/bond-slice'
import { createBoxSelectionSlice } from './slices/box-selection-slice'
import { createSelectionTransformSlice } from './slices/selection-transform-slice'
import { createMolecularOrbitalSlice } from './slices/molecular-orbital-slice'
import { createViewportControlsSlice } from './slices/viewport-controls-slice'
import { createHistorySlice } from './slices/history-slice'
import { createPlaneConstructionSlice } from './slices/plane-construction-slice'
import { createAdsorbateSlice } from './slices/adsorbate-slice'
import { createRdfSlice } from './slices/rdf-slice'
import { createXrdSlice } from './slices/xrd-slice'
import { createEdiffSlice } from './slices/ediff-slice'
import { createAssemblySlice } from './slices/assembly-slice'
import { createAtomAttributesSlice } from './slices/atom-attributes-slice'
import { createPorositySlice } from './slices/porosity-slice'
import { createTrajectoryAuxSlice } from './slices/trajectory-aux-slice'
import { createModeSlice } from './slices/mode-slice'
import { createSelectionSlice } from './slices/selection-slice'
import { createSymmetryOverlaySlice } from './slices/symmetry-overlay-slice'
import { createCameraFocusSlice } from './slices/camera-focus-slice'
import { createViewSettingsSlice } from './slices/view-settings-slice'
import { createCellManagementSlice } from './slices/cell-management-slice'
import { createStructureProcessingSlice } from './slices/structure-processing-slice'
import { createLatticeSupercellSlice } from './slices/lattice-supercell-slice'
import { createAtomBondCrudSlice } from './slices/atom-bond-crud-slice'
import { createAtomClipboardSlice } from './slices/atom-clipboard-slice'
import { createLoadersSlice } from './slices/loaders-slice'
import { createLightingSlice } from './slices/lighting-slice'
import { createCompactStructureSlice } from './slices/compact-structure-slice'
import { createVisualStyleSlice } from './slices/visual-style-slice'
import { createPathTracingSlice } from './slices/path-tracing-slice'
import { createPresentationTimelineSlice } from './slices/presentation-timeline-slice'
import { createBiomoleculeSlice } from './slices/biomolecule-slice'
import { createCrystalLayersSlice } from './slices/crystal-layers-slice'
import { createStructureGroupsSlice } from './slices/structure-groups-slice'
import { createMergePlacementSlice } from './slices/merge-placement-slice'
import type { CrystalStore } from './crystal-store-types'

/**
 * Creates an independent CrystalStore instance on every call.
 * ViewportContext injects separate instances so viewports remain isolated.
 */
export function createCrystalStore() {
  return create<CrystalStore>((set, get, store) => ({
    ...createTrajectorySlice(set, get, store),
    ...createMeasurementSlice(set, get, store),
    ...createElementFilterSlice(set, get, store),
    ...createBrillouinZoneSlice(set, get, store),
    ...createBondSlice(set, get, store),
    ...createBoxSelectionSlice(set, get, store),
    ...createSelectionTransformSlice(set, get, store),
    ...createMolecularOrbitalSlice(set, get, store),
    ...createViewportControlsSlice(set, get, store),
    ...createHistorySlice(set, get, store),
    ...createPlaneConstructionSlice(set, get, store),
    ...createAdsorbateSlice(set, get, store),
    ...createRdfSlice(set, get, store),
    ...createXrdSlice(set, get, store),
    ...createEdiffSlice(set, get, store),
    ...createAssemblySlice(set, get, store),
    ...createAtomAttributesSlice(set, get, store),
    ...createPorositySlice(set, get, store),
    ...createTrajectoryAuxSlice(set, get, store),
    ...createModeSlice(set, get, store),
    ...createSelectionSlice(set, get, store),
    ...createSymmetryOverlaySlice(set, get, store),
    ...createCameraFocusSlice(set, get, store),
    ...createViewSettingsSlice(set, get, store),
    ...createCellManagementSlice(set, get, store),
    ...createStructureProcessingSlice(set, get, store),
    ...createLatticeSupercellSlice(set, get, store),
    ...createAtomBondCrudSlice(set, get, store),
    ...createAtomClipboardSlice(set, get, store),
    ...createLoadersSlice(set, get, store),
    ...createLightingSlice(set, get, store),
    ...createCompactStructureSlice(set, get, store),
    ...createVisualStyleSlice(set, get, store),
    ...createPathTracingSlice(set, get, store),
    ...createPresentationTimelineSlice(set, get, store),
    ...createBiomoleculeSlice(set, get, store),
    ...createCrystalLayersSlice(set, get, store),
    ...createStructureGroupsSlice(set, get, store),
    ...createMergePlacementSlice(set, get, store),
  }))
}

// Default singleton for code that does not use a viewport context.
export const useCrystalStore = createCrystalStore()
