'use client'

/** Drag lattice-axis handles without confusing a click that opens the axis menu. */
import { useRef, useMemo, useEffect, useState } from 'react'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { useViewportStore as useCrystalStore } from '../../../orchestration/ViewportContext'
import { AxisQuickMenu } from './axis-quick-menu'

const AXIS_COLOR: Record<'a' | 'b' | 'c', string> = { a: '#FF453A', b: '#30D158', c: '#0A84FF' }

const CLICK_THRESHOLD_PX = 4

type DragState = {
  axis: 'a' | 'b' | 'c'
  base: THREE.Vector3
  unit: THREE.Vector3
  n: number
  planePoint: THREE.Vector3
  historyRecorded: boolean
  startX: number
  startY: number
  moved: boolean
}

export function CellResizeGizmo() {
  const { camera, gl } = useThree()
  const cellResizeMode = useCrystalStore((s) => s.cellResizeMode)
  const periodic = useCrystalStore((s) => s.periodic)
  const latticeVectors = useCrystalStore((s) => s.latticeVectors)
  const supercellParams = useCrystalStore((s) => s.supercellParams)

  const drag = useRef<DragState | null>(null)
  const [menuAxis, setMenuAxis] = useState<'a' | 'b' | 'c' | null>(null)

  const geom = useMemo(() => {
    if (!latticeVectors) return null
    const { a, b, c } = latticeVectors
    const nx = Math.max(1, supercellParams?.nx ?? 1)
    const ny = Math.max(1, supercellParams?.ny ?? 1)
    const nz = Math.max(1, supercellParams?.nz ?? 1)
    const A = new THREE.Vector3(a[0] * nx, a[1] * nx, a[2] * nx)
    const B = new THREE.Vector3(b[0] * ny, b[1] * ny, b[2] * ny)
    const C = new THREE.Vector3(c[0] * nz, c[1] * nz, c[2] * nz)
    const half = (u: THREE.Vector3, v: THREE.Vector3) => u.clone().add(v).multiplyScalar(0.5)
    if (A.length() < 1e-6 || B.length() < 1e-6 || C.length() < 1e-6) return null
    const handleRadius = Math.max(0.3, Math.min(A.length(), B.length(), C.length()) * 0.06)
    return {
      handleRadius,
      handles: [
        { axis: 'a' as const, pos: A.clone().add(half(B, C)), base: half(B, C), unit: A.clone().normalize(), n: nx },
        { axis: 'b' as const, pos: B.clone().add(half(A, C)), base: half(A, C), unit: B.clone().normalize(), n: ny },
        { axis: 'c' as const, pos: C.clone().add(half(A, B)), base: half(A, B), unit: C.clone().normalize(), n: nz },
      ],
    }
  }, [latticeVectors, supercellParams])

  useEffect(() => {
    const dom = gl.domElement
    const onMove = (e: PointerEvent) => {
      const d = drag.current
      if (!d) return
      e.preventDefault()
      e.stopPropagation()
      if (!d.moved) {
        const dx = e.clientX - d.startX
        const dy = e.clientY - d.startY
        if (dx * dx + dy * dy < CLICK_THRESHOLD_PX * CLICK_THRESHOLD_PX) return
        d.moved = true
      }
      const rect = dom.getBoundingClientRect()
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      )
      const camDir = new THREE.Vector3()
      camera.getWorldDirection(camDir)
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(camDir.clone().negate(), d.planePoint)
      const ray = new THREE.Raycaster()
      ray.setFromCamera(ndc, camera)
      const pt = new THREE.Vector3()
      if (!ray.ray.intersectPlane(plane, pt)) return
      const superLen = pt.clone().sub(d.base).dot(d.unit)
      const s = useCrystalStore.getState()
      const nextLength = Math.max(0.5, superLen / d.n)
      if (Math.abs(nextLength - s.latticeParams[d.axis]) < 1e-6) return
      if (!d.historyRecorded) {
        s.pushHistory()
        d.historyRecorded = true
      }
      const scaleContents = s.periodicDirs[d.axis] ? s.cellResizeScaleContents : false
      s.resizeLatticeAxis(d.axis, nextLength, scaleContents)
    }
    const onUp = (e: PointerEvent) => {
      const d = drag.current
      if (!d) return
      drag.current = null
      useCrystalStore.getState().setCellResizeDragging(false)
      try { dom.releasePointerCapture(e.pointerId) } catch { /* noop */ }
      dom.style.cursor = 'auto'
      if (!d.moved) {
        setMenuAxis(d.axis)
      }
    }
    dom.addEventListener('pointermove', onMove, true)
    dom.addEventListener('pointerup', onUp, true)
    dom.addEventListener('pointercancel', onUp, true)
    return () => {
      dom.removeEventListener('pointermove', onMove, true)
      dom.removeEventListener('pointerup', onUp, true)
      dom.removeEventListener('pointercancel', onUp, true)
    }
  }, [gl, camera])

  if (!cellResizeMode || !periodic || !geom) return null

  const onHandleDown = (h: NonNullable<typeof geom>['handles'][number]) => (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    setMenuAxis(null)
    drag.current = {
      axis: h.axis,
      base: h.base.clone(),
      unit: h.unit.clone(),
      n: h.n,
      planePoint: h.pos.clone(),
      historyRecorded: false,
      startX: e.nativeEvent.clientX,
      startY: e.nativeEvent.clientY,
      moved: false,
    }
    useCrystalStore.getState().setCellResizeDragging(true)
    try { gl.domElement.setPointerCapture(e.nativeEvent.pointerId) } catch { /* noop */ }
    gl.domElement.style.cursor = 'grabbing'
  }

  const menuHandle = menuAxis ? geom.handles.find((h) => h.axis === menuAxis) : null

  return (
    <group>
      {geom.handles.map((h) => (
        <mesh key={h.axis} position={h.pos} onPointerDown={onHandleDown(h)} renderOrder={20}>
          <sphereGeometry args={[geom.handleRadius, 20, 20]} />
          <meshBasicMaterial color={AXIS_COLOR[h.axis]} transparent opacity={0.92} depthTest={false} />
        </mesh>
      ))}
      {menuHandle && (
        <AxisQuickMenu
          axis={menuHandle.axis}
          position={menuHandle.pos}
          onClose={() => setMenuAxis(null)}
        />
      )}
    </group>
  )
}
