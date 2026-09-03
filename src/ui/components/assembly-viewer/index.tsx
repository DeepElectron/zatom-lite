'use client'

import { useRef, Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import { PerspectiveCamera, OrthographicCamera, OrbitControls } from '@react-three/drei'
import { useCrystalStore } from '../../../orchestration/crystalStore'
import { PlacementPanel } from './placement-panel'
import { AssemblyScene } from './assembly-scene'

function LoadingFallback() {
  return (
    <mesh>
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial color="#FF9F0A" wireframe />
    </mesh>
  )
}

function CameraControls({ orbitRef }: { orbitRef: React.RefObject<any> }) {
  return (
    <OrbitControls
      ref={orbitRef}
      enableDamping
      dampingFactor={0.05}
      rotateSpeed={0.5}
      zoomSpeed={0.8}
      panSpeed={0.5}
      minDistance={1}
      maxDistance={200}
    />
  )
}

export function AssemblyViewer() {
  const containerRef = useRef<HTMLDivElement>(null)
  const orbitRef = useRef<any>(null)
  
  const placementState = useCrystalStore((s) => s.placementState)
  const buildingBlocks = useCrystalStore((s) => s.buildingBlocks)
  const nextPlacementStep = useCrystalStore((s) => s.nextPlacementStep)
  const cancelPlacement = useCrystalStore((s) => s.cancelPlacement)
  const confirmPlacement = useCrystalStore((s) => s.confirmPlacement)
  const updatePlacementPosition = useCrystalStore((s) => s.updatePlacementPosition)
  const updatePlacementRotation = useCrystalStore((s) => s.updatePlacementRotation)
  const togglePlacementOrthographic = useCrystalStore((s) => s.togglePlacementOrthographic)
  const background = useCrystalStore((s) => s.background)
  
  const previewBlock = placementState.blockId ? buildingBlocks.find(b => b.id === placementState.blockId) : null
  const isPlacing = placementState.step !== 'idle'
  const useOrtho = isPlacing && placementState.useOrthographic
  
  return (
    <div ref={containerRef}  className="w-full h-full relative select-none">
      <Canvas
        gl={{ 
          antialias: true,
          alpha: true,
          powerPreference: 'high-performance',
        }}
        dpr={[1, 2]}
        camera={{ position: [15, 15, 15], fov: 50 }}
        style={{ background }}
        orthographic={useOrtho}
      >
        {useOrtho ? (
          <OrthographicCamera makeDefault position={[0, 40, 0.01]} zoom={15} />
        ) : (
          <PerspectiveCamera makeDefault position={[15, 15, 15]} fov={50} />
        )}
        <CameraControls orbitRef={orbitRef} />
        <Suspense fallback={<LoadingFallback />}>
          <AssemblyScene orbitRef={orbitRef} />
        </Suspense>
      </Canvas>
      
      {/* Placement UI Overlay */}
      {isPlacing && (
        <PlacementPanel
          placementState={placementState}
          previewBlock={previewBlock}
          updatePlacementPosition={updatePlacementPosition}
          updatePlacementRotation={updatePlacementRotation}
          togglePlacementOrthographic={togglePlacementOrthographic}
          nextPlacementStep={nextPlacementStep}
          cancelPlacement={cancelPlacement}
          confirmPlacement={confirmPlacement}
        />
      )}
    </div>
  )
}
