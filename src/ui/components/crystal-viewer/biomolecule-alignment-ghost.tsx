import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { buildBioCartoonGeometry } from '../../../lib/biomolecule/cartoon-geometry'
import { useViewportStore as useCrystalStore } from '../../../orchestration/ViewportContext'
import { StylizedMaterial } from './stylized-material'

/**
 * Lightweight aligned-reference overlay. It deliberately renders only the
 * representative polymer trace: the reference document stays immutable and
 * never enters the active editing/picking topology.
 */
export function BiomoleculeAlignmentGhost() {
  const ghost = useCrystalStore((state) => state.bioAlignmentGhost)
  const geometry = useMemo(() => {
    if (!ghost) return null
    const data = buildBioCartoonGeometry(
      ghost.structure,
      new Array(ghost.structure.residues.length).fill(ghost.color),
      { model: 'tube', quality: 6, smooth: 1, width: .78, thickness: .78 },
    )
    if (!data.positions.length) return null
    const next = new THREE.BufferGeometry()
    next.setAttribute('position', new THREE.BufferAttribute(data.positions, 3))
    next.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3))
    next.setAttribute('color', new THREE.BufferAttribute(data.colors, 3))
    next.setIndex(new THREE.BufferAttribute(data.indices, 1))
    return next
  }, [ghost])
  useEffect(() => () => geometry?.dispose(), [geometry])
  if (!ghost || !geometry) return null
  return (
    <mesh geometry={geometry} renderOrder={12} raycast={() => {}}>
      <StylizedMaterial
        color="#ffffff"
        vertexColors
        side={THREE.DoubleSide}
        opacity={ghost.opacity}
        transparent
        depthWrite={false}
        fresnel={.45}
      />
    </mesh>
  )
}
