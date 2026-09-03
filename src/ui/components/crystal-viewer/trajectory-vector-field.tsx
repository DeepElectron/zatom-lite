'use client'

/**
 * Trajectory vector-field overlay — draws a per-atom 3D arrow for the active
 * extended-XYZ vector property (`forces`, `magmom`, or the synthetic
 * `displacement` = current − frame-0 position). Arrow length = |v| × scale,
 * coloured by magnitude via the shared colormap so the field doubles as a
 * magnitude legend. Returns null when no vector property is selected.
 *
 * Generalises MagmomLabels (the per-atom overlay precedent) from <Html> badges
 * to THREE.ArrowHelper glyphs. Reactive to the active frame: setTrajectoryFrame
 * replaces store atoms (with new props), which re-runs the memo.
 *
 * NOTE: per-atom ArrowHelper is O(N); for >~2000 atoms an InstancedMesh of
 * cone+cylinder (matrix-per-atom, like instanced-atoms) is the planned upgrade.
 */
import { useMemo } from 'react'
import * as THREE from 'three'
import { useViewportStore as useCrystalStore } from '../../../orchestration/ViewportContext'
import { sampleColormap } from '../../../lib/viz/colormap'

export function TrajectoryVectorField() {
  const prop = useCrystalStore((s) => s.trajectoryVectorProp)
  const scale = useCrystalStore((s) => s.trajectoryVectorScale)
  const colormap = useCrystalStore((s) => s.trajectoryColormap)
  const atoms = useCrystalStore((s) => s.atoms)
  const frames = useCrystalStore((s) => s.trajectoryFrames)

  const arrows = useMemo(() => {
    if (!prop) return []
    const raw: { origin: THREE.Vector3; dir: THREE.Vector3; len: number }[] = []
    let maxLen = 0
    atoms.forEach((atom, i) => {
      const pos = atom.cartesian ?? atom.position
      if (!pos) return
      let v: [number, number, number] | null = null
      if (prop === 'displacement') {
        const ref = frames?.[0]?.atoms[i]?.cartesian
        if (ref && atom.cartesian) {
          v = [atom.cartesian[0] - ref[0], atom.cartesian[1] - ref[1], atom.cartesian[2] - ref[2]]
        }
      } else {
        const p = atom.props?.[prop]
        if (p && p.kind === 'vector') v = p.value
      }
      if (!v) return
      const len = Math.hypot(v[0], v[1], v[2])
      if (len < 1e-6) return
      if (len > maxLen) maxLen = len
      raw.push({
        origin: new THREE.Vector3(pos[0], pos[1], pos[2]),
        dir: new THREE.Vector3(v[0], v[1], v[2]).normalize(),
        len,
      })
    })
    return raw.map((a, k) => {
      const t = maxLen > 0 ? a.len / maxLen : 0
      const [r, g, b] = sampleColormap(colormap, t)
      const L = a.len * scale
      const head = Math.min(0.3 * L, 0.5)
      const ah = new THREE.ArrowHelper(a.dir, a.origin, L, new THREE.Color(r, g, b).getHex(), head, head * 0.6)
      return { key: k, ah }
    })
  }, [prop, scale, colormap, atoms, frames])

  if (!prop || arrows.length === 0) return null
  return <group>{arrows.map(({ key, ah }) => <primitive key={key} object={ah} />)}</group>
}
