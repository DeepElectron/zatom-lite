import { useMemo } from 'react'
import type { ThreeElements } from '@react-three/fiber' // pulls in the r3f JSX augmentation (self-sufficient)

// Disable raycast on the points (mirror CompactAtoms' NO_RAYCAST on its instancedMesh):
// at >250k atoms hit-testing goes through the CPU tile picker, never three's raycaster.
const NO_RAYCAST: NonNullable<ThreeElements['points']['raycast']> = () => {}

// Default device-pixel point size for the base layer (small — 1 vertex/atom).
const DEFAULT_POINT_SIZE_PX = 3
// The selection overlay renders slightly larger than the base points and on top.
const SELECTION_POINT_SIZE_BONUS_PX = 2
const SELECTION_COLOR = 0x0a84ff

export interface CompactPointsProps {
  positions: Float32Array   // zero-copy xyz, length 3*count — already the trajectory-displayed buffer
  colors: Float32Array      // per-point rgb (0..1), length 3*count, from the same convention as buildInstanceColors
  count: number
  selectedIndices: number[] // for a BOUNDED selection overlay (already capped at COMPACT_BOX_SELECTED_MAX=50000)
  pointSizePx?: number      // device-pixel point size; default a small constant (e.g. 3)
  visible?: boolean
}

export function CompactPoints({
  positions,
  colors,
  count,
  selectedIndices,
  pointSizePx,
  visible = true,
}: CompactPointsProps) {
  const size = pointSizePx ?? DEFAULT_POINT_SIZE_PX

  // Bounded selection overlay buffer: gather ONLY in-range selected atoms' xyz (length 3*valid),
  // skipping stale/over-cap indices so no stray point lands at the origin.
  const selectionXyz = useMemo(() => {
    const xyz: number[] = []
    for (const idx of selectedIndices) {
      if (idx < 0 || idx >= count) continue
      xyz.push(positions[idx * 3], positions[idx * 3 + 1], positions[idx * 3 + 2])
    }
    return Float32Array.from(xyz)
  }, [positions, selectedIndices, count])

  if (count === 0) return null

  return (
    <group visible={visible}>
      {/* base layer: one <points> over all atoms — frustumCulled off to match the sphere path.
          `args` keys the attribute to the buffer identity, so a new trajectory/coloring buffer
          rebuilds it and r3f disposes the prior geometry. */}
      <points frustumCulled={false} raycast={NO_RAYCAST}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
          <bufferAttribute attach="attributes-color" args={[colors, 3]} />
        </bufferGeometry>
        <pointsMaterial vertexColors sizeAttenuation={false} size={size} />
      </points>
      {/* bounded selection overlay, rendered on top */}
      {selectionXyz.length > 0 && (
        <points frustumCulled={false} raycast={NO_RAYCAST} renderOrder={1}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[selectionXyz, 3]} />
          </bufferGeometry>
          <pointsMaterial color={SELECTION_COLOR} sizeAttenuation={false} size={size + SELECTION_POINT_SIZE_BONUS_PX} depthTest={false} />
        </points>
      )}
    </group>
  )
}
