/**
 * loaders-slice -- Entry points for CIF crystals, multi-frame XYZ trajectories, and built-in templates.
 *
 * Three actions:
 *   - loadTemplate: synchronously load a built-in CIF template and reset the scene
 *   - loadFromCIF (async): parse CIF text, show progress for large files, and return errors
 *   - loadFromXYZ (async): parse XYZ text with multi-frame trajectory support
 *
 * Each action resets selection, hover, camera, focus, transform, and trajectory state before
 * installing new atoms, bonds, and supercell data. Each calls pushHistory first.
 *
 * Large files use the structureProcessing overlay at
 * LARGE_STRUCTURE_TEXT_PROGRESS_THRESHOLD and await nextStructureProcessingPaint()
 * during asynchronous parsing so the browser can render progress.
 *
 * Each loader performs a coordinated cross-slice reset of roughly 30 fields.
 */

import type { StateCreator } from 'zustand'
import { defaultMolecularOrbitalState } from '../../lib/molecular-orbitals/state'
import { calculateLatticeVectors } from '../../lib/crystal/lattice'
import { parseCIF } from '../../lib/crystal/cif-parser'
import { parseXYZ } from '../../lib/crystal/xyz-parser'
import { recomputeBonds } from '../recompute-bonds'
import { generateAtomId, resetAtomIdCounter } from '../../lib/crystal/supercell-utils'
import { STRUCTURE_TEMPLATE_CIFS } from '../../lib/crystal/crystal-template-cifs'
import type { Atom, CrystalSystem } from '../crystal-store-types'
import {
  LARGE_STRUCTURE_TEXT_PROGRESS_THRESHOLD,
  shouldShowStructureProcessingForText,
  nextStructureProcessingPaint,
} from '../../lib/structure-processing/helpers'
import type { CrystalStore } from '../crystal-store-types'
import { analysisOverlayResetPatch } from './atom-attributes-slice'

void LARGE_STRUCTURE_TEXT_PROGRESS_THRESHOLD

export interface LoadersSlice {
  loadTemplate: (templateKey: string) => Promise<{ success: true } | { success: false; error: string }>
  loadFromCIF: (
    cifContent: string,
    options?: { deferCameraDocument?: boolean },
  ) => Promise<{ success: true } | { success: false; error: string }>
  loadFromXYZ: (
    xyzContent: string,
    options?: {
      beforeStructureReplace?: () => void
      /** `replace` starts a document; `edit` installs an undoable rebuild;
       * `preview` installs a transient rebuild. Both latter modes preserve the
       * current camera and clipping/volume composition. */
      documentMode?: 'replace' | 'edit' | 'preview'
    },
  ) => Promise<{ success: true } | { success: false; error: string }>
}

