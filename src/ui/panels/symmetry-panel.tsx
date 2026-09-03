/** Multi-section symmetry analysis panel. */
import { useState, type ReactNode } from 'react'
import {
  ChevronRight, Loader2, Sparkles, RotateCcw,
  Hash, Boxes, Box, Eye, Compass, AlertCircle, EyeOff, AlertTriangle,
} from 'lucide-react'
import { Notice } from './panel-ui'
import { useActiveCrystalStore as useCrystalStore } from '../../orchestration/ViewportContext'
import { getGlobalBackendClient } from '../../host'
import { getElement } from '../../lib/crystal/elements'
import type { Atom, LatticeVectors } from '../../lib/crystal/types'
import { symmetryCellToExtxyz } from '../../lib/crystal/symmetry-cell-apply'
import { SupercellControls } from './supercell-controls'
import { WyckoffSection } from './wyckoff-section'
import type { StructureSymmetryResponse, StructureAtom } from '../../contracts/structures'

/** Convert symbol/fractional store data into the backend symmetry request shape. */
function toStructureAtoms(atoms: Atom[]): StructureAtom[] {
  return atoms.map((a) => {
    const [x, y, z] = a.position ?? [0, 0, 0]
    const element = getElement(a.element).atomicNumber
    return { element, x, y, z }
  })
}

function toLatticeMatrix(lv: LatticeVectors | null | undefined): number[][] | null {
  if (!lv) return null
  return [lv.a, lv.b, lv.c]
}

/** Call analyzeSymmetry directly because this panel needs the returned result. */
async function callAnalyzeSymmetry(atoms: Atom[], latticeVectors: LatticeVectors | null): Promise<StructureSymmetryResponse> {
  const client = getGlobalBackendClient()
  if (!client) throw new Error('Backend client not bound (app not bootstrapped yet)')
  const matrix = toLatticeMatrix(latticeVectors)
  if (!matrix) throw new Error('No lattice — symmetry analysis requires a periodic system')
  return client.analyzeSymmetry({
    atoms: toStructureAtoms(atoms),
    latticeMatrix: matrix,
  })
}

/** Frame the conventional cell while preserving view direction at 2.8× its longest vector. */
function flyToCell(
  latticeVectors: LatticeVectors,
  setCameraTarget: (t: { position: [number, number, number]; lookAt: [number, number, number]; preserveViewDirection?: boolean; distance?: number }) => void,
  setIsAnimatingCamera: (v: boolean) => void,
): void {
  const { a, b, c } = latticeVectors
  const center: [number, number, number] = [
    (a[0] + b[0] + c[0]) / 2,
    (a[1] + b[1] + c[1]) / 2,
    (a[2] + b[2] + c[2]) / 2,
  ]
  const norm = (v: [number, number, number]) => Math.hypot(v[0], v[1], v[2])
  const distance = Math.max(norm(a), norm(b), norm(c)) * 2.8
  setCameraTarget({
    position: center,
    lookAt: center,
    preserveViewDirection: true,
    distance,
  })
  setIsAnimatingCamera(true)
}

type SectionKey = 'find' | 'super' | 'show' | 'clear' | 'primitive' | 'axis' | 'wyckoff'

interface SectionDef {
  key: SectionKey
  title: string
  hint: string
  icon: typeof Sparkles
  defaultExpanded?: boolean
}

const SECTIONS: SectionDef[] = [
  { key: 'find',      title: 'Find Symmetry',     hint: 'Space group + operation set',   icon: Sparkles,  defaultExpanded: true },
  { key: 'wyckoff',   title: 'Wyckoff Positions', hint: 'Wyckoff site per atom',         icon: Hash },
  { key: 'super',     title: 'Supercell',         hint: 'Expand per axis / fork a copy',  icon: Boxes },
  { key: 'primitive', title: 'Primitive Cell',    hint: 'Reduce to the primitive cell',  icon: Box },
  { key: 'show',      title: 'Show Symmetry',     hint: 'Visualise operation spread',    icon: Eye },
  { key: 'clear',     title: 'Clear Symmetry',    hint: "Drop this panel's cached analysis", icon: RotateCcw },
  { key: 'axis',      title: 'Switch View Axis',  hint: 'Align camera to the a/b/c axis', icon: Compass },
]

