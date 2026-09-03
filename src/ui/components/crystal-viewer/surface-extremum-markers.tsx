/**
 * Surface extremum markers for a field-coloured isosurface (ESP surface
 * minima/maxima, IGMH sign(λ₂)ρ extremes).
 *
 * Reads `molecularOrbital.colorFieldStats`, which the orbital layer publishes
 * after sampling — this component never re-samples, so the marker values are
 * exactly the values that were coloured.
 *
 * Marker colours are deliberately NOT taken from the colormap: a red dot on a
 * red lobe is invisible. We use the convention most QC figures already use —
 * orange for maxima, cyan for minima — with a dark rim so the dot pops on any
 * surface or background. The numeric value appears only while the pointer is
 * over a marker, as plain text with a halo (no badge).
 */
import { useState } from 'react'
import { BackSide } from 'three'
import { Html } from '@react-three/drei'
import { useViewportStore as useCrystalStore } from '../../../orchestration/ViewportContext'

const MAX_COLOR = '#ff8a00'
const MIN_COLOR = '#00d4ff'
const RIM_COLOR = '#1a1a1a'
const RADIUS = 0.1

function formatValue(value: number) {
  const abs = Math.abs(value)
  if (abs === 0) return '0'
  if (abs < 0.01 || abs >= 1000) return value.toExponential(2)
  return value.toFixed(abs < 1 ? 3 : 2)
}

export function SurfaceExtremumMarkers() {
  const colorField = useCrystalStore((s) => s.molecularOrbital.colorField)
  const stats = useCrystalStore((s) => s.molecularOrbital.colorFieldStats)
  const visible = useCrystalStore((s) => s.molecularOrbital.visible)
  const [hovered, setHovered] = useState<number | null>(null)

  if (!visible || !colorField?.showExtrema || !stats || stats.extrema.length === 0) return null

  return (
    <group>
      {stats.extrema.map((e, i) => {
        const color = e.kind === 'min' ? MIN_COLOR : MAX_COLOR
        const isHovered = hovered === i
        return (
          <group key={`${e.kind}-${i}`} position={[e.position[0], e.position[1], e.position[2]]}>
            {/* Dark rim: a slightly larger back-face sphere behind the dot. */}
            <mesh>
              <sphereGeometry args={[RADIUS * 1.35, 16, 16]} />
              <meshBasicMaterial color={RIM_COLOR} side={BackSide} />
            </mesh>
            <mesh
              onPointerOver={(ev) => { ev.stopPropagation(); setHovered(i) }}
              onPointerOut={() => setHovered((h) => (h === i ? null : h))}
            >
              <sphereGeometry args={[RADIUS, 16, 16]} />
              <meshBasicMaterial color={color} />
            </mesh>
            {isHovered && (
              <Html
                center
                distanceFactor={8}
                position={[0, RADIUS * 3, 0]}
                style={{
                  pointerEvents: 'none',
                  userSelect: 'none',
                  fontSize: 12,
                  fontWeight: 700,
                  color,
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  whiteSpace: 'nowrap',
                  lineHeight: 1,
                  textShadow: '0 0 2px #000, 0 0 2px #000, 0 1px 2px #000',
                }}
              >
                {formatValue(e.value)}
              </Html>
            )}
          </group>
        )
      })}
    </group>
  )
}
