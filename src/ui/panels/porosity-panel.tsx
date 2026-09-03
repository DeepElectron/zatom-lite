/**
 * PorosityPanel — Modeler inspector "Porosity / Surface" function.
 *
 * Probe-radius void analysis on the current structure (pure frontend): rolls a
 * spherical probe to find probe-accessible free space, reports void volume, void
 * fraction, accessible surface area, and specific surface area (m²/g), and
 * renders the accessible iso-surface coloured by a colormap (reuses marching
 * cubes). The same iso-surface + colorbar machinery generalises to scalar fields
 * (e.g. charge density). Probe presets: He 1.2, H₂O 1.4, N₂ 1.55 Å.
 */
import { useState } from "react"
import { useActiveCrystalStore as useCrystalStore } from "../../orchestration/ViewportContext"
import { Waves, Eye, EyeOff } from "lucide-react"
import { COLORMAP_NAMES, colormapGradientCss, type ColormapName } from "../../lib/viz/colormap"
import { cn } from "../../ui-kit/utils"

function NumberRow({ label, value, min, max, step, onChange }: {
  label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void
}) {
  return (
    <label className="flex items-center gap-2 text-[11px]">
      <span className="w-24 shrink-0 text-muted-foreground">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="min-w-0 flex-1 accent-cyan-500" />
      <input type="number" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))}
        className="w-12 shrink-0 rounded border bg-transparent px-1 py-0.5 text-right tabular-nums" />
    </label>
  )
}

