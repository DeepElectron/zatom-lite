/**
 * PolymerBuilder — Modeler inspector "Polymer" function.
 *
 * Materials-Studio-style polymer / chain builder (build-polymer):
 *   monomer (current scene) + head/tail backbone atoms (click-to-pick in the
 *   viewport) → N-unit head-to-tail chain with conformation (extended / helix /
 *   random), tacticity, side branches, one-click H-capped termini, and an
 *   optional periodicity-matched infinite cell.
 * Build → loadFromXYZ replaces the scene (periodic chain loads as a crystal;
 * finite chain as a molecule). "Optimize (force field)" then runs an empirical
 * relaxation (POST /structure/optimize) for an equilibrium conformation.
 */
import { useState } from "react"
import { useActiveCrystalStore as useCrystalStore } from "../../orchestration/ViewportContext"
import { Spline, Sparkles, Crosshair } from "lucide-react"
import { symbolToAtomicNumber, atomicNumberToSymbol } from "../../chemistry/periodic-table"
import { optTrajectoryToExtxyz, type OptTrajectorySnapshot } from "../../lib/crystal/xyz-parser"
import { cn } from "../../ui-kit/utils"
import type { BackendService, ComputeBuilderInvokePayload } from "../../host"
import { getGlobalBackendClient } from "../../host"

type Conformation = "extended" | "helix" | "random"
type Tacticity = "isotactic" | "syndiotactic" | "atactic"
type Periodicity = "finite" | "periodic"

interface PolymerBuildResponse {
  atoms: { element: number; x: number; y: number; z: number }[]
  latticeMatrix: number[][]
  label?: string
  metadata?: Record<string, unknown>
}

function getPolymerBuilderBackend(): Pick<BackendService, 'invokeComputeBuilder' | 'optimizeStructure'> {
  const backend = getGlobalBackendClient()
  if (!backend) {
    throw new Error("BackendService unavailable for polymer builder")
  }
  return backend
}

function NumberRow({ label, value, min, max, step, onChange, disabled }: {
  label: string; value: number; min: number; max: number; step: number
  onChange: (v: number) => void; disabled?: boolean
}) {
  return (
    <label className={cn("flex items-center gap-2 text-[11px]", disabled && "opacity-40")}>
      <span className="w-24 shrink-0 text-muted-foreground">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))} className="min-w-0 flex-1" style={{ accentColor: 'var(--panel-accent)' }} />
      <input type="number" min={min} max={max} step={step} value={value} disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-12 shrink-0 rounded border bg-transparent px-1 py-0.5 text-right tabular-nums" />
    </label>
  )
}

function Segmented<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: readonly { v: T; t: string }[]; onChange: (v: T) => void
}) {
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="w-24 shrink-0 text-muted-foreground">{label}</span>
      <div className="flex min-w-0 flex-1 gap-1">
        {options.map((o) => (
          <button key={o.v} onClick={() => onChange(o.v)}
            className={cn("min-w-0 flex-1 truncate rounded px-1 py-0.5 text-[10px] capitalize",
              value === o.v ? "panel-btn-accent" : "bg-muted/40 hover:bg-muted/70")}>{o.t}</button>
        ))}
      </div>
    </div>
  )
}

/** extended-XYZ. Lattice only when periodic — a finite chain loads as a molecule. */
function toXyz(atoms: { element: number; x: number; y: number; z: number }[], lattice: number[][], periodic: boolean, label?: string): string {
  const comment = periodic
    ? `Lattice="${lattice.flat().map((v) => v.toFixed(6)).join(" ")}" Properties=species:S:1:pos:R:3 ${label ? `label="${label}"` : ""}`
    : `Properties=species:S:1:pos:R:3 ${label ? `label="${label}"` : ""}`
  return [
    String(atoms.length),
    comment,
    ...atoms.map((a) => `${atomicNumberToSymbol(a.element)} ${a.x.toFixed(6)} ${a.y.toFixed(6)} ${a.z.toFixed(6)}`),
  ].join("\n")
}

