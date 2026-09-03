/**
 * AmorphousBuilder — Modeler inspector "Amorphous" function.
 *
 * Materials-Studio "Amorphous Cell" toolkit (build-amorphous-cell):
 *   - Construction: pack N random copies of the current molecule into a cubic
 *     periodic box at a target density.
 *   - Packing: same, but molecule centroids confined to a z-slab / box / sphere.
 *   - Confined layer: pack the SMILES fragment into the vacuum gap of the
 *     current SLAB (which must be periodic).
 * Build → loadFromXYZ replaces the scene. "Optimize (force field)" then runs a
 * light empirical relaxation (POST /structure/optimize) on the current cell for
 * a physically reasonable, equilibrated structure.
 */
import { useState } from "react"
import { useActiveCrystalStore as useCrystalStore } from "../../orchestration/ViewportContext"
import { Boxes, Sparkles } from "lucide-react"
import { symbolToAtomicNumber, atomicNumberToSymbol } from "../../chemistry/periodic-table"
import { optTrajectoryToExtxyz, type OptTrajectorySnapshot } from "../../lib/crystal/xyz-parser"
import { cn } from "../../ui-kit/utils"
import { SliderRow, Segmented } from "./panel-ui"
import type { BackendService, ComputeBuilderInvokePayload } from "../../host"
import { getGlobalBackendClient } from "../../host"

type Task = "construction" | "packing" | "confined_layer"

interface AmorphousCellBuildResponse {
  atoms: { element: number; x: number; y: number; z: number }[]
  latticeMatrix: number[][]
  label?: string
}

function getAmorphousBuilderBackend(): Pick<BackendService, 'invokeComputeBuilder' | 'optimizeStructure'> {
  const backend = getGlobalBackendClient()
  if (!backend) {
    throw new Error("BackendService unavailable for amorphous builder")
  }
  return backend
}

  // Shared filled-track slider (stepper + drag bubble + odometer). Tinted with
  // the themed --panel-accent token; disabled wraps with pointer-events-none + dim.
function NumberRow({ label, value, min, max, step, onChange, disabled }: {
  label: string; value: number; min: number; max: number; step: number
  onChange: (v: number) => void; disabled?: boolean
}) {
  return (
    <div className={cn(disabled && "pointer-events-none opacity-40")}>
      <SliderRow
        label={label} value={value} min={min} max={max} step={step}
        accent="#8b5cf6" display={String(value)} onChange={onChange}
      />
    </div>
  )
}

function toExtXyz(atoms: { element: number; x: number; y: number; z: number }[], lattice: number[][], label?: string): string {
  const latStr = [lattice[0], lattice[1], lattice[2]].flat().map((v) => v.toFixed(6)).join(" ")
  return [
    String(atoms.length),
    `Lattice="${latStr}" Properties=species:S:1:pos:R:3 ${label ? `label="${label}"` : ""}`,
    ...atoms.map((a) => `${atomicNumberToSymbol(a.element)} ${a.x.toFixed(6)} ${a.y.toFixed(6)} ${a.z.toFixed(6)}`),
  ].join("\n")
}

