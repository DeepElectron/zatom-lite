"use client"

import { useState } from "react"
import { useActiveCrystalStore as useCrystalStore } from "../../orchestration/ViewportContext"
import {
  buildDislocation,
  type BuildDislocationOptions,
  type DislocationAtomInput,
} from "../../lib/analysis/builders/dislocation"
import type { CubicLatticeType } from "../../lib/crystal/lattice-period"
import { atomicNumberToSymbol } from "../../chemistry/periodic-table"
import { BuilderRow, NumInput, TextInput, BuildButton, StatusLine } from "./builder-controls"

/**
 * Dislocation builder — the line defect, introduced into the loaded crystal.
 *
 * Scene input, unlike the nanotube/cluster builders: a dislocation is a defect
 * *of* a crystal, so there has to be one on screen first. The Volterra
 * displacement field is applied to the atoms that are already there.
 *
 * Three things this panel deliberately shows rather than hides, because each is
 * a way the result can be misread:
 *
 *  - **Character is reported, not chosen.** It follows from **b** and ξ. A
 *    dropdown offering "screw / edge" alongside free Miller inputs would let the
 *    user pick one and the geometry give the other.
 *  - **`minSeparation`** — the elastic field diverges at the line, so without a
 *    core radius it will place atoms implausibly close. The number says how
 *    close, so "raise coreRadius" is a decision rather than a guess.
 *  - **The stacking fault of a partial.** `b scale` < 1 makes **b** a
 *    non-lattice vector; the faces then do not register and a fault trails the
 *    line. That is a real structure, not an error, but it has to be visible.
 */
