/** Noninteractive ghost geometry for proposed atom additions, moves, and removals. */
import { useMemo } from 'react'
import * as THREE from 'three'
import { useAgentProposalStore } from '../../../orchestration/agentProposalStore'
import { useViewportStoreApi } from '../../../orchestration/ViewportContext'
import { getDefaultCrystalElementVisual } from '../../../lib/render/crystal-visuals'

const REMOVE_COLOR = '#c2410c'
const MOVE_TRAIL_COLOR = '#0ea5e9'

export function AgentProposalGhostLayer() {
  const proposal = useAgentProposalStore((s) => s.current)
  const viewportApi = useViewportStoreApi()
  const diff = (proposal?.status === 'pending' || proposal?.status === 'applying')
    && proposal.viewportKey === (viewportApi as unknown as object)
    ? proposal.diff
    : null

  const trails = useMemo(() => {
    if (!diff) return null
    const segments: number[] = []
    for (const move of diff.moved) segments.push(...move.fromPosition, ...move.toPosition)
    if (!segments.length) return null
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(segments, 3))
    return geometry
  }, [diff])

  if (!diff) return null

  return (
    <group>
      {diff.added.map((atom) => {
        const visual = getDefaultCrystalElementVisual(atom.element)
        return (
          <mesh key={`add-${atom.atomId}`} position={atom.position} raycast={() => null}>
            <sphereGeometry args={[(visual.radius ?? 0.6) * 0.5, 20, 20]} />
            <meshStandardMaterial color={visual.color} transparent opacity={0.45} depthWrite={false} />
          </mesh>
        )
      })}
      {diff.moved.map((atom) => {
        const visual = getDefaultCrystalElementVisual(atom.element)
        return (
          <mesh key={`move-${atom.atomId}`} position={atom.toPosition} raycast={() => null}>
            <sphereGeometry args={[(visual.radius ?? 0.6) * 0.5, 20, 20]} />
            <meshStandardMaterial color={visual.color} transparent opacity={0.45} depthWrite={false} />
          </mesh>
        )
      })}
      {trails && (
        <lineSegments geometry={trails} raycast={() => null}>
          <lineBasicMaterial color={MOVE_TRAIL_COLOR} transparent opacity={0.8} depthWrite={false} />
        </lineSegments>
      )}
      {diff.removed.map((atom) => {
        const visual = getDefaultCrystalElementVisual(atom.element)
        return (
          <mesh key={`rm-${atom.atomId}`} position={atom.position} raycast={() => null}>
            <sphereGeometry args={[(visual.radius ?? 0.6) * 0.62, 12, 12]} />
            <meshBasicMaterial color={REMOVE_COLOR} wireframe transparent opacity={0.7} depthWrite={false} />
          </mesh>
        )
      })}
    </group>
  )
}
