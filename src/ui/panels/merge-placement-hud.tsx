'use client'
/** Viewport HUD for merge-placement steps, boundary effects, and keyboard actions. */

import { useMemo } from 'react'
import { useActiveCrystalStore } from '../../orchestration/ViewportContext'
import { analyzeMergeBoundary } from '../../lib/crystal/merge-boundary'
import { boundaryModeFor } from '../../lib/crystal/cell-overflow'

export function MergePlacementHUD() {
  const mergePlacement = useActiveCrystalStore((s) => s.mergePlacement)
  const confirm = useActiveCrystalStore((s) => s.confirmMergePlacement)
  const cancel = useActiveCrystalStore((s) => s.cancelMergePlacement)
  const latticeVectors = useActiveCrystalStore((s) => s.latticeVectors)
  const supercellParams = useActiveCrystalStore((s) => s.supercellParams)
  const periodicDirs = useActiveCrystalStore((s) => s.periodicDirs)
  const periodic = useActiveCrystalStore((s) => s.periodic)
  const atoms = useActiveCrystalStore((s) => s.atoms)
  const cellOverflowMode = useActiveCrystalStore((s) => s.cellOverflowMode)
  const boundaryMode = boundaryModeFor(cellOverflowMode)

  // Use the preview analysis to disclose boundary handling before confirmation.
  const report = useMemo(() => {
    if (!mergePlacement) return null
    const { position, atomOffsets } = mergePlacement
    return analyzeMergeBoundary(
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
    )
  }, [mergePlacement, latticeVectors, supercellParams, periodicDirs, periodic, atoms, boundaryMode])

  if (!mergePlacement || !report) return null

  const stepLabel = mergePlacement.step === 'xy'
    ? 'Click to set X·Y position'
    : 'Click to set height (Z)'

  const wrapCount = report.atomStatus.filter((s) => s === 'wrap').length
  const notices: { text: string; color: string }[] = []
  if (report.tooCloseCount > 0) {
    notices.push({ text: `${report.tooCloseCount} atoms overlap`, color: '#FF453A' })
  }
  if (wrapCount > 0) {
    // Both modes fold data into the cell but present different visual movement.
    // tile-images preserves the placed image while fold-in visibly crosses the boundary.
    // Describe the modes separately so image tiling is not mistaken for a jump.
    notices.push(
      cellOverflowMode === 'tile-images'
        ? { text: `${wrapCount} atoms shown in a periodic image`, color: '#64D2FF' }
        : { text: `${wrapCount} atoms fold into the cell`, color: '#FF9F0A' },
    )
  }
  if (report.extendAxes.length > 0) {
    notices.push({
      text: `box extends ${report.extendAxes.map((e) => e.axis).join('·')}`,
      color: '#64D2FF',
    })
  }

  return (
    <div
      className="flex items-center gap-3 rounded-full px-4 py-2 text-xs font-medium shadow-xl pointer-events-auto"
      style={{
        background: 'var(--panel-bg)',
        border: '1px solid var(--panel-border)',
        color: 'var(--panel-text)',
      }}
      role="status"
    >
      <span
        className="inline-block h-2 w-2 rounded-full"
        style={{ background: '#0A84FF' }}
        aria-hidden
      />
      <span className="font-semibold">{`Placing "${mergePlacement.name}"`}</span>
      <span style={{ opacity: 0.75 }}>{stepLabel}</span>
      {/* The folded anchor position is the final placement coordinate in Å. */}
      <span
        className="rounded px-2 py-0.5 font-mono tabular-nums"
        style={{ background: 'var(--panel-elevated)', fontSize: 11 }}
      >
        {mergePlacement.position.map((v) => v.toFixed(2)).join('  ')}
      </span>
      {notices.map((n) => (
        <span
          key={n.text}
          className="rounded-full px-2 py-0.5"
          style={{ background: `${n.color}22`, color: n.color, fontSize: 11 }}
        >
          {n.text}
        </span>
      ))}
      <span style={{ opacity: 0.5 }}>·</span>
      {/* Expose refinement and fallback keyboard controls explicitly. */}
      <span style={{ opacity: 0.55, fontSize: 11 }}>
        {mergePlacement.step === 'xy' ? 'Arrows nudge 0.1Å (Shift 1Å)' : 'Arrows ↕ nudge · Tab back'}
      </span>
      <button
        type="button"
        className="rounded-full px-2.5 py-1 transition-colors"
        style={{ background: '#0A84FF', color: '#fff' }}
        onClick={confirm}
      >
        Confirm (Enter)
      </button>
      <button
        type="button"
        className="rounded-full px-2.5 py-1 transition-colors"
        style={{ background: 'var(--panel-elevated)', color: 'var(--panel-text)' }}
        onClick={cancel}
      >
        Cancel (Esc)
      </button>
    </div>
  )
}
