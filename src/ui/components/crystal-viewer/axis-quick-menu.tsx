'use client'

/**
 * Contextual lattice-axis controls. The menu probes unobscured placement after
 * Drei positions its HTML, locks orbit input while open, and previews absolute
 * vacuum changes with a pulsing target cell before applying them.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Html, Line } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { Line2 } from 'three-stdlib'
import { useViewportStore as useCrystalStore } from '../../../orchestration/ViewportContext'

const AXIS_COLOR: Record<'a' | 'b' | 'c', string> = { a: '#FF453A', b: '#30D158', c: '#0A84FF' }
const AXIS_MILLER: Record<'a' | 'b' | 'c', { h: number; k: number; l: number }> = {
  a: { h: 1, k: 0, l: 0 },
  b: { h: 0, k: 1, l: 0 },
  c: { h: 0, k: 0, l: 1 },
}
const AXIS_TO_SUPER: Record<'a' | 'b' | 'c', 'nx' | 'ny' | 'nz'> = { a: 'nx', b: 'ny', c: 'nz' }

const DEFAULT_VACUUM = 10

const ROW = 'flex h-8 w-full items-center justify-between gap-3 rounded-[7px] px-2 text-[11.5px] whitespace-nowrap'
const ROW_BTN = `${ROW} zatom-pressable text-left hover:bg-[var(--panel-hover)] disabled:opacity-45 disabled:hover:bg-transparent`

function GhostTargetBox({ corners, color }: { corners: [number, number, number][]; color: string }) {
  const lineRefs = useRef<(Line2 | null)[]>([])
  useFrame(({ clock }) => {
    const pulse = 0.5 + 0.25 * Math.sin(clock.elapsedTime * 2.4)
    for (const l of lineRefs.current) {
      if (l?.material) (l.material as THREE.Material & { opacity: number }).opacity = pulse
    }
  })
  const EDGES: readonly [number, number][] = [
    [0, 1], [0, 2], [1, 3], [2, 3],
    [4, 5], [4, 6], [5, 7], [6, 7],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ]
  return (
    <group>
      {EDGES.map(([s, e], i) => (
        <Line
          key={i}
          ref={(el: Line2 | null) => { lineRefs.current[i] = el }}
          points={[corners[s], corners[e]]}
          color={color}
          lineWidth={1.5}
          dashed
          dashSize={0.45}
          gapSize={0.3}
          transparent
          opacity={0.5}
          depthTest={false}
        />
      ))}
    </group>
  )
}

export function AxisQuickMenu({
  axis,
  position,
  onClose,
}: {
  axis: 'a' | 'b' | 'c'
  position: THREE.Vector3
  onClose: () => void
}) {
  const latticeParams = useCrystalStore((s) => s.latticeParams)
  const supercellParams = useCrystalStore((s) => s.supercellParams)
  const periodicDirs = useCrystalStore((s) => s.periodicDirs)
  const rootRef = useRef<HTMLDivElement>(null)
  const [placement, setPlacement] = useState<'right' | 'left' | 'below'>('right')
  useLayoutEffect(() => {
    let raf2 = 0
    const raf = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
      const el = rootRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      if (rect.width === 0) return
      const anchorX = rect.left - 14
      const midY = rect.top + rect.height / 2
      const prevPE = el.style.pointerEvents
      el.style.pointerEvents = 'none'
      const clearAt = (x: number) => {
        if (x < 8 || x > window.innerWidth - 8) return false
        const probe = document.elementFromPoint(x, midY)
        return probe instanceof HTMLCanvasElement
      }
      const rightOk = clearAt(anchorX + 14 + rect.width - 4)
      const leftOk = clearAt(anchorX - 14 - rect.width + 4)
      el.style.pointerEvents = prevPE
      setPlacement(rightOk ? 'right' : leftOk ? 'left' : 'below')
      })
    })
    return () => {
      cancelAnimationFrame(raf)
      cancelAnimationFrame(raf2)
    }
  }, [])

  const placementTransform =
    placement === 'left'
      ? 'translate(calc(-100% - 14px), -50%)'
      : placement === 'below'
        ? 'translate(-50%, 18px)'
        : 'translate(14px, -50%)'

  const superKey = AXIS_TO_SUPER[axis]
  const repeats = Math.max(1, supercellParams?.[superKey] ?? 1)
  const length = latticeParams[axis]
  const isPeriodic = periodicDirs[axis]

  useEffect(() => {
    useCrystalStore.getState().setCellResizeDragging(true)
    return () => useCrystalStore.getState().setCellResizeDragging(false)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && e.target instanceof Node && rootRef.current.contains(e.target)) return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [onClose])

  const stepSupercell = (delta: number) => {
    const next = repeats + delta
    if (next < 1 || next > 20) return
    useCrystalStore.getState().setSupercellParams({ [superKey]: next })
  }

  const togglePeriodic = () => {
    const s = useCrystalStore.getState()
    s.setPeriodicDirs({ ...s.periodicDirs, [axis]: !isPeriodic })
  }

  const atoms = useCrystalStore((s) => s.atoms)
  const latticeVectors = useCrystalStore((s) => s.latticeVectors)
  const { currentVacuum, contentTop, axisUnit } = useMemo(() => {
    const vec = latticeVectors[axis]
    const unitLen = Math.sqrt(vec[0] ** 2 + vec[1] ** 2 + vec[2] ** 2) || 1
    const unit: [number, number, number] = [vec[0] / unitLen, vec[1] / unitLen, vec[2] / unitLen]
    const total = length * repeats
    let top = 0
    for (const a of atoms) {
      const p = a.cartesian ?? a.position
      if (!p) continue
      const proj = p[0] * unit[0] + p[1] * unit[1] + p[2] * unit[2]
      if (proj > top) top = proj
    }
    return { currentVacuum: Math.max(0, total - top), contentTop: top, axisUnit: unit }
  }, [latticeVectors, axis, atoms, length, repeats])

  const [vacuumInput, setVacuumInput] = useState(() =>
    currentVacuum > 0.05 ? currentVacuum.toFixed(1) : String(DEFAULT_VACUUM),
  )
  const vacuumValue = Number.parseFloat(vacuumInput)
  const vacuumValid = Number.isFinite(vacuumValue) && vacuumValue >= 0 && vacuumValue <= 200
  const vacuumDiffers = vacuumValid && Math.abs(vacuumValue - currentVacuum) > 0.05

  const applyVacuumTarget = () => {
    const s = useCrystalStore.getState()
    const newUnitLen = Math.max(0.5, (contentTop + vacuumValue) / repeats)
    s.pushHistory()
    s.resizeLatticeAxis(axis, newUnitLen, false)
    s.triggerCameraAutoReset()
  }

  const setVacuum = () => {
    if (isPeriodic || !vacuumDiffers) return
    applyVacuumTarget()
  }

  const openSurface = () => {
    if (!vacuumValid) return
    const s = useCrystalStore.getState()
    s.pushHistory()
    if (s.periodicDirs[axis]) {
      s.setPeriodicDirs({ ...s.periodicDirs, [axis]: false })
    }
    const newUnitLen = Math.max(0.5, (contentTop + vacuumValue) / repeats)
    s.resizeLatticeAxis(axis, newUnitLen, false)
    s.triggerCameraAutoReset()
  }

  const ghostCorners = useMemo<[number, number, number][] | null>(() => {
    if (!vacuumDiffers) return null
    const { a: va, b: vb, c: vc } = latticeVectors
    const n = { a: supercellParams?.nx ?? 1, b: supercellParams?.ny ?? 1, c: supercellParams?.nz ?? 1 }
    const targetTotal = contentTop + vacuumValue
    const totals: Record<'a' | 'b' | 'c', [number, number, number]> = {
      a: [va[0] * n.a, va[1] * n.a, va[2] * n.a],
      b: [vb[0] * n.b, vb[1] * n.b, vb[2] * n.b],
      c: [vc[0] * n.c, vc[1] * n.c, vc[2] * n.c],
    }
    totals[axis] = [axisUnit[0] * targetTotal, axisUnit[1] * targetTotal, axisUnit[2] * targetTotal]
    const corners: [number, number, number][] = []
    for (const di of [0, 1]) for (const dj of [0, 1]) for (const dk of [0, 1]) {
      corners.push([
        di * totals.a[0] + dj * totals.b[0] + dk * totals.c[0],
        di * totals.a[1] + dj * totals.b[1] + dk * totals.c[1],
        di * totals.a[2] + dj * totals.b[2] + dk * totals.c[2],
      ])
    }
    return corners
  }, [vacuumDiffers, latticeVectors, supercellParams, axis, axisUnit, contentTop, vacuumValue])

  const cleave = () => {
    useCrystalStore.getState().requestAxisCleave(AXIS_MILLER[axis])
    onClose()
  }

  const miller = AXIS_MILLER[axis]

  return (
    <>
    {/* Preview the target cell whenever the requested vacuum differs from the current value. */}
    {ghostCorners && <GhostTargetBox corners={ghostCorners} color={AXIS_COLOR[axis]} />}
    <Html position={position} zIndexRange={[10000, 9990]} style={{ pointerEvents: 'none' }}>
      <div
        ref={rootRef}
        className="w-[236px] select-none overflow-hidden rounded-[12px] border border-[var(--glass-border)] bg-[var(--glass-bg)] text-[var(--panel-text)] shadow-[0_10px_32px_rgba(0,0,0,0.22)] backdrop-blur-xl"
        style={{ pointerEvents: 'auto', transform: placementTransform }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {/* Axis identity and current repeated length. */}
        <div className="flex items-baseline justify-between gap-3 px-3 pt-2.5 pb-1.5">
          <span className="inline-flex items-baseline gap-1.5 text-[12px] font-semibold">
            <span
              className="inline-block h-2 w-2 self-center rounded-full"
              style={{ background: AXIS_COLOR[axis], boxShadow: `0 0 6px ${AXIS_COLOR[axis]}59` }}
            />
            {axis}
            <span className="font-medium text-[var(--panel-text-tertiary)]">axis</span>
          </span>
          <span className="text-[11px] tabular-nums text-[var(--panel-text-secondary)]">
            {length.toFixed(3)} Å
            <span className="text-[var(--panel-text-tertiary)]">{` × ${repeats}`}</span>
          </span>
        </div>

        <div className="flex flex-col gap-px px-1.5 pb-1.5">
          {/* Cell expansion stepper. */}
          <div className={ROW}>
            <span>Supercell</span>
            <span className="inline-flex h-6 items-center overflow-hidden rounded-[6px] border border-[var(--panel-border)] bg-[var(--panel-elevated)]">
              <button
                type="button"
                className="zatom-pressable inline-flex h-full w-6 items-center justify-center text-[13px] leading-none hover:bg-[var(--panel-hover)] disabled:opacity-35 disabled:hover:bg-transparent"
                onClick={() => stepSupercell(-1)}
                disabled={repeats <= 1}
                aria-label={`Decrease ${axis} axis repeats`}
              >
                −
              </button>
              <span className="inline-block min-w-6 border-x border-[var(--panel-border)] px-1 text-center text-[11.5px] leading-6 tabular-nums">
                {repeats}
              </span>
              <button
                type="button"
                className="zatom-pressable inline-flex h-full w-6 items-center justify-center text-[13px] leading-none hover:bg-[var(--panel-hover)]"
                onClick={() => stepSupercell(1)}
                aria-label={`Increase ${axis} axis repeats`}
              >
                +
              </button>
            </span>
          </div>

          {/* Periodicity toggle. */}
          <button type="button" className={ROW_BTN} onClick={togglePeriodic} role="switch" aria-checked={isPeriodic}>
            <span>Periodic</span>
            <span
              className="relative inline-block h-4 w-7 rounded-full transition-colors duration-150"
              style={{ background: isPeriodic ? '#30D158' : 'var(--panel-hover)' }}
            >
              <span
                className="absolute top-0.5 left-0.5 h-3 w-3 rounded-full bg-white shadow-sm transition-transform duration-150"
                style={{ transform: isPeriodic ? 'translateX(12px)' : 'translateX(0)' }}
              />
            </span>
          </button>

          {/* Perpendicular slice. */}
          <button type="button" className={ROW_BTN} onClick={cleave}>
            <span>Cleave plane</span>
            <span className="text-[10.5px] tabular-nums text-[var(--panel-text-tertiary)]">
              {`⊥ ${axis} · (${miller.h}${miller.k}${miller.l})`}
            </span>
          </button>
        </div>

        <div className="mx-3 h-px bg-[var(--panel-border)]" />

        <div className="flex flex-col gap-px px-1.5 py-1.5">
          {/* Vacuum is an absolute target; differences are previewed below and in 3D. */}
          <div className={ROW}>
            <span className={isPeriodic ? 'opacity-50' : undefined}>Vacuum</span>
            <span className="inline-flex items-center gap-1.5">
              <input
                type="number"
                min={0}
                max={200}
                step={1}
                value={vacuumInput}
                onChange={(e) => setVacuumInput(e.target.value)}
                aria-label="Target vacuum thickness in angstroms"
                className="zatom-field h-6 w-[52px] rounded-[6px] px-1.5 text-right text-[11.5px] tabular-nums"
                style={vacuumValid ? undefined : { borderColor: 'var(--status-red)' }}
              />
              <span className="text-[11px] text-[var(--panel-text-tertiary)]">Å</span>
              <button
                type="button"
                className="zatom-pressable panel-btn-accent h-6 rounded-[6px] px-2 text-[11px] font-medium"
                onClick={setVacuum}
                disabled={isPeriodic || !vacuumDiffers}
                title={
                  isPeriodic
                    ? 'Turn off periodicity on this axis first'
                    : !vacuumDiffers
                      ? 'Already at this vacuum'
                      : `Set vacuum to ${vacuumValue} Å (box ${vacuumValue > currentVacuum ? 'grows' : 'shrinks'})`
                }
              >
                Set
              </button>
            </span>
          </div>

          {/* Show current and target values only while a change is pending. */}
          {vacuumDiffers && (
            <div className="px-2 pb-0.5 text-[10.5px] tabular-nums text-[var(--panel-text-secondary)]">
              {`now ${currentVacuum.toFixed(1)} Å → ${vacuumValue.toFixed(1)} Å · dashed box = preview`}
            </div>
          )}

          {/* Open the surface by disabling periodicity and applying the target vacuum. */}
          <button
            type="button"
            className={`${ROW_BTN} font-medium text-[var(--panel-accent)] hover:bg-[var(--panel-accent-bg)]`}
            onClick={openSurface}
            disabled={!vacuumValid}
            title="Turn off periodicity on this axis and set vacuum in one step"
          >
            <span>Open surface</span>
            <span className="text-[10.5px] font-normal tabular-nums text-[var(--panel-text-tertiary)]">
              {`⊥ ${axis} · ${vacuumValid ? vacuumValue : '—'} Å`}
            </span>
          </button>
        </div>
      </div>
    </Html>
    </>
  )
}
