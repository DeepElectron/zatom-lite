/** Normal expansion preserves edited cells; fork expansion doubles the current cell
 * and remaps explicit periodic bonds. Commit atoms, topology and repeats together. */
import type { StateCreator } from 'zustand'
import type { CrystalSystem, LatticeParameters, LatticeVectors, SupercellParams } from '../../lib/crystal/types'
import { getDefaultLatticeParams, calculateLatticeVectors, applySystemConstraints, cartesianToFractional, fractionalToCartesian, isValidLatticeParameters } from '../../lib/crystal/lattice'
import { generateSupercell, generateAtomId, scaleLatticeVectorsForSupercell } from '../../lib/crystal/supercell-utils'
import type { AlignAxis } from '../../lib/crystal/structure-placement'
import { alignVectorToAxis, centerAtomsAtOrigin, centerAtomsInCell, wrapAtomsIntoCell } from '../../lib/crystal/structure-placement'
import { isOriginImage, splitIntoCellImage } from '../../lib/crystal/cell-overflow'
import { recomputeBonds } from '../recompute-bonds'
import {
  estimateSupercellAtomCount,
  nextStructureProcessingPaint,
  shouldShowStructureProcessingForAtomCount,
} from '../../lib/structure-processing/helpers'
import type { CrystalStore } from '../crystal-store-types'

const initialLatticeParams = getDefaultLatticeParams('cubic')
const initialLatticeVectors = calculateLatticeVectors(initialLatticeParams)

export function hasExplicitTopology(state: CrystalStore): boolean {
  return Boolean(state.bioStructure || state.atoms.some(atom => {
    const marker = atom.props?.['zatom.explicitBondTopology']
    return marker?.kind === 'scalar' && marker.value === 1
  }))
}

/** Placement changes inferred bonds, but only geometry/image offsets of explicit topology. */
export function bondsAfterPlacement(
  state: CrystalStore,
  atoms: CrystalStore['atoms'],
  latticeVectors: LatticeVectors,
  wrappedIn?: LatticeVectors,
): CrystalStore['bonds'] {
  if (!hasExplicitTopology(state)) return recomputeBonds(state, { atoms, latticeVectors })

  const nextById = new Map(atoms.map(atom => [atom.id, atom]))
  const wraps = new Map<string, [number, number, number]>()
  if (state.periodic && wrappedIn) {
    for (const old of state.atoms) {
      const next = nextById.get(old.id)
      if (!next || next === old) continue
      const oldPosition = old.cartesian ?? old.position
      const newPosition = next.cartesian ?? next.position
      const shift = cartesianToFractional([
        oldPosition[0] - newPosition[0],
        oldPosition[1] - newPosition[1],
        oldPosition[2] - newPosition[2],
      ], wrappedIn)
      wraps.set(old.id, shift.map(value => Math.round(value) || 0) as [number, number, number])
    }
  }
  const displayLattice = scaleLatticeVectorsForSupercell(latticeVectors, state.supercellParams)
  return state.bonds.map((bond) => {
    const first = nextById.get(bond.atom1Id)
    const second = nextById.get(bond.atom2Id)
    if (!first || !second) return bond
    const offset: [number, number, number] = state.periodic ? [...(bond.latticeOffset ?? [0, 0, 0])] : [0, 0, 0]
    if (state.periodic && wrappedIn) {
      const firstWrap = wraps.get(first.id) ?? [0, 0, 0]
      const secondWrap = wraps.get(second.id) ?? [0, 0, 0]
      for (let axis = 0; axis < 3; axis++) offset[axis] += secondWrap[axis] - firstWrap[axis]
    }
    // Finite molecular/bio renderers use direct endpoints, even when a stale
    // direction mask still allows the existing Wrap geometry action.
    const shift = state.periodic ? fractionalToCartesian(offset, displayLattice) : [0, 0, 0]
    const p1 = first.cartesian ?? fractionalToCartesian(first.position, latticeVectors)
    const p2 = second.cartesian ?? fractionalToCartesian(second.position, latticeVectors)
    const next = {
      ...bond,
      length: Math.hypot(p2[0] + shift[0] - p1[0], p2[1] + shift[1] - p1[1], p2[2] + shift[2] - p1[2]),
    }
    if (offset.some(value => value !== 0)) next.latticeOffset = offset
    else delete next.latticeOffset
    return next
  })
}

export interface LatticeSupercellSlice {
  crystalSystem: CrystalSystem
  latticeParams: LatticeParameters
  latticeVectors: LatticeVectors
  supercellParams: SupercellParams

  setCrystalSystem: (system: CrystalSystem) => void
  setLatticeParams: (params: Partial<LatticeParameters>) => boolean

  resizeLatticeAxis: (axis: 'a' | 'b' | 'c', newLength: number, scaleContents: boolean) => void

