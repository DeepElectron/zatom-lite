'use client'

import { useMemo } from 'react'
import * as THREE from 'three'
import { useViewportStore as useCrystalStore } from '../../../orchestration/ViewportContext'

// Wireframe sphere component
function WireframeSphere({ center, radius, color = '#0A84FF' }: { center: [number, number, number]; radius: number; color?: string }) {
  return (
    <mesh position={center}>
      <sphereGeometry args={[radius, 32, 24]} />
      <meshBasicMaterial color={color} wireframe transparent opacity={0.6} />
    </mesh>
  )
}

// Wireframe cylinder component
function WireframeCylinder({ 
  center, 
  radius, 
  height, 
  axis,
  color = '#30D158' 
}: { 
  center: [number, number, number]; 
  radius: number; 
  height: number; 
  axis: 'x' | 'y' | 'z';
  color?: string 
}) {
  const rotation = useMemo(() => {
    if (axis === 'x') return [0, 0, Math.PI / 2] as [number, number, number]
    if (axis === 'y') return [0, 0, 0] as [number, number, number]
    return [Math.PI / 2, 0, 0] as [number, number, number] // z
  }, [axis])
  
  return (
    <mesh position={center} rotation={rotation}>
      <cylinderGeometry args={[radius, radius, height, 32, 1, true]} />
      <meshBasicMaterial color={color} wireframe transparent opacity={0.6} side={THREE.DoubleSide} />
    </mesh>
  )
}

// Wireframe box component
function WireframeBox({ 
  center, 
  size,
  color = '#FF375F' 
}: { 
  center: [number, number, number]; 
  size: [number, number, number];
  color?: string 
}) {
  return (
    <mesh position={center}>
      <boxGeometry args={size} />
      <meshBasicMaterial color={color} wireframe transparent opacity={0.6} />
    </mesh>
  )
}

// Main selection region preview component
export function SelectionRegionPreview() {
  const preview = useCrystalStore((s) => s.selectionRegionPreview)
  
  if (!preview) return null
  
  switch (preview.type) {
    case 'sphere':
      return <WireframeSphere center={preview.center} radius={preview.radius} color="#0A84FF" />
    
    case 'shell':
      return (
        <>
          <WireframeSphere center={preview.center} radius={preview.innerRadius} color="#5AC8FA" />
          <WireframeSphere center={preview.center} radius={preview.outerRadius} color="#5AC8FA" />
        </>
      )
    
    case 'cylinder':
      return (
        <WireframeCylinder 
          center={preview.center} 
          radius={preview.radius} 
          height={preview.height} 
          axis={preview.axis}
          color="#30D158" 
        />
      )
    
    case 'box':
      return <WireframeBox center={preview.center} size={preview.size} color="#FF375F" />
    
    default:
      return null
  }
}
