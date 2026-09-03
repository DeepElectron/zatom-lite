/**
 * atom-bond-crud-slice — core atom and bond CRUD, supercell regeneration, and direct setters.
 *
 * Five state fields: unitCellAtoms / atoms / bonds + userAddedAtomIds / userDeletedPositions.
 * The last two track manual supercell additions and deletions so normal-mode expansion preserves them.
 *
 * Actions (21, grouped by responsibility):
 *   - atom: add / remove / updateElement / updateSelectedElement / translateSelected /
 *     updatePosition + addAtomToSupercell (adds directly to expanded atoms without changing the unit cell)
 *   - bond: add / remove / updateType / updateSelectedType / autoDetectBonds
 *   - delete: deleteSelectedAtoms (tracks userDeletedPositions) / deleteSelectedBonds /
 *     deleteAtom / deleteAtomsByIds
 *   - direct setters: setAtomsDirectly (updates the current structure) /
 *     replaceAtomsDirectly (replaces the structure) /
 *     setBondsDirectly (bypasses lattice logic in molecule mode)
 *   - replaceSelectedAtoms (replaces elements from contextMenu / selection and rebuilds bonds)
 *   - regenerateSupercell (full rebuild with nextStructureProcessingPaint progress updates)
 *
 * Cross-slice behavior: every write first calls pushHistory; replaceSelectedAtoms writes
 * contextMenu* (selection-slice); delete actions write selectedAtomIds / selectedBondIds (selection-slice).
 */

import type { StateCreator } from 'zustand'
import type { Atom, Bond } from '../../lib/crystal/types'
import { recomputeBonds } from '../recompute-bonds'
import { calculateLatticeVectors, getDefaultLatticeParams, cartesianToFractional } from '../../lib/crystal/lattice'
import { generateSupercell, generateAtomId, resetAtomIdCounter } from '../../lib/crystal/supercell-utils'
import {
  estimateSupercellAtomCount,
  nextStructureProcessingPaint,
  shouldShowStructureProcessingForAtomCount,
} from '../../lib/structure-processing/helpers'
import { defaultMolecularOrbitalState } from '../../lib/molecular-orbitals/state'
import type { CrystalStore } from '../crystal-store-types'
import { analysisOverlayResetPatch } from './atom-attributes-slice'

export interface AtomBondCrudSlice {
  unitCellAtoms: Atom[]
  atoms: Atom[]
  bonds: Bond[]
  userAddedAtomIds: Set<string>
  userDeletedPositions: Set<string>

  addAtom: (element: string, position: [number, number, number]) => void
  removeAtom: (atomId: string) => void
  updateAtomElement: (atomId: string, element: string) => void
  updateSelectedAtomsElement: (element: string) => void
  /** Set one atom's formal charge (integer e). Zero removes the field, preserving "missing means neutral." */
  updateAtomCharge: (atomId: string, charge: number) => void
  /** Set the formal charge of all selected atoms. */
  updateSelectedAtomsCharge: (charge: number) => void
  translateSelectedAtoms: (delta: [number, number, number]) => void
  /** The unit-cell atom path starts asynchronous supercell regeneration and returns its promise
   * so programmatic callers (agent tools) can await it; UI callers continue to ignore the result. */
  updateAtomPosition: (atomId: string, position: [number, number, number]) => void | Promise<void>
  addBond: (atom1Id: string, atom2Id: string, type?: 'single' | 'double' | 'triple' | 'aromatic') => void
  removeBond: (bondId: string) => void
  updateBondType: (bondId: string, type: 'single' | 'double' | 'triple' | 'aromatic') => void
  updateSelectedBondsType: (type: 'single' | 'double' | 'triple' | 'aromatic') => void
  autoDetectBonds: () => void
  replaceSelectedAtoms: (newElement: string) => void
  regenerateSupercell: () => Promise<void>
  addAtomToSupercell: (element: string, cartesian: [number, number, number]) => void
  deleteSelectedAtoms: () => void
  deleteSelectedBonds: () => void
  deleteAtom: (atomId: string) => void
  deleteAtomsByIds: (atomIds: string[]) => void
  deleteBond: (bondId: string) => void
  clearStructure: () => void
  /** Update atoms within the current document while preserving template chemistry metadata. */
  setAtomsDirectly: (atoms: Atom[]) => void
  /** Replace the current document and clear structure-specific bond/polyhedron rules. */
  replaceAtomsDirectly: (atoms: Atom[]) => void
  setBondsDirectly: (bonds: Bond[]) => void
}

