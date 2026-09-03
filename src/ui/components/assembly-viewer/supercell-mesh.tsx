/** Shared atom, bond, and lattice renderers for a repeated assembly block. */
import * as THREE from 'three'
import { Html } from '@react-three/drei'
import { useCrystalStore } from '../../../orchestration/crystalStore'
import { getElement } from '../../../lib/crystal/elements'

// Supercell atoms renderer
export function SupercellAtoms({ block, center, supercell, opacity = 1 }: {
  block: any;
  center: THREE.Vector3;
  supercell: { a: number; b: number; c: number };
  opacity?: number;
}) {
  const isCrystal = block.type === 'crystal' && block.latticeVectors
  const lattice = block.latticeVectors || { a: [1, 0, 0], b: [0, 1, 0], c: [0, 0, 1] }

  const atoms: JSX.Element[] = []
  const sa = isCrystal ? supercell.a : 1
  const sb = isCrystal ? supercell.b : 1
  const sc = isCrystal ? supercell.c : 1

  for (let ia = 0; ia < sa; ia++) {
    for (let ib = 0; ib < sb; ib++) {
      for (let ic = 0; ic < sc; ic++) {
        const offset = new THREE.Vector3(
          ia * lattice.a[0] + ib * lattice.b[0] + ic * lattice.c[0],
          ia * lattice.a[1] + ib * lattice.b[1] + ic * lattice.c[1],
          ia * lattice.a[2] + ib * lattice.b[2] + ic * lattice.c[2]
        )

        block.atoms.forEach((atom: any, idx: number) => {
          const element = getElement(atom.element)
          const pos = atom.cartesian || [atom.x || 0, atom.y || 0, atom.z || 0]
          const offsetPos: [number, number, number] = [
            pos[0] - center.x + offset.x,
            pos[1] - center.y + offset.y,
            pos[2] - center.z + offset.z
          ]

          atoms.push(
            <mesh key={`${ia}-${ib}-${ic}-${idx}`} position={offsetPos}>
              <sphereGeometry args={[element.radius * 0.3, 16, 12]} />
              <meshStandardMaterial
                color={element.color}
                roughness={0.4}
                metalness={0.1}
                transparent={opacity < 1}
                opacity={opacity}
              />
            </mesh>
          )
        })
      }
    }
  }

  return <>{atoms}</>
}

// Supercell bonds renderer
export function SupercellBonds({ block, center, supercell, opacity = 1 }: {
  block: any;
  center: THREE.Vector3;
  supercell: { a: number; b: number; c: number };
  opacity?: number;
}) {
  const isCrystal = block.type === 'crystal' && block.latticeVectors
  const lattice = block.latticeVectors || { a: [1, 0, 0], b: [0, 1, 0], c: [0, 0, 1] }

  const bonds: JSX.Element[] = []
  const sa = isCrystal ? supercell.a : 1
  const sb = isCrystal ? supercell.b : 1
  const sc = isCrystal ? supercell.c : 1

  for (let ia = 0; ia < sa; ia++) {
    for (let ib = 0; ib < sb; ib++) {
      for (let ic = 0; ic < sc; ic++) {
        const offset = new THREE.Vector3(
          ia * lattice.a[0] + ib * lattice.b[0] + ic * lattice.c[0],
          ia * lattice.a[1] + ib * lattice.b[1] + ic * lattice.c[1],
          ia * lattice.a[2] + ib * lattice.b[2] + ic * lattice.c[2]
        )

        block.bonds.forEach((bond: any, idx: number) => {
          const atom1 = block.atoms.find((a: any) => a.id === bond.atom1Id)
          const atom2 = block.atoms.find((a: any) => a.id === bond.atom2Id)
          if (!atom1 || !atom2) return

          const pos1 = atom1.cartesian || [atom1.x || 0, atom1.y || 0, atom1.z || 0]
          const pos2 = atom2.cartesian || [atom2.x || 0, atom2.y || 0, atom2.z || 0]

          const start = new THREE.Vector3(
            pos1[0] - center.x + offset.x,
            pos1[1] - center.y + offset.y,
            pos1[2] - center.z + offset.z
          )
          const end = new THREE.Vector3(
            pos2[0] - center.x + offset.x,
            pos2[1] - center.y + offset.y,
            pos2[2] - center.z + offset.z
          )
          const mid = start.clone().add(end).multiplyScalar(0.5)
          const length = start.distanceTo(end)
          const direction = end.clone().sub(start).normalize()

          const quaternion = new THREE.Quaternion()
          quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction)

          bonds.push(
            <mesh key={`${ia}-${ib}-${ic}-${idx}`} position={mid} quaternion={quaternion}>
              <cylinderGeometry args={[0.08, 0.08, length, 8]} />
              <meshStandardMaterial
                color="#888888"
                roughness={0.5}
                transparent={opacity < 1}
                opacity={opacity}
              />
            </mesh>
          )
        })
      }
    }
  }

  return <>{bonds}</>
}

