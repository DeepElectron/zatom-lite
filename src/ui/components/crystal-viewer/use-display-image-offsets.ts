/**
 * Canonical periodic image set shared by atom and bond renderers. A small
 * reference-keyed cache prevents per-bond callers from repeating the same O(N)
 * work while keeping display coordinates separate from stored coordinates.
 */
import { useMemo } from 'react'
import type { Atom, LatticeVectors } from '../../../lib/crystal/types'
import type { PeriodicMask } from '../../../lib/crystal/lattice-math'
import { isValidLattice } from '../../../lib/crystal/lattice-math'
import {
  type DisplayImageOffsets,
  type ImageOffset,
  buildDisplayImageOffsets,
  edgeImageOffsets,
} from '../../../lib/crystal/display-periodic-images'
import {
  computeImageTileCells,
  isOriginImage,
  splitIntoCellImage,
  type ImageIndex,
} from '../../../lib/crystal/cell-overflow'
import { useViewportStore as useCrystalStore } from '../../../orchestration/ViewportContext'

type Vec3 = [number, number, number]

export interface DisplayImages {
  /** Supercell-scaled lattice used for outlines and image translations. */
  displayBox: LatticeVectors | null
  /** Supercell repeat counts relative to the unit cell. */
  cells: Vec3
  /** Unit-cell image indices rendered by tile-images mode. */
  tiling: ImageIndex[] | null
  /** Effective image assignment for every source atom. */
  effectiveImages: readonly (ImageIndex | undefined)[]
  /** Visible display-box offsets keyed by source atom id. */
  offsets: DisplayImageOffsets | null
}

interface Inputs {
  atoms: Atom[]
  periodic: boolean
  latticeVectors: LatticeVectors | null | undefined
  periodicDirs: PeriodicMask
  supercellParams: { nx: number; ny: number; nz: number } | null | undefined
  showPeriodicImages: boolean
  cellOverflowMode: string
  draggingAtomId: string | null
}

const EMPTY_IMAGES: readonly (ImageIndex | undefined)[] = []
const NO_IMAGES: DisplayImages = {
  displayBox: null,
  cells: [1, 1, 1],
  tiling: null,
  effectiveImages: EMPTY_IMAGES,
  offsets: null,
}

export function useDisplayImages(atoms: Atom[]): DisplayImages {
  const periodic = useCrystalStore((s) => s.periodic)
  const latticeVectors = useCrystalStore((s) => s.latticeVectors)
  const periodicDirs = useCrystalStore((s) => s.periodicDirs)
  const supercellParams = useCrystalStore((s) => s.supercellParams)
  const showPeriodicImages = useCrystalStore((s) => s.showPeriodicImages)
  const cellOverflowMode = useCrystalStore((s) => s.cellOverflowMode)
  const draggingAtomId = useCrystalStore((s) => s.draggingAtomId)

  return useMemo(
    () =>
      lookup({
        atoms,
        periodic,
        latticeVectors,
        periodicDirs,
        supercellParams,
        showPeriodicImages,
        cellOverflowMode,
        draggingAtomId,
      }),
    [
      atoms,
      periodic,
      latticeVectors,
      periodicDirs,
      supercellParams,
      showPeriodicImages,
      cellOverflowMode,
      draggingAtomId,
    ],
  )
}

const CACHE_CAPACITY = 4
const cache: Array<{ key: Inputs; result: DisplayImages }> = []

function sameInputs(a: Inputs, b: Inputs): boolean {
  return (
    a.atoms === b.atoms &&
    a.periodic === b.periodic &&
    a.latticeVectors === b.latticeVectors &&
    a.periodicDirs === b.periodicDirs &&
    a.supercellParams === b.supercellParams &&
    a.showPeriodicImages === b.showPeriodicImages &&
    a.cellOverflowMode === b.cellOverflowMode &&
    a.draggingAtomId === b.draggingAtomId
  )
}

function lookup(key: Inputs): DisplayImages {
  for (let i = 0; i < cache.length; i++) {
    if (!sameInputs(cache[i].key, key)) continue
    if (i > 0) cache.unshift(...cache.splice(i, 1))
    return cache[0].result
  }
  const result = compute(key)
  cache.unshift({ key, result })
  if (cache.length > CACHE_CAPACITY) cache.length = CACHE_CAPACITY
  return result
}

export function __clearDisplayImageCache(): void {
  cache.length = 0
}

export const __computeDisplayImagesForTest = lookup

function compute({
  atoms,
  periodic,
  latticeVectors,
  periodicDirs,
  supercellParams,
  showPeriodicImages,
  cellOverflowMode,
  draggingAtomId,
}: Inputs): DisplayImages {
  if (!periodic || !isValidLattice(latticeVectors)) return NO_IMAGES

  const nx = Math.max(1, supercellParams?.nx ?? 1)
  const ny = Math.max(1, supercellParams?.ny ?? 1)
  const nz = Math.max(1, supercellParams?.nz ?? 1)
  const cells: Vec3 = [nx, ny, nz]
  const displayBox: LatticeVectors = {
    a: [latticeVectors.a[0] * nx, latticeVectors.a[1] * nx, latticeVectors.a[2] * nx],
    b: [latticeVectors.b[0] * ny, latticeVectors.b[1] * ny, latticeVectors.b[2] * ny],
    c: [latticeVectors.c[0] * nz, latticeVectors.c[1] * nz, latticeVectors.c[2] * nz],
  }

  const tiles = cellOverflowMode === 'tile-images'
  const effectiveImages: readonly (ImageIndex | undefined)[] = tiles
    ? atoms.map((a) => {
        if (a.id !== draggingAtomId) return a.displayImage
        const cart = a.cartesian ?? a.position
        if (!cart) return a.displayImage
        const { image } = splitIntoCellImage(cart as Vec3, latticeVectors, periodicDirs)
        return isOriginImage(image) ? undefined : image
      })
    : EMPTY_IMAGES

  const tileCells = tiles ? computeImageTileCells(effectiveImages) : []
  const tiling = tileCells.length > 1 ? tileCells : null

  const extra: Map<string, ImageOffset[]>[] = []

  if (showPeriodicImages) {
    extra.push(edgeImageOffsets(atoms, displayBox, periodicDirs))
  }

  // Tile offsets are expressed in display-box units, matching bond lattice offsets.
  if (tiling) {
    const tileOffsets = new Map<string, ImageOffset[]>()
    atoms.forEach((atom, index) => {
      const image = effectiveImages[index]
      const oa = image?.[0] ?? 0
      const ob = image?.[1] ?? 0
      const oc = image?.[2] ?? 0
      const list: ImageOffset[] = []
      for (const [ta, tb, tc] of tiling) {
        const ra = ta - oa, rb = tb - ob, rc = tc - oc
        if (ra === 0 && rb === 0 && rc === 0) continue
        if (ra % nx !== 0 || rb % ny !== 0 || rc % nz !== 0) continue
        list.push([ra / nx, rb / ny, rc / nz])
      }
      if (list.length > 0) tileOffsets.set(atom.id, list)
    })
    extra.push(tileOffsets)
  }

  const ids = atoms.map((a) => a.id)

  return {
    displayBox,
    cells,
    tiling,
    effectiveImages,
    offsets: buildDisplayImageOffsets(ids, extra),
  }
}
