/**
 * lattice-supercell-slice — crystal-system/lattice parameters and normal or fork supercell expansion.
 *
 * Four state fields (crystalSystem, latticeParams, latticeVectors, supercellParams)
 * and six actions: three setters, an incremental expandSupercell wrapper, and the
 * expandSupercellNormal/Fork implementations.
 *
 * Expansion modes:
 *   - normal: regenerate from unitCellAtoms while preserving user-added/deleted edits
 *   - fork: copy the entire current supercell along the target direction, growing as
 *     2^n without preserving user edits
 *
 * At LARGE_STRUCTURE_ATOM_PROGRESS_THRESHOLD or above, use the structureProcessing
 * overlay and await nextStructureProcessingPaint() so the browser can paint progress.
 *
 * Cross-slice: the three setters call regenerateSupercell and increment
 * cameraAutoResetVersion. setSupercellParams calls pushHistory, then dispatches to
 * normal or fork expansion according to supercellMode.
 */

import type { StateCreator } from 'zustand'
import type { CrystalSystem, LatticeParameters, LatticeVectors, SupercellParams } from '../../lib/crystal/types'
import { getDefaultLatticeParams, calculateLatticeVectors, applySystemConstraints, cartesianToFractional, fractionalToCartesian, isValidLatticeParameters } from '../../lib/crystal/lattice'
import { generateSupercell, resetAtomIdCounter, generateAtomId } from '../../lib/crystal/supercell-utils'
import { analyzeMergeBoundary } from '../../lib/crystal/merge-boundary'
import type { AlignAxis } from '../../lib/crystal/structure-placement'
import { alignVectorToAxis, centerAtomsAtOrigin, centerAtomsInCell, wrapAtomsIntoCell } from '../../lib/crystal/structure-placement'
import { boundaryModeFor, isOriginImage, splitIntoCellImage } from '../../lib/crystal/cell-overflow'
import { recomputeBonds } from '../recompute-bonds'
import {
  estimateSupercellAtomCount,
  nextStructureProcessingPaint,
  shouldShowStructureProcessingForAtomCount,
} from '../../lib/structure-processing/helpers'
import type { CrystalStore } from '../crystal-store-types'

const initialLatticeParams = getDefaultLatticeParams('cubic')
const initialLatticeVectors = calculateLatticeVectors(initialLatticeParams)

function translateForkAtom(
  atom: CrystalStore['atoms'][number],
  offset: [number, number, number],
  cellOffset: [number, number, number],
): CrystalStore['atoms'][number] | null {
  if (!atom.cartesian) return null
  const cartesian: [number, number, number] = [
    atom.cartesian[0] + offset[0],
    atom.cartesian[1] + offset[1],
    atom.cartesian[2] + offset[2],
  ]
  return {
    ...atom,
    id: generateAtomId(),
    cartesian,
    cellIndex: atom.cellIndex ? [
      atom.cellIndex[0] + cellOffset[0],
      atom.cellIndex[1] + cellOffset[1],
      atom.cellIndex[2] + cellOffset[2],
    ] : undefined,
    ...(atom.x === undefined ? {} : { x: cartesian[0] }),
    ...(atom.y === undefined ? {} : { y: cartesian[1] }),
    ...(atom.z === undefined ? {} : { z: cartesian[2] }),
  }
}

function normalizeForkCoordinates(
  atoms: CrystalStore['atoms'],
  oldParams: SupercellParams,
  newParams: SupercellParams,
  latticeVectors: LatticeVectors,
): CrystalStore['atoms'] {
  return atoms.map((atom) => {
    const actualFractional = atom.cartesian
      ? cartesianToFractional(atom.cartesian, latticeVectors)
      : [
          atom.position[0] * oldParams.nx,
          atom.position[1] * oldParams.ny,
          atom.position[2] * oldParams.nz,
        ] as [number, number, number]
    return {
      ...atom,
      position: [
        actualFractional[0] / newParams.nx,
        actualFractional[1] / newParams.ny,
        actualFractional[2] / newParams.nz,
      ],
      cellIndex: atom.cellIndex ?? [
        Math.floor(actualFractional[0] + 1e-9),
        Math.floor(actualFractional[1] + 1e-9),
        Math.floor(actualFractional[2] + 1e-9),
      ],
    }
  })
}

export interface LatticeSupercellSlice {
  crystalSystem: CrystalSystem
  latticeParams: LatticeParameters
  latticeVectors: LatticeVectors
  supercellParams: SupercellParams

