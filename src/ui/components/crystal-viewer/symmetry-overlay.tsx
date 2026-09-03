/** Render primitive-cell edges and filtered crystallographic symmetry elements. */
import { useMemo } from 'react'
import * as THREE from 'three'
import { Line } from '@react-three/drei'
import { useViewportStore as useCrystalStore } from '../../../orchestration/ViewportContext'

type Vec3 = [number, number, number]

// ── helpers ──────────────────────────────────────────────────────────────────

function det3(m: number[][]): number {
  const a = m[0], b = m[1], c = m[2]
  return (
    a[0] * (b[1] * c[2] - b[2] * c[1])
    - a[1] * (b[0] * c[2] - b[2] * c[0])
    + a[2] * (b[0] * c[1] - b[1] * c[0])
  )
}

function trace3(m: number[][]): number {
  return m[0][0] + m[1][1] + m[2][2]
}

function classifyOperation(rotation: number[][]): string {
  if (!rotation || rotation.length !== 3) return 'unknown'
  const t = Math.round(trace3(rotation))
  const d = Math.sign(Math.round(det3(rotation)))
  if (d > 0) {
    if (t === 3) return 'E'
    if (t === 2) return 'C6'
    if (t === 1) return 'C4'
    if (t === 0) return 'C3'
    if (t === -1) return 'C2'
  } else {
    if (t === -3) return 'i'
    if (t === 1) return 'σ'
    if (t === -1) return 'S4'
    if (t === 0) return 'S3/S6'
    if (t === -2) return 'S3'
  }
  return 'other'
}

function symmetryAxis(R: number[][], properRotation: boolean): Vec3 | null {
  // Crystallographic matrices are small integer matrices, so cross products of
  // rows in (R - λI) recover the ±1 eigenvector without an SVD dependency.
  const lambda = properRotation ? 1 : -1
  const M = [
    [R[0][0] - lambda, R[0][1], R[0][2]],
    [R[1][0], R[1][1] - lambda, R[1][2]],
    [R[2][0], R[2][1], R[2][2] - lambda],
  ]
  const cross = (u: number[], v: number[]): Vec3 => [
    u[1] * v[2] - u[2] * v[1],
    u[2] * v[0] - u[0] * v[2],
    u[0] * v[1] - u[1] * v[0],
  ]
  const candidates: Vec3[] = [cross(M[0], M[1]), cross(M[0], M[2]), cross(M[1], M[2])]
  let best: Vec3 | null = null
  let bestLen = 0
  for (const c of candidates) {
    const len = Math.hypot(c[0], c[1], c[2])
    if (len > bestLen) {
      bestLen = len
      best = c
    }
  }
  if (!best || bestLen < 1e-6) return null
  return [best[0] / bestLen, best[1] / bestLen, best[2] / bestLen]
}

function dedupeAxes(axes: Vec3[]): Vec3[] {
  const out: Vec3[] = []
  for (const ax of axes) {
    const dup = out.some((b) => {
      const d1 = Math.abs(ax[0] * b[0] + ax[1] * b[1] + ax[2] * b[2])
      return d1 > 0.999
    })
    if (!dup) out.push(ax)
  }
  return out
}

const COLOR: Record<string, string> = {
  C2: '#EF4444',
  C3: '#22C55E',
  C4: '#3B82F6',
  C6: '#A855F7',
  σ: '#06B6D4',
  i: '#F97316',
  S4: '#EAB308',
  'S3/S6': '#EAB308',
  S3: '#EAB308',
}

// ── component ────────────────────────────────────────────────────────────────

