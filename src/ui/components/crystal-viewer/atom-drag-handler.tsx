'use client'

/**
 * Global atom-drag driver. Capture-phase canvas listeners keep receiving motion
 * after the pointer leaves the atom, while a fixed-depth plane stabilizes mapping.
 * Selected groups use the preview/commit transaction and boundary rules run once
 * on release; axis locking bypasses positional snapping to avoid conflicting rules.
 */
import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useViewportStore as useCrystalStore } from '../../../orchestration/ViewportContext'
import { buildSnapLines } from '../../../lib/geometry-snap'
import { MAX_SNAP_ATOMS, needsSnapLines, pickSnapFeature } from '../../../lib/geometry-snap-pick'

export function AtomDragHandler() {
  const { gl, camera } = useThree()

  useEffect(() => {
    const dom = gl.domElement

    const drag: {
      id: string | null
      anchor: THREE.Vector3 | null
      startCartesian: [number, number, number] | null
      group: boolean
      pushed: boolean
      autoAxis: 'a' | 'b' | 'c' | null
    } = { id: null, anchor: null, startCartesian: null, group: false, pushed: false, autoAxis: null }

    const reset = () => {
      drag.id = null
      drag.anchor = null
      drag.startCartesian = null
      drag.group = false
      drag.pushed = false
      drag.autoAxis = null
    }

    const onPointerMove = (e: PointerEvent) => {
      const s = useCrystalStore.getState()
      const id = s.draggingAtomId
      if (!id || s.toolMode !== 'drag-atom' || s.translateMode || s.selectionManipActive) {
        if (drag.id) reset()
        return
      }
      if (drag.id !== id) {
        const atom = s.atoms.find((a) => a.id === id)
        const start = (atom?.cartesian ?? atom?.position) as [number, number, number] | undefined
        const anchorArr = s.draggingAtomAnchor ?? start
        drag.id = id
        drag.anchor = anchorArr ? new THREE.Vector3(anchorArr[0], anchorArr[1], anchorArr[2]) : null
        drag.startCartesian = start ?? null
        drag.group = s.selectedAtomIds.has(id) && s.selectedAtomIds.size >= 2
        drag.pushed = false
      }
      if (!drag.anchor || !drag.startCartesian) return

      e.preventDefault()
      e.stopPropagation()

      const rect = dom.getBoundingClientRect()
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      )
      const camDir = new THREE.Vector3()
      camera.getWorldDirection(camDir)
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(camDir.clone().negate(), drag.anchor)
      const ray = new THREE.Raycaster()
      ray.setFromCamera(ndc, camera)
      const pt = new THREE.Vector3()
      if (!ray.ray.intersectPlane(plane, pt)) return

      // Axis lock projects motion onto one lattice direction; auto mode uses hysteresis.
      const axisLock = s.dragAxisLock
      if (axisLock) {
        const unitOf = (ax: 'a' | 'b' | 'c') => {
          const v = s.latticeVectors[ax]
          const len = Math.hypot(v[0], v[1], v[2]) || 1
          return new THREE.Vector3(v[0] / len, v[1] / len, v[2] / len)
        }
        const delta = pt.clone().sub(drag.anchor)
        let axis: 'a' | 'b' | 'c'
        if (axisLock === 'auto') {
          const AXES = ['a', 'b', 'c'] as const
          let best: 'a' | 'b' | 'c' = drag.autoAxis ?? 'a'
          let bestMag = drag.autoAxis ? Math.abs(delta.dot(unitOf(drag.autoAxis))) * 1.25 : -1
          for (const ax of AXES) {
            if (ax === drag.autoAxis) continue
            const mag = Math.abs(delta.dot(unitOf(ax)))
            if (mag > bestMag) { best = ax; bestMag = mag }
          }
          drag.autoAxis = best
          axis = best
        } else {
          axis = axisLock
        }
        const u = unitOf(axis)
        pt.copy(drag.anchor).addScaledVector(u, delta.dot(u))
      }

      // Positional snapping applies only to a single free-axis atom drag.
      let snapped: [number, number, number] | null = null
      if (s.geometrySnapEnabled && !drag.group && !e.altKey && !axisLock) {
        const targets = s.geometrySnapTargets
        const lines = needsSnapLines(targets)
          ? buildSnapLines(s.atoms, s.bonds, s.latticeVectors, s.selectedAtomIds, {
              supercell: s.supercellParams,
              visible: s.periodic && s.showLattice,
              showCellGrid: s.showCellGrid,
            })
          : []
        const atomPoints = targets.atomCenter && s.atoms.length <= MAX_SNAP_ATOMS
          ? s.atoms
              .map((a) => ({ id: a.id, pos: (a.cartesian ?? a.position) as [number, number, number] | undefined }))
              .filter((a): a is { id: string; pos: [number, number, number] } => Array.isArray(a.pos))
          : []
        const feature = pickSnapFeature({
          camera,
          rect,
          clientX: e.clientX,
          clientY: e.clientY,
          snapLines: lines,
          atomPoints,
          targets,
          excludeAtomIds: new Set([id]),
        })
        s.setDragSnapFeature(feature)
        if (feature) snapped = feature.snap.pos
      } else if (s.dragSnapFeature) {
        s.setDragSnapFeature(null)
      }

      if (drag.group) {
        s.setTranslationPreview([pt.x - drag.anchor.x, pt.y - drag.anchor.y, pt.z - drag.anchor.z])
      } else {
        if (!drag.pushed) { s.pushHistory(); drag.pushed = true }
        s.updateAtomPosition(id, snapped ?? [
          drag.startCartesian[0] + (pt.x - drag.anchor.x),
          drag.startCartesian[1] + (pt.y - drag.anchor.y),
          drag.startCartesian[2] + (pt.z - drag.anchor.z),
        ])
      }
    }

    const onPointerUp = (e: PointerEvent) => {
      const s = useCrystalStore.getState()
      if (!s.draggingAtomId) {
        if (drag.id) reset()
        return
      }
      if (drag.group && s.translationPreview) {
        s.applyTranslationPreview()
      } else if (drag.id && drag.pushed) {
        s.applyBoundaryToAtoms([drag.id])
      }
      s.setDraggingAtom(null)
      reset()
      try { dom.releasePointerCapture(e.pointerId) } catch { /* noop */ }
      dom.style.cursor = s.toolMode === 'drag-atom' ? 'grab' : 'auto'
      // PDB explicit topology remains authoritative for coordinate-only edits.
      // Ordinary modeled structures retain the existing auto-bond refresh.
      if (!s.bioStructure) setTimeout(() => useCrystalStore.getState().autoDetectBonds(), 0)
    }

    dom.addEventListener('pointermove', onPointerMove, true)
    dom.addEventListener('pointerup', onPointerUp, true)
    dom.addEventListener('pointercancel', onPointerUp, true)

    return () => {
      dom.removeEventListener('pointermove', onPointerMove, true)
      dom.removeEventListener('pointerup', onPointerUp, true)
      dom.removeEventListener('pointercancel', onPointerUp, true)
    }
  }, [gl, camera])

  return null
}
