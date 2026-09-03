"use client"

import { useState } from "react"
import { useActiveCrystalStore as useCrystalStore } from "../../orchestration/ViewportContext"
import { buildSingleAtom, type SingleAtomOptions } from "../../lib/analysis/builders/single-atom"
import { BuilderRow, NumInput, TextInput, BuildButton, StatusLine } from "./builder-controls"

/**
 * Single-atom catalyst panel — one metal atom on a graphene / h-BN support.
 * Idealised adatom start (not a relaxed M–N₄ pocket).
 */
export function SingleAtomBuilderSection() {
  const loadFromXYZ = useCrystalStore((s) => s.loadFromXYZ)
  const setPeriodic = useCrystalStore((s) => s.setPeriodic)

  const [metal, setMetal] = useState("Pt")
  const [support, setSupport] = useState<"graphene" | "bn">("graphene")
  const [n, setN] = useState("4")
  const [height, setHeight] = useState("2.0")
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null)

  const handleBuild = async () => {
    setStatus(null)
    try {
      const opts: SingleAtomOptions = {
        metal: metal.trim() || "Pt",
        support,
        n: Math.max(2, Math.min(8, parseInt(n) || 4)),
        height: Math.max(1, parseFloat(height) || 2.0),
      }
      const result = buildSingleAtom(opts)
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
        <div style={{ fontSize: 13, color: "var(--panel-text)", marginBottom: 4 }}>Single-atom catalyst</div>
        <p style={{ fontSize: 11, color: "var(--panel-text-tertiary)", lineHeight: 1.5 }}>
          One metal atom on a graphene / h-BN support. Idealised adatom — apply N-doping + relax for a true M–N₄ site.
        </p>
      </div>

      <div className="rounded-lg p-3" style={{ backgroundColor: "var(--panel-elevated)", border: "1px solid var(--panel-border)" }}>
        <BuilderRow label="Metal"><TextInput value={metal} onChange={setMetal} width={40} /></BuilderRow>
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
        <BuilderRow label="Height (Å)"><NumInput value={height} onChange={setHeight} step="0.1" /></BuilderRow>
      </div>

      <BuildButton label={`Build ${metal}@${support === "bn" ? "BN" : "graphene"}`} onClick={handleBuild} />
      {status && <StatusLine status={status} />}
    </div>
  )
}