export const createLoadersSlice: StateCreator<CrystalStore, [], [], LoadersSlice> = (set, get) => ({
  loadTemplate: async (templateKey) => {
    // Coordinates use the same CIF parser as user imports. Materials Project's
    // full conventional-cell exports are intentionally P1, so the template
    // catalog restores the known conventional symmetry metadata afterwards.
    const entry = STRUCTURE_TEMPLATE_CIFS[templateKey]
    if (!entry) return { success: false, error: `Unknown structure template: ${templateKey}` }
    const result = await get().loadFromCIF(entry.cif, { deferCameraDocument: true })
    if (result.success) {
      const [nx, ny, nz] = entry.defaultSupercell ?? [1, 1, 1]
      const showCoordinationPolyhedra = entry.showCoordinationPolyhedra ?? false
      set({
        latticeParams: {
          ...get().latticeParams,
          centeringType: entry.centeringType,
          spaceGroupNumber: entry.spaceGroupNumber,
        },
        supercellParams: { nx, ny, nz },
        bondSettings: {
          ...get().bondSettings,
          elementPairRadii: { ...(entry.bondPairRadii ?? {}) },
          restrictToConfiguredPairs: Boolean(entry.bondPairRadii),
        },
        polyhedraCentralElements: new Set(entry.polyhedraCentralElements ?? []),
        showCoordinationPolyhedra,
        stylePresetId: get().showCoordinationPolyhedra === showCoordinationPolyhedra
          ? get().stylePresetId
          : 'custom',
        coordinationAnalysisSummary: null,
      })
      // Resolve only after the template's visual/chemical defaults and full
      // supercell are materialized. Callers may snapshot the structure as soon
      // as this promise completes.
      await get().regenerateSupercell()
      // A template is one document installation. Frame only its final default
      // supercell, never the intermediate parsed 1x1x1 cell.
      get().beginCameraDocument()
    }
    return result
  },
  
  loadFromCIF: async (cifContent, options) => {
    const manageProgress = shouldShowStructureProcessingForText(cifContent)
    if (manageProgress) {
      get().beginStructureProcessing(
        'Loading crystal structure',
        'Parsing CIF file',
        8,
        `Reading ${Math.round(cifContent.length / 1024).toLocaleString()} KB`,
      )
      await nextStructureProcessingPaint()
    }

    const result = parseCIF(cifContent)
    
    if (result.success === false) {
      if (manageProgress) {
        get().endStructureProcessing()
      }
      return { success: false, error: result.error.message }
    }

    // Parsing is the validation boundary. Do not dispose the current compact
    // structure or trajectory until a replacement is known to be valid.
    get().clearCompactStructure()
    get().clearBiomolecule()
    get().clearCrystalLayers()
    get().clearTrajectory()
    get().resetPresentationTimeline()
    // Initialize the new document's layer tree by replacing old groups with Base.
    get().resetStructureGroupsToBase()
    
    const { latticeParams, crystalSystem, atoms: cifAtoms, centeringType, spaceGroupNumber } = result.data

    // Include centering type and spacegroup in lattice params for BZ calculation
    const latticeParamsWithExtra = {
      ...latticeParams,
      ...(centeringType ? { centeringType } : {}),
      ...(spaceGroupNumber ? { spaceGroupNumber } : {}),
    }
    
    // Reset atom ID counter
    resetAtomIdCounter()
    
    // Calculate lattice vectors first (needed for cartesian conversion)
    const latticeVectors = calculateLatticeVectors(latticeParamsWithExtra)
    
    // Convert CIF atoms to store format
    // CIF parser returns: { element, position (fractional), cartesian (Cartesian) }
    const unitCellAtoms: Atom[] = cifAtoms.map((atom) => ({
      id: generateAtomId(),
      element: atom.element,
      position: atom.position,
      cartesian: atom.cartesian,
      siteIndex: atom.siteIndex,
    }))
    
    // Update store state
    set({
      builderMode: 'structure',
      periodic: true,
      crystalSystem,
      latticeParams: latticeParamsWithExtra,
      latticeVectors,
      unitCellAtoms,
      supercellParams: { nx: 1, ny: 1, nz: 1 },
      bondSettings: {
        ...get().bondSettings,
        elementPairRadii: {},
        restrictToConfiguredPairs: false,
      },
      polyhedraCentralElements: new Set<string>(),
      showCoordinationPolyhedra: false,
      stylePresetId: get().showCoordinationPolyhedra ? 'custom' : get().stylePresetId,
      userAddedAtomIds: new Set<string>(),
      userDeletedPositions: new Set<string>(),
      selectedAtomIds: new Set<string>(),
      selectedEdgeIds: new Set<string>(),
      selectedFaceIds: new Set<string>(),
      selectedBondIds: new Set<string>(),
      focusedAtomIds: new Set<string>(),
      measurementMode: 'none',
      measurements: [],
      pendingMeasurementAtoms: [],
      activeMeasurementEdit: null,
      pendingBondAtomId: null,
      bondAnnotations: [],
      boxSelectModeEnabled: false,
      isBoxSelecting: false,
      boxStart: null,
      boxEnd: null,
      selectionRegionPreview: null,
      constructedPlane: null,
      show2DPlaneView: false,
      clippingEnabled: false,
      clippingAxis: 'z',
      clippingOffset: 0,
      clippingNormal: null,
      volumeField: 'none',
      sliceEnabled: false,
      sliceClip: 'none',
      sliceIsolate: false,
      massiveSceneVisualFocusAtomIds: new Set<string>(),
      massiveSceneVisualFocusCenter: null,
      massiveSceneVisualFocusDistance: null,
      domainWallReview: null,
      bonds: [],
      translateMode: false,
      translationPreview: null,
      rotationPreview: null,
      selectionTransformMode: 'translate',
      selectionTransformOrigin: null,
      molecularOrbital: defaultMolecularOrbitalState,
      regionSeeds: null,
      showRegionSolids: false,
      hideAtomsInRegionView: false,
      showGrainColoring: false,
      ...analysisOverlayResetPatch(),
    })
    
    if (manageProgress) {
      get().updateStructureProcessing(
        'Expanding supercell',
        42,
        `Preparing ${unitCellAtoms.length.toLocaleString()} unit-cell atoms`,
      )
      await nextStructureProcessingPaint()
    }

    // Regenerate supercell and auto-detect bonds
    await get().regenerateSupercell()
    if (!options?.deferCameraDocument) get().beginCameraDocument()

    if (manageProgress) {
      get().updateStructureProcessing('Finalizing scene', 98, 'Structure ready')
      await nextStructureProcessingPaint()
      get().endStructureProcessing()
    }
    return { success: true }
  },
  
  loadFromXYZ: async (xyzContent, options) => {
    const documentMode = options?.documentMode ?? 'replace'
    const replacesDocument = documentMode === 'replace'
    const manageProgress = shouldShowStructureProcessingForText(xyzContent)
    if (manageProgress) {
      get().beginStructureProcessing(
        'Loading structure',
        'Parsing XYZ file',
        8,
        `Reading ${Math.round(xyzContent.length / 1024).toLocaleString()} KB`,
      )
      await nextStructureProcessingPaint()
    }

    const result = parseXYZ(xyzContent)
    
    if (result.success === false) {
      if (manageProgress) {
        get().endStructureProcessing()
      }
      return { success: false, error: result.error }
    }

    // The parser may yield to paint a large-file progress surface. Hosts that
    // perform compare-and-set writes get one final synchronous guard exactly
    // before the first structure mutation, so a stale source remains untouched.
    try {
      options?.beforeStructureReplace?.()
    } catch (error) {
      if (manageProgress) get().endStructureProcessing()
      throw error
    }

    // The rebuild modes operate on ordinary molecule/crystal documents. A PDB
    // owns residue topology and presentation tracks that an XYZ rebuild cannot
    // preserve; reject before mutating instead of silently converting it.
    if (!replacesDocument && get().bioStructure) {
      if (manageProgress) get().endStructureProcessing()
      return { success: false, error: 'XYZ edit/preview is not supported for a biomolecule document.' }
    }
    if (!replacesDocument && get().compactStructure) {
      if (manageProgress) get().endStructureProcessing()
      return { success: false, error: 'XYZ edit/preview is not supported for a compact document.' }
    }

    // A failed drag/drop must leave the current structure untouched. Rebuilds
    // share the parser/installer, but remain edits of the active document.
    get().clearCompactStructure()
    if (replacesDocument) {
      // Document replacement must be undoable because builders such as nanocluster,
      // slab, and bilayer create structures through this path. The snapshot covers
      // atoms, bonds, lattice, groups, and trajectory, including an empty prior scene.
      get().pushHistory()
      get().clearBiomolecule()
      get().clearCrystalLayers()
      get().resetPresentationTimeline()
      // Initialize the new document's layer tree by replacing old groups with Base.
      get().resetStructureGroupsToBase()
    } else if (documentMode === 'edit') {
      get().pushHistory()
    }
    get().clearTrajectory()
    
    const { atoms: xyzAtoms, latticeVectors, latticeParams, frames, isTrajectory } = result.data
    
    // Reset atom ID counter
    resetAtomIdCounter()
    
    // For XYZ files, atoms are in Cartesian coordinates
    // If extended XYZ has lattice info, we can compute fractional coords
    // Otherwise, treat as molecule (no lattice)
    
    if (latticeVectors && latticeParams) {
      // Extended XYZ with lattice - treat as crystal
      const a = latticeVectors.a
      const b = latticeVectors.b
      const c = latticeVectors.c
      
      // Calculate inverse of lattice matrix to get fractional coords
      const det = a[0] * (b[1] * c[2] - b[2] * c[1])
                - a[1] * (b[0] * c[2] - b[2] * c[0])
                + a[2] * (b[0] * c[1] - b[1] * c[0])
      
      const invDet = 1 / det
      const inv = [
        [(b[1] * c[2] - b[2] * c[1]) * invDet, (a[2] * c[1] - a[1] * c[2]) * invDet, (a[1] * b[2] - a[2] * b[1]) * invDet],
        [(b[2] * c[0] - b[0] * c[2]) * invDet, (a[0] * c[2] - a[2] * c[0]) * invDet, (a[2] * b[0] - a[0] * b[2]) * invDet],
        [(b[0] * c[1] - b[1] * c[0]) * invDet, (a[1] * c[0] - a[0] * c[1]) * invDet, (a[0] * b[1] - a[1] * b[0]) * invDet],
      ]
      
      const unitCellAtoms: Atom[] = xyzAtoms.map((atom) => {
        const cart = atom.cartesian ?? [0, 0, 0]
        const x = cart[0], y = cart[1], z = cart[2]
        // Lattice vectors are stored as rows, so cart = M^T * frac.
        // Therefore frac = (M^-1)^T * cart.
        const fx = inv[0][0] * x + inv[1][0] * y + inv[2][0] * z
        const fy = inv[0][1] * x + inv[1][1] * y + inv[2][1] * z
        const fz = inv[0][2] * x + inv[1][2] * y + inv[2][2] * z

        return {
          id: generateAtomId(),
          element: atom.element,
          position: [fx, fy, fz] as [number, number, number],
          cartesian: [x, y, z] as [number, number, number],
        }
      })
      
      const storeVectors = {
        a: latticeVectors.a,
        b: latticeVectors.b,
        c: latticeVectors.c,
      }
      
      set({
        builderMode: 'structure',
        periodic: true,
        crystalSystem: 'triclinic' as CrystalSystem,
        latticeParams: latticeParams,
        latticeVectors: storeVectors,
        unitCellAtoms,
        supercellParams: { nx: 1, ny: 1, nz: 1 },
        bondSettings: {
          ...get().bondSettings,
          elementPairRadii: {},
          restrictToConfiguredPairs: false,
        },
        polyhedraCentralElements: new Set<string>(),
        showCoordinationPolyhedra: false,
        stylePresetId: get().showCoordinationPolyhedra ? 'custom' : get().stylePresetId,
        userAddedAtomIds: new Set<string>(),
        userDeletedPositions: new Set<string>(),
        selectedAtomIds: new Set<string>(),
        selectedEdgeIds: new Set<string>(),
        selectedFaceIds: new Set<string>(),
        selectedBondIds: new Set<string>(),
        focusedAtomIds: new Set<string>(),
        measurementMode: 'none',
        measurements: [],
        pendingMeasurementAtoms: [],
        activeMeasurementEdit: null,
        pendingBondAtomId: null,
        bondAnnotations: [],
        boxSelectModeEnabled: false,
        isBoxSelecting: false,
        boxStart: null,
        boxEnd: null,
        selectionRegionPreview: null,
        ...(replacesDocument ? {
          constructedPlane: null,
          show2DPlaneView: false,
          clippingEnabled: false,
          clippingAxis: 'z' as const,
          clippingOffset: 0,
          clippingNormal: null,
          volumeField: 'none' as const,
          sliceEnabled: false,
          sliceClip: 'none' as const,
          sliceIsolate: false,
        } : {}),
        massiveSceneVisualFocusAtomIds: new Set<string>(),
        massiveSceneVisualFocusCenter: null,
        massiveSceneVisualFocusDistance: null,
        domainWallReview: null,
        bonds: [],
        translateMode: false,
        translationPreview: null,
        rotationPreview: null,
        selectionTransformMode: 'translate',
        selectionTransformOrigin: null,
        // Clear trajectory for crystal mode
        trajectoryFrames: null,
        trajectoryCurrentFrame: 0,
        trajectoryTotalFrames: 0,
        trajectoryPlaying: false,
        trajectoryIntervalId: null,
        trajectoryCoordinateMode: null,
        trajectoryLatticeMode: null,
        molecularOrbital: defaultMolecularOrbitalState,
        regionSeeds: null,
        showRegionSolids: false,
        hideAtomsInRegionView: false,
        showGrainColoring: false,
        ...analysisOverlayResetPatch(),
      })
      
      if (manageProgress) {
        get().updateStructureProcessing(
          'Expanding supercell',
          44,
          `Preparing ${unitCellAtoms.length.toLocaleString()} unit-cell atoms`,
        )
        await nextStructureProcessingPaint()
      }

      await get().regenerateSupercell()
      if (replacesDocument) get().beginCameraDocument()

      if (manageProgress) {
        get().updateStructureProcessing('Finalizing scene', 98, 'Structure ready')
        await nextStructureProcessingPaint()
        get().endStructureProcessing()
      }
    } else {
      // Standard XYZ without lattice - treat as molecule
      // Switch to molecule mode and set atoms directly
      const moleculeAtoms: Atom[] = xyzAtoms.map((atom) => ({
        id: generateAtomId(),
        element: atom.element,
        position: [0, 0, 0] as [number, number, number], // Not used in molecule mode
        cartesian: atom.cartesian ?? [0, 0, 0] as [number, number, number],
      }))
      
      // Store trajectory frames if this is a multi-frame file
      const trajectoryData = isTrajectory ? {
        trajectoryFrames: frames,
        trajectoryCurrentFrame: 0,
        trajectoryTotalFrames: frames.length,
        trajectoryPlaying: false,
        trajectoryIntervalId: null,
        trajectoryCoordinateMode: null,
        trajectoryLatticeMode: null,
      } : {
        trajectoryFrames: null,
        trajectoryCurrentFrame: 0,
        trajectoryTotalFrames: 0,
        trajectoryPlaying: false,
        trajectoryIntervalId: null,
        trajectoryCoordinateMode: null,
        trajectoryLatticeMode: null,
      }
      
      set({
        builderMode: 'structure',
        periodic: false,
        atoms: moleculeAtoms,
        bonds: [],
        bondSettings: {
          ...get().bondSettings,
          elementPairRadii: {},
          restrictToConfiguredPairs: false,
        },
        polyhedraCentralElements: new Set<string>(),
        showCoordinationPolyhedra: false,
        stylePresetId: get().showCoordinationPolyhedra ? 'custom' : get().stylePresetId,
        selectedAtomIds: new Set<string>(),
        selectedEdgeIds: new Set<string>(),
        selectedFaceIds: new Set<string>(),
        selectedBondIds: new Set<string>(),
        focusedAtomIds: new Set<string>(),
        measurementMode: 'none',
        measurements: [],
        pendingMeasurementAtoms: [],
        activeMeasurementEdit: null,
        pendingBondAtomId: null,
        bondAnnotations: [],
        boxSelectModeEnabled: false,
        isBoxSelecting: false,
        boxStart: null,
        boxEnd: null,
        selectionRegionPreview: null,
        ...(replacesDocument ? {
          constructedPlane: null,
          show2DPlaneView: false,
          clippingEnabled: false,
          clippingAxis: 'z' as const,
          clippingOffset: 0,
          clippingNormal: null,
          volumeField: 'none' as const,
          sliceEnabled: false,
          sliceClip: 'none' as const,
          sliceIsolate: false,
        } : {}),
        massiveSceneVisualFocusAtomIds: new Set<string>(),
        massiveSceneVisualFocusCenter: null,
        massiveSceneVisualFocusDistance: null,
        domainWallReview: null,
        translateMode: false,
        translationPreview: null,
        rotationPreview: null,
        selectionTransformMode: 'translate',
        selectionTransformOrigin: null,
        molecularOrbital: defaultMolecularOrbitalState,
        regionSeeds: null,
        showRegionSolids: false,
        hideAtomsInRegionView: false,
        showGrainColoring: false,
        ...trajectoryData,
        ...analysisOverlayResetPatch(),
      })
      
      if (manageProgress) {
        const moleculeCount = moleculeAtoms.length
        const frameDetail = isTrajectory
          ? `${frames.length.toLocaleString()} frames`
          : `${moleculeCount.toLocaleString()} atoms`
        get().updateStructureProcessing('Detecting bonds', 70, frameDetail)
        await nextStructureProcessingPaint()
      }

      const bonds = recomputeBonds(get(), { atoms: moleculeAtoms })
      set({ bonds })
      if (replacesDocument) get().beginCameraDocument()

      if (manageProgress) {
        get().updateStructureProcessing(
          isTrajectory ? 'Preparing frames' : 'Finalizing scene',
          92,
          isTrajectory ? `Caching ${frames.length.toLocaleString()} frames` : 'Structure ready',
        )
        await nextStructureProcessingPaint()
        get().endStructureProcessing()
      }
    }
    
    return { success: true }
  },
})
