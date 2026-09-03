/**
 * Transient assembly-placement mesh. Pointer positions are projected onto the
 * plane for the active workflow step while OrbitControls is suspended.
 */
import { useRef, useMemo, useEffect, useCallback } from 'react'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import { Html, Line } from '@react-three/drei'
import * as THREE from 'three'
import { useCrystalStore } from '../../../orchestration/crystalStore'
import { getElement } from '../../../lib/crystal/elements'

export function DraggablePlacementPreview({ block, position, rotation, step, onPositionChange, orbitRef }: { 
  block: any; 
  position: [number, number, number];
  rotation: [number, number, number];
  step: string;
  onPositionChange: (pos: [number, number, number]) => void;
  orbitRef: React.RefObject<any>;
}) {
  const groupRef = useRef<THREE.Group>(null)
  const isDragging = useRef(false)
  const dragPlane = useRef(new THREE.Plane())
  const { camera, gl } = useThree()
  
  const sceneObjects = useCrystalStore((s) => s.sceneObjects)
  const buildingBlocks = useCrystalStore((s) => s.buildingBlocks)
  const updatePlacementDistance = useCrystalStore((s) => s.updatePlacementDistance)
  
  const center = useMemo(() => {
    const nextCenter = new THREE.Vector3()
    block.atoms.forEach((atom: any) => {
      const pos = atom.cartesian || [atom.x || 0, atom.y || 0, atom.z || 0]
      nextCenter.add(new THREE.Vector3(pos[0], pos[1], pos[2]))
    })
    nextCenter.divideScalar(block.atoms.length || 1)
    return nextCenter
  }, [block])
  
  // Calculate minimum distance to existing atoms
  const distanceInfo = useMemo(() => {
    let minDist = Infinity
    type ClosestPair = { preview: THREE.Vector3; existing: THREE.Vector3 } | null
    let closestPair: ClosestPair = null
    
    // Get preview atom world positions
    const euler = new THREE.Euler(rotation[0], rotation[1], rotation[2])
    const previewAtoms = block.atoms.map((atom: any) => {
      const pos = atom.cartesian || [atom.x || 0, atom.y || 0, atom.z || 0]
      const localPos = new THREE.Vector3(pos[0] - center.x, pos[1] - center.y, pos[2] - center.z)
      localPos.applyEuler(euler)
      return new THREE.Vector3(
        localPos.x + position[0],
        localPos.y + position[1],
        localPos.z + position[2]
      )
    })
    
    // Compare with each existing scene object's atoms
    sceneObjects.forEach(obj => {
      const objBlock = buildingBlocks.find(b => b.id === obj.blockId)
      if (!objBlock) return
      
      const objCenter = new THREE.Vector3()
      objBlock.atoms.forEach((atom: any) => {
        const pos = atom.cartesian || [atom.x || 0, atom.y || 0, atom.z || 0]
        objCenter.add(new THREE.Vector3(pos[0], pos[1], pos[2]))
      })
      objCenter.divideScalar(objBlock.atoms.length || 1)
      
      const objEuler = new THREE.Euler(obj.rotation[0], obj.rotation[1], obj.rotation[2])
      
      objBlock.atoms.forEach((atom: any) => {
        const pos = atom.cartesian || [atom.x || 0, atom.y || 0, atom.z || 0]
        const localPos = new THREE.Vector3(pos[0] - objCenter.x, pos[1] - objCenter.y, pos[2] - objCenter.z)
        localPos.applyEuler(objEuler)
        const existingAtomPos = new THREE.Vector3(
          localPos.x + obj.position[0],
          localPos.y + obj.position[1],
          localPos.z + obj.position[2]
        )
        
        previewAtoms.forEach((previewPos: THREE.Vector3) => {
          const dist = previewPos.distanceTo(existingAtomPos)
          if (dist < minDist) {
            minDist = dist
            closestPair = { preview: previewPos.clone(), existing: existingAtomPos.clone() }
          }
        })
      })
    })
    
    return { min: minDist === Infinity ? -1 : minDist, closest: closestPair as ClosestPair }
  }, [block, position, rotation, sceneObjects, buildingBlocks, center])
  
  // Report distance to store
  useEffect(() => {
    updatePlacementDistance(distanceInfo.min)
  }, [distanceInfo.min, updatePlacementDistance])
  
  // Drag handlers for XY positioning
  const handlePointerDown = useCallback((e: ThreeEvent<PointerEvent>) => {
    if (step !== 'position-xy') return
    e.stopPropagation()
    isDragging.current = true
    
    // Set up horizontal drag plane
    dragPlane.current.setFromNormalAndCoplanarPoint(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(position[0], 0, position[2])
    )
    
    gl.domElement.style.cursor = 'grabbing'
    if (orbitRef.current) orbitRef.current.enabled = false
    ;(e.target as any)?.setPointerCapture?.(e.nativeEvent.pointerId)
  }, [step, position, gl, orbitRef])
  
  const handlePointerMove = useCallback((e: ThreeEvent<PointerEvent>) => {
    if (!isDragging.current || step !== 'position-xy') return
    e.stopPropagation()
    
    const raycaster = new THREE.Raycaster()
    const rect = gl.domElement.getBoundingClientRect()
    const mouse = new THREE.Vector2(
      ((e.nativeEvent.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.nativeEvent.clientY - rect.top) / rect.height) * 2 + 1
    )
    raycaster.setFromCamera(mouse, camera)
    
    const intersectPoint = new THREE.Vector3()
    if (raycaster.ray.intersectPlane(dragPlane.current, intersectPoint)) {
      onPositionChange([intersectPoint.x, position[1], intersectPoint.z])
    }
  }, [step, camera, gl, onPositionChange, position])
  
  const handlePointerUp = useCallback((e: ThreeEvent<PointerEvent>) => {
    isDragging.current = false
    gl.domElement.style.cursor = step === 'position-xy' ? 'grab' : 'auto'
    if (orbitRef.current) orbitRef.current.enabled = true
    ;(e.target as any)?.releasePointerCapture?.(e.nativeEvent.pointerId)
  }, [gl, step, orbitRef])
  
  return (
    <group 
      ref={groupRef}
      position={position}
      rotation={rotation}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerOver={() => { if (step === 'position-xy') gl.domElement.style.cursor = 'grab' }}
      onPointerOut={() => { if (!isDragging.current) gl.domElement.style.cursor = 'auto' }}
    >
      {/* Preview atoms with transparency */}
      {block.atoms.map((atom: any, i: number) => {
        const element = getElement(atom.element)
        const pos = atom.cartesian || [atom.x || 0, atom.y || 0, atom.z || 0]
        const offsetPos: [number, number, number] = [
          pos[0] - center.x,
          pos[1] - center.y,
          pos[2] - center.z
        ]
        
        return (
          <mesh key={i} position={offsetPos}>
            <sphereGeometry args={[element.radius * 0.3, 12, 8]} />
            <meshStandardMaterial 
              color={element.color} 
              transparent 
              opacity={0.5}
            />
          </mesh>
        )
      })}
      
      {/* Position indicator */}
      <mesh position={[0, -center.y, 0]}>
        <ringGeometry args={[2, 2.2, 32]} />
        <meshBasicMaterial color="#FF9F0A" side={THREE.DoubleSide} />
      </mesh>
      
      {/* Distance indicator dashed line to closest atom */}
      {distanceInfo.closest && distanceInfo.min > 0 && (
        <group>
          {/* Dashed line between closest atoms */}
          <Line
            points={[
              [
                distanceInfo.closest.preview.x - position[0],
                distanceInfo.closest.preview.y - position[1],
                distanceInfo.closest.preview.z - position[2],
              ],
              [
                distanceInfo.closest.existing.x - position[0],
                distanceInfo.closest.existing.y - position[1],
                distanceInfo.closest.existing.z - position[2],
              ],
            ]}
            color="#FF453A"
            lineWidth={2}
            dashed
            dashScale={3}
            dashSize={0.5}
            gapSize={0.3}
          />
          {/* Distance label */}
          <Html
            position={[
              (distanceInfo.closest.preview.x + distanceInfo.closest.existing.x) / 2 - position[0],
              (distanceInfo.closest.preview.y + distanceInfo.closest.existing.y) / 2 - position[1],
              (distanceInfo.closest.preview.z + distanceInfo.closest.existing.z) / 2 - position[2],
            ]}
            center
            style={{ pointerEvents: 'none' }}
          >
            <div className="bg-black/80 text-[#FF453A] text-[10px] font-mono px-1.5 py-0.5 rounded whitespace-nowrap">
              {distanceInfo.min.toFixed(2)} Å
            </div>
          </Html>
        </group>
      )}
      
      {/* Height indicator line for Z positioning */}
      {step === 'position-z' && (
        <line>
          <bufferGeometry>
            <bufferAttribute
              attach="attributes-position"
              count={2}
              array={new Float32Array([0, -50, 0, 0, 50, 0])}
              itemSize={3}
            />
          </bufferGeometry>
          <lineBasicMaterial color="#FF9F0A" />
        </line>
      )}
    </group>
  )
}