export function PolymerBuilder() {
  const atoms = useCrystalStore((s) => s.atoms)
  const latticeVectors = useCrystalStore((s) => s.latticeVectors)
  const loadFromXYZ = useCrystalStore((s) => s.loadFromXYZ)
  const selectedAtomIds = useCrystalStore((s) => s.selectedAtomIds)

  const [nUnits, setNUnits] = useState(10)
  const [headAtom, setHeadAtom] = useState(0)
  const [tailAtom, setTailAtom] = useState(1)
  const [bondLength, setBondLength] = useState(1.54)
  const [conformation, setConformation] = useState<Conformation>("extended")
  const [torsionDeg, setTorsionDeg] = useState(180)
  const [tacticity, setTacticity] = useState<Tacticity>("isotactic")
  const [branchPercent, setBranchPercent] = useState(0)
  const [branchLength, setBranchLength] = useState(1)
  const [capEnds, setCapEnds] = useState(true)
  const [periodicity, setPeriodicity] = useState<Periodicity>("finite")
  const [lateralVacuum, setLateralVacuum] = useState(12)
  const [seed, setSeed] = useState(42)

  const [building, setBuilding] = useState(false)
  const [optimizing, setOptimizing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)

  const sceneAtomCount = atoms?.length ?? 0
  // first selected atom → its index in the scene array (= monomer atom index)
  const selectedIndex = (() => {
    if (!atoms || selectedAtomIds.size === 0) return -1
    const firstId = selectedAtomIds.values().next().value as string
    return atoms.findIndex((a) => a.id === firstId)
  })()
  const elemAt = (i: number) => (atoms && i >= 0 && i < atoms.length ? atoms[i].element : "—")

  const headInRange = headAtom >= 0 && headAtom < sceneAtomCount
  const tailInRange = tailAtom >= 0 && tailAtom < sceneAtomCount
  const canBuild = sceneAtomCount >= 2 && headInRange && tailInRange && headAtom !== tailAtom && !building

  const build = async () => {
    setBuilding(true); setError(null); setResult(null)
    try {
      if (!atoms) throw new Error("no monomer loaded")
      const monomer = {
        atoms: atoms.map((a) => { const p = (a.cartesian ?? a.position) as [number, number, number]; return { element: symbolToAtomicNumber(a.element), x: p[0], y: p[1], z: p[2] } }),
        label: "monomer",
      }
      const params = {
        n_units: nUnits, head_atom: headAtom, tail_atom: tailAtom, bond_length: bondLength,
        conformation, torsion_deg: torsionDeg, tacticity,
        branch_percent: branchPercent, branch_length: branchLength,
        cap_ends: capEnds, periodicity, lateral_vacuum: lateralVacuum, seed,
      }
      const payload: ComputeBuilderInvokePayload = { seeds: { monomer }, params }
      const data = await getPolymerBuilderBackend().invokeComputeBuilder<PolymerBuildResponse>(
        "build-polymer",
        payload,
      )
      const md = data.metadata ?? {}
      const isPeriodic = (md.periodicity ?? periodicity) === "periodic"
      await loadFromXYZ(toXyz(data.atoms, data.latticeMatrix, isPeriodic, data.label))
      const branches = (md.branches as number) ?? 0
      const minContact = md.min_contact_ang as number | undefined
      const notes: string[] = []
      if (md.n_units_adjusted_for_periodicity) notes.push(`rounded to ${md.n_units}× for a seamless repeat`)
      if (md.conformation_adjusted) notes.push(`relaxed to ${md.conformation}${md.conformation === "helix" ? ` ${md.torsion_used_deg}°` : ""} to avoid clashes`)
      const tight = typeof minContact === "number" && minContact < 0.9
      setResult(
        `✓ ${data.atoms.length} atoms · ${isPeriodic ? "∞ periodic chain" : "finite (H-capped)"}${branches ? ` · ${branches} branches` : ""}` +
        (notes.length ? ` · ${notes.join("; ")}` : "") +
        (tight ? ` · ⚠ tight contacts (${minContact!.toFixed(2)} Å) — click Optimize to relax` : " — optimize for equilibrium.")
      )
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBuilding(false) }
  }

  const optimize = async () => {
    if (!atoms || atoms.length === 0) return
    setOptimizing(true); setError(null)
    try {
      const reqAtoms = atoms.map((a) => { const p = (a.cartesian ?? a.position) as [number, number, number]; return { element: symbolToAtomicNumber(a.element), x: p[0], y: p[1], z: p[2] } })
      const lm = latticeVectors ? [latticeVectors.a, latticeVectors.b, latticeVectors.c] : null
      const isPeriodic = !!latticeVectors
      const r = await getPolymerBuilderBackend().optimizeStructure({
        atoms: reqAtoms,
        latticeMatrix: lm,
        pbc: lm ? [true, true, true] : null,
        forceField: "auto",
        optimizer: "fire",
        steps: 300,
        fmax: 0.05,
        optimizationTarget: "atom",
        includeTrajectory: true,
      })
      const lattice = r.lattice?.matrix ?? lm ?? [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
      const trajectory = r.trajectory as OptTrajectorySnapshot[] | undefined
      // Multi-frame trajectory → relaxation movie (E/F convergence chart + force-arrow glyphs); else just the final frame.
      if (trajectory && trajectory.length > 1) await loadFromXYZ(optTrajectoryToExtxyz(trajectory), { documentMode: 'edit' })
      else await loadFromXYZ(toXyz(r.atoms, lattice, isPeriodic, "relaxed"), { documentMode: 'edit' })
      setResult(`✓ Relaxed (${r.forceFieldUsed ?? "force field"}) · ${r.stepsCompleted} steps · ${r.converged ? "converged" : "max steps"}${r.energy != null ? ` · E ${r.energy.toFixed(2)} eV` : ""}${trajectory && trajectory.length > 1 ? ` · ${trajectory.length}-frame trajectory — open E/F chart to watch convergence` : ""}`)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setOptimizing(false) }
  }

  return (
    <div className="space-y-3 overflow-x-hidden p-1">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <Spline className="h-4 w-4" /> Polymer chain
      </div>

      {sceneAtomCount < 2 ? (
        <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
          Load a <b>monomer</b> first (SMILES via Adsorbate, or import) — it becomes the repeat unit. Then pick its head &amp; tail backbone atoms below.
        </div>
      ) : (
        <div className="text-[11px] text-muted-foreground">Monomer: current structure (<span className="font-medium text-foreground/70">{sceneAtomCount} atoms</span>)</div>
      )}

      {/* head / tail picking */}
      <div className="panel-surface-accent space-y-1.5 rounded-lg border p-2">
        <div className="panel-accent flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide">
          <Crosshair className="h-3 w-3" /> Backbone atoms
        </div>
        <div className="text-[10px] text-muted-foreground">
          {selectedIndex >= 0 ? <>Selected in viewport: <b>{elemAt(selectedIndex)} #{selectedIndex}</b></> : "Click an atom in the viewport, then assign it ↓"}
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <div className="flex min-w-0 items-center gap-1">
            <button disabled={selectedIndex < 0} onClick={() => setHeadAtom(selectedIndex)}
              className="shrink-0 rounded bg-muted/50 px-1.5 py-1 text-[10px] hover:bg-muted disabled:opacity-40">Set Head</button>
            <span className="truncate text-[10px] tabular-nums text-muted-foreground">{elemAt(headAtom)} #{headAtom}</span>
          </div>
          <div className="flex min-w-0 items-center gap-1">
            <button disabled={selectedIndex < 0} onClick={() => setTailAtom(selectedIndex)}
              className="shrink-0 rounded bg-muted/50 px-1.5 py-1 text-[10px] hover:bg-muted disabled:opacity-40">Set Tail</button>
            <span className="truncate text-[10px] tabular-nums text-muted-foreground">{elemAt(tailAtom)} #{tailAtom}</span>
          </div>
        </div>
        <NumberRow label="Head index" value={headAtom} min={0} max={Math.max(0, sceneAtomCount - 1)} step={1} onChange={setHeadAtom} />
        <NumberRow label="Tail index" value={tailAtom} min={0} max={Math.max(0, sceneAtomCount - 1)} step={1} onChange={setTailAtom} />
        {headInRange && tailInRange && headAtom === tailAtom && <div className="status-red text-[10px]">Head and tail must differ.</div>}
      </div>

      {/* chain */}
      <NumberRow label="Repeat units" value={nUnits} min={1} max={300} step={1} onChange={setNUnits} />
      <NumberRow label="Bond length (Å)" value={bondLength} min={0.8} max={2.6} step={0.01} onChange={setBondLength} />

      {/* conformation */}
      <Segmented label="Conformation" value={conformation} onChange={setConformation}
        options={[{ v: "extended", t: "extended" }, { v: "helix", t: "helix" }, { v: "random", t: "random" }]} />
      {conformation === "helix" && <NumberRow label="Torsion (°)" value={torsionDeg} min={0} max={360} step={5} onChange={setTorsionDeg} />}
      {conformation === "random" && <NumberRow label="Random seed" value={seed} min={0} max={9999} step={1} onChange={setSeed} />}

      {/* tacticity */}
      <Segmented label="Tacticity" value={tacticity} onChange={setTacticity}
        options={[{ v: "isotactic", t: "iso" }, { v: "syndiotactic", t: "syndio" }, { v: "atactic", t: "atactic" }]} />

      {/* branching */}
      <NumberRow label="Branch %" value={branchPercent} min={0} max={100} step={5} onChange={setBranchPercent} />
      {branchPercent > 0 && <NumberRow label="Branch length" value={branchLength} min={1} max={20} step={1} onChange={setBranchLength} />}

      {/* periodicity */}
      <Segmented label="Periodicity" value={periodicity} onChange={setPeriodicity}
        options={[{ v: "finite", t: "finite" }, { v: "periodic", t: "∞ periodic" }]} />
      <NumberRow label="Lateral vacuum (Å)" value={lateralVacuum} min={4} max={40} step={1} onChange={setLateralVacuum} />
      {periodicity === "finite" && (
        <label className="flex items-center gap-2 text-[11px]">
          <input type="checkbox" checked={capEnds} onChange={(e) => setCapEnds(e.target.checked)} style={{ accentColor: 'var(--panel-accent)' }} />
          <span className="text-muted-foreground">One-click H: cap chain termini with hydrogen</span>
        </label>
      )}

      <button onClick={build} disabled={!canBuild}
        className="panel-btn-accent w-full rounded-lg py-2 text-sm font-medium transition-colors">
        {building ? "Polymerizing…" : "Build polymer"}
      </button>
      <button onClick={optimize} disabled={sceneAtomCount === 0 || optimizing || building}
        className="panel-btn-accent-outline flex w-full items-center justify-center gap-1.5 rounded-lg border py-2 text-sm font-medium transition-colors">
        <Sparkles className="h-3.5 w-3.5" /> {optimizing ? "Optimizing…" : "Optimize (force field)"}
      </button>
      {result && <div className="status-green text-[11px]">{result}</div>}
      {error && <div className="status-red text-[11px]">{error}</div>}
    </div>
  )
}
