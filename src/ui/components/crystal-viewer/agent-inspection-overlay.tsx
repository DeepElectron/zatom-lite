'use client'

import { useEffect, useMemo } from 'react'
import { Billboard, Line } from '@react-three/drei'

import { useAgentInspectionOverlayStore } from '../../../orchestration/agentInspectionOverlayStore'
import {
  useViewportStore as useCrystalStore,
  useViewportStoreApi,
} from '../../../orchestration/ViewportContext'
import { resolveViewportTheme } from '../../../host'

type Point3 = [number, number, number]

function ringPoints(radius: number): Point3[] {
  return Array.from({ length: 65 }, (_, index) => {
    const angle = (index / 64) * Math.PI * 2
    return [Math.cos(angle) * radius, Math.sin(angle) * radius, 0]
  })
}

/** Static WebGL reticle included in viewport captures for exact target localization. */
export function AgentInspectionOverlay() {
  const viewport = useViewportStoreApi()
  const overlay = useAgentInspectionOverlayStore((state) => state.byViewport.get(viewport as object) ?? null)
  const focusedAtomCount = useCrystalStore((state) => state.focusedAtomIds.size)
  const background = useCrystalStore((state) => state.background)
  const isDark = resolveViewportTheme(background) === 'dark'
  const clearOverlay = useAgentInspectionOverlayStore((state) => state.clearOverlay)
  const visualRadius = Math.max(overlay?.target.radius ?? 0, 0.45)
  const ring = useMemo(() => ringPoints(visualRadius), [visualRadius])

  useEffect(() => {
    if (overlay?.target.atomIds.length && focusedAtomCount === 0) {
      clearOverlay(viewport as object)
    }
  }, [clearOverlay, focusedAtomCount, overlay, viewport])

  if (!overlay) return null
  const crosshair = Math.min(0.9, Math.max(0.25, visualRadius * 0.18))
  const centerMarkerRadius = Math.min(0.22, Math.max(0.07, visualRadius * 0.055))
  const reticleColor = isDark ? '#ffd60a' : '#9a4d00'
  const centerColor = isDark ? '#ff9f0a' : '#b42318'

  return (
    <group position={overlay.target.center} renderOrder={1000}>
      <Billboard follow lockX={false} lockY={false} lockZ={false}>
        <Line
          points={ring}
          color={reticleColor}
          lineWidth={1.25}
          transparent
          opacity={0.62}
          depthTest={false}
          toneMapped={false}
        />
        <Line points={[[-crosshair, 0, 0], [crosshair, 0, 0]]} color={reticleColor} lineWidth={1.8} depthTest={false} toneMapped={false} />
        <Line points={[[0, -crosshair, 0], [0, crosshair, 0]]} color={reticleColor} lineWidth={1.8} depthTest={false} toneMapped={false} />
      </Billboard>
      <mesh renderOrder={1001}>
        <sphereGeometry args={[centerMarkerRadius, 16, 12]} />
        <meshBasicMaterial color={centerColor} depthTest={false} toneMapped={false} />
      </mesh>
    </group>
  )
}
