'use client'

import { useRef, useEffect, useMemo, useState } from 'react'
import { useThree, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { Atom } from '../../../lib/crystal/types'
import { useViewportStore as useCrystalStore } from '../../../orchestration/ViewportContext'
import {
  expandBioBoxSelection,
  shouldClearBioSelectionOnMiss,
} from '../../../lib/biomolecule/picking'
import { applyBoxSelectionOperation } from '../../../orchestration/slices/box-selection-slice'

interface ScreenPoint {
  x: number
  y: number
  z: number
}

interface ScreenRect {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

interface SelectionChunk {
  atomIds: string[]
  positions: [number, number, number][]
  corners: THREE.Vector3[]
}

const MIN_CHUNKABLE_ATOMS = 768
const TARGET_ATOMS_PER_CHUNK = 144
const MAX_CHUNK_AXIS = 8

function projectToScreen(
  point: THREE.Vector3,
  camera: THREE.Camera,
  size: { width: number; height: number },
): ScreenPoint | null {
  const vector = point.clone()
  vector.project(camera)

  if (!Number.isFinite(vector.x) || !Number.isFinite(vector.y) || !Number.isFinite(vector.z)) {
    return null
  }

  return {
    x: (vector.x * 0.5 + 0.5) * size.width,
    y: (-vector.y * 0.5 + 0.5) * size.height,
    z: vector.z,
  }
}

function isInsideBox(
  point: ScreenPoint,
  boxStart: { x: number; y: number },
  boxEnd: { x: number; y: number },
): boolean {
  const minX = Math.min(boxStart.x, boxEnd.x)
  const maxX = Math.max(boxStart.x, boxEnd.x)
  const minY = Math.min(boxStart.y, boxEnd.y)
  const maxY = Math.max(boxStart.y, boxEnd.y)

  return point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY
}

function toScreenRect(
  boxStart: { x: number; y: number },
  boxEnd: { x: number; y: number },
): ScreenRect {
  return {
    minX: Math.min(boxStart.x, boxEnd.x),
    maxX: Math.max(boxStart.x, boxEnd.x),
    minY: Math.min(boxStart.y, boxEnd.y),
    maxY: Math.max(boxStart.y, boxEnd.y),
  }
}

function rectsIntersect(a: ScreenRect, b: ScreenRect) {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY
}

function buildChunkCorners(
  min: [number, number, number],
  max: [number, number, number],
) {
  return [
    new THREE.Vector3(min[0], min[1], min[2]),
    new THREE.Vector3(min[0], min[1], max[2]),
    new THREE.Vector3(min[0], max[1], min[2]),
    new THREE.Vector3(min[0], max[1], max[2]),
    new THREE.Vector3(max[0], min[1], min[2]),
    new THREE.Vector3(max[0], min[1], max[2]),
    new THREE.Vector3(max[0], max[1], min[2]),
    new THREE.Vector3(max[0], max[1], max[2]),
  ]
}

function buildSelectionChunks(atoms: Atom[]): SelectionChunk[] {
  const validAtoms = atoms.filter((atom): atom is Atom & { cartesian: [number, number, number] } => Boolean(atom.cartesian))
  if (validAtoms.length === 0) {
    return []
  }

  if (validAtoms.length < MIN_CHUNKABLE_ATOMS) {
    return [
      {
        atomIds: validAtoms.map((atom) => atom.id),
        positions: validAtoms.map((atom) => atom.cartesian),
        corners: buildChunkCorners(
          [
            Math.min(...validAtoms.map((atom) => atom.cartesian[0])),
            Math.min(...validAtoms.map((atom) => atom.cartesian[1])),
            Math.min(...validAtoms.map((atom) => atom.cartesian[2])),
          ],
          [
            Math.max(...validAtoms.map((atom) => atom.cartesian[0])),
            Math.max(...validAtoms.map((atom) => atom.cartesian[1])),
            Math.max(...validAtoms.map((atom) => atom.cartesian[2])),
          ],
        ),
      },
    ]
  }

  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (const atom of validAtoms) {
    const [x, y, z] = atom.cartesian
    if (x < min[0]) min[0] = x
    if (y < min[1]) min[1] = y
    if (z < min[2]) min[2] = z
    if (x > max[0]) max[0] = x
    if (y > max[1]) max[1] = y
    if (z > max[2]) max[2] = z
  }

  const ranges = [
    Math.max(1e-6, max[0] - min[0]),
    Math.max(1e-6, max[1] - min[1]),
    Math.max(1e-6, max[2] - min[2]),
  ] as const
  const maxRange = Math.max(...ranges)
  const targetChunks = Math.min(96, Math.max(8, Math.round(validAtoms.length / TARGET_ATOMS_PER_CHUNK)))
  const root = Math.cbrt(targetChunks)
  const dims = ranges.map((range) =>
    Math.max(1, Math.min(MAX_CHUNK_AXIS, Math.round(root * (range / maxRange) || 1))),
  ) as [number, number, number]

  const chunkMap = new Map<string, { atomIds: string[]; positions: [number, number, number][]; min: [number, number, number]; max: [number, number, number] }>()

  for (const atom of validAtoms) {
    const [x, y, z] = atom.cartesian
    const ix = Math.min(dims[0] - 1, Math.max(0, Math.floor(((x - min[0]) / ranges[0]) * dims[0])))
    const iy = Math.min(dims[1] - 1, Math.max(0, Math.floor(((y - min[1]) / ranges[1]) * dims[1])))
    const iz = Math.min(dims[2] - 1, Math.max(0, Math.floor(((z - min[2]) / ranges[2]) * dims[2])))
    const key = `${ix}:${iy}:${iz}`

    const existing = chunkMap.get(key)
    if (existing) {
      existing.atomIds.push(atom.id)
      existing.positions.push(atom.cartesian)
      if (x < existing.min[0]) existing.min[0] = x
      if (y < existing.min[1]) existing.min[1] = y
      if (z < existing.min[2]) existing.min[2] = z
      if (x > existing.max[0]) existing.max[0] = x
      if (y > existing.max[1]) existing.max[1] = y
      if (z > existing.max[2]) existing.max[2] = z
      continue
    }

    chunkMap.set(key, {
      atomIds: [atom.id],
      positions: [atom.cartesian],
      min: [x, y, z],
      max: [x, y, z],
    })
  }

  return Array.from(chunkMap.values()).map((chunk) => ({
    atomIds: chunk.atomIds,
    positions: chunk.positions,
    corners: buildChunkCorners(chunk.min, chunk.max),
  }))
}

function getChunkScreenRect(
  chunk: SelectionChunk,
  camera: THREE.Camera,
  size: { width: number; height: number },
) {
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  let visibleCornerCount = 0

  for (const corner of chunk.corners) {
    const projected = projectToScreen(corner, camera, size)
    if (!projected) continue
    if (projected.z < -1.5 || projected.z > 1.5) continue

    visibleCornerCount += 1
    if (projected.x < minX) minX = projected.x
    if (projected.x > maxX) maxX = projected.x
    if (projected.y < minY) minY = projected.y
    if (projected.y > maxY) maxY = projected.y
  }

  if (visibleCornerCount === 0) {
    return null
  }

  return { minX, maxX, minY, maxY }
}

/**
 * Pointer travel that separates a modifier *click* (multi-select one atom) from
 * a modifier *drag* (ad-hoc rubber band) outside Box Select mode.
 */
export const BOX_SELECT_DRAG_THRESHOLD_PX = 4

export function exceedsBoxSelectDragThreshold(
  start: { x: number; y: number },
  current: { x: number; y: number },
): boolean {
  return Math.hypot(current.x - start.x, current.y - start.y) > BOX_SELECT_DRAG_THRESHOLD_PX
}

function isInteractiveOverlayTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  return Boolean(
    target.closest(
      'button, a, input, textarea, select, summary, [role="button"], [data-no-box-select="true"]',
    ),
  )
}

export function SelectionBox() {
  const { camera, size } = useThree()
  const committedBoxEndRef = useRef<{ x: number; y: number } | null>(null)

  const {
    atoms,
    isBoxSelecting,
    boxStart,
    boxEnd,
    selectAtoms,
    toolMode,
    bioStructure,
    boxSelectionOperation,
    boxSelectionBaseAtomIds,
  } = useCrystalStore()

  const selectionChunks = useMemo(() => buildSelectionChunks(atoms), [atoms])

  const applySelection = () => {
    if (!boxStart || !boxEnd || toolMode !== 'select') return []
    const selectedIds: string[] = []
    const selectionRect = toScreenRect(boxStart, boxEnd)
    const candidateChunks =
      selectionChunks.length <= 1
        ? selectionChunks
        : selectionChunks.filter((chunk) => {
            const chunkRect = getChunkScreenRect(chunk, camera, size)
            return chunkRect ? rectsIntersect(selectionRect, chunkRect) : false
          })

    for (const chunk of candidateChunks) {
      for (let index = 0; index < chunk.atomIds.length; index += 1) {
        const point3D = new THREE.Vector3(...chunk.positions[index])
        const point2D = projectToScreen(point3D, camera, size)
        if (!point2D || point2D.z < -1 || point2D.z > 1) continue

        if (isInsideBox(point2D, boxStart, boxEnd)) {
          selectedIds.push(chunk.atomIds[index])
        }
      }
    }

    const hitIds = bioStructure
      ? expandBioBoxSelection(bioStructure, selectedIds)
      : selectedIds
    const committedIds = applyBoxSelectionOperation(
      boxSelectionBaseAtomIds,
      hitIds,
      boxSelectionOperation,
    )

    // The store compares against the canonical current selection. Keeping a
    // second cache here made a repeated box-select silently fail after another
    // tool cleared the selection.
    selectAtoms(committedIds)

    return committedIds
  }

  useFrame(() => {
    if (!isBoxSelecting) return
    applySelection()
  })

  // Always commit each completed rectangle once. Object identity distinguishes
  // a new drag even when it ends at the same coordinates, and—unlike checking
  // an observed true→false transition—also covers a drag completed between two
  // React render frames.
  useEffect(() => {
    if (!isBoxSelecting && boxStart && boxEnd && boxEnd !== committedBoxEndRef.current) {
      committedBoxEndRef.current = boxEnd
      const selectedIds = applySelection()
      if (selectedIds.length === 0) {
        useCrystalStore.getState().clearFocusedAtoms()
      } else if (useCrystalStore.getState().autoFocusOnAtom) {
        useCrystalStore.getState().focusOnAtoms(selectedIds)
      }
    }
  }, [isBoxSelecting, boxStart, boxEnd, camera, size, selectionChunks, toolMode, selectAtoms, bioStructure, boxSelectionOperation, boxSelectionBaseAtomIds])

  return null
}

interface SelectionOverlayProps {
  containerRef: React.RefObject<HTMLDivElement | null>
}

export function SelectionOverlay({ containerRef }: SelectionOverlayProps) {
  const [localBox, setLocalBox] = useState<{
    start: { x: number; y: number } | null
    end: { x: number; y: number } | null
  }>({ start: null, end: null })
  const isTouchBoxSelectingRef = useRef(false)
  const pendingBoxRef = useRef<{
    x: number
    y: number
    operation: 'add' | 'subtract'
  } | null>(null)

  const {
    boxSelectModeEnabled,
    startBoxSelection,
    updateBoxSelection,
    endBoxSelection,
    toolMode,
    hideContextMenu,
    translateMode,
  } = useCrystalStore()

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const beginBox = (x: number, y: number, operation: 'replace' | 'add' | 'subtract') => {
      startBoxSelection(x, y, operation)
      setLocalBox({ start: { x, y }, end: { x, y } })
    }

    const moveBox = (x: number, y: number) => {
      if (!useCrystalStore.getState().isBoxSelecting) return
      useCrystalStore.getState().updateBoxSelection(x, y)
      setLocalBox((prev) => ({ ...prev, end: { x, y } }))
    }

    const finishBox = () => {
      if (useCrystalStore.getState().isBoxSelecting) {
        useCrystalStore.getState().endBoxSelection()
        setLocalBox({ start: null, end: null })
      }
    }

    const handleMouseDown = (e: MouseEvent) => {
      if (translateMode) return
      if (isInteractiveOverlayTarget(e.target)) return
      if (e.button === 0) hideContextMenu()
      if (toolMode !== 'select' || e.button !== 0) return

      const rect = container.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top

      const operation = e.shiftKey ? 'add' : e.ctrlKey || e.metaKey ? 'subtract' : 'replace'

      if (boxSelectModeEnabled) {
        e.preventDefault()
        beginBox(x, y, operation)
        return
      }

      // Outside Box Select mode a modifier gesture is ambiguous, so decide by
      // pointer travel instead of committing on mousedown: only arm the box here
      // and promote it in mousemove once the pointer leaves the click threshold.
      // Opening the box eagerly (the old behaviour) meant a plain Shift-click on
      // an atom also committed a rectangle on mouseup, which overwrote that very
      // pick and made Shift-click multi-select unusable.
      if (operation === 'replace') return
      pendingBoxRef.current = { x, y, operation }
    }

    const handleMouseMove = (e: MouseEvent) => {
      const pending = pendingBoxRef.current
      if (!pending && !useCrystalStore.getState().isBoxSelecting) return

      const rect = container.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top

      if (pending) {
        if (!exceedsBoxSelectDragThreshold(pending, { x, y })) return
        pendingBoxRef.current = null
        beginBox(pending.x, pending.y, pending.operation)
      }

      moveBox(x, y)
    }

    const handleMouseUp = () => {
      // Released inside the threshold: the gesture was a click, so leave the
      // selection to the atom pick handler and never commit a rectangle.
      pendingBoxRef.current = null
      finishBox()
    }

    const handleTouchStart = (e: TouchEvent) => {
      if (!useCrystalStore.getState().boxSelectModeEnabled) return
      if (useCrystalStore.getState().translateMode) return
      if (useCrystalStore.getState().toolMode !== 'select') return
      if (e.touches.length !== 1) return
      if (isInteractiveOverlayTarget(e.target)) return

      const touch = e.touches[0]
      const rect = container.getBoundingClientRect()
      const x = touch.clientX - rect.left
      const y = touch.clientY - rect.top

      e.preventDefault()
      e.stopPropagation()
      isTouchBoxSelectingRef.current = true
      beginBox(x, y, 'replace')
    }

    const handleTouchMove = (e: TouchEvent) => {
      if (!isTouchBoxSelectingRef.current) return
      if (e.touches.length !== 1) return

      const touch = e.touches[0]
      const rect = container.getBoundingClientRect()
      const x = touch.clientX - rect.left
      const y = touch.clientY - rect.top

      e.preventDefault()
      e.stopPropagation()
      moveBox(x, y)
    }

    const handleTouchEnd = (e: TouchEvent) => {
      if (!isTouchBoxSelectingRef.current) return
      isTouchBoxSelectingRef.current = false
      e.preventDefault()
      finishBox()
    }

    const handleContextMenu = (e: MouseEvent) => {
      const currentSelectedAtomIds = useCrystalStore.getState().selectedAtomIds
      if (currentSelectedAtomIds.size > 0) {
        e.preventDefault()
        const atomIds = Array.from(currentSelectedAtomIds)
        useCrystalStore.getState().showContextMenu(e.clientX, e.clientY, atomIds)
      }
    }

    container.addEventListener('mousedown', handleMouseDown)
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    container.addEventListener('contextmenu', handleContextMenu)
    container.addEventListener('touchstart', handleTouchStart, { passive: false })
    container.addEventListener('touchmove', handleTouchMove, { passive: false })
    container.addEventListener('touchend', handleTouchEnd)

    return () => {
      container.removeEventListener('mousedown', handleMouseDown)
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
      container.removeEventListener('contextmenu', handleContextMenu)
      container.removeEventListener('touchstart', handleTouchStart)
      container.removeEventListener('touchmove', handleTouchMove)
      container.removeEventListener('touchend', handleTouchEnd)
    }
  }, [
    boxSelectModeEnabled,
    containerRef,
    endBoxSelection,
    hideContextMenu,
    startBoxSelection,
    toolMode,
    translateMode,
    updateBoxSelection,
  ])

  const boxStyle = localBox.start && localBox.end ? {
    left: Math.min(localBox.start.x, localBox.end.x),
    top: Math.min(localBox.start.y, localBox.end.y),
    width: Math.abs(localBox.end.x - localBox.start.x),
    height: Math.abs(localBox.end.y - localBox.start.y),
  } : null

  if (!boxStyle) return null

  return (
    <div className="absolute inset-0 pointer-events-none z-20">
      <div
        className="absolute border-2 border-[#0A84FF] bg-[#0A84FF]/10"
        style={boxStyle}
      />
    </div>
  )
}

export interface BioSelectionMissContext {
  hasBiomolecule: boolean
  toolMode: string
  measurementMode: string
  translateMode: boolean
  boxSelectModeEnabled: boolean
}

/** Canonical blank-click gate used by the canvas and exercised without WebGL. */
export function isBioSelectionReplaceMiss(
  context: BioSelectionMissContext,
  event: { button: number; detail?: number; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean },
): boolean {
  return context.hasBiomolecule
    && context.toolMode === 'select'
    && context.measurementMode === 'none'
    && !context.translateMode
    && !context.boxSelectModeEnabled
    && event.button === 0
    // A double-click dispatches two click events. The second is still reported
    // as a miss when the first hit disappeared during rerender, so never let a
    // click with detail > 1 erase the molecule-level promotion.
    && (event.detail ?? 1) === 1
    && shouldClearBioSelectionOnMiss(event)
}