  applyBoundaryToAtoms: (atomIds: Iterable<string>) => void

  wrapAllAtomsIntoCell: () => void

  centerStructureInCell: () => void

  centerStructureAtOrigin: () => void

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
    const state = get()
    const vectors = calculateLatticeVectors(newParams)
    const box = scaleLatticeVectorsForSupercell(vectors, state.supercellParams)
    const atoms = state.atoms.map(atom => {
      const fraction = cartesianToFractional(atom.cartesian ?? fractionalToCartesian(atom.position, state.latticeVectors), state.latticeVectors)
      const cartesian = fractionalToCartesian(fraction, vectors)
      return { ...atom, cartesian, position: cartesianToFractional(cartesian, box) }
    })
    const unitCellAtoms = state.unitCellAtoms.map(atom => ({...atom, cartesian: fractionalToCartesian(atom.position, vectors)}))
    const bonds = bondsAfterPlacement(state, atoms, vectors)
    // Changing lattice parameters deforms the current edited structure. It must
    // not regenerate pristine sites over displacements, vacancies or explicit bonds.
    set({ latticeParams: newParams, latticeVectors: vectors, atoms, unitCellAtoms, bonds })
    get().syncBiomoleculeCoordinates(atoms)
    set((state) => ({ cameraAutoResetVersion: state.cameraAutoResetVersion + 1 }))
    return true
  },

  resizeLatticeAxis: (axis, newLength, scaleContents) => {
    const L = Math.max(0.5, newLength)
    const state = get()
    const { latticeParams, crystalSystem, latticeVectors: oldVectors, atoms, periodicDirs } = state
    let system = crystalSystem
    let newParams = applySystemConstraints({ ...latticeParams, [axis]: L }, system)


    if (!periodicDirs[axis] && Math.abs(newParams[axis] - L) > 1e-6) {
      const { alpha, beta, gamma } = latticeParams
      system = alpha === 90 && beta === 90 && gamma === 90 ? 'orthorhombic' : 'triclinic'
      newParams = applySystemConstraints({ ...latticeParams, [axis]: L }, system)
    }
    const newVectors = calculateLatticeVectors(newParams)
    let nextAtoms = atoms
    if (scaleContents && atoms.length > 0) {


      nextAtoms = atoms.map((a) => {
        if (!a.cartesian) return a
        const f = cartesianToFractional(a.cartesian, oldVectors)
        const nc = fractionalToCartesian(f, newVectors)
        return { ...a, cartesian: nc }
      })
    }
    const bonds = bondsAfterPlacement(state, nextAtoms, newVectors)
    // The gesture owns history. Publish the changed cell/coordinates and their
    // bonds together so no subscriber or renderer receives stale bond geometry.
    set({ latticeParams: newParams, latticeVectors: newVectors, atoms: nextAtoms, bonds, crystalSystem: system })
  },

  applyBoundaryToAtoms: (atomIds) => {
    const state = get()
    const ids = new Set(atomIds)
    if (!state.periodic || !state.atoms.some(atom => ids.has(atom.id))) return
    const oldBox = scaleLatticeVectorsForSupercell(state.latticeVectors, state.supercellParams)
    const imageMode = state.cellOverflowMode === 'tile-images'
    const atoms = state.atoms.map(atom => {
      if (!ids.has(atom.id)) return atom
      const placed = splitIntoCellImage(atom.cartesian ?? atom.position, oldBox, state.periodicDirs)
      const cartesian = placed.wrapped
      const image: [number, number, number] = [placed.image[0] * state.supercellParams.nx,
        placed.image[1] * state.supercellParams.ny, placed.image[2] * state.supercellParams.nz]
      const displayImage = imageMode && !isOriginImage(image) ? image : undefined
      return { ...atom, cartesian, position: cartesianToFractional(cartesian, oldBox), displayImage }
    })
    const bonds = bondsAfterPlacement(state, atoms, state.latticeVectors, oldBox)
    set({ atoms, bonds })
    get().syncBiomoleculeCoordinates(atoms)
  },

  wrapAllAtomsIntoCell: () => {
    const state = get()
    const { atoms, latticeVectors, periodicDirs } = state
    if (atoms.length === 0) return
    // A materialized supercell is the periodic box. Wrapping to its primitive
    // cell would collapse distinct sites and break display-box bond offsets.
    const displayLattice = scaleLatticeVectorsForSupercell(latticeVectors, state.supercellParams)
    const next = wrapAtomsIntoCell(atoms, displayLattice, periodicDirs)
    // The helper may allocate the outer array even when every atom is unchanged.
    if (next === atoms || next.every((atom, index) => atom === atoms[index])) return
    const bonds = bondsAfterPlacement(state, next, latticeVectors, displayLattice)
    get().pushHistory()
    set({ atoms: next, bonds })
    get().syncBiomoleculeCoordinates(next)
  },

  centerStructureInCell: () => {
    const { atoms, latticeVectors } = get()
    if (atoms.length === 0) return
    const next = centerAtomsInCell(atoms, scaleLatticeVectorsForSupercell(latticeVectors, get().supercellParams))
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
    if (get().structureProcessing.active) return
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
    if (get().supercellMode === 'normal' && hasExplicitTopology(get())) return
    if (get().supercellMode === 'fork' && (['nx', 'ny', 'nz'] as const).some(axis =>
      newParams[axis] !== oldParams[axis] && newParams[axis] !== oldParams[axis] * 2)) return
    get().pushHistory()

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
  expandSupercellNormal: async (oldParams: SupercellParams, newParams: SupercellParams) => {
    const { unitCellAtoms, latticeVectors, atoms, userAddedAtomIds, bondSettings, structureProcessing } = get()
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
      if (get().atoms !== atoms || get().supercellParams !== oldParams || get().latticeVectors !== latticeVectors) {
        get().endStructureProcessing()
        return
      }
    }

    // Existing cells own their edited sites. Generate only newly requested cells;
    // rebuilding the old region would discard substitutions, moves and vacancies.
    const key = (cell: readonly number[], site: number) => `${cell.join(',')}:${site}`
    const oldSites = new Map(atoms.filter(a => !userAddedAtomIds.has(a.id)).map((atom, index) => [
      key(atom.cellIndex ?? [0, 0, 0], atom.siteIndex ?? index), atom,
    ]))
    // A previous image belongs to the old periodic box. Replicate independent
    // canonical sites, clearing display-only offsets: carrying an old image into
    // the enlarged box can overlap it with a newly materialized independent atom.
    const box = scaleLatticeVectorsForSupercell(latticeVectors, newParams)
    const place = (atom: CrystalStore['atoms'][number], existing: boolean) => {
      let cartesian = atom.cartesian ?? fractionalToCartesian(atom.position, latticeVectors)
      let displayImage: [number, number, number] | undefined
      if (get().periodic) {
        if (existing) cartesian = splitIntoCellImage(cartesian, scaleLatticeVectorsForSupercell(latticeVectors, oldParams), get().periodicDirs).wrapped
        const split = splitIntoCellImage(cartesian, box, get().periodicDirs)
        cartesian = split.wrapped
      }
      return { ...atom, cartesian, position: cartesianToFractional(cartesian, box), displayImage }
    }
    const newAtoms: CrystalStore['atoms'] = []
    const periodicMask = get().periodic ? get().periodicDirs : {a: false, b: false, c: false}
    const canonicalUnit = unitCellAtoms.map(atom => {
      const cartesian = splitIntoCellImage(fractionalToCartesian(atom.position, latticeVectors), latticeVectors, periodicMask).wrapped
      return { ...atom, cartesian, position: cartesianToFractional(cartesian, latticeVectors), displayImage: undefined }
    })
    for (const generated of generateSupercell(canonicalUnit, newParams, latticeVectors)) {
      const cell = generated.cellIndex!
      const insideOld = cell[0] < oldParams.nx && cell[1] < oldParams.ny && cell[2] < oldParams.nz
      const existing = oldSites.get(key(cell, generated.siteIndex!))
      if (insideOld) {
        if (existing) newAtoms.push(place(existing, true))
      } else {
        newAtoms.push(place(generated, false))
      }
    }
    for (const atom of atoms) if (userAddedAtomIds.has(atom.id)) newAtoms.push(place(atom, true))

    const bonds = recomputeBonds(get(), { atoms: newAtoms, latticeVectors, bondSettings, supercellParams: newParams })
    set({ atoms: newAtoms, unitCellAtoms: canonicalUnit, supercellParams: newParams, selectedAtomIds: new Set(), bonds })
    if (manageProgress) get().endStructureProcessing()

  },

  // Fork mode expansion: duplicate entire current supercell (2^n exponential growth)
  // Only allows doubling in each direction (1->2, 2->4, 4->8, etc.)
  expandSupercellFork: async (oldParams: SupercellParams, newParams: SupercellParams) => {
    const { atoms, latticeVectors, bondSettings, structureProcessing } = get()
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
      if (get().atoms !== atoms || get().supercellParams !== oldParams || get().latticeVectors !== latticeVectors) {
        get().endStructureProcessing()
        return
      }
    }

    const source = get()
    const factor = [newParams.nx / oldParams.nx, newParams.ny / oldParams.ny, newParams.nz / oldParams.nz]
    if (factor.some(n => n !== 1 && n !== 2)) return
    const oldBox = scaleLatticeVectorsForSupercell(latticeVectors, oldParams)
    const newBox = scaleLatticeVectorsForSupercell(latticeVectors, newParams)
    const sourceAtoms = atoms.map(atom => {
      const raw = atom.cartesian ?? fractionalToCartesian(atom.position, oldBox)
      const cartesian = source.periodic ? splitIntoCellImage(raw, oldBox, source.periodicDirs).wrapped : raw
      return { ...atom, cartesian, position: cartesianToFractional(cartesian, oldBox), displayImage: undefined }
    })
    const sourceBonds = hasExplicitTopology(source)
      ? bondsAfterPlacement(source, sourceAtoms, latticeVectors, oldBox) : []
    const currentAtoms: CrystalStore['atoms'] = []
    const copies = new Map<string, string>()
    const tiles: [number, number, number][] = []
    for (let i = 0; i < factor[0]; i++) for (let j = 0; j < factor[1]; j++) for (let k = 0; k < factor[2]; k++) {
      const tile: [number, number, number] = [i, j, k]
      tiles.push(tile)
      const shift = fractionalToCartesian(tile, oldBox)
      for (const [index, atom] of sourceAtoms.entries()) {
        const id = i === 0 && j === 0 && k === 0 ? atom.id : generateAtomId()
        const raw = atom.cartesian ?? fractionalToCartesian(atom.position, oldBox)
        const p = source.periodic ? splitIntoCellImage(raw, oldBox, source.periodicDirs).wrapped : raw
        let cartesian = p.map((value, axis) => value + shift[axis]) as [number, number, number]
        let displayImage: [number, number, number] | undefined
        if (source.cellOverflowMode === 'tile-images') {
          const split = splitIntoCellImage(cartesian, newBox, source.periodicDirs)
          cartesian = split.wrapped
        }
        currentAtoms.push({ ...atom, id, cartesian, position: cartesianToFractional(cartesian, newBox), displayImage,
          siteIndex: atom.siteIndex ?? index,
          cellIndex: [(atom.cellIndex?.[0] ?? 0) + i * oldParams.nx,
            (atom.cellIndex?.[1] ?? 0) + j * oldParams.ny, (atom.cellIndex?.[2] ?? 0) + k * oldParams.nz],
        })
        copies.set(`${tile.join(',')}:${atom.id}`, id)
      }
    }
    const explicitBonds: CrystalStore['bonds'] = []
    if (hasExplicitTopology(source)) {
      const newById = new Map(currentAtoms.map(atom => [atom.id, atom]))
      const oldById = new Map(sourceAtoms.map(atom => [atom.id, atom]))
      for (const tile of tiles) for (const bond of sourceBonds) {
        const offset = bond.latticeOffset ?? [0, 0, 0]
        const target = tile.map((value, axis) => value + offset[axis])
        const boundary = target.map((value, axis) => Math.floor(value / factor[axis])) as [number, number, number]
        const cell = target.map((value, axis) => value - boundary[axis] * factor[axis])
        const first = copies.get(`${tile.join(',')}:${bond.atom1Id}`)
        const second = copies.get(`${cell.join(',')}:${bond.atom2Id}`)
        if (!first || !second) continue
        // Images may have changed representatives in the enlarged box. Adjust
        // the integer bond offset for exactly those per-atom wrapping shifts.
        const wrapOf = (oldId: string, newId: string, copyCell: number[]) => {
          const old = oldById.get(oldId)!
          const base = old.cartesian ?? fractionalToCartesian(old.position, oldBox)
          const shift = fractionalToCartesian(copyCell as [number, number, number], oldBox)
          return cartesianToFractional(base.map((v, axis) => v + shift[axis] - newById.get(newId)!.cartesian![axis]) as [number, number, number], newBox)
        }
        const firstWrap = wrapOf(bond.atom1Id, first, tile), secondWrap = wrapOf(bond.atom2Id, second, cell)
        for (let axis = 0; axis < 3; axis++) boundary[axis] += Math.round(secondWrap[axis]) - Math.round(firstWrap[axis])
        explicitBonds.push({ ...bond, id: tile.every(n => n === 0) ? bond.id : `${bond.id}@${tile.join(',')}`,
          atom1Id: first, atom2Id: second, latticeOffset: boundary })
      }
    }

    if (currentAtoms.length > atoms.length) {
      const bonds = hasExplicitTopology(source)
        ? bondsAfterPlacement({ ...source, supercellParams: newParams, atoms: currentAtoms, bonds: explicitBonds }, currentAtoms, latticeVectors)
        : recomputeBonds(source, { atoms: currentAtoms, latticeVectors, bondSettings, supercellParams: newParams })
      set({ atoms: currentAtoms, supercellParams: newParams, selectedAtomIds: new Set(), bonds })
    }
    if (manageProgress) get().endStructureProcessing()

  },
})
