/**
 * ChartViewport — live result viewport inside the viewport-grid.
 *
 * Renders RDF g(r) or XRD pattern derived from a *source* crystal viewport.
 * Doesn't own a crystalStore — reads the source slot's store directly via
 * zustand's `useStore`, so it stays reactive to structure edits in the
 * neighbouring 3D viewport.
 */

import { useEffect, useMemo, type ReactNode } from "react"
import { useStore } from "zustand"
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts"
import { selectionNeighborShells } from "../../../lib/analysis/rdf/calc-rdf"
import { X, RefreshCw, Layers, Play } from "lucide-react"
import {
  useViewportManager,
  type ChartKind,
  type ChartSlot,
} from "../../../orchestration/viewportManager"
import type { createCrystalStore } from "../../../orchestration/crystalStore"
import { LadderViewport } from "./LadderViewport"

type CrystalStoreHook = ReturnType<typeof createCrystalStore>

const CHART_TITLES: Record<ChartKind, string> = {
  rdf: 'Radial distribution g(r)',
  xrd: 'Powder XRD pattern',
  ediff: 'Electron diffraction radial profile',
  convergence: 'Relaxation convergence',
  ladder: 'Structure ladder',
}

const CHART_LABELS: Record<ChartKind, string> = {
  rdf: 'g(r)',
  xrd: 'XRD',
  ediff: 'eDiff',
  convergence: 'E/F',
  ladder: 'Ladder',
}

interface ChartHeaderProps {
  label: string
  title: string
  sourceLabel: string | null
  controls?: ReactNode
  onClose: () => void
  onRecompute: () => void
  computing: boolean
}

