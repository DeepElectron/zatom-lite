/** Render and transform one assembly scene object and its supercell geometry. */
import { useRef, useCallback } from 'react'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import { TransformControls } from '@react-three/drei'
import * as THREE from 'three'
import { useCrystalStore } from '../../../orchestration/crystalStore'
import { SupercellAtoms, SupercellBonds, SupercellLatticeWireframe } from './supercell-mesh'

// Instanced rendering for a single building block in scene
export function SceneObjectMesh({ objectId, orbitRef }: { objectId: string; orbitRef: React.RefObject<any> }) {
  const groupRef = useRef<THREE.Group>(null)

  const sceneObjects = useCrystalStore((s) => s.sceneObjects)
  const buildingBlocks = useCrystalStore((s) => s.buildingBlocks)
  const selectedSceneObjectId = useCrystalStore((s) => s.selectedSceneObjectId)
  const selectSceneObject = useCrystalStore((s) => s.selectSceneObject)
  const updateSceneObjectPosition = useCrystalStore((s) => s.updateSceneObjectPosition)
  const updateSceneObjectRotation = useCrystalStore((s) => s.updateSceneObjectRotation)
  const assemblyTransformMode = useCrystalStore((s) => s.assemblyTransformMode)
  const toolMode = useCrystalStore((s) => s.toolMode)
  const placementState = useCrystalStore((s) => s.placementState)

  const sceneObj = sceneObjects.find(o => o.id === objectId)
  const block = sceneObj ? buildingBlocks.find(b => b.id === sceneObj.blockId) : null

  const isSelected = selectedSceneObjectId === objectId
  // Only show gizmo when drag-atom tool is active AND an object is selected
  const showGizmo = isSelected && toolMode === 'drag-atom' && (assemblyTransformMode === 'translate' || assemblyTransformMode === 'rotate')

  // During placement, existing objects are not interactive
  const isPlacing = placementState.step !== 'idle'

  const { gl } = useThree()

  // Click handler for selection - disabled during placement
  const handleClick = useCallback((e: ThreeEvent<MouseEvent>) => {
    if (isPlacing) return
    e.stopPropagation()
    selectSceneObject(objectId)
  }, [objectId, selectSceneObject, isPlacing])

  // Handle transform changes from gizmo
  const handleTransformChange = useCallback(() => {
    if (!groupRef.current) return
    const pos = groupRef.current.position
    const rot = groupRef.current.rotation

    if (assemblyTransformMode === 'translate') {
      updateSceneObjectPosition(objectId, [pos.x, pos.y, pos.z])
    } else if (assemblyTransformMode === 'rotate') {
      updateSceneObjectRotation(objectId, [rot.x, rot.y, rot.z])
    }
  }, [objectId, assemblyTransformMode, updateSceneObjectPosition, updateSceneObjectRotation])

  if (!sceneObj || !block) return null

  const center = new THREE.Vector3()
  if (block.type === 'crystal' && block.latticeVectors) {
    const lv = block.latticeVectors
    const va = Array.isArray(lv) ? lv[0] : lv.a
    const vb = Array.isArray(lv) ? lv[1] : lv.b
    const vc = Array.isArray(lv) ? lv[2] : lv.c
    const sc = sceneObj.supercell || { a: 1, b: 1, c: 1 }
    center.set(
      0.5 * (va[0]*sc.a + vb[0]*sc.b + vc[0]*sc.c),
      0.5 * (va[1]*sc.a + vb[1]*sc.b + vc[1]*sc.c),
      0.5 * (va[2]*sc.a + vb[2]*sc.b + vc[2]*sc.c),
    )
  } else {
    block.atoms.forEach((atom: any) => {
      const pos = atom.cartesian || [atom.x || 0, atom.y || 0, atom.z || 0]
      center.add(new THREE.Vector3(pos[0], pos[1], pos[2]))
    })
    center.divideScalar(block.atoms.length || 1)
  }

  // Calculate bounding box for selection highlight
  const bbox = new THREE.Box3()
  block.atoms.forEach(atom => {
    const pos = atom.cartesian ?? [0, 0, 0]
    bbox.expandByPoint(new THREE.Vector3(pos[0] - center.x, pos[1] - center.y, pos[2] - center.z))
  })
  const bboxSize = new THREE.Vector3()
  bbox.getSize(bboxSize)

  // Dim opacity when placement is active
  const objectOpacity = isPlacing ? 0.4 : 1

  return (
    <>
      <group
        ref={groupRef}
        position={sceneObj.position}
        rotation={sceneObj.rotation}
        onClick={handleClick}
        onPointerOver={() => { if (!isPlacing) gl.domElement.style.cursor = 'pointer' }}
        onPointerOut={() => { gl.domElement.style.cursor = 'auto' }}
      >
        {/* Selection highlight box - sized to content (hidden during placement) */}
        {isSelected && !showGizmo && !isPlacing && (
          <mesh position={[0, 0, 0]}>
            <boxGeometry args={[bboxSize.x + 1, bboxSize.y + 1, bboxSize.z + 1]} />
            <meshBasicMaterial color="#FF9F0A" wireframe opacity={0.5} transparent />
          </mesh>
        )}

      {block.type === 'crystal' && block.latticeVectors && block.showLattice && (
        <SupercellLatticeWireframe
          latticeVectors={block.latticeVectors}
          center={center}
          supercell={sceneObj.supercell}
        />
      )}

      {/* Render atoms - with supercell expansion for crystals */}
      <SupercellAtoms
        block={block}
        center={center}
        supercell={sceneObj.supercell}
        opacity={objectOpacity}
      />

      {/* Render bonds - with supercell expansion */}
      <SupercellBonds
        block={block}
        center={center}
        supercell={sceneObj.supercell}
        opacity={objectOpacity}
      />
      </group>

      {/* Transform Controls Gizmo */}
      {showGizmo && groupRef.current && (
        <TransformControls
          object={groupRef.current}
          mode={assemblyTransformMode === 'translate' ? 'translate' : 'rotate'}
          size={0.8}
          onObjectChange={handleTransformChange}
          onMouseDown={() => { if (orbitRef.current) orbitRef.current.enabled = false }}
          onMouseUp={() => orbitRef.current && (orbitRef.current.enabled = true)}
        />
      )}
    </>
  )
}
