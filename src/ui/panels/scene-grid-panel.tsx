"use client"

// SceneGrid debug panel — renders exactly what the AI sees through the
// scene_grid tools: same pure pipeline (buildSceneGrid / probeSceneCell),
// same pose source (viewportCaptureRegistry). Human-inspectable, so the
// grid abstraction can be tuned with eyes on it.

import { useEffect, useMemo, useState } from "react"
import { useActiveCrystalStore as useCrystalStore } from "../../orchestration/ViewportContext"
import { getViewportPose } from "../../orchestration/viewportCaptureRegistry"
import { readActiveViewportStructure } from "../../agent/viewer-context"
import {
  buildSceneGrid,
  probeSceneCell,
  SCENE_GRID_VIEWS,
  type SceneGridCell,
  type SceneGridResult,
  type SceneGridView,
  type SceneProbeResult,
} from "../../lib/scene-grid/scene-grid"
import { SCENE_REGIMES, type SceneRegime } from "../../lib/scene-grid/regime"
import { DEFAULT_SCENE_BUDGET } from "../../lib/scene-grid/foveate"
import { ELEMENTS } from "../../lib/crystal/elements"

const FIELD: React.CSSProperties = {
  width: 64,
  padding: '4px 8px',
  borderRadius: 8,
  border: '1px solid var(--panel-border)',
  background: 'var(--panel-bg)',
  color: 'var(--text-primary)',
  fontSize: 12,
  fontVariantNumeric: 'tabular-nums',
}

const LABEL: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--text-secondary)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
}

function elementColor(element: string): string {
  return ELEMENTS[element]?.color ?? '#9E9E9E'
}

/** Nearest bin renders full color; farthest fades toward the panel bg. */
function depthOpacity(depthBin: number, depthBins: number): number {
  if (depthBins <= 1) return 1
  return 1 - 0.72 * (depthBin / (depthBins - 1))
}

