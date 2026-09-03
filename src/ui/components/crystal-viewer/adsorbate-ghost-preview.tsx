/**
 * Non-pickable placement preview resolved through the same pipeline as commit,
 * so the ghost and the final adsorbate use identical coordinates.
 */
import { useMemo } from 'react'
import { useViewportStore as useCrystalStore } from '../../../orchestration/ViewportContext'
import { resolveAdsorbatePlacement } from '../../../orchestration/slices/adsorbate-slice'
import { getDefaultCrystalElementVisual } from '../../../lib/render/crystal-visuals'

export function AdsorbateGhostPreview() {
  const armed = useCrystalStore((s) => s.adsorbateClickPlace)
  const hoveredId = useCrystalStore((s) => s.hoveredAtomId)
  const atoms = useCrystalStore((s) => s.atoms)
  const latticeVectors = useCrystalStore((s) => s.latticeVectors)
  const supercellParams = useCrystalStore((s) => s.supercellParams)
  const periodic = useCrystalStore((s) => s.periodic)
  const adsorbateFragment = useCrystalStore((s) => s.adsorbateFragment)
  const customFragment = useCrystalStore((s) => s.customFragment)

  const ghost = useMemo(() => {
    if (!armed || !hoveredId) return null
    const res = resolveAdsorbatePlacement(
      { atoms, latticeVectors, supercellParams, periodic, adsorbateFragment, customFragment },
      [hoveredId],
      'click',
    )
    if (!res.ok || !res.newAtoms || res.newAtoms.length === 0) return null
    if (res.autoVacuum && res.baseAtoms) {
      const idx = (atoms ?? []).findIndex((a) => a.id === hoveredId)
      if (idx < 0) return null
      const orig = atoms![idx]
      const shifted = res.baseAtoms[idx]
      const origPos = (orig.cartesian ?? orig.position) as [number, number, number]
      const d: [number, number, number] = [
        origPos[0] - shifted.cartesian[0],
        origPos[1] - shifted.cartesian[1],
        origPos[2] - shifted.cartesian[2],
      ]
      return res.newAtoms.map((a) => ({
        element: a.element,
        position: [a.cartesian[0] + d[0], a.cartesian[1] + d[1], a.cartesian[2] + d[2]] as [number, number, number],
      }))
    }
    return res.newAtoms.map((a) => ({ element: a.element, position: a.cartesian }))
  }, [armed, hoveredId, atoms, latticeVectors, supercellParams, periodic, adsorbateFragment, customFragment])

  if (!ghost) return null
  return (
    <group>
      {ghost.map((a, i) => {
        const visual = getDefaultCrystalElementVisual(a.element)
        return (
          <mesh key={i} position={a.position} raycast={() => null}>
            <sphereGeometry args={[(visual.radius ?? 0.6) * 0.5, 20, 20]} />
            <meshStandardMaterial color={visual.color} transparent opacity={0.45} depthWrite={false} />
          </mesh>
        )
      })}
    </group>
  )
}
