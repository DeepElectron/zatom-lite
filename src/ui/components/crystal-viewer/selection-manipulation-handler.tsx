'use client'

/**
 * Capture-phase selection manipulation: Ctrl-drag rotates about the selection
 * centroid, while Shift-Ctrl-drag translates in the view plane. Orbit input is
 * locked before pointer-down and edits are committed once on release.
 */
import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useViewportStore as useCrystalStore } from '../../../orchestration/ViewportContext'
import { computeSelectionTransformOrigin } from '../../../lib/selection-transform-preview'

export function SelectionManipulationHandler() {
  const { gl, camera } = useThree()

  useEffect(() => {
    const dom = gl.domElement

    const drag: {
      mode: null | 'translate' | 'rotate'
      startX: number
      startY: number
      origin: [number, number, number] | null
    } = { mode: null, startX: 0, startY: 0, origin: null }
    let armed = false

    const canManipulate = (): boolean => {
      const s = useCrystalStore.getState()
      if (s.selectedAtomIds.size === 0 || s.translateMode) return false
      return s.toolMode === 'select' || s.toolMode === 'drag-atom'
    }

    const setArmed = (next: boolean) => {
      if (next === armed) return
      armed = next
      useCrystalStore.getState().setSelectionManipActive(next)
      if (!next) {
        const s = useCrystalStore.getState()
        s.setTranslationPreview(null)
        s.setRotationPreview(null)
        s.setSelectionTransformOrigin(null)
      }
    }

    const modifierHeld = (e: { ctrlKey: boolean }) => e.ctrlKey

    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.key === 'Control' || e.ctrlKey) && canManipulate()) {
        setArmed(true)
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if ((e.key === 'Control' || !e.ctrlKey) && !drag.mode) {
        if (!e.ctrlKey) setArmed(false)
      }
    }
    const onBlur = () => { if (!drag.mode) setArmed(false) }

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0 || !modifierHeld(e) || !canManipulate()) return
      const s = useCrystalStore.getState()
      const origin = computeSelectionTransformOrigin(s.atoms, s.selectedAtomIds)
      if (!origin) return

      setArmed(true)
      drag.mode = e.shiftKey ? 'translate' : 'rotate'
      drag.startX = e.clientX
      drag.startY = e.clientY
      drag.origin = origin
      s.setSelectionTransformOrigin(origin)
      try { dom.setPointerCapture(e.pointerId) } catch { /* noop */ }
      dom.style.cursor = drag.mode === 'rotate' ? 'grabbing' : 'move'
      e.preventDefault()
      e.stopPropagation()
    }

    const onPointerMove = (e: PointerEvent) => {
      if (!drag.mode || !drag.origin) return
      e.preventDefault()
      e.stopPropagation()
      const s = useCrystalStore.getState()

      if (drag.mode === 'translate') {
        const rect = dom.getBoundingClientRect()
        const ndc = new THREE.Vector2(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          -((e.clientY - rect.top) / rect.height) * 2 + 1,
        )
        const camDir = new THREE.Vector3()
        camera.getWorldDirection(camDir)
        const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
          camDir.clone().negate(),
          new THREE.Vector3(drag.origin[0], drag.origin[1], drag.origin[2]),
        )
        const ray = new THREE.Raycaster()
        ray.setFromCamera(ndc, camera)
        const pt = new THREE.Vector3()
        if (ray.ray.intersectPlane(plane, pt)) {
          s.setTranslationPreview([pt.x - drag.origin[0], pt.y - drag.origin[1], pt.z - drag.origin[2]])
        }
      } else {
        const rx = ((e.clientY - drag.startY) / Math.max(1, dom.clientHeight)) * Math.PI
        const ry = ((e.clientX - drag.startX) / Math.max(1, dom.clientWidth)) * Math.PI
        if (!s.selectionTransformOrigin) s.setSelectionTransformOrigin(drag.origin)
        s.setRotationPreview([rx, ry, 0])
      }
    }

    const finishDrag = (e: PointerEvent) => {
      if (!drag.mode) return
      const s = useCrystalStore.getState()
      if (drag.mode === 'translate') s.applyTranslationPreview()
      else s.applyRotationPreview()
      drag.mode = null
      drag.origin = null
      try { dom.releasePointerCapture(e.pointerId) } catch { /* noop */ }
      dom.style.cursor = 'auto'
      e.preventDefault()
      e.stopPropagation()
      if (!modifierHeld(e)) setArmed(false)
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    dom.addEventListener('pointerdown', onPointerDown, true)
    dom.addEventListener('pointermove', onPointerMove, true)
    dom.addEventListener('pointerup', finishDrag, true)
    dom.addEventListener('pointercancel', finishDrag, true)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      dom.removeEventListener('pointerdown', onPointerDown, true)
      dom.removeEventListener('pointermove', onPointerMove, true)
      dom.removeEventListener('pointerup', finishDrag, true)
      dom.removeEventListener('pointercancel', finishDrag, true)
      if (armed) useCrystalStore.getState().setSelectionManipActive(false)
    }
  }, [gl, camera])

  return null
}