export function AmorphousBuilder() {
  const atoms = useCrystalStore((s) => s.atoms)
  const latticeVectors = useCrystalStore((s) => s.latticeVectors)
  const periodic = useCrystalStore((s) => s.periodic)
  const loadFromXYZ = useCrystalStore((s) => s.loadFromXYZ)
  const customFragment = useCrystalStore((s) => s.customFragment)

  const [task, setTask] = useState<Task>("construction")
  const [nMolecules, setNMolecules] = useState(8)
  const [density, setDensity] = useState(1.0)
  const [boxSize, setBoxSize] = useState(0)
  const [minDistance, setMinDistance] = useState(1.8)
  const [seed, setSeed] = useState(42)
  // packing
  const [regionShape, setRegionShape] = useState<"slab_z" | "box" | "sphere">("slab_z")
  const [regionZLo, setRegionZLo] = useState(0)
  const [regionZHi, setRegionZHi] = useState(0)
  const [regionXLo, setRegionXLo] = useState(0)
  const [regionXHi, setRegionXHi] = useState(0)
  const [regionYLo, setRegionYLo] = useState(0)
  const [regionYHi, setRegionYHi] = useState(0)
  const [regionRadius, setRegionRadius] = useState(0)
  // confined layer
  const [gapClearance, setGapClearance] = useState(2.5)
  const [finalVacuum, setFinalVacuum] = useState(15)

  const [building, setBuilding] = useState(false)
  const [optimizing, setOptimizing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)

  const sceneAtomCount = atoms?.length ?? 0
  const hasFragment = !!customFragment
  // construction/packing use the scene as the molecule; confined_layer uses the
  // scene as the slab (must be periodic) + the SMILES fragment as the molecule.
  const canBuild = task === "confined_layer"
    ? sceneAtomCount > 0 && !!latticeVectors && !!periodic && hasFragment && !building
    : sceneAtomCount > 0 && !building

  const build = async () => {
    setBuilding(true); setError(null); setResult(null)
    try {
      const seeds: Record<string, unknown> = {}
      if (task === "confined_layer") {
        if (!atoms || !latticeVectors || !customFragment) throw new Error("missing slab or fragment")
        seeds.slab = {
          atoms: atoms.map((a) => { const p = (a.cartesian ?? a.position) as [number, number, number]; return { element: symbolToAtomicNumber(a.element), x: p[0], y: p[1], z: p[2] } }),
          latticeMatrix: [latticeVectors.a, latticeVectors.b, latticeVectors.c],
          label: "slab",
        }
        seeds.molecule = { atoms: customFragment.atoms.map((a) => ({ element: symbolToAtomicNumber(a.element), x: a.pos[0], y: a.pos[1], z: a.pos[2] })), label: "fragment" }
      } else {
        if (!atoms) throw new Error("no molecule loaded")
        seeds.molecule = { atoms: atoms.map((a) => { const p = (a.cartesian ?? a.position) as [number, number, number]; return { element: symbolToAtomicNumber(a.element), x: p[0], y: p[1], z: p[2] } }), label: "molecule" }
      }
      const params: Record<string, unknown> = {
        task, n_molecules: nMolecules, density_g_cm3: density, box_size_ang: boxSize,
        min_distance_ang: minDistance, seed,
        region_shape: regionShape, region_z_lo: regionZLo, region_z_hi: regionZHi,
        region_x_lo: regionXLo, region_x_hi: regionXHi, region_y_lo: regionYLo, region_y_hi: regionYHi,
        region_radius: regionRadius,
        gap_clearance: gapClearance, final_vacuum: finalVacuum,
      }
      const payload: ComputeBuilderInvokePayload = { seeds, params }
      const data = await getAmorphousBuilderBackend().invokeComputeBuilder<AmorphousCellBuildResponse>(
        "build-amorphous-cell",
        payload,
      )
      await loadFromXYZ(toExtXyz(data.atoms, data.latticeMatrix, data.label))
      setResult(`✓ ${data.atoms.length} atoms · ${data.latticeMatrix[0][0].toFixed(1)} Å box — optimize for equilibrium.`)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBuilding(false) }
  }

  const optimize = async () => {
    if (!atoms || atoms.length === 0) return
    setOptimizing(true); setError(null)
    try {
      const reqAtoms = atoms.map((a) => { const p = (a.cartesian ?? a.position) as [number, number, number]; return { element: symbolToAtomicNumber(a.element), x: p[0], y: p[1], z: p[2] } })
      const lm = latticeVectors ? [latticeVectors.a, latticeVectors.b, latticeVectors.c] : null
      const r = await getAmorphousBuilderBackend().optimizeStructure({
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
      else await loadFromXYZ(toExtXyz(r.atoms, lattice, "relaxed"), { documentMode: 'edit' })
      setResult(`✓ Relaxed (${r.forceFieldUsed ?? "force field"}) · ${r.stepsCompleted} steps · ${r.converged ? "converged" : "max steps"}${r.energy != null ? ` · E ${r.energy.toFixed(2)} eV` : ""}${trajectory && trajectory.length > 1 ? ` · ${trajectory.length}-frame trajectory — open E/F chart to watch convergence` : ""}`)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setOptimizing(false) }
  }

  return (
    <div className="space-y-3 p-1">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <Boxes className="h-4 w-4" /> Amorphous cell
      </div>
      {/* task selector */}
      <Segmented
        options={["Construct", "Packing", "Confined"]}
        value={task === "construction" ? "Construct" : task === "packing" ? "Packing" : "Confined"}
        onChange={(v) => setTask(v === "Construct" ? "construction" : v === "Packing" ? "packing" : "confined_layer")}
      />

      {task === "confined_layer" ? (
        (!periodic || !latticeVectors) ? (
          <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">Confined layer needs a <b>periodic slab</b> in the scene (build one in Slab first), plus a molecule loaded via SMILES.</div>
        ) : !hasFragment ? (
          <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">Load a molecule via SMILES (Adsorbate panel) — it gets packed into the slab's vacuum gap.</div>
        ) : (
          <div className="text-[11px] text-muted-foreground">Slab: scene ({sceneAtomCount} atoms) · molecule: SMILES fragment ({customFragment.atoms.length} atoms)</div>
        )
      ) : sceneAtomCount === 0 ? (
        <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">Load a molecule first (SMILES or import) — it becomes the repeat unit packed into the box.</div>
      ) : (
        <div className="text-[11px] text-muted-foreground">Repeat unit: current structure (<span className="font-medium text-foreground/70">{sceneAtomCount} atoms</span>)</div>
      )}

      {/* common controls */}
      <NumberRow label="Molecules" value={nMolecules} min={1} max={200} step={1} onChange={setNMolecules} />
      <NumberRow label="Min distance (Å)" value={minDistance} min={0.5} max={4} step={0.1} onChange={setMinDistance} />
      <NumberRow label="Random seed" value={seed} min={0} max={9999} step={1} onChange={setSeed} />

      {/* construction / packing box */}
      {task !== "confined_layer" && (
        <>
          <NumberRow label="Density (g/cm³)" value={density} min={0.05} max={5} step={0.05} onChange={setDensity} disabled={boxSize > 0} />
          <NumberRow label="Box edge (Å · 0=auto)" value={boxSize} min={0} max={100} step={1} onChange={setBoxSize} />
        </>
      )}
      {/* packing region */}
      {task === "packing" && (
        <>
          <div className="flex items-center gap-2 text-[11px]">
            <span className="w-32 shrink-0 text-muted-foreground">Region</span>
            <div className="flex flex-1 gap-1">
              {(["slab_z", "box", "sphere"] as const).map((s) => (
                <button key={s} onClick={() => setRegionShape(s)} className={cn("flex-1 rounded px-1 py-0.5 text-[10px]", regionShape === s ? "panel-btn-accent" : "bg-muted/40 hover:bg-muted/70")}>{s === "slab_z" ? "z-slab" : s}</button>
              ))}
            </div>
          </div>
          {regionShape === "slab_z" && <>
            <NumberRow label="z low (Å)" value={regionZLo} min={0} max={100} step={0.5} onChange={setRegionZLo} />
            <NumberRow label="z high (Å · 0=top)" value={regionZHi} min={0} max={100} step={0.5} onChange={setRegionZHi} />
          </>}
          {regionShape === "box" && <>
            <NumberRow label="x low (Å)" value={regionXLo} min={0} max={100} step={0.5} onChange={setRegionXLo} />
            <NumberRow label="x high (Å · 0=edge)" value={regionXHi} min={0} max={100} step={0.5} onChange={setRegionXHi} />
            <NumberRow label="y low (Å)" value={regionYLo} min={0} max={100} step={0.5} onChange={setRegionYLo} />
            <NumberRow label="y high (Å · 0=edge)" value={regionYHi} min={0} max={100} step={0.5} onChange={setRegionYHi} />
            <NumberRow label="z low (Å)" value={regionZLo} min={0} max={100} step={0.5} onChange={setRegionZLo} />
            <NumberRow label="z high (Å · 0=edge)" value={regionZHi} min={0} max={100} step={0.5} onChange={setRegionZHi} />
          </>}
          {regionShape === "sphere" && <NumberRow label="Radius (Å · 0=L/4)" value={regionRadius} min={0} max={50} step={0.5} onChange={setRegionRadius} />}
        </>
      )}
      {/* confined gap */}
      {task === "confined_layer" && (
        <>
          <NumberRow label="Gap clearance (Å)" value={gapClearance} min={1} max={10} step={0.1} onChange={setGapClearance} />
          <NumberRow label="Final vacuum (Å)" value={finalVacuum} min={0} max={50} step={1} onChange={setFinalVacuum} />
        </>
      )}

      <button onClick={build} disabled={!canBuild}
          className="panel-btn-accent w-full rounded-lg py-2 text-sm font-medium transition-colors">
        {building ? "Packing…" : "Build amorphous cell"}
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
