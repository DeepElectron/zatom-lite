/**
 * MagnetismPanel — Modeler inspector "Magnetism" function.
 *
 * Tag atoms with an initial collinear magnetic moment (magmom, μB) for spin-
 * polarised DFT. magmom is stored per-atom in `atomAttributes[atomId].magmom`
 * (the shared sparse per-atom map) and flows into the calculation (ABACUS STRU
 * + nspin). Presets: set-on-selection (any sign), ferromagnetic uniform, fill
 * by element high-spin defaults, and clear. Toggle the viewport ↑/↓ labels to
 * see the assignment. Pick atoms by clicking them in the viewport.
 */
import { useState } from "react"
import { useActiveCrystalStore as useCrystalStore } from "../../orchestration/ViewportContext"
import { Magnet, Crosshair, Eye, EyeOff } from "lucide-react"
import type { AtomAttributes } from "../../orchestration/slices/atom-attributes-slice"

export function MagnetismPanel() {
  const atoms = useCrystalStore((s) => s.atoms)
  const selectedAtomIds = useCrystalStore((s) => s.selectedAtomIds)
  const atomAttributes = useCrystalStore((s) => s.atomAttributes)
  const setAtomAttributesBulk = useCrystalStore((s) => s.setAtomAttributesBulk)
  const applyMagmomByElement = useCrystalStore((s) => s.applyMagmomByElement)
  const showMagmomLabels = useCrystalStore((s) => s.showMagmomLabels)
  const setShowMagmomLabels = useCrystalStore((s) => s.setShowMagmomLabels)
  const cellCharge = useCrystalStore((s) => s.cellCharge)
  const setCellCharge = useCrystalStore((s) => s.setCellCharge)
  const netSpin = useCrystalStore((s) => s.netSpin)
  const setNetSpin = useCrystalStore((s) => s.setNetSpin)

  const [value, setValue] = useState(5)
  const [theta, setTheta] = useState(90)
  const [phi, setPhi] = useState(0)
  const [note, setNote] = useState<string | null>(null)

  const nAtoms = atoms?.length ?? 0
  const selCount = selectedAtomIds.size

  const setBulk = (ids: string[], magmom: number) => {
    if (ids.length === 0) return
    const entries: Record<string, AtomAttributes> = {}
    for (const id of ids) entries[id] = { magmom }
    setAtomAttributesBulk(entries)
    if (!showMagmomLabels) setShowMagmomLabels(true)  // show the result so the action is visible
  }

  const setOnSelection = () => {
    setBulk([...selectedAtomIds], value)
    setNote(`Set ${selCount} atom(s) → ${value > 0 ? "+" : ""}${value} μB`)
  }
  const ferromagnetic = () => {
    // all atoms, uniform +|value| (ferromagnetic alignment)
    setBulk(atoms.map((a) => a.id), Math.abs(value))
    setNote(`Ferromagnetic: all ${nAtoms} atoms → +${Math.abs(value)} μB`)
  }
  const fillByElement = () => {
    const n = applyMagmomByElement()
    if (!showMagmomLabels) setShowMagmomLabels(true)
    setNote(`Filled by element — ${n} magnetic atom(s) tagged (Fe/Co/Ni/Mn/…)`)
  }
  const clear = (ids: string[], label: string) => {
    setBulk(ids, 0)
    setNote(`Cleared magmom on ${label}`)
  }
  // non-collinear spin direction (ABACUS angle1/angle2 + nspin 4)
  const setDirOnSelection = () => {
    const ids = [...selectedAtomIds]
    if (ids.length === 0) return
    const entries: Record<string, AtomAttributes> = {}
    for (const id of ids) entries[id] = { magmomTheta: theta, magmomPhi: phi }
    setAtomAttributesBulk(entries)
    setNote(`Direction θ=${theta}° φ=${phi}° → ${ids.length} atom(s) (non-collinear, nspin 4)`)
  }
  const clearDir = () => {
    const ids = selCount > 0 ? [...selectedAtomIds] : atoms.map((a) => a.id)
    const entries: Record<string, AtomAttributes> = {}
    for (const id of ids) entries[id] = { magmomTheta: undefined, magmomPhi: undefined }
    setAtomAttributesBulk(entries)
    setNote(`Cleared direction → collinear on ${ids.length} atom(s)`)
  }

  // summary
  const tagged = atoms.filter((a) => {
    const m = atomAttributes[a.id]?.magmom
    return typeof m === "number" && m !== 0
  })
  const net = tagged.reduce((s, a) => s + (atomAttributes[a.id]!.magmom as number), 0)
  const up = tagged.filter((a) => (atomAttributes[a.id]!.magmom as number) > 0).length
  const selElems = [...selectedAtomIds]
    .map((id) => atoms.find((a) => a.id === id)?.element)
    .filter(Boolean) as string[]

  return (
    <div className="space-y-3 p-1">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <Magnet className="h-4 w-4" /> Magnetism · spin & charge
      </div>

      {nAtoms === 0 ? (
        <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">Load or build a structure first, then tag magnetic atoms.</div>
      ) : (
        <div className="text-[11px] text-muted-foreground">Structure: <span className="font-medium text-foreground/70">{nAtoms} atoms</span></div>
      )}

      {/* selection */}
      <div className="panel-surface-accent space-y-1.5 rounded-lg border p-2">
        <div className="panel-accent flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide">
          <Crosshair className="h-3 w-3" /> Selection
        </div>
        <div className="text-[10px] text-muted-foreground">
          {selCount > 0 ? <>Selected: <b>{selCount} atom(s)</b>{selElems.length ? ` (${[...new Set(selElems)].join(", ")})` : ""}</> : "Click atoms in the viewport to select them."}
        </div>
      </div>

      {/* value */}
      <label className="flex items-center gap-2 text-[11px]">
        {/* Allow the slider to shrink so its intrinsic width does not push the value field outside the panel. */}
        <span className="w-20 shrink-0 text-muted-foreground">Moment (μB)</span>
        <input type="range" min={-7} max={7} step={0.5} value={value} onChange={(e) => setValue(Number(e.target.value))} className="min-w-0 flex-1" style={{ accentColor: 'var(--panel-accent)' }} />
        <input type="number" min={-12} max={12} step={0.5} value={value}
          onChange={(e) => { const v = Number(e.target.value); setValue(Number.isFinite(v) ? Math.max(-12, Math.min(12, v)) : 0) }}
          className="w-16 rounded border bg-transparent px-1 py-0.5 text-right tabular-nums" />
      </label>
      <div className="text-[10px] text-muted-foreground">Sign = spin direction (+ up / − down). 0 = non-magnetic.</div>

      {/* Use one solid primary action; render peer actions as outlined controls. */}
      <div className="grid grid-cols-2 gap-1.5">
        <button onClick={setOnSelection} disabled={selCount === 0}
          className="panel-btn-accent rounded-lg py-1.5 text-[11px] font-medium transition-colors">
          Set on selected ({selCount})
        </button>
        <button onClick={ferromagnetic} disabled={nAtoms === 0}
          className="panel-btn-accent-outline rounded-lg border py-1.5 text-[11px] font-medium transition-colors">
          FM: all +{Math.abs(value)}
        </button>
        <button onClick={fillByElement} disabled={nAtoms === 0}
          className="panel-btn-accent-outline rounded-lg border py-1.5 text-[11px] font-medium transition-colors">
          Fill by element
        </button>
        <button onClick={() => clear(selCount > 0 ? [...selectedAtomIds] : atoms.map((a) => a.id), selCount > 0 ? `${selCount} selected` : "all atoms")}
          disabled={nAtoms === 0}
          className="rounded-lg border py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted/50 disabled:opacity-40">
          Clear {selCount > 0 ? "selected" : "all"}
        </button>
      </div>

      {/* label toggle */}
      <button onClick={() => setShowMagmomLabels(!showMagmomLabels)}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg border py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted/50">
        {showMagmomLabels ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        {showMagmomLabels ? "Hide" : "Show"} magmom labels
      </button>

      {/* non-collinear spin direction (per-atom θ/φ → ABACUS angle1/angle2 + nspin 4) */}
      {/* Use the same accent as Selection and separate sections through spacing and headings. */}
      <div className="space-y-1.5 rounded-lg border border-[var(--glass-border-subtle)] p-2">
        <div className="text-[10px] font-medium uppercase tracking-wide text-[var(--panel-text-secondary)]">Spin direction · non-collinear</div>
        <div className="flex items-center gap-2 text-[11px]">
          <span className="w-10 shrink-0 text-muted-foreground">θ (°)</span>
          <input type="range" min={0} max={180} step={5} value={theta} onChange={(e) => setTheta(Number(e.target.value))} className="min-w-0 flex-1" style={{ accentColor: 'var(--panel-accent)' }} />
          <input type="number" min={0} max={180} step={5} value={theta} onChange={(e) => { const v = Number(e.target.value); setTheta(Number.isFinite(v) ? Math.max(0, Math.min(180, v)) : 0) }} className="w-14 rounded border bg-transparent px-1 py-0.5 text-right tabular-nums" />
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          <span className="w-10 shrink-0 text-muted-foreground">φ (°)</span>
          <input type="range" min={0} max={360} step={5} value={phi} onChange={(e) => setPhi(Number(e.target.value))} className="min-w-0 flex-1" style={{ accentColor: 'var(--panel-accent)' }} />
          <input type="number" min={0} max={360} step={5} value={phi} onChange={(e) => { const v = Number(e.target.value); setPhi(Number.isFinite(v) ? Math.max(0, Math.min(360, v)) : 0) }} className="w-14 rounded border bg-transparent px-1 py-0.5 text-right tabular-nums" />
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <button onClick={setDirOnSelection} disabled={selCount === 0}
            className="panel-btn-accent rounded-lg py-1.5 text-[11px] font-medium transition-colors">
            Set θ/φ on selected ({selCount})
          </button>
          <button onClick={clearDir} disabled={nAtoms === 0}
            className="rounded-lg border py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted/50 disabled:opacity-40">
            Clear → collinear
          </button>
        </div>
        <div className="text-[10px] text-muted-foreground">θ from +z, φ in xy. Needs a moment set above. Any direction → non-collinear SCF (nspin 4; SOC needs FR pseudopotentials).</div>
      </div>

      {/* cell-level charge & net spin (structure-wide compute settings) */}
      {/* This is a structure-level setting, not a warning surface. */}
      <div className="space-y-2 rounded-lg border border-[var(--glass-border-subtle)] p-2">
        <div className="text-[10px] font-medium uppercase tracking-wide text-[var(--panel-text-secondary)]">Cell charge &amp; net spin</div>
        <label className="flex items-center gap-2 text-[11px]">
          <span className="w-28 shrink-0 text-muted-foreground">Total charge (e)</span>
          <input type="number" step={1} value={cellCharge}
            onChange={(e) => { const v = Number(e.target.value); setCellCharge(Number.isFinite(v) ? v : 0) }}
            className="w-20 rounded border bg-transparent px-1 py-0.5 text-right tabular-nums" />
        </label>
        <label className="flex items-center gap-2 text-[11px]">
          <span className="w-28 shrink-0 text-muted-foreground">Net spin n↑−n↓</span>
          <input type="number" step={1} placeholder="auto" value={netSpin ?? ''}
            onChange={(e) => { const t = e.target.value.trim(); const v = Number(t); setNetSpin(t === '' ? null : (Number.isFinite(v) ? v : null)) }}
            className="w-20 rounded border bg-transparent px-1 py-0.5 text-right tabular-nums" />
        </label>
        <div className="text-[10px] text-muted-foreground">
          q&gt;0 = electron-deficient (→ solver.charge / ABACUS nelec). Net spin fixes n↑−n↓ (ABACUS nupdown); blank = unconstrained.
        </div>
      </div>

      {/* summary */}
      {tagged.length > 0 && (
        <div className="rounded-lg border bg-muted/20 p-2 text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground/80">{tagged.length}</span> tagged · net <span className="font-medium text-foreground/80">{net > 0 ? "+" : ""}{net.toFixed(1)} μB</span> · {up}↑ / {tagged.length - up}↓
          <div className="mt-0.5 text-[10px]">Tagged for spin-polarised DFT (collinear, nspin=2). The moment flows to the backend (extensions / compute presets / saved frames) → ABACUS STRU per-atom <code>mag</code> + nspin 2. Use ± signs on different sublattices for AFM / FiM.</div>
        </div>
      )}
      {note && <div className="status-green text-[11px]">{note}</div>}
    </div>
  )
}
