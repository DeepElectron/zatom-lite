/**
 * R3F scene for the assembly viewer. It owns camera transitions, step-specific
 * picking planes, placement previews, scene objects, and the export boundary.
 */
import { useRef, useEffect, useCallback } from 'react'
import { useThree, useFrame, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { useCrystalStore } from '../../../orchestration/crystalStore'
import { resolveViewportTheme } from '../../../host'
import { resolveViewportLighting } from '../../../lib/lighting'
import { ViewportLights } from '../viewport-lights'
import { DraggablePlacementPreview } from './draggable-placement-preview'
import { ExportBoundaryPreview } from './export-boundary-preview'
import { SceneObjectMesh } from './scene-object-mesh'

export function AssemblyScene({ orbitRef }: { orbitRef: React.RefObject<any> }) {
  const sceneObjects = useCrystalStore((s) => s.sceneObjects)
  const selectSceneObject = useCrystalStore((s) => s.selectSceneObject)
  const placementState = useCrystalStore((s) => s.placementState)
  const buildingBlocks = useCrystalStore((s) => s.buildingBlocks)
  const updatePlacementPosition = useCrystalStore((s) => s.updatePlacementPosition)

  const { camera } = useThree()
  const targetCameraPos = useRef(new THREE.Vector3(15, 15, 15))
  const targetLookAt = useRef(new THREE.Vector3(0, 0, 0))
  const isAnimating = useRef(false)

  // Animate camera based on placement step
  useEffect(() => {
    if (placementState.step === 'position-xy') {
      // Top-down view
      targetCameraPos.current.set(0, 40, 0.01)
      targetLookAt.current.set(0, 0, 0)
      isAnimating.current = true
      if (orbitRef.current) {
        orbitRef.current.enableRotate = false
      }
    } else if (placementState.step === 'position-z') {
      // True horizontal side view - camera at Y=0, looking straight at the scene
      targetCameraPos.current.set(40, 0, 0)
      targetLookAt.current.set(0, 0, 0)
      isAnimating.current = true
      if (orbitRef.current) {
        orbitRef.current.enableRotate = false
      }
    } else if (placementState.step === 'idle') {
      // Default perspective view
      targetCameraPos.current.set(15, 15, 15)
      targetLookAt.current.set(0, 0, 0)
      isAnimating.current = true
      if (orbitRef.current) {
        orbitRef.current.enableRotate = true
      }
    }
  }, [placementState.step, orbitRef])

  // Smooth camera animation
  useFrame(() => {
    if (isAnimating.current) {
      camera.position.lerp(targetCameraPos.current, 0.08)
      if (orbitRef.current) {
        orbitRef.current.target.lerp(targetLookAt.current, 0.08)
      }

      if (camera.position.distanceTo(targetCameraPos.current) < 0.1) {
        isAnimating.current = false
      }
    }
  })

  // Click on empty space to deselect or set placement position
  const handleBackgroundClick = useCallback((e: ThreeEvent<MouseEvent>) => {
    if (placementState.step === 'position-xy') {
      // Set XY position from click point
      updatePlacementPosition([e.point.x, placementState.position[1], e.point.z])
    } else if (placementState.step === 'position-z') {
      // Set Z position (height)
      updatePlacementPosition([placementState.position[0], e.point.y, placementState.position[2]])
    } else {
      selectSceneObject(null)
    }
  }, [selectSceneObject, placementState, updatePlacementPosition])

  // Get preview block for placement
  const previewBlock = placementState.blockId ? buildingBlocks.find(b => b.id === placementState.blockId) : null

  const background = useCrystalStore((s) => s.background)
  const isDark = resolveViewportTheme(background) === 'dark'
  const userAmbient = useCrystalStore(s => s.lightAmbient)
  const userKey = useCrystalStore(s => s.lightKey)
  const userFill = useCrystalStore(s => s.lightFill)
  const userAzim = useCrystalStore(s => s.lightAzimuth)
  const userElev = useCrystalStore(s => s.lightElevation)
  const followCamera = useCrystalStore(s => s.lightFollowsCamera)
  const lighting = resolveViewportLighting(isDark, userAmbient, userKey, userFill)

  return (
    <>
      <ViewportLights lighting={lighting} azimuth={userAzim} elevation={userElev} followCamera={followCamera} />

      {/* Grid helper */}
      <gridHelper args={[50, 50, '#333333', '#222222']} rotation={[0, 0, 0]} />

      {/* Invisible plane for clicks */}
      {placementState.step === 'position-xy' ? (
        <mesh position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]} onClick={handleBackgroundClick}>
          <planeGeometry args={[200, 200]} />
          <meshBasicMaterial visible={false} />
        </mesh>
      ) : placementState.step === 'position-z' ? (
        <mesh position={[placementState.position[0], 0, placementState.position[2]]} rotation={[0, 0, 0]} onClick={handleBackgroundClick}>
          <planeGeometry args={[200, 200]} />
          <meshBasicMaterial visible={false} />
        </mesh>
      ) : (
        <mesh position={[0, -0.01, 0]} rotation={[-Math.PI / 2, 0, 0]} onClick={handleBackgroundClick}>
          <planeGeometry args={[200, 200]} />
          <meshBasicMaterial visible={false} />
        </mesh>
      )}

      {/* Placement preview - draggable */}
      {previewBlock && placementState.step !== 'idle' && (
        <DraggablePlacementPreview
          block={previewBlock}
          position={placementState.position}
          rotation={placementState.rotation}
          step={placementState.step}
          onPositionChange={updatePlacementPosition}
          orbitRef={orbitRef}
        />
      )}

      {/* Render all scene objects */}
      {sceneObjects.map(obj => (
        <SceneObjectMesh key={obj.id} objectId={obj.id} orbitRef={orbitRef} />
      ))}

      <ExportBoundaryPreview />
    </>
  )
}