export const createAtomBondCrudSlice: StateCreator<CrystalStore, [], [], AtomBondCrudSlice> = (set, get) => ({
  unitCellAtoms: [],
  atoms: [],
  bonds: [],
  userAddedAtomIds: new Set<string>(),
  userDeletedPositions: new Set<string>(),

  addAtom: (element, position) => {
    const wasEmpty = get().atoms.length === 0 && get().unitCellAtoms.length === 0
    const newAtom: Atom = {
      id: generateAtomId(),
      element,
      position,
    }
    set({ unitCellAtoms: [...get().unitCellAtoms, newAtom] })
    void get().regenerateSupercell().then(() => {
      if (wasEmpty) get().triggerCameraAutoReset()
    })
  },

  removeAtom: (atomId) => {
    const unitCellAtoms = get().unitCellAtoms.filter(a => a.id !== atomId)
    const bonds = get().bonds.filter(b => b.atom1Id !== atomId && b.atom2Id !== atomId)
    const selectedAtomIds = new Set(get().selectedAtomIds)
    selectedAtomIds.delete(atomId)
    set({ unitCellAtoms, bonds, selectedAtomIds })
    get().regenerateSupercell()
  },

  updateAtomElement: (atomId, element) => {
    const current = get().atoms.find((atom) => atom.id === atomId)
    if (!current || current.element === element) return
    get().pushHistory()
    // Element identity is part of PDB topology. Converting to the ordinary
    // molecular editor is explicit and avoids stale residue/selection science.
    get().clearBiomolecule()
    // Update in supercell atoms
    const atoms = get().atoms.map(a => 
      a.id === atomId ? { ...a, element } : a
    )
    set({ atoms })
  },

  updateAtomCharge: (atomId, charge) => {
    const current = get().atoms.find((atom) => atom.id === atomId)
    if (!current) return
    const next = Math.round(charge)
    if ((current.charge ?? 0) === next) return
    get().pushHistory()
    // Remove the field instead of storing zero so neutrality has one canonical representation;
    // otherwise export and comparison paths must handle both undefined and the equivalent zero.
    const atoms = get().atoms.map((atom) => {
      if (atom.id !== atomId) return atom
      if (next === 0) {
        const { charge: _dropped, ...rest } = atom
        return rest
      }
      return { ...atom, charge: next }
    })
    set({ atoms })
  },

  updateSelectedAtomsCharge: (charge) => {
    const { selectedAtomIds, atoms } = get()
    if (selectedAtomIds.size === 0) return
    const next = Math.round(charge)
    get().pushHistory()
    const updatedAtoms = atoms.map((atom) => {
      if (!selectedAtomIds.has(atom.id)) return atom
      if (next === 0) {
        const { charge: _dropped, ...rest } = atom
        return rest
      }
      return { ...atom, charge: next }
    })
    set({ atoms: updatedAtoms })
  },

  // Bulk: update element for all selected atoms
  updateSelectedAtomsElement: (element) => {
    const { selectedAtomIds, atoms } = get()
    if (selectedAtomIds.size === 0) return
    
    get().pushHistory()
    get().clearBiomolecule()
    const updatedAtoms = atoms.map(a => 
      selectedAtomIds.has(a.id) ? { ...a, element } : a
    )
    set({ atoms: updatedAtoms })
  },

  // Bulk: translate all selected atoms by delta
  translateSelectedAtoms: (delta) => {
    const { selectedAtomIds, atoms } = get()
    if (selectedAtomIds.size === 0) return
    
    get().pushHistory()
    const updatedAtoms = atoms.map(a => {
      if (!selectedAtomIds.has(a.id)) return a
      const pos = a.cartesian || a.position
      return {
        ...a,
        cartesian: [pos[0] + delta[0], pos[1] + delta[1], pos[2] + delta[2]] as [number, number, number],
        position: [a.position[0] + delta[0], a.position[1] + delta[1], a.position[2] + delta[2]] as [number, number, number],
      }
    })
    set({ atoms: updatedAtoms })
    if (get().bioStructure) get().syncBiomoleculeCoordinates(updatedAtoms)
    else setTimeout(() => get().autoDetectBonds(), 0)
  },

  updateAtomPosition: (atomId, position) => {
    // Check if atom is in unitCellAtoms
    const isUnitCellAtom = get().unitCellAtoms.some(a => a.id === atomId)
    const latticeVectors = get().latticeVectors

    if (isUnitCellAtom && latticeVectors) {
      // Callers provide Cartesian coordinates, while unitCellAtoms.position is fractional.
      // Convert before writing; otherwise Cartesian values are interpreted as fractional coordinates,
      // sending the atom several lattice lengths away (the root cause of drag lagging behind the cursor).
      const fractional = cartesianToFractional(position, latticeVectors)
      const unitCellAtoms = get().unitCellAtoms.map(a =>
        a.id === atomId ? { ...a, position: fractional } : a
      )
      set({ unitCellAtoms })
      return get().regenerateSupercell()
    } else {
      // Update supercell atom directly (cartesian coordinates)
      const atoms = get().atoms.map(a =>
        a.id === atomId ? { ...a, cartesian: position, position } : a
      )
      set({ atoms })
      get().syncBiomoleculeCoordinates(atoms)
    }
  },

  addBond: (atom1Id, atom2Id, type) => {
    const bondKey = [atom1Id, atom2Id].sort().join('-')
    const existingBond = get().bonds.find(b => b.id === `bond-${bondKey}`)
    if (existingBond) return
    get().pushHistory()
    get().clearBiomolecule()

    const newBond: Bond = {
      id: `bond-${bondKey}`,
      atom1Id,
      atom2Id,
      type: type ?? 'single',
    }
    set({ bonds: [...get().bonds, newBond] })
  },

  removeBond: (bondId) => {
    if (!get().bonds.some((bond) => bond.id === bondId)) return
    get().pushHistory()
    get().clearBiomolecule()
    set({ bonds: get().bonds.filter(b => b.id !== bondId) })
  },

  updateBondType: (bondId, type) => {
    const current = get().bonds.find((bond) => bond.id === bondId)
    if (!current || current.type === type) return
    get().pushHistory()
    get().clearBiomolecule()
    set({
      bonds: get().bonds.map(b =>
        b.id === bondId ? { ...b, type } : b
      ),
    })
  },

  updateSelectedBondsType: (type) => {
    const { selectedBondIds, bonds } = get()
    if (selectedBondIds.size === 0) return
    get().pushHistory()
    get().clearBiomolecule()
    
    set({
      bonds: bonds.map(b =>
        selectedBondIds.has(b.id) ? { ...b, type } : b
      ),
    })
  },

  autoDetectBonds: () => {
    // Replacing an explicit PDB topology with distance-inferred bonds is a
    // document-model conversion. Drop residue/chain science first so no layer
    // or interaction renderer can keep reading stale topology metadata.
    if (get().bioStructure) get().clearBiomolecule()
    set({ bonds: recomputeBonds(get()) })
  },

  // Selection / hover / context menu actions: createSelectionSlice (spread above)
  
  replaceSelectedAtoms: (newElement) => {
  get().pushHistory()
  get().clearBiomolecule()
  const { atoms, contextMenuAtomIds, selectedAtomIds } = get()
  const idsToReplace = contextMenuAtomIds.length > 0 
    ? new Set(contextMenuAtomIds) 
    : selectedAtomIds
  
  const newAtoms = atoms.map(atom => {
    if (idsToReplace.has(atom.id)) {
      return { ...atom, element: newElement }
    }
    return atom
  })
  
  set({ atoms: newAtoms, contextMenuPosition: null, contextMenuAtomIds: [] })
  
  // Re-detect bonds for new element types
  setTimeout(() => {
    get().autoDetectBonds()
  }, 0)
  },

  // Camera + focus actions: createCameraFocusSlice (spread above)

  // View settings actions: createViewSettingsSlice (spread above)
  
  // Cell management actions: createCellManagementSlice (spread above)

  regenerateSupercell: async () => {
    const {
      unitCellAtoms,
      supercellParams,
      latticeVectors,
      bondSettings,
      structureProcessing,
    } = get()
    const estimatedAtomCount = estimateSupercellAtomCount(unitCellAtoms, supercellParams)
    const manageProgress = !structureProcessing.active && shouldShowStructureProcessingForAtomCount(estimatedAtomCount)

    if (manageProgress) {
      get().beginStructureProcessing(
        'Rebuilding structure',
        'Expanding supercell',
        14,
        `Preparing ~${estimatedAtomCount.toLocaleString()} atoms`,
      )
      await nextStructureProcessingPaint()
    } else if (structureProcessing.active) {
      get().updateStructureProcessing(
        'Expanding supercell',
        Math.max(structureProcessing.progress, 56),
        `Preparing ~${estimatedAtomCount.toLocaleString()} atoms`,
      )
      await nextStructureProcessingPaint()
    }

    resetAtomIdCounter()
    const atoms = generateSupercell(unitCellAtoms, supercellParams, latticeVectors)
    set({ atoms, selectedAtomIds: new Set(), bonds: [] })

    if (manageProgress || structureProcessing.active) {
      get().updateStructureProcessing(
        'Detecting bonds',
        Math.max(structureProcessing.progress, 80),
        `Rebuilding bonding for ${atoms.length.toLocaleString()} atoms`,
      )
      await nextStructureProcessingPaint()
    }

    set({ bonds: recomputeBonds(get(), { atoms, latticeVectors, bondSettings }) })

    if (manageProgress) {
      get().updateStructureProcessing('Finalizing scene', 97, 'Preparing viewport')
      await nextStructureProcessingPaint()
      get().endStructureProcessing()
    }
  },

  // Undo/Redo + Assembly undo/redo: createHistorySlice (spread above)

  // Add atom directly to supercell (single atom, not unit cell)
  addAtomToSupercell: (element, cartesian) => {
    // Push history before making changes
    get().pushHistory()
    get().clearBiomolecule()
    
    // In composite-structure mode, a new atom belongs to the selected sublayer
    // according to structure-groups-slice semantics.
    const activeGroupId = get().activeGroupId
    const newAtom: Atom = {
      id: generateAtomId(),
      element,
      position: cartesian, // Store cartesian as position for now
      cartesian,
      ...(activeGroupId !== null ? { groupId: activeGroupId } : {}),
    }
    
    const wasEmpty = get().atoms.length === 0
    const atoms = [...get().atoms, newAtom]
    
    // Track user-added atom for preservation during expansion
    const userAddedAtomIds = new Set(get().userAddedAtomIds)
    userAddedAtomIds.add(newAtom.id)
    
    set({ atoms, userAddedAtomIds })
    if (wasEmpty) get().triggerCameraAutoReset()
    
    // Re-detect bonds
    setTimeout(() => {
      get().autoDetectBonds()
    }, 0)
  },

  // Plane construction actions: createPlaneConstructionSlice (spread above)
// Delete operations
  deleteSelectedAtoms: () => {
  // For biological scenes, delete at document level (exclude on export, then reparse)
  // to preserve cartoon and residue semantics. The crystal clearBiomolecule path
  // would degrade the entire protein into plain atoms.
  if (get().bioStructure) {
    const ids = get().selectedAtomIds
    if (ids.size > 0) get().deleteBioAtoms(new Set(ids))
    return
  }
  get().pushHistory()
  const { atoms, bonds, selectedAtomIds, userDeletedPositions, userAddedAtomIds } = get()
  
  // Track deleted positions for normal mode expansion
  const newDeletedPositions = new Set(userDeletedPositions)
  const newUserAddedAtomIds = new Set(userAddedAtomIds)
  
  atoms.forEach(atom => {
    if (selectedAtomIds.has(atom.id) && atom.cartesian) {
      // Record the position so it won't be regenerated
      const posKey = `${atom.cartesian[0].toFixed(3)}-${atom.cartesian[1].toFixed(3)}-${atom.cartesian[2].toFixed(3)}`
      newDeletedPositions.add(posKey)
      // Remove from user-added if it was user-added
      newUserAddedAtomIds.delete(atom.id)
    }
  })
  
  const newAtoms = atoms.filter(a => !selectedAtomIds.has(a.id))
  // Also remove bonds connected to deleted atoms
  const newBonds = bonds.filter(b =>
  !selectedAtomIds.has(b.atom1Id) && !selectedAtomIds.has(b.atom2Id)
  )
  set({ 
    atoms: newAtoms, 
    bonds: newBonds, 
    selectedAtomIds: new Set(),
    userDeletedPositions: newDeletedPositions,
    userAddedAtomIds: newUserAddedAtomIds,
  })
  },

  deleteSelectedBonds: () => {
    // In biological scenes, only ligand bonds (HETATM, including newly dropped molecules)
    // may be deleted; residue chemistry defines polymer bonds, so those are always rejected.
    // Suppress at document level without calling clearBiomolecule.
    if (get().bioStructure) {
      const ids = get().selectedBondIds
      if (ids.size > 0) get().deleteBioBonds(ids)
      return
    }
    get().pushHistory()
    const { bonds, selectedBondIds } = get()
    const newBonds = bonds.filter(b => !selectedBondIds.has(b.id))
    set({ bonds: newBonds, selectedBondIds: new Set() })
  },

  deleteAtom: (atomId: string) => {
    if (get().bioStructure) {
      get().deleteBioAtoms(new Set([atomId]))
      return
    }
    get().pushHistory()
    const { atoms, bonds } = get()
    const newAtoms = atoms.filter(a => a.id !== atomId)
    const newBonds = bonds.filter(b => b.atom1Id !== atomId && b.atom2Id !== atomId)
    set({ atoms: newAtoms, bonds: newBonds })
  },

  deleteAtomsByIds: (atomIds: string[]) => {
    if (!atomIds || atomIds.length === 0) return
    if (get().bioStructure) {
      get().deleteBioAtoms(new Set(atomIds))
      return
    }
    get().pushHistory()
    const { atoms, bonds, userDeletedPositions, userAddedAtomIds, focusedAtomIds } = get()
    const idsToDelete = new Set(atomIds)
    
    // Track deleted positions for normal mode expansion
    const newDeletedPositions = new Set(userDeletedPositions)
    const newUserAddedAtomIds = new Set(userAddedAtomIds)
    
    atoms.forEach(atom => {
      if (idsToDelete.has(atom.id) && atom.cartesian) {
        const posKey = `${atom.cartesian[0].toFixed(3)}-${atom.cartesian[1].toFixed(3)}-${atom.cartesian[2].toFixed(3)}`
        newDeletedPositions.add(posKey)
        newUserAddedAtomIds.delete(atom.id)
      }
    })
    
    const newAtoms = atoms.filter(a => !idsToDelete.has(a.id))
    const newBonds = bonds.filter(b => !idsToDelete.has(b.atom1Id) && !idsToDelete.has(b.atom2Id))
    
    // Also remove deleted atoms from focusedAtomIds
    const newFocusedAtomIds = new Set(focusedAtomIds)
    atomIds.forEach(id => newFocusedAtomIds.delete(id))
    
    set({
      atoms: newAtoms,
      bonds: newBonds,
      selectedAtomIds: new Set(),
      focusedAtomIds: newFocusedAtomIds,
      userDeletedPositions: newDeletedPositions,
      userAddedAtomIds: newUserAddedAtomIds,
    })
  },

  deleteBond: (bondId: string) => {
    // Biological scenes use document-level suppression: ligand bonds may be deleted,
    // while polymer bonds are rejected. Calling clearBiomolecule here used to discard
    // the biological document; deleting one ligand bond must not degrade a protein to plain atoms.
    if (get().bioStructure) {
      get().deleteBioBonds([bondId])
      return
    }
    get().pushHistory()
    const { bonds } = get()
    const newBonds = bonds.filter(b => b.id !== bondId)
    set({ bonds: newBonds })
  },

  clearStructure: () => {
    // A blank structure is a new, unbound editing document. Unbind before the
    // history snapshot so clearing never marks the previous Asset as modified.
    get().unbindFrame()
    get().pushHistory()
    get().clearBiomolecule()
    get().clearCrystalLayers()
    get().clearTrajectory()
    get().resetPresentationTimeline()
    get().clearCompactStructure()
    const latticeParams = getDefaultLatticeParams('cubic')
    set({
      crystalSystem: 'cubic',
      latticeParams,
      latticeVectors: calculateLatticeVectors(latticeParams),
      supercellParams: { nx: 1, ny: 1, nz: 1 },
      periodic: false,
      unitCellAtoms: [],
      atoms: [],
      bonds: [],
      bondSettings: {
        ...get().bondSettings,
        elementPairRadii: {},
        restrictToConfiguredPairs: false,
      },
      polyhedraCentralElements: new Set<string>(),
      showCoordinationPolyhedra: false,
      stylePresetId: get().showCoordinationPolyhedra ? 'custom' : get().stylePresetId,
      userAddedAtomIds: new Set(),
      userDeletedPositions: new Set(),
      structureGroups: [],
      activeGroupId: null,
      selectedAtomIds: new Set(),
      selectedEdgeIds: new Set(),
      selectedFaceIds: new Set(),
      selectedBondIds: new Set(),
      focusedAtomIds: new Set(),
      massiveSceneVisualFocusAtomIds: new Set(),
      massiveSceneVisualFocusCenter: null,
      massiveSceneVisualFocusDistance: null,
      hoveredAtomId: null,
      hoveredEdgeId: null,
      hoveredFaceId: null,
      hoveredBondId: null,
      draggingAtomId: null,
      pendingBondAtomId: null,
      measurementMode: 'none',
      measurements: [],
      pendingMeasurementAtoms: [],
      activeMeasurementEdit: null,
      selectionRegionPreview: null,
      boxSelectModeEnabled: false,
      isBoxSelecting: false,
      boxStart: null,
      boxEnd: null,
      contextMenuPosition: null,
      contextMenuAtomIds: [],
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
      regionSeeds: null,
      showRegionSolids: false,
      hideAtomsInRegionView: false,
      showGrainColoring: false,
      molecularOrbital: defaultMolecularOrbitalState,
      domainWallReview: null,
      ...analysisOverlayResetPatch(),
    })
    get().beginCameraDocument()
  },

  // Bond settings actions: createBondSlice (spread above)
  
  // Element filter actions: createElementFilterSlice (spread above)


  // Measurement actions: createMeasurementSlice (spread above)

  // Direct setters for molecule mode (bypasses crystal lattice logic)
  setAtomsDirectly: (atoms) => {
    get().pushHistory()
    set({
      atoms,
      unitCellAtoms: [],
      selectedAtomIds: new Set(),
      userAddedAtomIds: new Set(),
      userDeletedPositions: new Set(),
      compactStructure: null,
      focusAtoms: [],
    })
    get().syncBiomoleculeCoordinates(atoms)
  },

  replaceAtomsDirectly: (atoms) => {
    get().pushHistory()
    get().clearBiomolecule()
    get().clearCrystalLayers()
    get().clearTrajectory()
    get().resetPresentationTimeline()
    get().clearCompactStructure()
    set({
      periodic: false,
      atoms,
      unitCellAtoms: [],
      bonds: [],
      selectedAtomIds: new Set(),
      selectedBondIds: new Set(),
      selectedEdgeIds: new Set(),
      selectedFaceIds: new Set(),
      focusedAtomIds: new Set(),
      userAddedAtomIds: new Set(),
      userDeletedPositions: new Set(),
      structureGroups: [],
      activeGroupId: null,
      bondSettings: {
        ...get().bondSettings,
        elementPairRadii: {},
        restrictToConfiguredPairs: false,
      },
      polyhedraCentralElements: new Set<string>(),
      showCoordinationPolyhedra: false,
      stylePresetId: get().showCoordinationPolyhedra ? 'custom' : get().stylePresetId,
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
      regionSeeds: null,
      showRegionSolids: false,
      hideAtomsInRegionView: false,
      showGrainColoring: false,
      molecularOrbital: defaultMolecularOrbitalState,
      domainWallReview: null,
      ...analysisOverlayResetPatch(),
    })
    // Replacing the structure rebuilds the layer backbone; every structure has a Base layer.
    get().resetStructureGroupsToBase()
    get().beginCameraDocument()
  },
  
  setBondsDirectly: (bonds) => {
    get().pushHistory()
    if (get().bioStructure) get().clearBiomolecule()
    set({ bonds, selectedBondIds: new Set() })
  },
  
})
