'use client'

/** Render detected adsorption sites and the selected site's surface normal. */
import { useMemo } from 'react'
import * as THREE from 'three'
import { Line } from '@react-three/drei'
import { useViewportStore as useCrystalStore } from '../../../orchestration/ViewportContext'
import { siteDotColor } from '../../../lib/render/adsorbate-site-colors'

const DOT_RADIUS = 0.28
const SELECTED_SCALE = 1.75
const NORMAL_STICK_A = 2.0

export function AdsorbateSiteMarkers() {
  const detectedSites = useCrystalStore((s) => s.detectedSites)
  if (!detectedSites || detectedSites.length === 0) return null
  return <MarkersInner />
}

function MarkersInner() {
  const detectedSites = useCrystalStore((s) => s.detectedSites)
  const selectedSiteId = useCrystalStore((s) => s.selectedSiteId)
  const selectedSiteIdB = useCrystalStore((s) => s.selectedSiteIdB)

  const markers = useMemo(() => detectedSites.map((site) => {
    const blocked = site.accessibility === 'blocked'
    const selected = site.id === selectedSiteId || site.id === selectedSiteIdB
    const p = site.position
    const n = site.normal ?? [0, 0, 1]
    const tip: [number, number, number] = [
      p[0] + n[0] * NORMAL_STICK_A,
      p[1] + n[1] * NORMAL_STICK_A,
      p[2] + n[2] * NORMAL_STICK_A,
    ]
    return {
      id: site.id,
      position: [p[0], p[1], p[2]] as [number, number, number],
      tip,
      color: siteDotColor(site.kind, blocked),
      selected,
      radius: DOT_RADIUS * (selected ? SELECTED_SCALE : 1),
      opacity: blocked ? 0.45 : selected ? 1 : 0.8,
    }
  }), [detectedSites, selectedSiteId, selectedSiteIdB])

  return (
    <group name="adsorbate-site-markers">
      {markers.map((m) => (
        <group key={m.id}>
          <mesh position={m.position} raycast={() => null}>
            <sphereGeometry args={[m.radius, 16, 12]} />
            <meshStandardMaterial
              color={m.color}
              emissive={new THREE.Color(m.color)}
              emissiveIntensity={m.selected ? 0.55 : 0.25}
              transparent={m.opacity < 1}
              opacity={m.opacity}
              depthWrite={m.opacity >= 1}
            />
          </mesh>
          {m.selected && (
            <Line
              points={[m.position, m.tip]}
              color={m.color}
              lineWidth={2}
              dashed
              dashSize={0.18}
              gapSize={0.12}
            />
          )}
        </group>
      ))}
    </group>
  )
}
