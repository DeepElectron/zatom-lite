'use client'

/** Interactive merge preview with step-specific picking planes and boundary warnings. */
import { useEffect, useRef, useCallback, useMemo } from 'react'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { useViewportStore as useCrystalStore } from '../../../orchestration/ViewportContext'
import { getElement } from '../../../lib/crystal/elements'
import { analyzeMergeBoundary } from '../../../lib/crystal/merge-boundary'
import { boundaryModeFor } from '../../../lib/crystal/cell-overflow'
import { calculateVolume } from '../../../lib/crystal/lattice'

const WARN_COLORS = { tooClose: '#FF453A', wrap: '#FF9F0A', extend: '#64D2FF' } as const

const NUDGE_STEP = 0.1
const GRID_DIVISIONS = 4

export function MergePlacementPreview() {
  const mergePlacement = useCrystalStore((s) => s.mergePlacement)
  if (!mergePlacement) return null
  return <PreviewInner />
}

function PreviewInner() {
  const mergePlacement = useCrystalStore((s) => s.mergePlacement)!
  const updatePosition = useCrystalStore((s) => s.updateMergePlacementPosition)
  const setStep = useCrystalStore((s) => s.setMergePlacementStep)
  const confirm = useCrystalStore((s) => s.confirmMergePlacement)
  const cancel = useCrystalStore((s) => s.cancelMergePlacement)
  const { camera } = useThree()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const p = useCrystalStore.getState().mergePlacement
      if (!p) return
      const d = e.shiftKey ? 1 : NUDGE_STEP
      const nudge = (dx: number, dy: number, dz: number) => {
        e.preventDefault()
        updatePosition([p.position[0] + dx, p.position[1] + dy, p.position[2] + dz])
      }
      switch (e.key) {
        case 'Escape':
          e.preventDefault()
          cancel()
          return
        case 'Enter':
          e.preventDefault()
          confirm()
          return
        case 'ArrowLeft':
          if (p.step === 'xy') nudge(-d, 0, 0)
          return
        case 'ArrowRight':
          if (p.step === 'xy') nudge(d, 0, 0)
          return
        case 'ArrowUp':
          p.step === 'xy' ? nudge(0, d, 0) : nudge(0, 0, d)
          return
        case 'ArrowDown':
          p.step === 'xy' ? nudge(0, -d, 0) : nudge(0, 0, -d)
          return
        case 'Tab':
        case 'Backspace':
          if (p.step === 'z') {
            e.preventDefault()
            setStep('xy')
          }
          return
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cancel, confirm, updatePosition, setStep])

  const zPlaneRef = useRef<THREE.Mesh>(null)
  const downPosRef = useRef<{ x: number; y: number } | null>(null)

  const { position, step, atomOffsets } = mergePlacement

  const latticeVectors = useCrystalStore((s) => s.latticeVectors)
  const supercellParams = useCrystalStore((s) => s.supercellParams)
  const periodicDirs = useCrystalStore((s) => s.periodicDirs)
  const periodic = useCrystalStore((s) => s.periodic)
  const atoms = useCrystalStore((s) => s.atoms)
  const cellOverflowMode = useCrystalStore((s) => s.cellOverflowMode)
  const boundaryMode = boundaryModeFor(cellOverflowMode)
  const report = useMemo(() => analyzeMergeBoundary(
    atomOffsets.map(({ offset }) => [
      position[0] + offset[0],
      position[1] + offset[1],
      position[2] + offset[2],
    ] as [number, number, number]),
    latticeVectors,
    supercellParams,
    periodicDirs,
    periodic,
    atoms.map((a) => (a.cartesian ?? a.position) as [number, number, number]),
    boundaryMode,
  ), [atomOffsets, position, latticeVectors, supercellParams, periodicDirs, periodic, atoms, boundaryMode])

  const gridPositions = useMemo(() => {
    if (!periodic || calculateVolume(latticeVectors) < 1e-9) return null
    const ax = latticeVectors.a[0] * supercellParams.nx
    const ay = latticeVectors.a[1] * supercellParams.nx
    const bx = latticeVectors.b[0] * supercellParams.ny
    const by = latticeVectors.b[1] * supercellParams.ny
    const z = position[2]
    const pts: number[] = []
    for (let i = 0; i <= GRID_DIVISIONS; i++) {
      const t = i / GRID_DIVISIONS
      pts.push(t * bx, t * by, z, ax + t * bx, ay + t * by, z)
      pts.push(t * ax, t * ay, z, bx + t * ax, by + t * ay, z)
    }
    return new Float32Array(pts)
  }, [periodic, latticeVectors, supercellParams.nx, supercellParams.ny, position])

  useEffect(() => {
    if (!zPlaneRef.current || step !== 'z') return
    const toCamera = new THREE.Vector3().subVectors(camera.position, new THREE.Vector3(...position))
    toCamera.z = 0
    if (toCamera.lengthSq() < 1e-6) toCamera.set(0, -1, 0)
    toCamera.normalize()
    const angle = Math.atan2(toCamera.y, toCamera.x)
    zPlaneRef.current.rotation.set(Math.PI / 2, 0, angle - Math.PI / 2, 'ZXY')
  })

  const onPointerDown = useCallback((e: ThreeEvent<PointerEvent>) => {
    downPosRef.current = { x: e.nativeEvent.clientX, y: e.nativeEvent.clientY }
  }, [])

  const isClick = (e: ThreeEvent<MouseEvent>) => {
    const down = downPosRef.current
    downPosRef.current = null
    if (!down) return true
    return Math.hypot(e.nativeEvent.clientX - down.x, e.nativeEvent.clientY - down.y) <= 6
  }

  const handleXYMove = useCallback((e: ThreeEvent<PointerEvent>) => {
    if (!e.point) return
    updatePosition([e.point.x, e.point.y, position[2]])
  }, [updatePosition, position])

  const handleXYClick = useCallback((e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    if (!isClick(e)) return
    setStep('z')
  }, [setStep])

  const handleZMove = useCallback((e: ThreeEvent<PointerEvent>) => {
    if (!e.point) return
    updatePosition([position[0], position[1], e.point.z])
  }, [updatePosition, position])

  const handleZClick = useCallback((e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    if (!isClick(e)) return
    confirm()
  }, [confirm])

  return (
    <>
      {atomOffsets.map((a, i) => {
        const el = getElement(a.element)
        const warn = report.tooClose[i]
          ? WARN_COLORS.tooClose
          : report.atomStatus[i] === 'wrap'
            ? WARN_COLORS.wrap
            : report.atomStatus[i] === 'extend'
              ? WARN_COLORS.extend
              : null
        return (
          <mesh key={i} position={report.finalPositions[i]} renderOrder={15}>
            <sphereGeometry args={[el.radius * 0.5, 20, 20]} />
            <meshStandardMaterial
              color={warn ?? el.color}
              emissive={warn ?? '#000000'}
              emissiveIntensity={warn ? 0.45 : 0}
              transparent
              opacity={warn ? 0.75 : 0.55}
              depthWrite={false}
            />
          </mesh>
        )
      })}
      {atomOffsets.map((a, i) => {
        if (report.atomStatus[i] !== 'wrap') return null
        const raw: [number, number, number] = [
          position[0] + a.offset[0],
          position[1] + a.offset[1],
          position[2] + a.offset[2],
        ]
        const final = report.finalPositions[i]
        return (
          <line key={`wrap-guide-${i}`}>
            <bufferGeometry>
              <bufferAttribute
                attach="attributes-position"
                args={[new Float32Array([...raw, ...final]), 3]}
              />
            </bufferGeometry>
            <lineBasicMaterial color={WARN_COLORS.wrap} transparent opacity={0.35} depthTest={false} />
          </line>
        )
      })}
      {/* XY step: show the cell footprint at the active height as a guide. */}
      {step === 'xy' && gridPositions && (
        <lineSegments renderOrder={14}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[gridPositions, 3]} />
          </bufferGeometry>
          <lineBasicMaterial color="#0A84FF" transparent opacity={0.18} depthWrite={false} />
        </lineSegments>
      )}
      <group position={position}>
        {/* Placement marker. */}
        <mesh renderOrder={16}>
          <sphereGeometry args={[0.12, 12, 12]} />
          <meshBasicMaterial color="#0A84FF" transparent opacity={0.9} depthTest={false} />
        </mesh>
        {/* Vertical guide for the Z step. */}
        {step === 'z' && (
          <line>
            <bufferGeometry>
              <bufferAttribute
                attach="attributes-position"
                args={[new Float32Array([0, 0, -50, 0, 0, 50]), 3]}
              />
            </bufferGeometry>
            <lineBasicMaterial color="#0A84FF" transparent opacity={0.5} depthTest={false} />
          </line>
        )}
      </group>

      {/* Horizontal XY picking plane through the current Z position. */}
      {step === 'xy' && (
        <mesh
          position={[0, 0, position[2]]}
          onPointerMove={handleXYMove}
          onPointerDown={onPointerDown}
          onClick={handleXYClick}
          renderOrder={-1}
        >
          <planeGeometry args={[500, 500]} />
          <meshBasicMaterial visible={false} side={THREE.DoubleSide} transparent opacity={0} depthWrite={false} />
        </mesh>
      )}

      {/* Camera-facing vertical picking plane through the placement point. */}
      {step === 'z' && (
        <mesh
          ref={zPlaneRef}
          position={position}
          onPointerMove={handleZMove}
          onPointerDown={onPointerDown}
          onClick={handleZClick}
          renderOrder={-1}
        >
          <planeGeometry args={[500, 500]} />
          <meshBasicMaterial visible={false} side={THREE.DoubleSide} transparent opacity={0} depthWrite={false} />
        </mesh>
      )}
    </>
  )
}