  setCrystalSystem: (system: CrystalSystem) => void
  setLatticeParams: (params: Partial<LatticeParameters>) => boolean
  /** Resize one lattice axis interactively from the 3D handle. With scaleContents,
   * atoms retain fractional coordinates and scale with the cell; otherwise only the
   * box changes. Does not regenerate the supercell, which would clear molecules. */
  resizeLatticeAxis: (axis: 'a' | 'b' | 'c', newLength: number, scaleContents: boolean) => void
  /** Apply placement boundary rules after a move/drag: wrap periodic axes into the
   * box and extend nonperiodic axes to contain the structure. Does not push history;
   * the caller's gesture transaction already did. */
  applyBoundaryToAtoms: (atomIds: Iterable<string>) => void
  /** Wrap all atoms into the cell along periodic axes only. Unlike
   * applyBoundaryToAtoms, this only normalizes coordinates and neither changes the
   * lattice nor analyzes a merge. Pushes its own history entry as a standalone action. */
  wrapAllAtomsIntoCell: () => void
  /** Rigidly translate the bounding-box center to the cell center in periodic mode. */
  centerStructureInCell: () => void
  /** Rigidly translate the bounding-box center to the Cartesian origin. This is the
   * meaningful center in nonperiodic molecule mode, where the cell is not rendered. */
  centerStructureAtOrigin: () => void
  /** Rigidly rotate the structure to align the bond between exactly two selected
   * atoms with a Cartesian axis. Disabled for periodic structures because rotating
   * atoms without the lattice would break periodic equivalence. */
  alignSelectionToAxis: (axis: AlignAxis) => void
  setSupercellParams: (params: Partial<SupercellParams>) => void
  expandSupercell: (direction: 'x' | 'y' | 'z', amount: number) => void
  expandSupercellNormal: (oldParams: SupercellParams, newParams: SupercellParams) => Promise<void>
  expandSupercellFork: (oldParams: SupercellParams, newParams: SupercellParams) => Promise<void>
}

