'use client'

import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { Atom } from '../../../lib/crystal/types'
import { buildFusedAtomSurface } from '../../../lib/render/fused-atom-surface'
import { getCpkElementVisual, type ElementVisualOverride } from '../../../lib/render/crystal-visuals'

interface FusedAtomSurfaceProps {
  atoms: readonly Atom[]
  elementOverrides: Record<string, ElementVisualOverride>
}

export function FusedAtomSurface({ atoms, elementOverrides }: FusedAtomSurfaceProps) {
  const geometry = useMemo(() => {
    const data = buildFusedAtomSurface(
      atoms,
      (element) => elementOverrides[element]?.color ?? getCpkElementVisual(element).color,
    )
    if (!data) return null
    const next = new THREE.BufferGeometry()
    next.setAttribute('position', new THREE.BufferAttribute(data.positions, 3))
    next.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3))
    next.setAttribute('color', new THREE.BufferAttribute(data.colors, 3))
    next.setIndex(new THREE.BufferAttribute(data.indices, 1))
    next.computeBoundingSphere()
    return next
  }, [atoms, elementOverrides])

  useEffect(() => () => geometry?.dispose(), [geometry])
  if (!geometry) return null

  return (
    <mesh geometry={geometry} castShadow receiveShadow>
      <meshPhysicalMaterial
        vertexColors
        metalness={0.04}
        roughness={0.3}
        ior={1.48}
        specularIntensity={0.82}
        clearcoat={0.24}
        clearcoatRoughness={0.36}
        envMapIntensity={0.95}
      />
    </mesh>
  )
}
