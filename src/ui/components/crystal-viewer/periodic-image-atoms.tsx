/**
 * Pure render overlay for periodic atom images and their cell outlines. It shares
 * the canonical image set with bond renderers so every visible endpoint agrees.
 */
import { useMemo } from 'react'
import { useViewportStore as useCrystalStore } from '../../../orchestration/ViewportContext'
import type { Atom, LatticeVectors, ViewMode } from '../../../lib/crystal/types'
import type { LayerRenderOverride } from './layer-render-override'
import { AtomMesh } from './atom-renderer'
import type { ImageIndex } from '../../../lib/crystal/cell-overflow'
import { latticeShift } from '../../../lib/crystal/lattice-math'
import { applySelectionTransformPreviewToPosition } from '../../../lib/selection-transform-preview'
import { useDisplayPositions } from './use-display-positions'
import { useDisplayImages } from './use-display-image-offsets'
import { isHomeImage, type DisplayImageOffsets } from '../../../lib/crystal/display-periodic-images'

type Vec3 = [number, number, number]

function buildImageAtoms(
  atoms: readonly Atom[],
  offsets: DisplayImageOffsets,
  positionOf: (atomId: string) => Vec3 | undefined,
  lattice: LatticeVectors,
  limit: number,
): Atom[] {
  const out: Atom[] = []
  const shiftCache = new Map<string, Vec3>()
  for (const atom of atoms) {
    const base = positionOf(atom.id)
    if (!base) continue
    for (const off of offsets.get(atom.id) ?? []) {
      if (isHomeImage(off)) continue
      const k = `${off[0]},${off[1]},${off[2]}`
      let s = shiftCache.get(k)
      if (!s) {
        s = latticeShift(lattice, off[0], off[1], off[2]) as Vec3
        shiftCache.set(k, s)
      }
      const shifted: Vec3 = [base[0] + s[0], base[1] + s[1], base[2] + s[2]]
      out.push({ ...atom, cartesian: shifted, position: shifted })
      if (out.length >= limit) return out
    }
  }
  return out
}

const BOX_EDGE_PAIRS: readonly [number, number][] = [
  [0, 1], [0, 2], [1, 3], [2, 3],
  [4, 5], [4, 6], [5, 7], [6, 7],
  [0, 4], [1, 5], [2, 6], [3, 7],
]

function TiledCellOutlines({ lattice, tileCells, color }: { lattice: LatticeVectors; tileCells: readonly ImageIndex[]; color: string }) {
  const positions = useMemo(() => {
    const pts: number[] = []
    const corner = (i: number, j: number, k: number, da: number, db: number, dc: number): Vec3 => [
      (i + da) * lattice.a[0] + (j + db) * lattice.b[0] + (k + dc) * lattice.c[0],
      (i + da) * lattice.a[1] + (j + db) * lattice.b[1] + (k + dc) * lattice.c[1],
      (i + da) * lattice.a[2] + (j + db) * lattice.b[2] + (k + dc) * lattice.c[2],
    ]
    for (const [da, db, dc] of tileCells) {
      if (da === 0 && db === 0 && dc === 0) continue
      const corners: Vec3[] = [
        corner(0, 0, 0, da, db, dc), corner(1, 0, 0, da, db, dc),
        corner(0, 1, 0, da, db, dc), corner(1, 1, 0, da, db, dc),
        corner(0, 0, 1, da, db, dc), corner(1, 0, 1, da, db, dc),
        corner(0, 1, 1, da, db, dc), corner(1, 1, 1, da, db, dc),
      ]
      for (const [s, e] of BOX_EDGE_PAIRS) {
        pts.push(corners[s][0], corners[s][1], corners[s][2])
        pts.push(corners[e][0], corners[e][1], corners[e][2])
      }
    }
    return new Float32Array(pts)
  }, [lattice, tileCells])

  if (positions.length === 0) return null
  return (
    <lineSegments>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <lineBasicMaterial color={color} transparent opacity={0.28} depthWrite={false} />
    </lineSegments>
  )
}

const MAX_IMAGE_ATOMS = 4000

interface PeriodicImageAtomsProps {
  viewMode: ViewMode
  scale: number
  renderOverride?: LayerRenderOverride
  hiddenAtomIds?: ReadonlySet<string>
}

export function PeriodicImageAtoms({ viewMode, scale, renderOverride, hiddenAtomIds }: PeriodicImageAtomsProps) {
  const latticeVectors = useCrystalStore((s) => s.latticeVectors)
  const atoms = useCrystalStore((s) => s.atoms)
  const bonds = useCrystalStore((s) => s.bonds)
  const cellColor = useCrystalStore((s) => s.cellColor)
  const selectedAtomIds = useCrystalStore((s) => s.selectedAtomIds)
  const selectionTransformOrigin = useCrystalStore((s) => s.selectionTransformOrigin)
  const translationPreview = useCrystalStore((s) => s.translationPreview)
  const rotationPreview = useCrystalStore((s) => s.rotationPreview)

  const unwrapMap = useDisplayPositions(atoms, bonds)
  const displayImages = useDisplayImages(atoms)

  const displayPositions = useMemo(() => {
    const map = new Map<string, Vec3>()
    for (const atom of atoms) {
      const cart = atom.cartesian ?? atom.position
      if (!cart) continue
      map.set(
        atom.id,
        applySelectionTransformPreviewToPosition(
          cart as Vec3,
          selectedAtomIds.has(atom.id),
          selectionTransformOrigin,
          translationPreview,
          rotationPreview,
          unwrapMap?.get(atom.id) ?? null,
        ) as Vec3,
      )
    }
    return map
  }, [atoms, unwrapMap, selectedAtomIds, selectionTransformOrigin, translationPreview, rotationPreview])

  const visibleSourceAtoms = useMemo(
    () => (hiddenAtomIds && hiddenAtomIds.size > 0 ? atoms.filter((atom) => !hiddenAtomIds.has(atom.id)) : atoms),
    [atoms, hiddenAtomIds],
  )

  const imageAtoms = useMemo(() => {
    if (!displayImages.offsets || !latticeVectors) return []
    return buildImageAtoms(
      visibleSourceAtoms,
      displayImages.offsets,
      (id) => displayPositions.get(id),
      displayImages.displayBox ?? latticeVectors,
      MAX_IMAGE_ATOMS,
    )
  }, [visibleSourceAtoms, displayImages.offsets, displayImages.displayBox, displayPositions, latticeVectors])

  const tiling = displayImages.tiling

  if (imageAtoms.length === 0 && !tiling) return null

  return (
    <group>
      {/* Cell outlines and image atoms must use the same translation vectors. */}
      {tiling && latticeVectors && (
        <TiledCellOutlines lattice={latticeVectors} tileCells={tiling} color={cellColor} />
      )}
      {imageAtoms.map((atom, index) => (
        <AtomMesh
          key={`periodic-image-${atom.id}-${index}`}
          atom={atom}
          viewMode={viewMode}
          scale={scale}
          renderOverride={renderOverride}
          focusDisplayPosition={(atom.cartesian ?? atom.position) as Vec3}
          isPeriodicImage
        />
      ))}
    </group>
  )
}