export const createLatticeSupercellSlice: StateCreator<CrystalStore, [], [], LatticeSupercellSlice> = (set, get) => ({
  crystalSystem: 'cubic',
  latticeParams: initialLatticeParams,
  latticeVectors: initialLatticeVectors,
  supercellParams: { nx: 1, ny: 1, nz: 1 },

  setCrystalSystem: (system) => {
    if (system === get().crystalSystem) return
    get().pushHistory()
    const params = getDefaultLatticeParams(system)
    const vectors = calculateLatticeVectors(params)
    set({ 
      crystalSystem: system, 
      latticeParams: params,
      latticeVectors: vectors,
    })
    get().regenerateSupercell()
    set((state) => ({ cameraAutoResetVersion: state.cameraAutoResetVersion + 1 }))
  },

  setLatticeParams: (params) => {
    const currentSystem = get().crystalSystem
    const newParams = applySystemConstraints(
      { ...get().latticeParams, ...params },
      currentSystem
    )
    if (!isValidLatticeParameters(newParams)) return false
    const currentParams = get().latticeParams
    if ((Object.keys(newParams) as Array<keyof LatticeParameters>).every(key => newParams[key] === currentParams[key])) {
      return true
    }
    get().pushHistory()
    const vectors = calculateLatticeVectors(newParams)
    set({ 
      latticeParams: newParams,
      latticeVectors: vectors,
    })
    get().regenerateSupercell()
    set((state) => ({ cameraAutoResetVersion: state.cameraAutoResetVersion + 1 }))
    return true
  },

  resizeLatticeAxis: (axis, newLength, scaleContents) => {
    const L = Math.max(0.5, newLength) // Clamp to 0.5 Å so the cell cannot collapse.
    const { latticeParams, crystalSystem, latticeVectors: oldVectors, atoms, periodicDirs } = get()
    let system = crystalSystem
    let newParams = applySystemConstraints({ ...latticeParams, [axis]: L }, system)
    // Crystal-system symmetry can suppress extending one nonperiodic axis for vacuum
    // (for example, cubic/tetragonal may force b=a). Removing periodicity breaks that
    // symmetry, so relax to orthorhombic for all-right angles or triclinic otherwise.
    if (!periodicDirs[axis] && Math.abs(newParams[axis] - L) > 1e-6) {
      const { alpha, beta, gamma } = latticeParams
      system = alpha === 90 && beta === 90 && gamma === 90 ? 'orthorhombic' : 'triclinic'
      newParams = applySystemConstraints({ ...latticeParams, [axis]: L }, system)
    }
    const newVectors = calculateLatticeVectors(newParams)
    if (scaleContents && atoms.length > 0) {
      // Preserve each atom's fractional coordinate from the old cell to the new one,
      // scaling Cartesian rendering coordinates only. Supercell atoms with frac>1
      // scale correctly as well.
      const scaled = atoms.map((a) => {
        if (!a.cartesian) return a
        const f = cartesianToFractional(a.cartesian, oldVectors)
        const nc = fractionalToCartesian(f, newVectors)
        return { ...a, cartesian: nc }
      })
      set({ latticeParams: newParams, latticeVectors: newVectors, atoms: scaled, crystalSystem: system })
    } else {
      set({ latticeParams: newParams, latticeVectors: newVectors, crystalSystem: system })
    }
  },

  applyBoundaryToAtoms: (atomIds) => {
    const idSet = new Set(atomIds)
    if (idSet.size === 0) return
    const { atoms, latticeVectors, supercellParams, periodicDirs, periodic, cellOverflowMode } = get()
    const moved = atoms.filter((a) => idSet.has(a.id))
    if (moved.length === 0) return

    // In 'tile-images', normalize coordinates into the cell but record the image where
    // the atom was dragged so the display layer can render it there. Compute that image
    // from the original unwrapped position, paired with analyzeMergeBoundary's result.
    const preWrap = moved.map((a) => (a.cartesian ?? a.position) as [number, number, number])
    const report = analyzeMergeBoundary(
      preWrap,
      latticeVectors,
      supercellParams,
      periodicDirs,
      periodic,
      atoms.filter((a) => !idSet.has(a.id)).map((a) => (a.cartesian ?? a.position) as [number, number, number]),
      boundaryModeFor(cellOverflowMode),
    )
    const tiling = cellOverflowMode === 'tile-images'
    const imageOf = new Map<string, [number, number, number] | undefined>()
    if (tiling) {
      moved.forEach((a, idx) => {
        const { image } = splitIntoCellImage(preWrap[idx], latticeVectors, periodicDirs)
        imageOf.set(a.id, isOriginImage(image) ? undefined : image)
      })
    }

    const unchanged = report.extendAxes.length === 0
      && report.atomStatus.every((s) => s === 'ok')
      && report.shift[0] === 0 && report.shift[1] === 0 && report.shift[2] === 0
      // In tiled mode, an image change also counts, including clearing one when returning inside.
      && (!tiling || moved.every((a) => {
        const next = imageOf.get(a.id)
        const prev = a.displayImage
        if (!next && !prev) return true
        if (!next || !prev) return false
        return next[0] === prev[0] && next[1] === prev[1] && next[2] === prev[2]
      }))
    if (unchanged) return

    // Outside a nonperiodic axis: extend the box as vacuum without moving atoms in Cartesian space.
    for (const { axis, newUnitLength } of report.extendAxes) {
      get().resizeLatticeAxis(axis, newUnitLength, false)
    }
    // Outside a periodic axis: wrap to the equivalent in-box position; finalPositions includes negative shifts.
    let i = 0
    const updated = get().atoms.map((a) => {
      if (!idSet.has(a.id)) return a
      const final = report.finalPositions[i++]
      // displayImage selects the rendered image only in 'tile-images'. Clear it in
      // other modes so a stale offset cannot survive a mode switch.
      return { ...a, cartesian: final, position: final, displayImage: tiling ? imageOf.get(a.id) : undefined }
    })
    set({ atoms: updated })
    get().syncBiomoleculeCoordinates(updated)
  },

  wrapAllAtomsIntoCell: () => {
    const { atoms, latticeVectors, periodicDirs } = get()
    if (atoms.length === 0) return
    const next = wrapAtomsIntoCell(atoms, latticeVectors, periodicDirs)
    // The pure function preserves the array reference when unchanged; skip an empty
    // transaction so history does not accumulate no-op undo steps.
    if (next === atoms) return
    get().pushHistory()
    set({ atoms: next })
    get().syncBiomoleculeCoordinates(next)
  },

  centerStructureInCell: () => {
    const { atoms, latticeVectors } = get()
    if (atoms.length === 0) return
    const next = centerAtomsInCell(atoms, latticeVectors)
    if (next === atoms) return
    get().pushHistory()
    set({ atoms: next })
    get().syncBiomoleculeCoordinates(next)
  },

  centerStructureAtOrigin: () => {
    const { atoms, latticeVectors } = get()
    if (atoms.length === 0) return
    const next = centerAtomsAtOrigin(atoms, latticeVectors)
    if (next === atoms) return
    get().pushHistory()
    set({ atoms: next })
    get().syncBiomoleculeCoordinates(next)
  },

  alignSelectionToAxis: (axis) => {
    const { atoms, latticeVectors, selectedAtomIds, periodic } = get()
    // Reject periodic structures: rotating atoms without the lattice changes the structure.
    if (periodic) return
    if (selectedAtomIds.size !== 2) return
    const [fromId, toId] = Array.from(selectedAtomIds)
    const next = alignVectorToAxis(atoms, fromId, toId, axis, latticeVectors)
    if (next === atoms) return
    get().pushHistory()
    set({ atoms: next })
    get().syncBiomoleculeCoordinates(next)
  },

  setSupercellParams: (params) => {
    const oldParams = get().supercellParams
    const proposed = { ...oldParams, ...params }
    const normalize = (value: number, fallback: number) => Number.isFinite(value)
      ? Math.max(1, Math.min(100, Math.trunc(value)))
      : fallback
    const newParams: SupercellParams = {
      nx: normalize(proposed.nx, oldParams.nx),
      ny: normalize(proposed.ny, oldParams.ny),
      nz: normalize(proposed.nz, oldParams.nz),
    }
    if (newParams.nx === oldParams.nx && newParams.ny === oldParams.ny && newParams.nz === oldParams.nz) return
    get().pushHistory()
    set({ supercellParams: newParams })
    
    // Use expandSupercell for incremental changes to preserve edits
    const { supercellMode } = get()
    
    if (supercellMode === 'fork') {
      // Fork mode: duplicate current supercell along the expanded direction
      void get().expandSupercellFork(oldParams, newParams)
    } else {
      // Normal mode: add unit cells but preserve user edits
      void get().expandSupercellNormal(oldParams, newParams)
    }
    set((state) => ({ cameraAutoResetVersion: state.cameraAutoResetVersion + 1 }))
  },
  
  expandSupercell: (direction, amount) => {
    const { supercellParams } = get()
    const key = direction === 'x' ? 'nx' : direction === 'y' ? 'ny' : 'nz'
    const newValue = Math.max(1, supercellParams[key] + amount)
    get().setSupercellParams({ [key]: newValue })
  },
  
  // Normal mode expansion: add unit cells, preserve user edits
  expandSupercellNormal: async (_oldParams: SupercellParams, newParams: SupercellParams) => {
    const { unitCellAtoms, latticeVectors, atoms, userAddedAtomIds, userDeletedPositions, bondSettings, structureProcessing } = get()
    const estimatedAtomCount = estimateSupercellAtomCount(unitCellAtoms, newParams) + userAddedAtomIds.size
    const manageProgress = !structureProcessing.active && shouldShowStructureProcessingForAtomCount(estimatedAtomCount)

    if (manageProgress) {
      get().beginStructureProcessing(
        'Updating supercell',
        'Expanding structure',
        12,
        `Preparing ~${estimatedAtomCount.toLocaleString()} atoms`,
      )
      await nextStructureProcessingPaint()
    }
    
    // Keep user-added atoms (atoms that were manually added)
    const userAddedAtoms = atoms.filter(a => userAddedAtomIds.has(a.id))
    
    // Generate new supercell
    resetAtomIdCounter()
    let newAtoms = generateSupercell(unitCellAtoms, newParams, latticeVectors)
    
    // Filter out atoms at positions that user deleted
    newAtoms = newAtoms.filter(atom => {
      if (!atom.cartesian) return true
      const posKey = `${atom.cartesian[0].toFixed(3)}-${atom.cartesian[1].toFixed(3)}-${atom.cartesian[2].toFixed(3)}`
      return !userDeletedPositions.has(posKey)
    })
    
    // Add back user-added atoms
    newAtoms = [...newAtoms, ...userAddedAtoms]
    
    set({ atoms: newAtoms, selectedAtomIds: new Set(), bonds: [] })

    if (manageProgress) {
      get().updateStructureProcessing(
        'Detecting bonds',
        68,
        `Rebuilding bonding for ${newAtoms.length.toLocaleString()} atoms`,
      )
      await nextStructureProcessingPaint()
    }

    const bonds = recomputeBonds(get(), { atoms: newAtoms, latticeVectors, bondSettings })
    set({ bonds })

    if (manageProgress) {
      get().updateStructureProcessing('Finalizing scene', 96, 'Preparing viewport')
      await nextStructureProcessingPaint()
      get().endStructureProcessing()
    }
  },
  
  // Fork mode expansion: duplicate entire current supercell (2^n exponential growth)
  // Only allows doubling in each direction (1->2, 2->4, 4->8, etc.)
  expandSupercellFork: async (oldParams: SupercellParams, newParams: SupercellParams) => {
    const { atoms, latticeVectors, bondSettings, structureProcessing } = get()
    const { a, b, c } = latticeVectors
    const expansionFactor = (newParams.nx / Math.max(oldParams.nx, 1)) * (newParams.ny / Math.max(oldParams.ny, 1)) * (newParams.nz / Math.max(oldParams.nz, 1))
    const estimatedAtomCount = Math.max(atoms.length, Math.round(atoms.length * expansionFactor))
    const manageProgress = !structureProcessing.active && shouldShowStructureProcessingForAtomCount(estimatedAtomCount)

    if (manageProgress) {
      get().beginStructureProcessing(
        'Updating supercell',
        'Forking structure',
        14,
        `Duplicating toward ~${estimatedAtomCount.toLocaleString()} atoms`,
      )
      await nextStructureProcessingPaint()
    }
    
    // A fork duplicates crystallographic sites, not newly indexed sites. Materialize
    // the fallback identity before copying so `site N` remains stable in every cell.
    let currentAtoms: CrystalStore['atoms'] = atoms.map((atom, atomIndex) => ({
      ...atom,
      siteIndex: atom.siteIndex ?? atomIndex,
    }))
    
    // Check if we're doubling in X direction
    if (newParams.nx >= oldParams.nx * 2) {
      const toDouble = [...currentAtoms]
      // Calculate offset: shift by the entire current supercell width in X
      const offsetX = oldParams.nx * a[0]
      const offsetY = oldParams.nx * a[1]
      const offsetZ = oldParams.nx * a[2]
      
      for (const atom of toDouble) {
        const copy = translateForkAtom(atom, [offsetX, offsetY, offsetZ], [oldParams.nx, 0, 0])
        if (copy) currentAtoms.push(copy)
      }
    }
    
    // Check if we're doubling in Y direction
    if (newParams.ny >= oldParams.ny * 2) {
      const toDouble = [...currentAtoms]
      const offsetX = oldParams.ny * b[0]
      const offsetY = oldParams.ny * b[1]
      const offsetZ = oldParams.ny * b[2]
      
      for (const atom of toDouble) {
        const copy = translateForkAtom(atom, [offsetX, offsetY, offsetZ], [0, oldParams.ny, 0])
        if (copy) currentAtoms.push(copy)
      }
    }
    
    // Check if we're doubling in Z direction
    if (newParams.nz >= oldParams.nz * 2) {
      const toDouble = [...currentAtoms]
      const offsetX = oldParams.nz * c[0]
      const offsetY = oldParams.nz * c[1]
      const offsetZ = oldParams.nz * c[2]
      
      for (const atom of toDouble) {
        const copy = translateForkAtom(atom, [offsetX, offsetY, offsetZ], [0, 0, oldParams.nz])
        if (copy) currentAtoms.push(copy)
      }
    }

    // `position` is normalized to the final supercell, while the crystal-layer
    // fx/fy/fz DSL recovers unit-cell fractional coordinates as position * n.
    currentAtoms = normalizeForkCoordinates(currentAtoms, oldParams, newParams, latticeVectors)
    
    // Only update if atoms changed
    if (currentAtoms.length > atoms.length) {
      set({ atoms: currentAtoms, selectedAtomIds: new Set(), bonds: [] })

      if (manageProgress) {
        get().updateStructureProcessing(
          'Detecting bonds',
          70,
          `Rebuilding bonding for ${currentAtoms.length.toLocaleString()} atoms`,
        )
        await nextStructureProcessingPaint()
      }

      const bonds = recomputeBonds(get(), { atoms: currentAtoms, latticeVectors, bondSettings })
      set({ bonds })
    }

    if (manageProgress) {
      get().updateStructureProcessing('Finalizing scene', 96, 'Preparing viewport')
      await nextStructureProcessingPaint()
      get().endStructureProcessing()
    }
  },
})
