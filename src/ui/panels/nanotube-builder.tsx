"use client"

import { useState } from "react"
import { useActiveCrystalStore as useCrystalStore } from "../../orchestration/ViewportContext"
import { buildNanotube, type NanotubeOptions } from "../../lib/analysis/builders/nanotube"
import { BuilderRow, NumInput, TextInput, BuildButton, StatusLine } from "./builder-controls"

/**
 * Nanotube builder panel — chiral (n, m) tube from a graphene-like sheet.
 *
 * Pure-parameter (no scene input). CNT = C/C; BNNT = B/N. Rolls the sheet by
 * the chiral vector, repeats `n_units` translational cells along the axis.
 */
export function NanotubeBuilderSection() {
  const loadFromXYZ = useCrystalStore((s) => s.loadFromXYZ)
  const setPeriodic = useCrystalStore((s) => s.setPeriodic)

  const [nIdx, setNIdx] = useState("6")
  const [mIdx, setMIdx] = useState("6")
  const [nUnits, setNUnits] = useState("4")
  const [elA, setElA] = useState("C")
  const [elB, setElB] = useState("C")
  const [bondLength, setBondLength] = useState("")
  const [vacuum, setVacuum] = useState("10")
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null)

  const handleBuild = async () => {
    setStatus(null)
    try {
      const opts: NanotubeOptions = {
        n: Math.max(1, parseInt(nIdx) || 6),
        m: Math.max(0, parseInt(mIdx) || 0),
        n_units: Math.max(1, Math.min(50, parseInt(nUnits) || 4)),
        elements: [elA.trim() || "C", elB.trim() || "C"],
        bond_length: bondLength.trim() === "" ? undefined : Math.max(0.5, parseFloat(bondLength) || 0),
        vacuum: Math.max(5, parseFloat(vacuum) || 10),
      }
      const result = buildNanotube(opts)
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
        <div style={{ fontSize: 13, color: "var(--panel-text)", marginBottom: 4 }}>Nanotube (n, m)</div>
        <p style={{ fontSize: 11, color: "var(--panel-text-tertiary)", lineHeight: 1.5 }}>
          Roll a graphene-like sheet into a chiral tube. CNT = C/C, BNNT = B/N. (n,0) zigzag, (n,n) armchair.
        </p>
      </div>

      <div className="rounded-lg p-3" style={{ backgroundColor: "var(--panel-elevated)", border: "1px solid var(--panel-border)" }}>
        <BuilderRow label="Chiral n"><NumInput value={nIdx} onChange={setNIdx} step="1" /></BuilderRow>
        <BuilderRow label="Chiral m"><NumInput value={mIdx} onChange={setMIdx} step="1" /></BuilderRow>
        <BuilderRow label="Axial units"><NumInput value={nUnits} onChange={setNUnits} step="1" /></BuilderRow>
        <BuilderRow label="Elements">
          <div style={{ display: "flex", gap: 4 }}>
            <TextInput value={elA} onChange={setElA} width={28} />
            <TextInput value={elB} onChange={setElB} width={28} />
          </div>
        </BuilderRow>
        <BuilderRow label="Bond len (Å)"><TextInput value={bondLength} onChange={setBondLength} placeholder="auto" /></BuilderRow>
        <BuilderRow label="Vacuum (Å)"><NumInput value={vacuum} onChange={setVacuum} step="1" /></BuilderRow>
      </div>

      <BuildButton label={`Build (${nIdx},${mIdx}) ${elA}${elB === elA ? "" : elB} tube`} onClick={handleBuild} />
      {status && <StatusLine status={status} />}
    </div>
  )
}
