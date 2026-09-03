"use client"

import { useState } from "react"
import { useActiveCrystalStore as useCrystalStore } from "../../orchestration/ViewportContext"
import { buildDualAtom, type DualAtomOptions } from "../../lib/analysis/builders/dual-atom"
import { BuilderRow, NumInput, TextInput, BuildButton, StatusLine } from "./builder-controls"

/** Dual-atom catalyst panel — a metal pair on graphene / h-BN (idealised adatom dimer). */
export function DualAtomBuilderSection() {
  const loadFromXYZ = useCrystalStore((s) => s.loadFromXYZ)
  const setPeriodic = useCrystalStore((s) => s.setPeriodic)

  const [metalA, setMetalA] = useState("Fe")
  const [metalB, setMetalB] = useState("Co")
  const [support, setSupport] = useState<"graphene" | "bn">("graphene")
  const [n, setN] = useState("5")
  const [sep, setSep] = useState("2.5")
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null)

  const handleBuild = async () => {
    setStatus(null)
    try {
      const opts: DualAtomOptions = {
        metalA: metalA.trim() || "Fe",
        metalB: metalB.trim() || metalA.trim() || "Fe",
        support,
        n: Math.max(2, Math.min(8, parseInt(n) || 5)),
        separation: Math.max(1.5, parseFloat(sep) || 2.5),
      }
      const result = buildDualAtom(opts)
      const loadRes = await loadFromXYZ(result.xyz)
      if (loadRes.success) {
        setPeriodic(true)
        setStatus({ ok: true, message: result.description })
      } else {
        setStatus({ ok: false, message: `Load failed: ${loadRes.error}` })
      }
    } catch (err) {
      setStatus({ ok: false, message: err instanceof Error ? err.message : String(err) })
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <div style={{ fontSize: 13, color: "var(--panel-text)", marginBottom: 4 }}>Dual-atom catalyst</div>
        <p style={{ fontSize: 11, color: "var(--panel-text-tertiary)", lineHeight: 1.5 }}>
          A metal pair (homo- or hetero-) on graphene / h-BN. Idealised adatom dimer — N-dope + relax for a true M₂–N₆ site.
        </p>
      </div>

      <div className="rounded-lg p-3" style={{ backgroundColor: "var(--panel-elevated)", border: "1px solid var(--panel-border)" }}>
        <BuilderRow label="Metal A / B">
          <div style={{ display: "flex", gap: 4 }}>
            <TextInput value={metalA} onChange={setMetalA} width={36} />
            <TextInput value={metalB} onChange={setMetalB} width={36} />
          </div>
        </BuilderRow>
        <BuilderRow label="Support">
          <select
            value={support}
            onChange={(e) => setSupport(e.target.value as "graphene" | "bn")}
            style={{ fontSize: 12, padding: "3px 6px", borderRadius: 4, backgroundColor: "var(--panel-bg)", color: "var(--panel-text)", border: "1px solid var(--panel-border)" }}
          >
            <option value="graphene">Graphene (C)</option>
            <option value="bn">h-BN (B/N)</option>
          </select>
        </BuilderRow>
        <BuilderRow label="Supercell n"><NumInput value={n} onChange={setN} step="1" /></BuilderRow>
        <BuilderRow label="M–M sep (Å)"><NumInput value={sep} onChange={setSep} step="0.1" /></BuilderRow>
      </div>

      <BuildButton label={`Build ${metalA}${metalB}@${support === "bn" ? "BN" : "C"}`} onClick={handleBuild} />
      {status && <StatusLine status={status} />}
    </div>
  )
}