export function SceneGridPanelSection() {
  // Reactive triggers: recompute when the structure or selection changes.
  const atomsVersion = useCrystalStore((s) => s.atoms)
  const selectAtoms = useCrystalStore((s) => s.selectAtoms)
  // The live selection is a first-class grid input, not just a viewer highlight:
  // it is the strongest intent signal the agent gets, so the panel must feed it
  // in too or it would stop showing what the LLM actually reads.
  const selectedIds = useCrystalStore((s) => s.selectedAtomIds)

  const [view, setView] = useState<SceneGridView>('current')
  const [resolution, setResolution] = useState(24)
  const [depthBins, setDepthBins] = useState(8)
  const [topK, setTopK] = useState(3)
  // The character ceiling decides what the agent actually receives, so it is a
  // panel knob: a pinned Res can exceed it, and then the two differ.
  const [budget, setBudget] = useState(DEFAULT_SCENE_BUDGET)
  const [depthLo, setDepthLo] = useState(0)
  const [depthHi, setDepthHi] = useState(1)
  const [regimeOverride, setRegimeOverride] = useState<SceneRegime | 'auto'>('auto')
  const [showAscii, setShowAscii] = useState(false)
  const [probe, setProbe] = useState<SceneProbeResult | null>(null)
  // Tick drives 'current'-view recompute while the user orbits the camera.
  const [poseTick, setPoseTick] = useState(0)

  useEffect(() => {
    if (view !== 'current') return
    const timer = window.setInterval(() => setPoseTick((t) => t + 1), 500)
    return () => window.clearInterval(timer)
  }, [view])

  const grid: SceneGridResult | { error: string } = useMemo(() => {
    void atomsVersion
    void poseTick
    const structure = readActiveViewportStructure()
    if (!structure || structure.atoms.length === 0) return { error: 'No atoms in the scene.' }
    const pose = view === 'current' ? getViewportPose() : null
    if (view === 'current' && !pose) return { error: 'No camera pose registered yet — interact with the viewport once.' }
    try {
      return buildSceneGrid(structure, {
        view,
        resolution,
        depthBins,
        topK,
        depthRange: depthLo > 0 || depthHi < 1 ? [depthLo, depthHi] : undefined,
        pose: pose ? { position: pose.position, lookAt: pose.lookAt } : null,
        regime: regimeOverride === 'auto' ? undefined : regimeOverride,
        selectedAtomIds: selectedIds,
        budget,
      })
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  }, [atomsVersion, poseTick, view, resolution, depthBins, topK, depthLo, depthHi, regimeOverride, selectedIds, budget])

  const failed = 'error' in grid

  const cellMap = useMemo(() => {
    const map = new Map<string, SceneGridCell>()
    if ('error' in grid) return map
    for (const cell of grid.cells) map.set(`${cell.xy[0]},${cell.xy[1]}`, cell)
    return map
  }, [grid])

  const handleCellClick = (x: number, y: number) => {
    const structure = readActiveViewportStructure()
    if (!structure || 'error' in grid) return
    const pose = view === 'current' ? getViewportPose() : null
    try {
      const result = probeSceneCell(structure, {
        view,
        resolution,
        depthBins,
        topK,
        depthRange: depthLo > 0 || depthHi < 1 ? [depthLo, depthHi] : undefined,
        pose: pose ? { position: pose.position, lookAt: pose.lookAt } : null,
        regime: regimeOverride === 'auto' ? undefined : regimeOverride,
        selectedAtomIds: selectedIds,
        budget,
      }, x, y)
      setProbe(result)
    } catch {
      setProbe(null)
    }
  }

  const [gw, gh] = failed ? [0, 0] : (grid as SceneGridResult).resolution

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Scene grid (AI view)</div>
      <div style={{ fontSize: 11.5, lineHeight: 1.5, color: 'var(--text-secondary)' }}>
        The exact grid the agent reads through scene_grid — same projection, same depth stacks. Click a cell to probe it.
      </div>

      <label style={LABEL}>
        View
        <select
          value={view}
          onChange={(e) => { setView(e.target.value as SceneGridView); setProbe(null) }}
          style={{ ...FIELD, width: 132 }}
        >
          {SCENE_GRID_VIEWS.map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>
      </label>

      <label style={LABEL}>
        Regime
        <select
          value={regimeOverride}
          onChange={(e) => { setRegimeOverride(e.target.value as SceneRegime | 'auto'); setProbe(null) }}
          style={{ ...FIELD, width: 132 }}
        >
          <option value="auto">auto</option>
          {SCENE_REGIMES.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
      </label>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <label style={LABEL}>
          Res
          <input type="number" min={8} max={64} value={resolution} style={FIELD}
            onChange={(e) => setResolution(Math.max(8, Math.min(64, Number(e.target.value) || 24)))} />
        </label>
        <label style={LABEL}>
          Depth bins
          <input type="number" min={2} max={16} value={depthBins} style={FIELD}
            onChange={(e) => setDepthBins(Math.max(2, Math.min(16, Number(e.target.value) || 8)))} />
        </label>
        <label style={LABEL}>
          Top K
          <input type="number" min={1} max={6} value={topK} style={FIELD}
            onChange={(e) => setTopK(Math.max(1, Math.min(6, Number(e.target.value) || 3)))} />
        </label>
        <label style={LABEL}>
          Depth
          <span style={{ display: 'flex', gap: 4 }}>
            <input type="number" min={0} max={1} step={0.05} value={depthLo} style={{ ...FIELD, width: 52 }}
              onChange={(e) => setDepthLo(Math.max(0, Math.min(1, Number(e.target.value) || 0)))} />
            <input type="number" min={0} max={1} step={0.05} value={depthHi} style={{ ...FIELD, width: 52 }}
              onChange={(e) => setDepthHi(Math.max(0, Math.min(1, Number(e.target.value) || 1)))} />
          </span>
        </label>
        <label style={LABEL}>
          Budget
          <input type="number" min={500} max={20000} step={100} value={budget} style={FIELD}
            onChange={(e) => setBudget(Math.max(500, Math.min(20000, Number(e.target.value) || DEFAULT_SCENE_BUDGET)))} />
        </label>
      </div>

      {failed ? (
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', padding: '12px 0' }}>
          {(grid as { error: string }).error}
        </div>
      ) : (
        <>
          <div
            role="grid"
            aria-label="Scene grid cells"
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${gw}, 1fr)`,
              gap: 1,
              aspectRatio: `${gw} / ${gh}`,
              background: 'var(--panel-border)',
              border: '1px solid var(--panel-border)',
              borderRadius: 8,
              overflow: 'hidden',
            }}
          >
            {Array.from({ length: gh }, (_, y) =>
              Array.from({ length: gw }, (_, x) => {
                const cell = cellMap.get(`${x},${y}`)
                const top = cell?.stack[0]
                const isProbed = probe && !('error' in probe) && probe.xy[0] === x && probe.xy[1] === y
                return (
                  <button
                    key={`${x},${y}`}
                    type="button"
                    onClick={() => handleCellClick(x, y)}
                    aria-label={top ? `Cell ${x},${y}: ${cell?.code ?? top[1]}` : `Cell ${x},${y}: empty`}
                    title={
                      cell
                        ? `${cell.code}  ·  ${cell.label}  ·  ${cell.atomCount} atom${cell.atomCount === 1 ? '' : 's'}\n${cell.stack.map(([, el, d]) => `${el} (bin ${d})`).join(' / ')}`
                        : undefined
                    }
                    style={{
                      border: 'none',
                      padding: 0,
                      cursor: 'pointer',
                      background: top ? elementColor(top[1]) : 'var(--panel-bg)',
                      opacity: top ? depthOpacity(top[2], (grid as SceneGridResult).depthBins) : 1,
                      outline: isProbed ? '2px solid var(--text-primary)' : 'none',
                      outlineOffset: -2,
                      minHeight: 6,
                    }}
                  />
                )
              }),
            )}
          </div>

          <div style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between' }}>
            <span>{(grid as SceneGridResult).atomsProjected}/{(grid as SceneGridResult).atomsTotal} atoms</span>
            <span>{(grid as SceneGridResult).cells.length} cells · {(grid as SceneGridResult).truncatedCells} truncated</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <span>
              regime <strong style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{(grid as SceneGridResult).regime.regime}</strong>
              {' · '}unit {(grid as SceneGridResult).regime.unit}
              {(grid as SceneGridResult).regime.overridden ? ' (forced)' : ' (auto)'}
            </span>
            {(grid as SceneGridResult).focus && (
              <span>
                focus {(grid as SceneGridResult).focus!.atomCount} atoms · {(grid as SceneGridResult).focus!.cells.length} cells
              </span>
            )}
          </div>
          {/* A pinned Res can cost more than the ceiling, and then the agent
              receives a different grid than this canvas shows. Say so. */}
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <span>
              budget{' '}
              <strong
                style={{
                  color: (grid as SceneGridResult).budget.used > (grid as SceneGridResult).budget.requested
                    ? 'var(--accent-warning, #b45309)'
                    : 'var(--text-primary)',
                  fontWeight: 600,
                }}
              >
                {(grid as SceneGridResult).budget.used}/{(grid as SceneGridResult).budget.requested}
              </strong>
              {(grid as SceneGridResult).budget.used > (grid as SceneGridResult).budget.requested && ' over'}
              {(grid as SceneGridResult).budget.degraded > 0 && ` · degraded ${(grid as SceneGridResult).budget.degraded}`}
            </span>
            <span>
              {(grid as SceneGridResult).budget.insetResolution > 0
                ? `inset ${(grid as SceneGridResult).budget.insetResolution}²`
                : 'no inset'}
              {' · outline '}{(grid as SceneGridResult).budget.outlineDetail}
            </span>
          </div>
        </>
      )}

      {probe && (
        <div style={{
          border: '1px solid var(--panel-border)',
          borderRadius: 8,
          padding: 10,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
            Cell [{probe.xy[0]}, {probe.xy[1]}] — {probe.stack.length} atom{probe.stack.length === 1 ? '' : 's'}
          </div>
          {probe.stack.length === 0 ? (
            <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>Empty cell.</div>
          ) : (
            <>
              {probe.stack.map((a) => (
                <div key={a.atomId} style={{ fontSize: 11.5, color: 'var(--text-secondary)', display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span aria-hidden style={{ width: 10, height: 10, borderRadius: 3, background: elementColor(a.element), display: 'inline-block' }} />
                  <span style={{ color: 'var(--text-primary)' }}>{a.element}</span>
                  <span>bin {a.depthBin}</span>
                  <span>depth {a.depth.toFixed(2)}</span>
                  <span style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 10.5 }}>{a.atomId.slice(0, 12)}</span>
                </div>
              ))}
              <button
                type="button"
                onClick={() => { selectAtoms(probe.stack.map((a) => a.atomId));  }}
                style={{
                  marginTop: 4,
                  padding: '6px 10px',
                  borderRadius: 8,
                  border: '1px solid var(--panel-border)',
                  background: 'var(--panel-bg)',
                  color: 'var(--text-primary)',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                Select these atoms in viewport
              </button>
            </>
          )}
        </div>
      )}

      <label style={{ ...LABEL, justifyContent: 'flex-start' }}>
        <input type="checkbox" checked={showAscii} onChange={(e) => setShowAscii(e.target.checked)} />
        Show ASCII (what the LLM reads)
      </label>
      {showAscii && !failed && (
        <pre style={{
          margin: 0,
          padding: 10,
          borderRadius: 8,
          border: '1px solid var(--panel-border)',
          background: 'var(--panel-bg)',
          color: 'var(--text-secondary)',
          fontSize: 9.5,
          lineHeight: 1.35,
          overflowX: 'auto',
          maxHeight: 260,
          overflowY: 'auto',
        }}>{(grid as SceneGridResult).ascii}</pre>
      )}
    </div>
  )
}
