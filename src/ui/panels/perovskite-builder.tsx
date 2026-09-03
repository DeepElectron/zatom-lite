"use client"

import { useState } from "react"
import { useActiveCrystalStore as useCrystalStore } from "../../orchestration/ViewportContext"
import { buildPerovskite, type PerovskiteOptions } from "../../lib/analysis/builders/perovskite"
import { BuilderRow, NumInput, TextInput, BuildButton, StatusLine } from "./builder-controls"

/**
 * Perovskite builder panel — ideal cubic ABX₃ (Pm-3m). Pure-parameter: a + the
 * three site elements + optional supercell. A=corner, B=body-centre, X=face-centres.
 */
export function PerovskiteBuilderSection() {
  const loadFromXYZ = useCrystalStore((s) => s.loadFromXYZ)
  const setPeriodic = useCrystalStore((s) => s.setPeriodic)

  const [a, setA] = useState("3.905")
  const [elA, setElA] = useState("Sr")
  const [elB, setElB] = useState("Ti")
  const [elX, setElX] = useState("O")
  const [supercell, setSupercell] = useState("1")
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null)

  const handleBuild = async () => {
    setStatus(null)
    try {
      const opts: PerovskiteOptions = {
        a: Math.max(1, parseFloat(a) || 3.905),
        elementA: elA.trim() || "Sr",
        elementB: elB.trim() || "Ti",
        elementX: elX.trim() || "O",
        supercell: Math.max(1, Math.min(8, parseInt(supercell) || 1)),
      }
      const result = buildPerovskite(opts)
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
        <div style={{ fontSize: 13, color: "var(--panel-text)", marginBottom: 4 }}>Perovskite ABX₃</div>
        <p style={{ fontSize: 11, color: "var(--panel-text-tertiary)", lineHeight: 1.5 }}>
          Ideal cubic perovskite (Pm-3m): A on corners, B at body centre, X on face centres. 5 atoms/cell.
        </p>
      </div>

      <div className="rounded-lg p-3" style={{ backgroundColor: "var(--panel-elevated)", border: "1px solid var(--panel-border)" }}>
        <BuilderRow label="a (Å)"><NumInput value={a} onChange={setA} step="0.01" /></BuilderRow>
        <BuilderRow label="A / B / X">
          <div style={{ display: "flex", gap: 4 }}>
            <TextInput value={elA} onChange={setElA} width={32} />
            <TextInput value={elB} onChange={setElB} width={32} />
            <TextInput value={elX} onChange={setElX} width={32} />
          </div>
        </BuilderRow>
        <BuilderRow label="Supercell n"><NumInput value={supercell} onChange={setSupercell} step="1" /></BuilderRow>
      </div>

      <BuildButton label={`Build ${elA}${elB}${elX}₃`} onClick={handleBuild} />
      {status && <StatusLine status={status} />}
    </div>
  )
}