// Supercell lattice wireframe component for crystal blocks
export function SupercellLatticeWireframe({ latticeVectors, center, supercell }: {
  latticeVectors: any;
  center: THREE.Vector3;
  supercell: { a: number; b: number; c: number }
}) {
  const periodicDirs = useCrystalStore(s => s.periodicDirs)
  const { a, b, c } = latticeVectors

  const origin = new THREE.Vector3(-center.x, -center.y, -center.z)
  const va = new THREE.Vector3(a[0] * supercell.a, a[1] * supercell.a, a[2] * supercell.a)
  const vb = new THREE.Vector3(b[0] * supercell.b, b[1] * supercell.b, b[2] * supercell.b)
  const vc = new THREE.Vector3(c[0] * supercell.c, c[1] * supercell.c, c[2] * supercell.c)

  type LatticeEdge = { from: THREE.Vector3; to: THREE.Vector3; dirs: ('a' | 'b' | 'c')[] }
  const edges: LatticeEdge[] = []

  edges.push({ from: origin.clone(), to: origin.clone().add(va), dirs: ['a'] })
  edges.push({ from: origin.clone().add(vb), to: origin.clone().add(va).add(vb), dirs: ['a'] })
  edges.push({ from: origin.clone().add(vc), to: origin.clone().add(vc).add(va), dirs: ['a'] })
  edges.push({ from: origin.clone().add(vb).add(vc), to: origin.clone().add(va).add(vb).add(vc), dirs: ['a'] })

  edges.push({ from: origin.clone(), to: origin.clone().add(vb), dirs: ['b'] })
  edges.push({ from: origin.clone().add(va), to: origin.clone().add(va).add(vb), dirs: ['b'] })
  edges.push({ from: origin.clone().add(vc), to: origin.clone().add(vc).add(vb), dirs: ['b'] })
  edges.push({ from: origin.clone().add(va).add(vc), to: origin.clone().add(va).add(vb).add(vc), dirs: ['b'] })

  edges.push({ from: origin.clone(), to: origin.clone().add(vc), dirs: ['c'] })
  edges.push({ from: origin.clone().add(va), to: origin.clone().add(va).add(vc), dirs: ['c'] })
  edges.push({ from: origin.clone().add(vb), to: origin.clone().add(vb).add(vc), dirs: ['c'] })
  edges.push({ from: origin.clone().add(va).add(vb), to: origin.clone().add(va).add(vb).add(vc), dirs: ['c'] })

  const dirColor = (dir: 'a' | 'b' | 'c') => periodicDirs[dir] ? '#0A84FF' : '#FF4444'
  const dirOpacity = (dir: 'a' | 'b' | 'c') => periodicDirs[dir] ? 0.6 : 0.3

  const labelColors = { a: '#FF6B6B', b: '#4ECB71', c: '#5B9BFF' }

  return (
    <group>
      {edges.map((edge, i) => {
        const mid = edge.from.clone().add(edge.to).multiplyScalar(0.5)
        const length = edge.from.distanceTo(edge.to)
        const direction = edge.to.clone().sub(edge.from).normalize()
        const quaternion = new THREE.Quaternion()
        quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction)
        const color = dirColor(edge.dirs[0])
        const opacity = dirOpacity(edge.dirs[0])

        return (
          <mesh key={i} position={mid} quaternion={quaternion}>
            <cylinderGeometry args={[0.03, 0.03, length, 6]} />
            <meshBasicMaterial color={color} opacity={opacity} transparent />
          </mesh>
        )
      })}

      {/* Lattice-axis arrows and labels. */}
      {[
        { label: 'a', vec: va, color: labelColors.a },
        { label: 'b', vec: vb, color: labelColors.b },
        { label: 'c', vec: vc, color: labelColors.c },
      ].map(({ label, vec, color }) => {
        const tip = origin.clone().add(vec)
        const arrowDir = vec.clone().normalize()
        const conePos = tip.clone()
        const coneQuat = new THREE.Quaternion()
        coneQuat.setFromUnitVectors(new THREE.Vector3(0, 1, 0), arrowDir)

        return (
          <group key={label}>
            {/* Arrowhead. */}
            <mesh position={conePos} quaternion={coneQuat}>
              <coneGeometry args={[0.15, 0.5, 8]} />
              <meshBasicMaterial color={color} />
            </mesh>
            {/* Axis label. */}
            <Html position={tip.clone().add(arrowDir.clone().multiplyScalar(0.8))} center style={{ pointerEvents: 'none' }}>
              <div style={{
                color,
                fontSize: '14px',
                fontWeight: 700,
                textShadow: '0 0 4px rgba(0,0,0,0.8)',
                userSelect: 'none',
              }}>
                {label}
              </div>
            </Html>
          </group>
        )
      })}
    </group>
  )
}
