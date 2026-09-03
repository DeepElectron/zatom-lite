'use client'

import { useRef, useEffect, useMemo, useCallback, useState } from 'react'
import { TransformControls } from '@react-three/drei'
import * as THREE from 'three'
import { useViewportStore as useCrystalStore } from '../../../orchestration/ViewportContext'
import { computeSelectionTransformOrigin, isNonZeroVector } from '../../../lib/selection-transform-preview'

export function SelectionTransformGizmo() {
  const selectedAtomIds = useCrystalStore((s) => s.selectedAtomIds)
  const atoms = useCrystalStore((s) => s.atoms)
  const setTranslationPreview = useCrystalStore((s) => s.setTranslationPreview)
  const rotationPreview = useCrystalStore((s) => s.rotationPreview)
  const setRotationPreview = useCrystalStore((s) => s.setRotationPreview)
  const translateMode = useCrystalStore((s) => s.translateMode)
  const translationPreview = useCrystalStore((s) => s.translationPreview)
  const selectionTransformMode = useCrystalStore((s) => s.selectionTransformMode)
  const setSelectionTransformOrigin = useCrystalStore((s) => s.setSelectionTransformOrigin)
  const setInteractionPerformanceActive = useCrystalStore((s) => s.setInteractionPerformanceActive)

  const groupRef = useRef<THREE.Group>(null)
  const controlsRef = useRef<any>(null)
  const initialPositionRef = useRef<THREE.Vector3 | null>(null)
  const isDraggingRef = useRef(false)
  const lastPreviewMagnitudeRef = useRef(0)
  const [mounted, setMounted] = useState(false)

  const selectionCenter = useMemo(() => {
    if (selectedAtomIds.size < 2) return null
    const origin = computeSelectionTransformOrigin(atoms, selectedAtomIds)
    if (!origin) return null
    return new THREE.Vector3(origin[0], origin[1], origin[2])
  }, [atoms, selectedAtomIds])

  useEffect(() => {
    if (translateMode && selectionCenter && groupRef.current) {
      groupRef.current.position.copy(selectionCenter)
      groupRef.current.rotation.set(0, 0, 0)
      initialPositionRef.current = selectionCenter.clone()
      setSelectionTransformOrigin([selectionCenter.x, selectionCenter.y, selectionCenter.z])
      setMounted(true)
    } else if (!translateMode) {
      setMounted(false)
      initialPositionRef.current = null
      // A modifier drag owns the same pivot; do not clear it when atom updates
      // retrigger this effect during an active selection manipulation.
      if (!useCrystalStore.getState().selectionManipActive) {
        setSelectionTransformOrigin(null)
      }
    }
  }, [translateMode, selectionCenter, selectionTransformMode, setSelectionTransformOrigin])

  useEffect(() => {
    if (!groupRef.current || !initialPositionRef.current || isDraggingRef.current) return

    if (selectionTransformMode === 'rotate') {
      const nextRotation = rotationPreview ?? [0, 0, 0]
      groupRef.current.position.copy(initialPositionRef.current)
      groupRef.current.rotation.set(nextRotation[0], nextRotation[1], nextRotation[2])
      return
    }

    groupRef.current.rotation.set(0, 0, 0)

    if (translationPreview) {
      groupRef.current.position.set(
        initialPositionRef.current.x + translationPreview[0],
        initialPositionRef.current.y + translationPreview[1],
        initialPositionRef.current.z + translationPreview[2],
      )
    } else if (selectionCenter) {
      groupRef.current.position.copy(selectionCenter)
      initialPositionRef.current = selectionCenter.clone()
    }
  }, [rotationPreview, selectionCenter, selectionTransformMode, translationPreview])

  const handleChange = useCallback(() => {
    if (!groupRef.current || !initialPositionRef.current) return

    if (selectionTransformMode === 'rotate') {
      const delta: [number, number, number] = [
        groupRef.current.rotation.x,
        groupRef.current.rotation.y,
        groupRef.current.rotation.z,
      ]

      if (isNonZeroVector(delta)) {
        setRotationPreview(delta)
        if (isDraggingRef.current) {
          const magnitude = Math.sqrt(delta[0] ** 2 + delta[1] ** 2 + delta[2] ** 2)
          if (Math.abs(magnitude - lastPreviewMagnitudeRef.current) > 0.01) {
            lastPreviewMagnitudeRef.current = magnitude
          }
        }
      } else {
        setRotationPreview(null)
      }
      return
    }

    const currentPos = groupRef.current.position
    const delta: [number, number, number] = [
      currentPos.x - initialPositionRef.current.x,
      currentPos.y - initialPositionRef.current.y,
      currentPos.z - initialPositionRef.current.z,
    ]

    if (delta[0] !== 0 || delta[1] !== 0 || delta[2] !== 0) {
      setTranslationPreview(delta)
      if (isDraggingRef.current) {
        const magnitude = Math.sqrt(delta[0] ** 2 + delta[1] ** 2 + delta[2] ** 2)
        if (Math.abs(magnitude - lastPreviewMagnitudeRef.current) > 0.005) {
          lastPreviewMagnitudeRef.current = magnitude
        }
      }
    }
  }, [selectionTransformMode, setRotationPreview, setTranslationPreview])

  useEffect(() => {
    if (!mounted) return

    let removeListener: (() => void) | null = null
    const timeoutId = setTimeout(() => {
      const controls = controlsRef.current
      if (!controls) return

      const onDraggingChanged = (event: { value: boolean }) => {
        const wasDragging = isDraggingRef.current
        isDraggingRef.current = event.value

        if (!wasDragging && event.value) {
          lastPreviewMagnitudeRef.current = 0
          setInteractionPerformanceActive(true)
        }

        if (wasDragging && !event.value) {
          const state = useCrystalStore.getState()
          if (state.selectionTransformMode === 'rotate') {
            if (isNonZeroVector(state.rotationPreview)) {
              state.applyRotationPreview()
            }
          } else if (state.translationPreview && (state.translationPreview[0] !== 0 || state.translationPreview[1] !== 0 || state.translationPreview[2] !== 0)) {
            state.applyTranslationPreview()
          }

          setInteractionPerformanceActive(false)
          lastPreviewMagnitudeRef.current = 0
          if (groupRef.current) {
            groupRef.current.rotation.set(0, 0, 0)
            initialPositionRef.current = groupRef.current.position.clone()
          }
        }
      }

      controls.addEventListener('dragging-changed', onDraggingChanged)
      removeListener = () => {
        controls.removeEventListener('dragging-changed', onDraggingChanged)
      }
    }, 50)

    return () => {
      clearTimeout(timeoutId)
      removeListener?.()
      setInteractionPerformanceActive(false)
    }
  }, [mounted, setInteractionPerformanceActive])

  if (!selectionCenter || selectedAtomIds.size < 2 || !translateMode) return null

  return (
    <>
      <group ref={groupRef} position={selectionCenter}>
        <mesh>
          <sphereGeometry args={[0.15, 16, 16]} />
          <meshBasicMaterial color="#30D158" transparent opacity={0.6} />
        </mesh>
      </group>

      {mounted && groupRef.current && (
        <TransformControls
          ref={controlsRef}
          object={groupRef.current}
          mode={selectionTransformMode}
          size={0.8}
          onChange={handleChange}
        />
      )}
    </>
  )
}
