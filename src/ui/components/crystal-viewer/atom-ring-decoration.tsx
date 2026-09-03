import { useEffect, useMemo, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { applyRadiusVariance } from '../../../lib/crystal/elements'
import { getDefaultCrystalElementVisual } from '../../../lib/render/crystal-visuals'
import { applySelectionTransformPreviewToPosition } from '../../../lib/selection-transform-preview'
import { useViewportStore as useCrystalStore } from '../../../orchestration/ViewportContext'
import { useDisplayPositions } from './use-display-positions'

/** Three mutually orthogonal great-circle rings: xy, yz, zx planes. */
const RING_ORIENTATIONS: readonly THREE.Quaternion[] = [
  new THREE.Quaternion(),
  new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2),
  new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2),
]
const RING_RADIUS_FACTOR = 1.03
const TUBE_FACTOR = 0.055
const RING_LIMIT = 6000 // atoms; 3 instances each

/**
 * Three non-pickable great-circle rings around each atom. Radius and display
 * position follow the atom pipeline so decoration stays attached during unwraps
 * and transform previews.
 */
export function AtomRingDecoration({ hiddenAtomIds }: { hiddenAtomIds?: ReadonlySet<string> }) {
  const show = useCrystalStore((s) => s.showAtomRings)
  const atoms = useCrystalStore((s) => s.atoms)
  const bonds = useCrystalStore((s) => s.bonds)
  const viewMode = useCrystalStore((s) => s.viewMode)
  const atomScale = useCrystalStore((s) => s.atomScale)
  const elementOverrides = useCrystalStore((s) => s.elementOverrides)
  const elementRadiusVariance = useCrystalStore((s) => s.elementRadiusVariance)
  const selectedAtomIds = useCrystalStore((s) => s.selectedAtomIds)
  const translationPreview = useCrystalStore((s) => s.translationPreview)
  const rotationPreview = useCrystalStore((s) => s.rotationPreview)
  const selectionTransformOrigin = useCrystalStore((s) => s.selectionTransformOrigin)
  const unwrapMap = useDisplayPositions(atoms, bonds)
  const invalidate = useThree((s) => s.invalidate)
  const meshRef = useRef<THREE.InstancedMesh>(null)

  const active = show && (viewMode === 'ball-stick' || viewMode === 'space-fill')

  const instances = useMemo(() => {
    if (!active) return null
    const out: { position: THREE.Vector3; radius: number; color: THREE.Color }[] = []
    for (const atom of atoms) {
      if (!atom.cartesian || hiddenAtomIds?.has(atom.id)) continue
      if (out.length >= RING_LIMIT) break
      const visual = elementOverrides[atom.element] ?? getDefaultCrystalElementVisual(atom.element)
      const base = applyRadiusVariance(visual.radius, elementRadiusVariance) * 0.5
      const radius = viewMode === 'space-fill' ? base * 2.5 * atomScale : base * atomScale
      const p = applySelectionTransformPreviewToPosition(
        atom.cartesian,
        selectedAtomIds.has(atom.id),
        selectionTransformOrigin,
        translationPreview,
        rotationPreview,
        unwrapMap?.get(atom.id) ?? null,
      )
      const color = new THREE.Color(visual.color).multiplyScalar(0.55)
      out.push({ position: new THREE.Vector3(p[0], p[1], p[2]), radius, color })
    }
    return out
  }, [
    active, atoms, hiddenAtomIds, elementOverrides, elementRadiusVariance, viewMode, atomScale,
    selectedAtomIds, selectionTransformOrigin, translationPreview, rotationPreview, unwrapMap,
  ])

  const count = (instances?.length ?? 0) * RING_ORIENTATIONS.length

  useEffect(() => {
    const mesh = meshRef.current
    if (!mesh || !instances) return
    const m = new THREE.Matrix4()
    const s = new THREE.Vector3()
    let i = 0
    for (const inst of instances) {
      s.setScalar(inst.radius)
      for (const q of RING_ORIENTATIONS) {
        m.compose(inst.position, q, s)
        mesh.setMatrixAt(i, m)
        mesh.setColorAt(i, inst.color)
        i += 1
      }
    }
    mesh.count = i
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()
    invalidate()
  }, [instances, invalidate])

  // One unit torus is instanced and scaled to each atom radius.
  const geometry = useMemo(() => new THREE.TorusGeometry(RING_RADIUS_FACTOR, TUBE_FACTOR, 8, 48), [])
  useEffect(() => () => geometry.dispose(), [geometry])

  if (!instances || count === 0) return null

  return (
    <instancedMesh key={count} ref={meshRef} args={[geometry, undefined, count]} frustumCulled={false} raycast={() => null}>
      <meshStandardMaterial roughness={0.6} metalness={0.05} />
    </instancedMesh>
  )
}