function ChartHeader({ label, title, sourceLabel, controls, onClose, onRecompute, computing }: ChartHeaderProps) {
  return (
    <div
      className="shrink-0"
      style={{ borderBottom: '1px solid var(--panel-border)', backgroundColor: 'var(--panel-bg)' }}
    >
      <div className="flex min-h-[38px] items-center gap-2 px-2 py-1.5">
        <span className="shrink-0 rounded-md bg-emerald-500/80 px-2 py-1 text-[10px] font-medium text-white">
          {label}
        </span>
        <div className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate text-[11px] font-medium" style={{ color: 'var(--panel-text)' }} title={title}>
            {title}
          </span>
          {sourceLabel && (
            <span className="truncate text-[9px] opacity-60" style={{ color: 'var(--panel-text-tertiary)' }}>
              {sourceLabel}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={onRecompute}
            disabled={computing}
            className="zatom-choice zatom-pressable flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px]"
            title="Recompute with current structure"
          >
            <RefreshCw className={`w-3 h-3 ${computing ? 'animate-spin' : ''}`} />
            Update
          </button>
          <button
            onClick={onClose}
            className="w-6 h-6 rounded flex items-center justify-center transition-colors"
            style={{ color: 'var(--panel-text-tertiary)' }}
            title="Close chart"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      {controls && (
        <div className="flex min-w-0 flex-wrap items-center justify-center gap-x-3 gap-y-1 px-3 pb-2 text-[10px]" style={{ color: 'var(--panel-text-secondary)' }}>
          {controls}
        </div>
      )}
    </div>
  )
}

type ChartRow = { x: number } & Record<string, number | null>

// ────────────────────────── RDF inner ──────────────────────────

function RdfInner({ slot, sourceStore }: { slot: ChartSlot; sourceStore: CrystalStoreHook }) {
  const closeChartSlot = useViewportManager((s) => s.closeChartSlot)

  const atoms = useStore(sourceStore, (s) => s.atoms)
  const periodic = useStore(sourceStore, (s) => s.periodic)
  const entries = useStore(sourceStore, (s) => s.rdfEntries)
  const status = useStore(sourceStore, (s) => s.rdfStatus)
  const error = useStore(sourceStore, (s) => s.rdfError)
  const cutoff = useStore(sourceStore, (s) => s.rdfCutoff)
  const nBins = useStore(sourceStore, (s) => s.rdfNBins)
  const usePbc = useStore(sourceStore, (s) => s.rdfUsePbc)
  const computeRdf = useStore(sourceStore, (s) => s.computeRdf)
  const computeAllPairs = useStore(sourceStore, (s) => s.computeAllPairs)
  const clearRdfEntries = useStore(sourceStore, (s) => s.clearRdfEntries)

  // Auto-run on mount if there's a structure but no entries yet — gives an
  // instant chart instead of an empty pane.
  useEffect(() => {
    if (atoms.length >= 2 && entries.length === 0) {
      computeAllPairs()
    }
    // Intentional: run only on mount; subsequent edits trigger via "Update" button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const chartData = useMemo<ChartRow[]>(() => {
    if (entries.length === 0) return []
    const longest = entries.reduce((acc, e) => (e.pattern.r.length > acc.pattern.r.length ? e : acc), entries[0])
    return longest.pattern.r.map((r, idx) => {
      const row: ChartRow = { x: r }
      for (const entry of entries) {
        row[entry.id] = entry.pattern.g_r[idx] ?? null
      }
      return row
    })
  }, [entries])

  const computing = status === 'computing'

  const yMax = useMemo(() => {
    const PHYSICAL_MIN_R = 0.5
    let peak = 0
    for (const row of chartData) {
      if (row.x < PHYSICAL_MIN_R) continue
      for (const entry of entries) {
        const v = row[entry.id]
        if (typeof v === 'number' && v > peak) peak = v
      }
    }
    if (peak <= 0) return undefined
    const padded = peak * 1.15
    const step = Math.pow(10, Math.floor(Math.log10(padded)) - 1)
    return Math.ceil(padded / step) * step
  }, [chartData, entries])

  const selectedAtomIds = useStore(sourceStore, (s) => s.selectedAtomIds)
  const latticeVectors = useStore(sourceStore, (s) => s.latticeVectors)

  const SHELL_MARK_LIMIT = 64
  const selectionTooLarge = selectedAtomIds.size > SHELL_MARK_LIMIT

  const shells = useMemo(() => {
    if (selectedAtomIds.size === 0 || selectionTooLarge || !latticeVectors) return []
    const centerIndices: number[] = []
    atoms.forEach((a, i) => { if (selectedAtomIds.has(a.id)) centerIndices.push(i) })
    if (centerIndices.length === 0) return []
    return selectionNeighborShells(
      {
        sites: atoms.map((a) => ({ element: a.element, cartesian: a.cartesian as [number, number, number] })),
        latticeVectors,
      },
      centerIndices,
      { cutoff, pbc: usePbc && periodic, tolerance: cutoff / Math.max(1, nBins) },
    )
  }, [atoms, selectedAtomIds, selectionTooLarge, latticeVectors, cutoff, nBins, usePbc, periodic])

  const recompute = () => {
    clearRdfEntries()
    computeAllPairs()
  }

  return (
    <div
      className="w-full h-full flex flex-col"
      style={{ backgroundColor: 'var(--panel-bg)' }}
    >
      <ChartHeader
        label={CHART_LABELS.rdf}
        title={CHART_TITLES.rdf}
        sourceLabel={`${atoms.length} atoms`}
        controls={(
          <>
            <button
              onClick={() => { computeRdf();  }}
              disabled={atoms.length < 2 || computing}
              className="zatom-primary zatom-pressable flex items-center gap-1 rounded px-2 py-1 text-[10px] disabled:opacity-40"
            >
              <Play className="w-3 h-3" /> Single
            </button>
            <button
              onClick={recompute}
              disabled={atoms.length < 2 || computing}
              className="zatom-choice zatom-pressable flex items-center gap-1 rounded px-2 py-1 text-[10px] disabled:opacity-40"
            >
              <Layers className="w-3 h-3" /> All pairs
            </button>
          </>
        )}
        onClose={() => { closeChartSlot(slot.id);  }}
        onRecompute={recompute}
        computing={computing}
      />

      <div className="flex-1 min-h-0 p-3 flex flex-col gap-3 overflow-y-auto">
        {error && (
          <div className="text-[11px] px-2 py-1.5 rounded" style={{ color: '#FF453A', backgroundColor: 'rgba(255,69,58,0.1)' }}>
            {error}
          </div>
        )}

        {atoms.length < 2 ? (
          <EmptyState message="Load a structure with at least two atoms to compute g(r)." />
        ) : entries.length === 0 ? (
          <EmptyState message="Press All pairs to compute." />
        ) : (
          <div className="flex-1 min-h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 24, left: 0 }}>
                <CartesianGrid strokeDasharray="2 3" stroke="var(--panel-border)" />
                <XAxis
                  dataKey="x"
                  type="number"
                  domain={['dataMin', 'dataMax']}
                  tickFormatter={(v: number) => v.toFixed(1)}
                  tick={{ fill: 'var(--panel-text-tertiary)', fontSize: 10 }}
                  label={{ value: 'r (Å)', position: 'insideBottom', offset: -8, fill: 'var(--panel-text-secondary)', fontSize: 10 }}
                />
                <YAxis
                  tick={{ fill: 'var(--panel-text-tertiary)', fontSize: 10 }}
                  width={32}
                  domain={yMax !== undefined ? [0, yMax] : undefined}
                  allowDataOverflow={yMax !== undefined}
                />
                {/* List only nonzero pairs so the tooltip stays within the plot. */}
                <Tooltip
                  cursor={{ stroke: 'var(--panel-border)' }}
                  wrapperStyle={{ zIndex: 20 }}
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null
                    const hits = payload
                      .filter((p) => typeof p.value === 'number' && p.value > 0.001)
                      .sort((a, b) => (b.value as number) - (a.value as number))
                      .slice(0, 4)
                    return (
                      <div
                        className="rounded px-2 py-1.5 text-[10px] leading-tight"
                        style={{
                          backgroundColor: 'var(--panel-elevated)',
                          border: '1px solid var(--panel-border)',
                          color: 'var(--panel-text)',
                          maxWidth: 132,
                        }}
                      >
                        <div style={{ color: 'var(--panel-text-secondary)' }}>
                          r = {typeof label === 'number' ? label.toFixed(2) : label} Å
                        </div>
                        {hits.length === 0 ? (
                          <div style={{ color: 'var(--panel-text-tertiary)' }}>no density</div>
                        ) : (
                          hits.map((p) => {
                            const entry = entries.find((e) => e.id === p.dataKey)
                            return (
                              <div key={String(p.dataKey)} className="flex items-center justify-between gap-2">
                                <span className="flex items-center gap-1 truncate" style={{ color: p.color }}>
                                  <span className="w-1.5 h-1.5 rounded-sm shrink-0" style={{ backgroundColor: p.color }} />
                                  {entry?.label ?? String(p.dataKey)}
                                </span>
                                <span className="tabular-nums">{(p.value as number).toFixed(2)}</span>
                              </div>
                            )
                          })
                        )}
                      </div>
                    )
                  }}
                />
                {entries.map((entry) => (
                  <Line
                    key={entry.id}
                    type="monotone"
                    dataKey={entry.id}
                    stroke={entry.color}
                    strokeWidth={1.4}
                    dot={false}
                    isAnimationActive={false}
                    connectNulls
                  />
                ))}
                {/* Label coordination only on the first shell to avoid overlap in small panes. */}
                {shells.map((shell, i) => (
                  <ReferenceLine
                    key={`shell-${shell.distance.toFixed(3)}`}
                    x={shell.distance}
                    stroke="#FF9500"
                    strokeWidth={i === 0 ? 1.4 : 1}
                    strokeDasharray={i === 0 ? undefined : '3 3'}
                    strokeOpacity={i === 0 ? 0.9 : 0.45}
                    label={i === 0 ? {
                      value: `${shell.count}`,
                      position: 'insideTopRight',
                      fill: '#FF9500',
                      fontSize: 10,
                      offset: 4,
                    } : undefined}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {entries.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {/* Pair legend; color dots already identify the data series. */}
            <div className="flex flex-wrap gap-x-2.5 gap-y-1 text-[10px]" style={{ color: 'var(--panel-text-secondary)' }}>
              {entries.map((e) => (
                <span key={e.id} className="flex items-center gap-1">
                  <span className="w-2 h-0.5 rounded-full" style={{ backgroundColor: e.color }} />
                  {e.label}
                </span>
              ))}
            </div>
            {/* Selection annotations are metadata, not another data series. */}
            {(shells.length > 0 || selectionTooLarge) && (
              <div
                className="flex items-center gap-1.5 pt-1.5 text-[10px]"
                style={{ borderTop: '1px solid var(--panel-border)' }}
              >
                {shells.length > 0 ? (
                  <>
                    <span className="w-2 border-t border-dashed shrink-0" style={{ borderColor: '#FF9500' }} />
                    <span style={{ color: '#FF9500' }}>
                      {shells[0].count} at {shells[0].distance.toFixed(2)} Å
                    </span>
                    <span style={{ color: 'var(--panel-text-tertiary)' }}>
                      · {shells.length} shell{shells.length > 1 ? 's' : ''} from selection
                    </span>
                  </>
                ) : (
                  <span style={{ color: 'var(--panel-text-tertiary)' }}>
                    {selectedAtomIds.size} atoms selected — too many to mark shells
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ────────────────────────── XRD inner ──────────────────────────

function XrdInner({ slot, sourceStore }: { slot: ChartSlot; sourceStore: CrystalStoreHook }) {
  const closeChartSlot = useViewportManager((s) => s.closeChartSlot)

  const atoms = useStore(sourceStore, (s) => s.atoms)
  const periodic = useStore(sourceStore, (s) => s.periodic)
  const entries = useStore(sourceStore, (s) => s.xrdEntries)
  const status = useStore(sourceStore, (s) => s.xrdStatus)
  const error = useStore(sourceStore, (s) => s.xrdError)
  const computeXrd = useStore(sourceStore, (s) => s.computeXrd)
  const clearXrdEntries = useStore(sourceStore, (s) => s.clearXrdEntries)

  useEffect(() => {
    if (periodic && atoms.length >= 1 && entries.length === 0) {
      computeXrd()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const recompute = () => {
    clearXrdEntries()
    computeXrd()
  }

  const computing = status === 'computing'

  const chartData = useMemo<ChartRow[]>(() => {
    if (entries.length === 0) return []
    const step = 0.05
    let min = Infinity, max = -Infinity
    for (const entry of entries) {
      for (const x of entry.pattern.x) {
        if (x < min) min = x
        if (x > max) max = x
      }
    }
    if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return []
    const peakMaps = entries.map((e) => {
      const m = new Map<number, number>()
      for (let i = 0; i < e.pattern.x.length; i++) {
        const b = Math.round(e.pattern.x[i] / step) * step
        m.set(b, (m.get(b) ?? 0) + e.pattern.y[i])
      }
      return { id: e.id, m }
    })
    const n = Math.ceil((max - min) / step) + 1
    const rows: ChartRow[] = []
    for (let i = 0; i < n; i++) {
      const x = min + i * step
      const bucket = Math.round(x / step) * step
      const row: ChartRow = { x }
      for (const p of peakMaps) row[p.id] = p.m.get(bucket) ?? 0
      rows.push(row)
    }
    return rows
  }, [entries])

  return (
    <div className="w-full h-full flex flex-col" style={{ backgroundColor: 'var(--panel-bg)' }}>
      <ChartHeader
        label={CHART_LABELS.xrd}
        title={CHART_TITLES.xrd}
        sourceLabel={periodic ? `${atoms.length} atoms · periodic` : 'needs periodic cell'}
        onClose={() => { closeChartSlot(slot.id);  }}
        onRecompute={recompute}
        computing={computing}
      />

      <div className="flex-1 min-h-0 p-3 flex flex-col gap-3 overflow-y-auto">
        {error && (
          <div className="text-[11px] px-2 py-1.5 rounded" style={{ color: '#FF453A', backgroundColor: 'rgba(255,69,58,0.1)' }}>
            {error}
          </div>
        )}

        {!periodic ? (
          <EmptyState message="XRD requires a periodic cell. Toggle Boundary → Periodic." />
        ) : entries.length === 0 ? (
          <EmptyState message="Press Update to compute pattern." />
        ) : (
          <div className="flex-1 min-h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 24, left: 0 }}>
                <CartesianGrid strokeDasharray="2 3" stroke="var(--panel-border)" />
                <XAxis
                  dataKey="x"
                  type="number"
                  domain={['dataMin', 'dataMax']}
                  tick={{ fill: 'var(--panel-text-tertiary)', fontSize: 10 }}
                  tickFormatter={(v: number) => v.toFixed(0)}
                  label={{ value: '2θ (°)', position: 'insideBottom', offset: -8, fill: 'var(--panel-text-secondary)', fontSize: 10 }}
                />
                <YAxis tick={{ fill: 'var(--panel-text-tertiary)', fontSize: 10 }} width={32} domain={[0, 110]} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--panel-elevated)',
                    border: '1px solid var(--panel-border)',
                    fontSize: 11,
                    color: 'var(--panel-text)',
                  }}
                  formatter={(value: number, name: string) => {
                    if (value === 0) return ['', '']
                    const entry = entries.find((e) => e.id === name)
                    return [value.toFixed(1), entry?.label ?? name]
                  }}
                  labelFormatter={(v: number) => `2θ = ${v.toFixed(2)}°`}
                />
                {entries.map((entry) => (
                  <Line
                    key={entry.id}
                    type="stepAfter"
                    dataKey={entry.id}
                    stroke={entry.color}
                    strokeWidth={1.2}
                    dot={false}
                    isAnimationActive={false}
                    connectNulls={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  )
}

// ────────────────────────── Electron-diffraction inner ──────────────────────────
function EdiffInner({ slot, sourceStore }: { slot: ChartSlot; sourceStore: CrystalStoreHook }) {
  const closeChartSlot = useViewportManager((s) => s.closeChartSlot)

  const atoms = useStore(sourceStore, (s) => s.atoms)
  const periodic = useStore(sourceStore, (s) => s.periodic)
  const entries = useStore(sourceStore, (s) => s.ediffEntries)
  const status = useStore(sourceStore, (s) => s.ediffStatus)
  const error = useStore(sourceStore, (s) => s.ediffError)
  const computeEdiff = useStore(sourceStore, (s) => s.computeEdiff)
  const clearEdiffEntries = useStore(sourceStore, (s) => s.clearEdiffEntries)

  useEffect(() => {
    if (periodic && atoms.length >= 1 && entries.length === 0) {
      computeEdiff()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const recompute = () => {
    clearEdiffEntries()
    computeEdiff()
  }

  const computing = status === 'computing'

  // Bucketize by |g| VALUE (not array index) so entries computed with different
  // gMax/nBins still align on the physical |g| axis (mirrors the XRD chart).
  const chartData = useMemo<ChartRow[]>(() => {
    if (entries.length === 0) return []
    const step = 0.05
    let min = Infinity, max = -Infinity
    for (const e of entries) {
      for (const x of e.pattern.x) {
        if (x < min) min = x
        if (x > max) max = x
      }
    }
    if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return []
    const maps = entries.map((e) => {
      const m = new Map<number, number>()
      for (let i = 0; i < e.pattern.x.length; i++) {
        const b = Math.round(e.pattern.x[i] / step) * step
        m.set(b, Math.max(m.get(b) ?? 0, e.pattern.y[i]))
      }
      return { id: e.id, m }
    })
    const n = Math.ceil((max - min) / step) + 1
    const rows: ChartRow[] = []
    for (let i = 0; i < n; i++) {
      const x = min + i * step
      const bucket = Math.round(x / step) * step
      const row: ChartRow = { x }
      for (const p of maps) row[p.id] = p.m.get(bucket) ?? 0
      rows.push(row)
    }
    return rows
  }, [entries])

  return (
    <div className="w-full h-full flex flex-col" style={{ backgroundColor: 'var(--panel-bg)' }}>
      <ChartHeader
        label={CHART_LABELS.ediff}
        title={CHART_TITLES.ediff}
        sourceLabel={periodic ? `${atoms.length} atoms · periodic` : 'needs periodic cell'}
        onClose={() => { closeChartSlot(slot.id);  }}
        onRecompute={recompute}
        computing={computing}
      />

      <div className="flex-1 min-h-0 p-3 flex flex-col gap-3 overflow-y-auto">
        {error && (
          <div className="text-[11px] px-2 py-1.5 rounded" style={{ color: '#FF453A', backgroundColor: 'rgba(255,69,58,0.1)' }}>
            {error}
          </div>
        )}

        {!periodic ? (
          <EmptyState message="Electron diffraction requires a periodic cell. Toggle Boundary → Periodic." />
        ) : entries.length === 0 ? (
          <EmptyState message="Press Update to compute the radial profile." />
        ) : (
          <div className="flex-1 min-h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 24, left: 0 }}>
                <CartesianGrid strokeDasharray="2 3" stroke="var(--panel-border)" />
                <XAxis
                  dataKey="x"
                  type="number"
                  domain={['dataMin', 'dataMax']}
                  tick={{ fill: 'var(--panel-text-tertiary)', fontSize: 10 }}
                  tickFormatter={(v: number) => v.toFixed(1)}
                  label={{ value: '|g| (Å⁻¹)', position: 'insideBottom', offset: -8, fill: 'var(--panel-text-secondary)', fontSize: 10 }}
                />
                <YAxis tick={{ fill: 'var(--panel-text-tertiary)', fontSize: 10 }} width={32} domain={[0, 110]} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--panel-elevated)',
                    border: '1px solid var(--panel-border)',
                    fontSize: 11,
                    color: 'var(--panel-text)',
                  }}
                  formatter={(value: number, name: string) => {
                    const entry = entries.find((e) => e.id === name)
                    return [value.toFixed(1), entry?.label ?? name]
                  }}
                  labelFormatter={(v: number) => `|g| = ${v.toFixed(2)} Å⁻¹`}
                />
                {entries.map((entry) => (
                  <Line
                    key={entry.id}
                    type="monotone"
                    dataKey={entry.id}
                    stroke={entry.color}
                    strokeWidth={1.2}
                    dot={false}
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  )
}

// ────────────────────────── Convergence inner ──────────────────────────

function ConvergenceInner({ slot, sourceStore }: { slot: ChartSlot; sourceStore: CrystalStoreHook }) {
  const closeChartSlot = useViewportManager((s) => s.closeChartSlot)
  const frames = useStore(sourceStore, (s) => s.trajectoryFrames)
  const metadata = useStore(sourceStore, (s) => s.trajectoryMetadata)

  // Per-frame energy + max |force|, from trajectory metadata if present, else
  // derived directly from the frame's comment energy + per-atom force vectors.
  const chartData = useMemo<ChartRow[]>(() => {
    if (!frames || frames.length < 2) return []
    return frames.map((fr, i) => {
      const meta = metadata?.[i]
      const energy = meta?.energy ?? fr.frameScalars?.energy ?? null
      let maxForce = meta?.max_force ?? null
      if (maxForce == null) {
        let mx = 0
        let has = false
        for (const a of fr.atoms) {
          const f = a.props?.forces
          if (f && f.kind === 'vector') {
            has = true
            const m = Math.hypot(f.value[0], f.value[1], f.value[2])
            if (m > mx) mx = m
          }
        }
        maxForce = has ? mx : null
      }
      return { x: i + 1, energy, maxForce }
    })
  }, [frames, metadata])

  const hasEnergy = chartData.some((r) => r.energy != null)
  const hasForce = chartData.some((r) => r.maxForce != null)

  return (
    <div className="w-full h-full flex flex-col" style={{ backgroundColor: 'var(--panel-bg)' }}>
      <ChartHeader
        label={CHART_LABELS.convergence}
        title={CHART_TITLES.convergence}
        sourceLabel={frames ? `${frames.length} frames` : null}
        onClose={() => { closeChartSlot(slot.id);  }}
        onRecompute={() => {}}
        computing={false}
      />
      <div className="flex-1 min-h-0 p-3 flex flex-col gap-3 overflow-y-auto">
        {!frames || frames.length < 2 ? (
          <EmptyState message="Load a multi-frame trajectory (e.g. a relaxation .extxyz with per-frame energy / forces)." />
        ) : (
          <div className="flex-1 min-h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 24, left: 0 }}>
                <CartesianGrid strokeDasharray="2 3" stroke="var(--panel-border)" />
                <XAxis
                  dataKey="x"
                  type="number"
                  domain={['dataMin', 'dataMax']}
                  allowDecimals={false}
                  tick={{ fill: 'var(--panel-text-tertiary)', fontSize: 10 }}
                  label={{ value: 'ionic step', position: 'insideBottom', offset: -8, fill: 'var(--panel-text-secondary)', fontSize: 10 }}
                />
                <YAxis yAxisId="e" tick={{ fill: '#34d399', fontSize: 10 }} width={50} domain={['auto', 'auto']} />
                <YAxis yAxisId="f" orientation="right" tick={{ fill: '#f59e0b', fontSize: 10 }} width={42} domain={[0, 'auto']} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--panel-elevated)',
                    border: '1px solid var(--panel-border)',
                    fontSize: 11,
                    color: 'var(--panel-text)',
                  }}
                  labelFormatter={(v: number) => `step ${v}`}
                  formatter={(value: number, name: string) => [
                    Number.isFinite(value) ? value.toFixed(name === 'maxForce' ? 3 : 2) : '—',
                    name === 'energy' ? 'E (eV)' : '|F|max (eV/Å)',
                  ]}
                />
                {hasEnergy && (
                  <Line yAxisId="e" type="monotone" dataKey="energy" stroke="#34d399" strokeWidth={1.6} dot={false} isAnimationActive={false} connectNulls />
                )}
                {hasForce && (
                  <Line yAxisId="f" type="monotone" dataKey="maxForce" stroke="#f59e0b" strokeWidth={1.6} dot={false} isAnimationActive={false} connectNulls />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
        {(hasEnergy || hasForce) && (
          <div className="flex flex-wrap gap-1.5 text-[10px]" style={{ color: 'var(--panel-text-secondary)' }}>
            {hasEnergy && (
              <span className="flex items-center gap-1 px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--panel-elevated)' }}>
                <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: '#34d399' }} />Energy (eV)
              </span>
            )}
            {hasForce && (
              <span className="flex items-center gap-1 px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--panel-elevated)' }}>
                <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: '#f59e0b' }} />Max force (eV/Å)
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <div
      className="flex-1 min-h-[200px] flex items-center justify-center text-[11px] text-center px-4"
      style={{ color: 'var(--panel-text-tertiary)' }}
    >
      {message}
    </div>
  )
}

// ────────────────────────── public ──────────────────────────

export function ChartViewport({ slot }: { slot: ChartSlot }) {
  const sourceStore = useViewportManager((s) => {
    const sl = s.viewports[slot.sourceViewportId]
    return sl?.kind === 'crystal' ? (sl.storeInstance as unknown as CrystalStoreHook) : null
  })
  const closeChartSlot = useViewportManager((s) => s.closeChartSlot)

  if (!sourceStore) {
    return (
      <div className="w-full h-full flex flex-col" style={{ backgroundColor: 'var(--panel-bg)' }}>
        <ChartHeader
          label={CHART_LABELS[slot.chartKind]}
          title={CHART_TITLES[slot.chartKind]}
          sourceLabel={null}
          onClose={() => closeChartSlot(slot.id)}
          onRecompute={() => {}}
          computing={false}
        />
        <EmptyState message="Source viewport closed — close this chart and re-open from Functions." />
      </div>
    )
  }

  return slot.chartKind === 'rdf'
    ? <RdfInner slot={slot} sourceStore={sourceStore} />
    : slot.chartKind === 'xrd'
    ? <XrdInner slot={slot} sourceStore={sourceStore} />
    : slot.chartKind === 'ediff'
    ? <EdiffInner slot={slot} sourceStore={sourceStore} />
    : slot.chartKind === 'ladder'
    ? <LadderViewport slot={slot} sourceStore={sourceStore} />
    : <ConvergenceInner slot={slot} sourceStore={sourceStore} />
}
