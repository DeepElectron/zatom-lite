'use client'

/** Camera-facing, constant-pixel markers for the currently active snap geometry. */
import { useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type { Group } from 'three'
import { useViewportStore as useCrystalStore } from '../../../orchestration/ViewportContext'
import { pointsOnLine, type SnapLine, type SnapPoint, type Vec3 } from '../../../lib/geometry-snap'
import {
  isSnapPointEnabled,
  snapFeatureColor,
  type ActiveFeature,
} from '../../../lib/geometry-snap-pick'

function GuideLine({ line, idx }: { line: SnapLine; idx: number }) {
  const A = line.p1
  const B = line.p2
  const d: Vec3 = [B[0] - A[0], B[1] - A[1], B[2] - A[2]]
  const positions = new Float32Array([
    A[0] - d[0] * 1.5, A[1] - d[1] * 1.5, A[2] - d[2] * 1.5,
    A[0] + d[0] * 2.5, A[1] + d[1] * 2.5, A[2] + d[2] * 2.5,
  ])
  return (
    <line key={`guide-${line.id}-${idx}`}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <lineBasicMaterial
        color={line.kind === 'lattice' ? '#BF5AF2' : '#FF9F0A'}
        transparent
        opacity={0.35}
        depthTest={false}
      />
    </line>
  )
}

function ScreenSpaceMarker({
  position,
  targetPx,
  children,
}: {
  position: Vec3
  targetPx: number
  children: React.ReactNode
}) {
  const ref = useRef<Group>(null)
  const { camera, size } = useThree()
  useFrame(() => {
    const g = ref.current
    if (!g) return
    const dist = camera.position.distanceTo(g.position)
    const fov = 'fov' in camera ? ((camera.fov as number) * Math.PI) / 180 : Math.PI / 4
    const worldPerPx = (2 * dist * Math.tan(fov / 2)) / size.height
    g.scale.setScalar(worldPerPx * targetPx)
    g.quaternion.copy(camera.quaternion)
  })
  return (
    <group ref={ref} position={position}>
      {children}
    </group>
  )
}

export function SnapFeatureOverlay({ active }: { active: ActiveFeature | null }) {
  const targets = useCrystalStore((s) => s.geometrySnapTargets)
  if (!active) return null

  const featurePoints: SnapPoint[] =
    active.snap.type !== 'atom' && active.snap.type !== 'intersection' && active.lines.length === 1
      ? pointsOnLine(active.lines[0]).filter((p) => isSnapPointEnabled(p.kind, targets))
      : []

  const accent = snapFeatureColor(active)

  return (
    <>
      {/* Draw only the lines involved in the active feature. */}
      {active.lines.map((l, i) => <GuideLine key={`guide-${l.id}-${i}`} line={l} idx={i} />)}
      {/* Candidate rings stay neutral; an inner dot distinguishes division points from endpoints. */}
      {featurePoints.map((c, i) => (
        <ScreenSpaceMarker key={`snap-pt-${i}`} position={c.pos} targetPx={3.5}>
          <mesh renderOrder={19}>
            <ringGeometry args={[0.72, 1, 32]} />
            <meshBasicMaterial color="#8E8E93" transparent opacity={0.6} depthTest={false} />
          </mesh>
          {c.kind !== 'extension' && c.kind !== 'endpoint' && (
            <mesh renderOrder={19}>
              <circleGeometry args={[0.34, 24]} />
              <meshBasicMaterial color="#8E8E93" transparent opacity={0.6} depthTest={false} />
            </mesh>
          )}
        </ScreenSpaceMarker>
      ))}
      {/* The active snap is the only high-contrast marker. */}
      <ScreenSpaceMarker position={active.snap.pos} targetPx={5}>
        <mesh renderOrder={20}>
          <circleGeometry args={[0.55, 32]} />
          <meshBasicMaterial color={accent} depthTest={false} />
        </mesh>
        <mesh renderOrder={20}>
          <ringGeometry args={[0.82, 1, 32]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.95} depthTest={false} />
        </mesh>
      </ScreenSpaceMarker>
    </>
  )
}