export function SymmetryPanel() {
  const hasBackend = getGlobalBackendClient() !== null
  const [expanded, setExpanded] = useState<Set<SectionKey>>(
    new Set(SECTIONS.filter((s) => s.defaultExpanded).map((s) => s.key)),
  )
  // A version bump remounts every section and clears its local result state.
  const [resetVersion, setResetVersion] = useState(0)
  const toggle = (key: SectionKey) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  return (
    <div className="space-y-2">
      {!hasBackend && (
        <Notice tone="amber" icon={AlertTriangle}>
          Local symmetry engine is not packaged in this build, so the tools below are
          disabled. zatom will not fall back to a server.
        </Notice>
      )}
      {SECTIONS.map((section) => {
        const disabled = !hasBackend && ['find', 'wyckoff', 'primitive', 'show'].includes(section.key)
        return (
          <SectionCard
            key={section.key}
            section={section}
            open={!disabled && expanded.has(section.key)}
            disabled={disabled}
            onToggle={() => toggle(section.key)}
          >
            <SectionBody
              key={`${section.key}-${resetVersion}`}
              section={section.key}
              onClear={() => setResetVersion((v) => v + 1)}
            />
          </SectionCard>
        )
      })}
    </div>
  )
}

/** Animate collapsible sections with interpolated CSS grid rows instead of DOM measurement. */
function SectionCard({
  section, open, disabled = false, onToggle, children,
}: {
  section: SectionDef
  open: boolean
  disabled?: boolean
  onToggle: () => void
  children: ReactNode
}) {
  const Icon = section.icon
  // Use a neutral panel with one accent hairline and subtle elevation.
  // Reserve saturated accent color for primary actions.
  return (
    <div
      className={[
        'group relative rounded-[10px] border overflow-hidden',
        'transition-[background-color,border-color,box-shadow] duration-[180ms] ease-[cubic-bezier(0.4,0,0.2,1)]',
        open
          ? 'bg-[var(--panel-elevated)]/40 border-[var(--panel-border-focus)]/70 shadow-[inset_0_1px_0_var(--panel-border)]'
          : 'bg-transparent border-[var(--panel-border)]/60 hover:bg-[var(--panel-hover)]/30 hover:border-[var(--panel-border-focus)]/50',
      ].join(' ')}
    >
      {/* The 1px hairline is the section color anchor. */}
      <span
        aria-hidden
        className={[
          'absolute left-0 top-1 bottom-1 w-px origin-center rounded-full',
          'bg-[var(--panel-accent)]',
          'transition-[opacity,transform] duration-[200ms] ease-[cubic-bezier(0.23,1,0.32,1)]',
          open ? 'opacity-80 scale-y-100' : 'opacity-0 scale-y-50',
        ].join(' ')}
      />

      <button
        onClick={onToggle}
        disabled={disabled}
        title={disabled ? 'Requires the packaged local symmetry engine.' : undefined}
        className="w-full px-3 py-2 flex items-center gap-2.5 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--panel-border-focus)] rounded-[10px] disabled:cursor-not-allowed disabled:opacity-50"
      >
        <ChevronRight
          className={[
            'w-3 h-3 shrink-0 text-[var(--panel-text-tertiary)]',
            'transition-transform duration-[220ms] ease-[cubic-bezier(0.4,0,0.2,1)]',
            open ? 'rotate-90' : 'rotate-0',
          ].join(' ')}
        />
        <Icon
          className={[
            'w-3.5 h-3.5 shrink-0',
            'transition-[color,transform] duration-[180ms] ease-[cubic-bezier(0.4,0,0.2,1)]',
            open
              ? 'text-[var(--panel-text-secondary)]'
              : 'text-[var(--panel-text-tertiary)] group-hover:text-[var(--panel-text-secondary)]',
          ].join(' ')}
        />
        <span
          className={[
            'text-[12px] tracking-tight',
            'transition-colors duration-[180ms]',
            open
              ? 'text-[var(--panel-text)] font-medium'
              : 'text-[var(--panel-text-secondary)] font-medium group-hover:text-[var(--panel-text)]',
          ].join(' ')}
        >
          {section.title}
        </span>
        {/* State the disabled reason once in the top notice rather than in every section. */}
        <span className="text-[10px] text-[var(--panel-text-tertiary)] truncate flex-1 text-left">
          {section.hint}
        </span>
      </button>

      {/* Grid rows interpolate 0fr to 1fr while children clip overflow. */}
      <div
        className="grid transition-[grid-template-rows] duration-[360ms] ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:duration-0"
        style={{ gridTemplateRows: open ? '1fr' : '0fr' }}
        aria-hidden={!open}
        ref={(element) => element?.toggleAttribute('inert', !open)}
      >
        <div className="min-h-0 overflow-hidden">
          <div
            className={[
              'px-3 pb-3 pt-2 border-t border-[var(--panel-border)]/40',
              'transition-opacity duration-[240ms] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:duration-0',
              open ? 'opacity-100' : 'opacity-0',
            ].join(' ')}
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}

function SectionBody({ section, onClear }: { section: SectionKey; onClear: () => void }) {
  switch (section) {
    case 'super':
      return <SupercellControls />
    case 'find':
      return <FindSymmetrySection />
    case 'wyckoff':
      return <WyckoffSection />
    case 'primitive':
      return <PrimitiveCellSection />
    case 'axis':
      return <SwitchViewAxisSection />
    case 'show':
      return <ShowSymmetrySection />
    case 'clear':
      return <ClearSymmetrySection onClear={onClear} />
    default:
      return (
        <p className="text-[11px] text-[var(--panel-text-tertiary)] italic">
          Coming soon — not implemented yet, this is a placeholder.
        </p>
      )
  }
}

/** Shared primary action for symmetry workflows. */
function AccentButton({
  onClick, disabled, busy, busyLabel, icon, children,
}: {
  onClick: () => void
  disabled?: boolean
  busy?: boolean
  busyLabel: string
  icon: ReactNode
  children: ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="zatom-primary zatom-pressable relative flex w-full items-center justify-center gap-1.5 overflow-hidden rounded px-3 py-1.5 text-xs font-medium"
    >
      {busy
        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
        : icon}
      <span className="relative z-10">{busy ? busyLabel : children}</span>
    </button>
  )
}

/** Show backend failures prominently and explain common runtime connection errors. */
function ErrorBanner({ error }: { error: string }) {
  const isNetworkError =
    /fetch|ECONNREFUSED|NetworkError|Failed to fetch|runFn not bound/i.test(error)
  return (
    <div
      className="flex items-start gap-1.5 px-2 py-1.5 rounded border"
      style={{
        background: 'var(--status-amber-bg)',
        borderColor: 'var(--status-amber-border)',
      }}
    >
      <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" style={{ color: 'var(--status-amber)' }} />
      <div className="flex-1 min-w-0">
        <p className="text-[10px] leading-tight break-words" style={{ color: 'var(--status-amber)' }}>{error}</p>
        {isNetworkError && (
          <p className="text-[9px] text-[var(--panel-text-tertiary)] mt-0.5">
            Hint: check that the Python backend is running on VITE_BACKEND_URL.
          </p>
        )}
      </div>
    </div>
  )
}

/** Clickable chips filter viewport symmetry elements; disabled and excluded states remain distinct. */
function FilterChip({
  label, count, active, enabled, onClick,
}: {
  label: string
  count: number
  active: boolean
  enabled: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      disabled={!enabled}
      title={enabled
        ? (active ? `${label}: ${count} (click to hide in viewport)` : `${label}: ${count} (click to show)`)
        : `Enable "Show symmetry elements" to filter by type`}
      className={[
        'zatom-choice zatom-pressable rounded px-1.5 py-0.5 font-mono text-[10px]',
        !active ? 'line-through opacity-60' : '',
        'disabled:cursor-default',
      ].join(' ')}
      data-selected={active && enabled}
    >
      {label}×{count}
    </button>
  )
}

/** Clear cached symmetry results without changing the structure. */
function ClearSymmetrySection({ onClear }: { onClear: () => void }) {
  return (
    <div className="space-y-2">
      <p className="text-[10px] text-[var(--panel-text-tertiary)]">
        Clears this panel&apos;s analysis results (the Find / Primitive / Show output).
        The structure itself is untouched; re-run the analysis to restore it.
      </p>
      <button
        onClick={() => onClear()}
        className={[
          'w-full px-3 py-1.5 rounded text-xs font-medium',
          'bg-[var(--panel-elevated)] text-[var(--panel-text)]',
          'border border-[var(--panel-border)]',
          'transition-[background-color,border-color] duration-[160ms] ease-[cubic-bezier(0.4,0,0.2,1)]',
          'hover:bg-[var(--panel-hover)] hover:border-[var(--panel-border-focus)]',
          'active:scale-[0.98] active:duration-[80ms]',
          'flex items-center justify-center gap-1.5',
        ].join(' ')}
      >
        <RotateCcw className="w-3.5 h-3.5" />
        Reset Analysis
      </button>
    </div>
  )
}

/** Bucket symmetry operations by trace and determinant. */
function classifyOperation(rotation: number[][]): string {
  if (!rotation || rotation.length !== 3) return 'unknown'
  const trace = rotation[0][0] + rotation[1][1] + rotation[2][2]
  const a = rotation[0], b = rotation[1], c = rotation[2]
  const det =
    a[0] * (b[1] * c[2] - b[2] * c[1]) -
    a[1] * (b[0] * c[2] - b[2] * c[0]) +
    a[2] * (b[0] * c[1] - b[1] * c[0])
  const t = Math.round(trace)
  const d = Math.sign(Math.round(det))
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

/** Show bucket counts and render corresponding viewport elements. */
function ShowSymmetrySection() {
  const atoms = useCrystalStore((s) => s.atoms) as Atom[]
  const latticeVectors = useCrystalStore((s) => s.latticeVectors) as LatticeVectors | null
  const result = useCrystalStore((s) => s.symmetryAnalysis)
  const setSymmetryAnalysis = useCrystalStore((s) => s.setSymmetryAnalysis)
  const showElements = useCrystalStore((s) => s.showSymmetryElements)
  const setShowElements = useCrystalStore((s) => s.setShowSymmetryElements)
  const filter = useCrystalStore((s) => s.symmetryElementFilter)
  const setFilter = useCrystalStore((s) => s.setSymmetryElementFilter)
  const setCameraTarget = useCrystalStore((s) => s.setCameraTarget) as (t: { position: [number, number, number]; lookAt: [number, number, number]; preserveViewDirection?: boolean; distance?: number }) => void
  const setIsAnimatingCamera = useCrystalStore((s) => s.setIsAnimatingCamera) as (v: boolean) => void
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async () => {
    setBusy(true); setError(null)
    try {
      const symmetry = await callAnalyzeSymmetry(atoms, latticeVectors)
      if (!symmetry?.operations) throw new Error('No operations in response')
      setSymmetryAnalysis(symmetry)
      setShowElements(true)
      if (latticeVectors) flyToCell(latticeVectors, setCameraTarget, setIsAnimatingCamera)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  // Bucket counts derived from shared analysis (no separate local state).
  const counts = result?.operations
    ? (() => {
        const buckets: Record<string, number> = {}
        for (const op of result.operations) {
          const label = classifyOperation(op.rotation)
          buckets[label] = (buckets[label] ?? 0) + 1
        }
        return buckets
      })()
    : null
  const total = result?.operationCount ?? 0

  const toggleFilter = (label: string) => {
    const current = filter ?? new Set<string>()
    const next = new Set(current)
    if (next.has(label)) next.delete(label); else next.add(label)
    setFilter(next.size === 0 ? null : next)
  }

  return (
    <div className="space-y-2">
      <AccentButton
        onClick={run}
        disabled={busy || atoms.length === 0}
        busy={busy}
        busyLabel="Analyzing..."
        icon={<Sparkles className="w-3.5 h-3.5" />}
      >
        Show Symmetry Operations
      </AccentButton>
      {error && <ErrorBanner error={error} />}
      {counts && (
        <div className="space-y-1.5">
          <div className="text-[10px] text-[var(--panel-text-tertiary)]">
            Total operations: <span className="font-mono text-[var(--panel-text)]">{total}</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {Object.entries(counts)
              .sort((a, b) => b[1] - a[1])
              .map(([label, n]) => (
                <FilterChip
                  key={label}
                  label={label}
                  count={n}
                  active={filter == null || filter.has(label)}
                  enabled={showElements}
                  onClick={() => toggleFilter(label)}
                />
              ))}
          </div>
          <p className="text-[9px] text-[var(--panel-text-tertiary)] italic">
            E=identity, Cn=n-fold rotation, i=inversion, σ=mirror, Sn=rotoinversion
          </p>
          <OverlayToggle
            label={showElements ? 'Hide symmetry elements in viewport' : 'Show symmetry elements in viewport'}
            active={showElements}
            onClick={() => setShowElements(!showElements)}
            icon={showElements ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
          />
        </div>
      )}
    </div>
  )
}

/** Align the camera with ±a/±b/±c and set both target and animation state. */
function SwitchViewAxisSection() {
  const latticeVectors = useCrystalStore((s) => s.latticeVectors) as { a: [number, number, number]; b: [number, number, number]; c: [number, number, number] } | null
  const setCameraTarget = useCrystalStore((s) => s.setCameraTarget) as (t: { position: [number, number, number]; lookAt: [number, number, number] } | null) => void
  const setIsAnimatingCamera = useCrystalStore((s) => s.setIsAnimatingCamera) as (v: boolean) => void

  const lookAlong = (axisKey: 'a' | 'b' | 'c', sign: 1 | -1) => {
    if (!latticeVectors) return
    const va = latticeVectors.a, vb = latticeVectors.b, vc = latticeVectors.c
    const axis = latticeVectors[axisKey]
    const center: [number, number, number] = [
      (va[0] + vb[0] + vc[0]) / 2,
      (va[1] + vb[1] + vc[1]) / 2,
      (va[2] + vb[2] + vc[2]) / 2,
    ]
    const norm3 = (v: [number, number, number]) => Math.sqrt(v[0] ** 2 + v[1] ** 2 + v[2] ** 2)
    const distance = Math.max(norm3(va), norm3(vb), norm3(vc)) * 2.5
    const axisLen = norm3(axis) || 1
    const position: [number, number, number] = [
      center[0] + (sign * axis[0] * distance) / axisLen,
      center[1] + (sign * axis[1] * distance) / axisLen,
      center[2] + (sign * axis[2] * distance) / axisLen,
    ]
    setCameraTarget({ position, lookAt: center })
    setIsAnimatingCamera(true)
  }

  const canAlign = latticeVectors != null
  return (
    <div className="space-y-2">
      <p className="text-[10px] text-[var(--panel-text-tertiary)]">
        Aligns the camera along the chosen crystal axis for a head-on projection of the cell.
      </p>
      <div className="grid grid-cols-3 gap-1.5">
        {(['a', 'b', 'c'] as const).map((label) => (
          <div key={label} className="space-y-1">
            <AxisButton onClick={() => lookAlong(label, 1)} disabled={!canAlign} label={`+${label}`} />
            <AxisButton onClick={() => lookAlong(label, -1)} disabled={!canAlign} label={`-${label}`} />
          </div>
        ))}
      </div>
      {!canAlign && (
        <p className="text-[10px]" style={{ color: 'var(--status-amber)' }}>No lattice — switch only available for periodic systems.</p>
      )}
    </div>
  )
}

function AxisButton({ onClick, disabled, label }: { onClick: () => void; disabled: boolean; label: string }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="zatom-choice zatom-pressable w-full rounded px-2 py-1 font-mono text-[10px] disabled:opacity-40"
    >
      {label}
    </button>
  )
}

/** Run backend symmetry analysis and show group, crystal system, and operation count. */
function FindSymmetrySection() {
  const atoms = useCrystalStore((s) => s.atoms) as Atom[]
  const latticeVectors = useCrystalStore((s) => s.latticeVectors) as LatticeVectors | null
  const result = useCrystalStore((s) => s.symmetryAnalysis)
  const setSymmetryAnalysis = useCrystalStore((s) => s.setSymmetryAnalysis)
  const showHUD = useCrystalStore((s) => s.showSymmetryHUD)
  const setShowHUD = useCrystalStore((s) => s.setShowSymmetryHUD)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async () => {
    setBusy(true); setError(null)
    try {
      const symmetry = await callAnalyzeSymmetry(atoms, latticeVectors)
      setSymmetryAnalysis(symmetry)
      setShowHUD(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      <AccentButton
        onClick={run}
        disabled={busy || atoms.length === 0}
        busy={busy}
        busyLabel="Analyzing..."
        icon={<Sparkles className="w-3.5 h-3.5" />}
      >
        Find Symmetry
      </AccentButton>
      {error && <ErrorBanner error={error} />}
      {result && (
        <>
          <div className="text-[10px] font-mono space-y-0.5 text-[var(--panel-text-secondary)]">
            <Row k="space group" v={`${result.spaceGroup.internationalSymbol} (#${result.spaceGroup.number})`} />
            <Row k="crystal system" v={result.spaceGroup.crystalSystem} />
            <Row k="point group" v={result.spaceGroup.pointGroup} />
            <Row k="bravais" v={result.spaceGroup.bravaisLattice} />
            <Row k="ops" v={`${result.operationCount}`} />
          </div>
          <OverlayToggle
            label={showHUD ? 'Hide HUD badge' : 'Show HUD badge'}
            active={showHUD}
            onClick={() => setShowHUD(!showHUD)}
            icon={showHUD ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
          />
        </>
      )}
    </div>
  )
}

/** Small secondary toggle for viewport overlays —— elevated bg, accent when active. */
function OverlayToggle({
  label, active, onClick, icon,
}: { label: string; active: boolean; onClick: () => void; icon: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="zatom-choice zatom-pressable flex w-full items-center justify-center gap-1.5 rounded px-2 py-1 text-[10px] font-medium"
      data-selected={active}
    >
      {icon}
      {label}
    </button>
  )
}

/** Reuse symmetry analysis to report primitive-cell dimensions. */
function PrimitiveCellSection() {
  const atoms = useCrystalStore((s) => s.atoms) as Atom[]
  const latticeVectors = useCrystalStore((s) => s.latticeVectors) as LatticeVectors | null
  const result = useCrystalStore((s) => s.symmetryAnalysis)
  const setSymmetryAnalysis = useCrystalStore((s) => s.setSymmetryAnalysis)
  const showPrimitive = useCrystalStore((s) => s.showPrimitiveCell)
  const setShowPrimitive = useCrystalStore((s) => s.setShowPrimitiveCell)
  const setCameraTarget = useCrystalStore((s) => s.setCameraTarget) as (t: { position: [number, number, number]; lookAt: [number, number, number]; preserveViewDirection?: boolean; distance?: number }) => void
  const setIsAnimatingCamera = useCrystalStore((s) => s.setIsAnimatingCamera) as (v: boolean) => void
  const loadFromXYZ = useCrystalStore((s) => s.loadFromXYZ)
  const [busy, setBusy] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async () => {
    setBusy(true); setError(null)
    try {
      const symmetry = await callAnalyzeSymmetry(atoms, latticeVectors)
      if (!symmetry?.primitiveCell) throw new Error('No primitive cell in response')
      setSymmetryAnalysis(symmetry)
      setShowPrimitive(true)
      if (latticeVectors) flyToCell(latticeVectors, setCameraTarget, setIsAnimatingCamera)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  /** Apply the detected primitive cell to the structure. */
  const applyPrimitive = async () => {
    const cell = result?.primitiveCell
    if (!cell) return
    setApplying(true); setError(null)
    try {
      const built = symmetryCellToExtxyz(cell, { label: 'primitive cell' })
      if (!built.ok) throw new Error(built.error)
      // Use loadFromXYZ in edit mode because reduction is an edit to the current document.
      // That path records history and preserves layers and camera state.
      // loadFromCIF would reset layers, timeline, and camera.
      const loaded = await loadFromXYZ(built.xyz, { documentMode: 'edit' })
      if (!loaded.success) throw new Error(loaded.error)
      // Clear analysis and overlays after the structure is replaced.
      setSymmetryAnalysis(null)
      setShowPrimitive(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setApplying(false)
    }
  }

  const primitive = result?.primitiveCell
    ? (() => {
        const m = result.primitiveCell.lattice.matrix
        const norm = (v: number[]) => Math.sqrt(v[0] ** 2 + v[1] ** 2 + v[2] ** 2)
        return {
          aLen: norm(m[0]),
          bLen: norm(m[1]),
          cLen: norm(m[2]),
          atomCount: result.primitiveCell.atomCount,
        }
      })()
    : null

  return (
    <div className="space-y-2">
      <AccentButton
        onClick={run}
        disabled={busy || atoms.length === 0}
        busy={busy}
        busyLabel="Searching..."
        icon={<Sparkles className="w-3.5 h-3.5" />}
      >
        Find Primitive Cell
      </AccentButton>
      {error && <ErrorBanner error={error} />}
      {primitive && (
        <>
          <div className="text-[10px] font-mono space-y-0.5 text-[var(--panel-text-secondary)]">
            <Row k="|a|" v={`${primitive.aLen.toFixed(3)} Å`} />
            <Row k="|b|" v={`${primitive.bLen.toFixed(3)} Å`} />
            <Row k="|c|" v={`${primitive.cLen.toFixed(3)} Å`} />
            <Row k="atoms" v={`${primitive.atomCount}`} />
          </div>
          <OverlayToggle
            label={showPrimitive ? 'Hide primitive cell' : 'Show primitive cell'}
            active={showPrimitive}
            onClick={() => setShowPrimitive(!showPrimitive)}
            icon={showPrimitive ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
          />
          {/* Separate destructive structure replacement from analysis with a divider and secondary action. */}
          <div className="pt-1.5 border-t border-[var(--panel-border)]/40 space-y-1.5">
            <button
              onClick={applyPrimitive}
              disabled={applying}
              className={[
                'zatom-pressable w-full flex items-center justify-center gap-1.5',
                'px-3 py-1.5 rounded text-xs font-medium',
                'bg-[var(--panel-elevated)] text-[var(--panel-text)]',
                'border border-[var(--panel-border)]',
                'transition-[background-color,border-color] duration-[160ms] ease-[cubic-bezier(0.4,0,0.2,1)]',
                'hover:bg-[var(--panel-hover)] hover:border-[var(--panel-border-focus)]',
                'disabled:opacity-50 disabled:cursor-not-allowed',
              ].join(' ')}
            >
              {applying
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <Box className="w-3.5 h-3.5" />}
              {applying ? 'Reducing...' : 'Reduce structure to primitive cell'}
            </button>
            <p className="text-[9px] text-[var(--panel-text-tertiary)] leading-snug">
              Replaces the current structure ({atoms.length} atoms) with the primitive
              cell ({primitive.atomCount} atoms). Undo restores the original.
            </p>
          </div>
        </>
      )}
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-[var(--panel-text-tertiary)]">{k}</span>
      <span className="text-[var(--panel-text)] truncate">{v}</span>
    </div>
  )
}