export function SymmetryOverlay() {
  const analysis = useCrystalStore((s) => s.symmetryAnalysis)
  const showPrimitive = useCrystalStore((s) => s.showPrimitiveCell)
  const showElements = useCrystalStore((s) => s.showSymmetryElements)
  const filter = useCrystalStore((s) => s.symmetryElementFilter)
  const latticeVectors = useCrystalStore((s) => s.latticeVectors)

  const cellCenter = useMemo<Vec3>(() => {
    if (!latticeVectors) return [0, 0, 0]
    const { a, b, c } = latticeVectors
    return [(a[0] + b[0] + c[0]) / 2, (a[1] + b[1] + c[1]) / 2, (a[2] + b[2] + c[2]) / 2]
  }, [latticeVectors])

  const cellSize = useMemo(() => {
    if (!latticeVectors) return 5
    const { a, b, c } = latticeVectors
    const norm = (v: Vec3) => Math.hypot(...v)
    return Math.max(norm(a), norm(b), norm(c))
  }, [latticeVectors])

  // ── Primitive cell wireframe edges ─────────────────────────────────────────
  const primitiveEdges = useMemo<Vec3[][] | null>(() => {
    if (!showPrimitive || !analysis?.primitiveCell) return null
    const m = analysis.primitiveCell.lattice.matrix
    if (!m || m.length !== 3) return null
    const a = m[0] as Vec3, b = m[1] as Vec3, c = m[2] as Vec3
    // 8 corners of the parallelepiped relative to origin
    const origin: Vec3 = [
      cellCenter[0] - (a[0] + b[0] + c[0]) / 2,
      cellCenter[1] - (a[1] + b[1] + c[1]) / 2,
      cellCenter[2] - (a[2] + b[2] + c[2]) / 2,
    ]
    const add = (...vs: Vec3[]): Vec3 => [
      origin[0] + vs.reduce((s, v) => s + v[0], 0),
      origin[1] + vs.reduce((s, v) => s + v[1], 0),
      origin[2] + vs.reduce((s, v) => s + v[2], 0),
    ]
    const O = add()
    const A = add(a)
    const B = add(b)
    const C = add(c)
    const AB = add(a, b)
    const AC = add(a, c)
    const BC = add(b, c)
    const ABC = add(a, b, c)
    return [
      [O, A], [O, B], [O, C],
      [A, AB], [A, AC],
      [B, AB], [B, BC],
      [C, AC], [C, BC],
      [AB, ABC], [AC, ABC], [BC, ABC],
    ]
  }, [showPrimitive, analysis, cellCenter])

  // ── Symmetry elements ──────────────────────────────────────────────────────
  type AxisElement = { kind: 'axis'; label: string; color: string; dir: Vec3 }
  type PlaneElement = { kind: 'plane'; label: string; color: string; normal: Vec3 }
  type InversionElement = { kind: 'inversion'; label: string; color: string }
  type Element = AxisElement | PlaneElement | InversionElement

  const elements = useMemo<Element[]>(() => {
    if (!showElements || !analysis?.operations) return []
    const byLabel: Record<string, Vec3[]> = {}
    let hasInversion = false
    for (const op of analysis.operations) {
      const label = classifyOperation(op.rotation)
      if (label === 'E') continue
      if (label === 'i') { hasInversion = true; continue }
      const d = Math.sign(Math.round(det3(op.rotation)))
      const axis = symmetryAxis(op.rotation, d > 0)
      if (!axis) continue
      ;(byLabel[label] ||= []).push(axis)
    }
    const out: Element[] = []
    for (const [label, axes] of Object.entries(byLabel)) {
      const uniq = dedupeAxes(axes)
      const color = COLOR[label] ?? '#94A3B8'
      const isMirror = label === 'σ'
      for (const dir of uniq) {
        if (isMirror) out.push({ kind: 'plane', label, color, normal: dir })
        else out.push({ kind: 'axis', label, color, dir })
      }
    }
    if (hasInversion) out.push({ kind: 'inversion', label: 'i', color: COLOR.i })
    return out
  }, [showElements, analysis])

  const filteredElements = useMemo(() => {
    if (!filter || filter.size === 0) return elements
    return elements.filter((e) => filter.has(e.label))
  }, [elements, filter])

  // ── Render ─────────────────────────────────────────────────────────────────
  if (!showPrimitive && !showElements) return null

  const axisHalfLen = cellSize * 0.75

  return (
    <group>
      {/* Primitive cell wireframe */}
      {primitiveEdges?.map((edge, i) => (
        <Line
          key={`prim-${i}`}
          points={edge}
          color="#06B6D4"
          lineWidth={1.5}
          dashed
          dashSize={0.25}
          gapSize={0.15}
          opacity={0.85}
          transparent
        />
      ))}

      {/* Symmetry axes + mirror planes */}
      {filteredElements.map((el, i) => {
        if (el.kind === 'axis') {
          const [dx, dy, dz] = el.dir
          const p1: Vec3 = [
            cellCenter[0] - dx * axisHalfLen,
            cellCenter[1] - dy * axisHalfLen,
            cellCenter[2] - dz * axisHalfLen,
          ]
          const p2: Vec3 = [
            cellCenter[0] + dx * axisHalfLen,
            cellCenter[1] + dy * axisHalfLen,
            cellCenter[2] + dz * axisHalfLen,
          ]
          return (
            <Line
              key={`axis-${i}`}
              points={[p1, p2]}
              color={el.color}
              lineWidth={2}
              opacity={0.85}
              transparent
            />
          )
        }
        if (el.kind === 'plane') {
          // Build a quad in the plane with normal = el.normal.
          const n = new THREE.Vector3(...el.normal)
          // Pick any vector not parallel to n
          const tmp = Math.abs(n.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)
          const u = new THREE.Vector3().crossVectors(n, tmp).normalize().multiplyScalar(cellSize * 0.7)
          const v = new THREE.Vector3().crossVectors(n, u).normalize().multiplyScalar(cellSize * 0.7)
          const c = new THREE.Vector3(...cellCenter)
          const corners: Vec3[] = [
            [c.x + u.x + v.x, c.y + u.y + v.y, c.z + u.z + v.z],
            [c.x + u.x - v.x, c.y + u.y - v.y, c.z + u.z - v.z],
            [c.x - u.x - v.x, c.y - u.y - v.y, c.z - u.z - v.z],
            [c.x - u.x + v.x, c.y - u.y + v.y, c.z - u.z + v.z],
          ]
          // 4 edges as a closed loop
          return (
            <group key={`plane-${i}`}>
              <Line
                points={[corners[0], corners[1], corners[2], corners[3], corners[0]]}
                color={el.color}
                lineWidth={1.5}
                opacity={0.6}
                transparent
              />
              {/* Translucent quad */}
              <mesh>
                <bufferGeometry>
                  <bufferAttribute
                    attach="attributes-position"
                    count={6}
                    array={new Float32Array([
                      ...corners[0], ...corners[1], ...corners[2],
                      ...corners[0], ...corners[2], ...corners[3],
                    ])}
                    itemSize={3}
                  />
                </bufferGeometry>
                <meshBasicMaterial
                  color={el.color}
                  transparent
                  opacity={0.12}
                  side={THREE.DoubleSide}
                  depthWrite={false}
                />
              </mesh>
            </group>
          )
        }
        // Inversion center: a small three-axis cross at the cell center.
        const r = cellSize * 0.08
        const cx = cellCenter
        return (
          <group key={`inv-${i}`}>
            <Line points={[[cx[0] - r, cx[1], cx[2]], [cx[0] + r, cx[1], cx[2]]]} color={el.color} lineWidth={2.5} />
            <Line points={[[cx[0], cx[1] - r, cx[2]], [cx[0], cx[1] + r, cx[2]]]} color={el.color} lineWidth={2.5} />
            <Line points={[[cx[0], cx[1], cx[2] - r], [cx[0], cx[1], cx[2] + r]]} color={el.color} lineWidth={2.5} />
            <mesh position={cx}>
              <sphereGeometry args={[r * 0.35, 12, 12]} />
              <meshBasicMaterial color={el.color} />
            </mesh>
          </group>
        )
      })}
    </group>
  )
}
