'use client'

/**
 * Void-surface overlay — renders the probe-accessible iso-surface (SAS) from the
 * porosity analysis as a translucent mesh, coloured per-vertex by the nearest-
 * atom distance via the selected colormap. Returns null when no analysis has run
 * or the toggle is off.
 */

import { useMemo } from 'react'
import * as THREE from 'three'
import { useViewportStore as useCrystalStore } from '../../../orchestration/ViewportContext'
import { sampleColormap } from '../../../lib/viz/colormap'
import type { VoidAnalysisResult } from '../../../lib/analysis/porosity/void-field'
import type { ColormapName } from '../../../lib/viz/colormap'

function buildGeometry(result: VoidAnalysisResult, colormap: ColormapName): THREE.BufferGeometry | null {
  if (result.mesh.vertices.length === 0) return null
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(result.mesh.vertices, 3))
  if (result.mesh.normals.length === result.mesh.vertices.length) {
    geo.setAttribute('normal', new THREE.BufferAttribute(result.mesh.normals, 3))
  }
  geo.setIndex(new THREE.BufferAttribute(result.mesh.faces, 1))
  if (result.mesh.normals.length !== result.mesh.vertices.length) geo.computeVertexNormals()

  const nv = result.vertexScalar.length
  const colors = new Float32Array(nv * 3)
  const [smin, smax] = result.scalarRange
  const span = smax - smin || 1
  for (let i = 0; i < nv; i++) {
    const t = (result.vertexScalar[i] - smin) / span
    const [r, g, b] = sampleColormap(colormap, t)
    colors[i * 3] = r; colors[i * 3 + 1] = g; colors[i * 3 + 2] = b
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return geo
}

export function VoidSurfaceLayer() {
  const voidResult = useCrystalStore((s) => s.voidResult)
  const showVoidSurface = useCrystalStore((s) => s.showVoidSurface)
  const colormap = useCrystalStore((s) => s.voidColormap)
  const opacity = useCrystalStore((s) => s.voidSurfaceOpacity)

  const geometry = useMemo(() => {
    if (!voidResult) return null
    return buildGeometry(voidResult, colormap)
  }, [voidResult, colormap])

  if (!showVoidSurface || !geometry) return null

  return (
    <group renderOrder={15}>
      <mesh geometry={geometry}>
        <meshStandardMaterial
          vertexColors
          transparent
          opacity={opacity}
          side={THREE.DoubleSide}
          depthWrite={false}
          roughness={0.4}
          metalness={0.05}
        />
      </mesh>
    </group>
  )
}