export function PorosityPanel() {
  const atoms = useCrystalStore((s) => s.atoms)
  const periodic = useCrystalStore((s) => s.periodic)
  const voidResult = useCrystalStore((s) => s.voidResult)
  const probeRadius = useCrystalStore((s) => s.probeRadius)
  const voidResolution = useCrystalStore((s) => s.voidResolution)
  const voidColormap = useCrystalStore((s) => s.voidColormap)
  const voidSurfaceOpacity = useCrystalStore((s) => s.voidSurfaceOpacity)
  const showVoidSurface = useCrystalStore((s) => s.showVoidSurface)
  const setProbeRadius = useCrystalStore((s) => s.setProbeRadius)
  const setVoidResolution = useCrystalStore((s) => s.setVoidResolution)
  const setVoidColormap = useCrystalStore((s) => s.setVoidColormap)
  const setVoidSurfaceOpacity = useCrystalStore((s) => s.setVoidSurfaceOpacity)
  const setShowVoidSurface = useCrystalStore((s) => s.setShowVoidSurface)
  const computeVoidAnalysis = useCrystalStore((s) => s.computeVoidAnalysis)
  const clearVoidAnalysis = useCrystalStore((s) => s.clearVoidAnalysis)

  const [computing, setComputing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nAtoms = atoms?.length ?? 0

  const analyze = () => {
    setComputing(true); setError(null)
    // defer so the "Computing…" state paints before the synchronous grid pass
    setTimeout(() => {
      const r = computeVoidAnalysis()
      if (!r.ok) setError(r.error ?? "analysis failed")
      setComputing(false)
    }, 30)
  }

  const fmt = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : "—")

  return (
    <div className="space-y-3 overflow-x-hidden p-1">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <Waves className="h-4 w-4" /> Porosity · surface
      </div>

      {nAtoms === 0 ? (
        <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">Load or build a structure first.</div>
      ) : (
        <div className="text-[11px] text-muted-foreground">{nAtoms} atoms · {periodic ? "periodic cell" : "molecule (bounding box)"}</div>
      )}

      {/* probe */}
      <NumberRow label="Probe radius (Å)" value={probeRadius} min={0.3} max={4} step={0.05} onChange={setProbeRadius} />
      <div className="flex items-center gap-1.5 text-[10px]">
        <span className="w-32 shrink-0 text-muted-foreground">Presets</span>
        <div className="flex flex-1 gap-1">
          {([["He", 1.2], ["H₂O", 1.4], ["N₂", 1.55]] as const).map(([n, r]) => (
            <button key={n} onClick={() => setProbeRadius(r)}
              className={cn("flex-1 rounded px-1 py-0.5", Math.abs(probeRadius - r) < 1e-6 ? "bg-cyan-600 text-white" : "bg-muted/40 hover:bg-muted/70")}>{n} {r}</button>
          ))}
        </div>
      </div>
      <NumberRow label="Grid resolution" value={voidResolution} min={16} max={96} step={4} onChange={setVoidResolution} />

      <button onClick={analyze} disabled={nAtoms === 0 || computing}
        className="w-full rounded-lg bg-cyan-600 py-2 text-sm font-medium text-white transition-colors hover:bg-cyan-700 disabled:opacity-50">
        {computing ? "Computing void field…" : "Analyze porosity"}
      </button>

      {/* results */}
      {voidResult && (
        <div className="space-y-2">
          {voidResult.mesh.vertices.length === 0 && (
            <div className="status-surface-amber rounded-lg border p-2 text-[10px]">
              No probe-accessible surface here (void fraction {fmt(voidResult.voidFractionPct, 1)}%). The cell is dense / non-porous for this probe — try a <b>smaller probe</b> (e.g. 0.5 Å), a higher resolution, or a more open structure (slab with vacuum, MOF, amorphous box).
            </div>
          )}
          <div className="grid grid-cols-2 gap-1.5 rounded-lg border bg-muted/20 p-2 text-[11px]">
            <Stat label="Void volume" value={`${fmt(voidResult.voidVolumeAng3, 0)} Å³`} />
            <Stat label="Void fraction" value={`${fmt(voidResult.voidFractionPct, 1)} %`} />
            <Stat label="Accessible area" value={`${fmt(voidResult.accessibleSurfaceAreaAng2, 0)} Å²`} />
            <Stat label="Specific area" value={`${fmt(voidResult.specificSurfaceArea_m2g, 0)} m²/g`} />
            <Stat label="Cell volume" value={`${fmt(voidResult.cellVolumeAng3, 0)} Å³`} />
            <Stat label="Probe" value={`${fmt(voidResult.probeRadius, 2)} Å · ${voidResult.resolution}³`} />
          </div>

          {/* colorbar */}
          <div className="rounded-lg border p-2">
            <div className="mb-1 flex items-center justify-between text-[10px] text-muted-foreground">
              <span>Surface colour: channel openness (2nd-wall dist, Å)</span>
              <select value={voidColormap} onChange={(e) => setVoidColormap(e.target.value as ColormapName)}
                className="rounded border bg-transparent px-1 py-0.5 text-[10px]">
                {COLORMAP_NAMES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="h-3 w-full rounded" style={{ background: colormapGradientCss(voidColormap) }} />
            <div className="mt-0.5 flex justify-between text-[10px] tabular-nums text-muted-foreground">
              <span>{fmt(voidResult.scalarRange[0], 2)}</span>
              <span>{fmt(voidResult.scalarRange[1], 2)}</span>
            </div>
          </div>

          <NumberRow label="Surface opacity" value={voidSurfaceOpacity} min={0.1} max={1} step={0.05} onChange={setVoidSurfaceOpacity} />
          <div className="grid grid-cols-2 gap-1.5">
            <button onClick={() => setShowVoidSurface(!showVoidSurface)}
              className="flex items-center justify-center gap-1.5 rounded-lg border py-1.5 text-[11px] font-medium text-muted-foreground hover:bg-muted/50">
              {showVoidSurface ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}{showVoidSurface ? "Hide" : "Show"} surface
            </button>
            <button onClick={() => clearVoidAnalysis()}
              className="rounded-lg border py-1.5 text-[11px] font-medium text-muted-foreground hover:bg-muted/50">Clear</button>
          </div>
        </div>
      )}
      {error && <div className="status-red text-[11px]">{error}</div>}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="font-medium tabular-nums text-foreground/80">{value}</div>
    </div>
  )
}
