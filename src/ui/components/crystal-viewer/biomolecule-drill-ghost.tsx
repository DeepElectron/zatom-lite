/** Temporary spatial anchor shown while drilling through a biomolecular hierarchy. */
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useViewportStore as useCrystalStore } from '../../../orchestration/ViewportContext'

export function BiomoleculeDrillGhost() {
  const ghost = useCrystalStore((state) => state.bioDrillGhost)

  const geometry = useMemo(() => {
    if (!ghost) return null
    const box = new THREE.BoxGeometry(ghost.radius * 2, ghost.radius * 2, ghost.radius * 2)
    const edges = new THREE.EdgesGeometry(box)
    box.dispose()
    return edges
  }, [ghost])

  useEffect(() => () => geometry?.dispose(), [geometry])

  if (!ghost || !geometry) return null

  return (
    <lineSegments
      geometry={geometry}
      position={ghost.center}
      renderOrder={11}
      raycast={() => {}}
    >
      <lineBasicMaterial
        color="#5E5CE6"
        transparent
        opacity={0.35}
        depthWrite={false}
      />
    </lineSegments>
  )
}