export function DislocationBuilderSection() {
  const atoms = useCrystalStore((s) => s.atoms)
  const latticeVectors = useCrystalStore((s) => s.latticeVectors)
  const loadFromXYZ = useCrystalStore((s) => s.loadFromXYZ)
  const setPeriodic = useCrystalStore((s) => s.setPeriodic)

  const [burgers, setBurgers] = useState("110")
  const [line, setLine] = useState("110")
  const [latticeType, setLatticeType] = useState<CubicLatticeType>("fcc")
  const [poisson, setPoisson] = useState("0.33")
  const [radius, setRadius] = useState("")
  const [coreRadius, setCoreRadius] = useState("2")
  const [bScale, setBScale] = useState("1")
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null)

  /** "1-10" / "110" / "1 -1 0" → [1, -1, 0]. */
  const parseMiller = (raw: string, label: string): [number, number, number] => {
    const text = raw.trim()
    const spaced = text.split(/[\s,]+/).filter(Boolean)
    let out: number[]
    if (spaced.length === 3) {
      out = spaced.map(Number)
    } else {
      // Compact form: a leading '-' binds to the digit that follows it, so
      // "1-10" is [1,-1,0] and not [1,-10] — the crystallographic convention,
      // and the reason this is not just split('').
      out = []
      for (let i = 0; i < text.length; i++) {
        if (text[i] === "-") { out.push(-Number(text[++i])) } else { out.push(Number(text[i])) }
      }
    }
    if (out.length !== 3 || out.some((v) => !Number.isFinite(v))) {
      throw new Error(`${label}: expected three Miller indices, got "${raw}"`)
    }
    if (out.every((v) => v === 0)) throw new Error(`${label}: cannot be [000]`)
    return out as [number, number, number]
  }

  const handleBuild = async () => {
    setStatus(null)
    try {
      if (!atoms.length) throw new Error("Load a crystal first — a dislocation is a defect of one")
      if (!latticeVectors) throw new Error("No lattice — a Burgers vector is a lattice translation")

      const input: DislocationAtomInput[] = atoms.map((a) => ({
        element: typeof a.element === "number" ? atomicNumberToSymbol(a.element) : String(a.element),
        cartesian: [a.x, a.y, a.z] as [number, number, number],
      }))
      const opts: BuildDislocationOptions = {
        lattice: [latticeVectors.a, latticeVectors.b, latticeVectors.c] as BuildDislocationOptions["lattice"],
        atoms: input,
        burgers: parseMiller(burgers, "Burgers"),
        lineDirection: parseMiller(line, "Line"),
        latticeType,
        poissonRatio: parseFloat(poisson) || 0.33,
        radius: radius.trim() === "" ? undefined : Math.max(1, parseFloat(radius) || 0),
        coreRadius: Math.max(0, parseFloat(coreRadius) || 0),
        burgersScale: Math.max(1e-6, parseFloat(bScale) || 1),
      }
      const result = buildDislocation(opts)
      const loadRes = await loadFromXYZ(result.xyz)
      if (!loadRes.success) {
        setStatus({ ok: false, message: `Load failed: ${loadRes.error}` })
        return
      }
      // The cylinder has free transverse surfaces. The renderer has one global
      // periodic toggle, so showing it as finite is truthful; the Agent path
      // retains the exact [false, false, true] canonical boundary contract.
      setPeriodic(false)
      const extra = `min separation ${result.minSeparation.toFixed(2)} Å`
      setStatus({ ok: true, message: `${result.description} — ${extra}` })
    } catch (err) {
      setStatus({ ok: false, message: err instanceof Error ? err.message : String(err) })
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <div style={{ fontSize: 13, color: "var(--panel-text)", marginBottom: 4 }}>Dislocation</div>
        <p style={{ fontSize: 11, color: "var(--panel-text-tertiary)", lineHeight: 1.5 }}>
          Volterra construction on the loaded crystal. Character follows from b and the line
          direction — parallel is screw, perpendicular is edge. Isotropic elasticity, so the
          field is a starting configuration for relaxation, not an energy.
        </p>
      </div>

      <div className="rounded-lg p-3" style={{ backgroundColor: "var(--panel-elevated)", border: "1px solid var(--panel-border)" }}>
        <BuilderRow label="Burgers [hkl]"><TextInput value={burgers} onChange={setBurgers} placeholder="110" /></BuilderRow>
        <BuilderRow label="Line [hkl]"><TextInput value={line} onChange={setLine} placeholder="110" /></BuilderRow>
        <BuilderRow label="Lattice">
          <select
            value={latticeType}
            onChange={(e) => setLatticeType(e.target.value as CubicLatticeType)}
            style={{
              fontSize: 11, padding: "2px 6px", borderRadius: 6,
              backgroundColor: "var(--panel-bg)", color: "var(--panel-text)",
              border: "1px solid var(--panel-border)",
            }}
          >
            <option value="fcc">FCC</option>
            <option value="bcc">BCC</option>
            <option value="diamond">Diamond</option>
            <option value="sc">Simple cubic</option>
          </select>
        </BuilderRow>
        <BuilderRow label="Poisson ν"><NumInput value={poisson} onChange={setPoisson} step="0.01" /></BuilderRow>
        <BuilderRow label="Radius (Å)"><TextInput value={radius} onChange={setRadius} placeholder="auto" /></BuilderRow>
        <BuilderRow label="Core cut (Å)"><NumInput value={coreRadius} onChange={setCoreRadius} step="0.5" /></BuilderRow>
        <BuilderRow label="b scale"><NumInput value={bScale} onChange={setBScale} step="0.1" /></BuilderRow>
      </div>

      {parseFloat(bScale) !== 1 && (
        <p style={{ fontSize: 11, color: "#FF9F0A", lineHeight: 1.5 }}>
          b scale ≠ 1 makes a partial. Its Burgers vector is not a lattice translation, so the
          cut faces do not register and a stacking fault trails the line.
        </p>
      )}

      <BuildButton label="Introduce dislocation" onClick={handleBuild} disabled={!atoms.length} />
      {status && <StatusLine status={status} />}
    </div>
  )
}
