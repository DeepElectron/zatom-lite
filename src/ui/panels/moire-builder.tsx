"use client"

import { useState } from "react"
import { useActiveCrystalStore as useCrystalStore } from "../../orchestration/ViewportContext"
import { buildMoire, type MoireOptions } from "../../lib/analysis/builders/moire"
import { BuilderRow, NumInput, TextInput, BuildButton, StatusLine } from "./builder-controls"

/**
 * Moiré builder panel — twisted-bilayer of a graphene-like sheet.
 *
 * Pure-parameter (no scene input). Builds the exact COMMENSURATE Moiré supercell
 * for the target twist angle: it snaps to the nearest commensurate angle (m,n) so
 * both layers fill the same rhombic cell and adjacent (periodic-image) cells tile
 * seamlessly. The cell size is fixed by the angle (small angle → many atoms);
 * `Max atoms` caps it. CNT/BNNT-style element pairs supported (C/C, B/N).
 */
export function MoireBuilderSection() {
  const loadFromXYZ = useCrystalStore((s) => s.loadFromXYZ)
  const setPeriodic = useCrystalStore((s) => s.setPeriodic)

  const [twist, setTwist] = useState("21.79")
  const [maxAtoms, setMaxAtoms] = useState("6000")
  const [interlayer, setInterlayer] = useState("3.35")
  const [elA, setElA] = useState("C")
  const [elB, setElB] = useState("C")
  const [bondLength, setBondLength] = useState("")
  const [vacuum, setVacuum] = useState("12")
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null)

  const handleBuild = async () => {
    setStatus(null)
    try {
      const opts: MoireOptions = {
        twist_angle_deg: parseFloat(twist) || 0,
        maxAtoms: Math.max(8, parseInt(maxAtoms) || 6000),
        interlayer: Math.max(2, parseFloat(interlayer) || 3.35),
        elements: [elA.trim() || "C", elB.trim() || "C"],
        bond_length: bondLength.trim() === "" ? undefined : Math.max(0.5, parseFloat(bondLength) || 0),
        vacuum: Math.max(5, parseFloat(vacuum) || 12),
      }
      const result = buildMoire(opts)
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
        <div style={{ fontSize: 13, color: "var(--panel-text)", marginBottom: 4 }}>Moiré bilayer</div>
        <p style={{ fontSize: 11, color: "var(--panel-text-tertiary)", lineHeight: 1.5 }}>
          Commensurate twisted bilayer — snaps to the nearest exact (m,n) angle so adjacent cells tile seamlessly.
        </p>
      </div>

      <div className="rounded-lg p-3" style={{ backgroundColor: "var(--panel-elevated)", border: "1px solid var(--panel-border)" }}>
        <BuilderRow label="Twist (°)"><NumInput value={twist} onChange={setTwist} step="0.1" /></BuilderRow>
        <BuilderRow label="Max atoms"><NumInput value={maxAtoms} onChange={setMaxAtoms} step="100" /></BuilderRow>
        <BuilderRow label="Interlayer (Å)"><NumInput value={interlayer} onChange={setInterlayer} step="0.05" /></BuilderRow>
        <BuilderRow label="Elements">
          <div style={{ display: "flex", gap: 4 }}>
            <TextInput value={elA} onChange={setElA} width={28} />
            <TextInput value={elB} onChange={setElB} width={28} />
          </div>
        </BuilderRow>
        <BuilderRow label="Bond len (Å)"><TextInput value={bondLength} onChange={setBondLength} placeholder="auto" /></BuilderRow>
        <BuilderRow label="Vacuum (Å)"><NumInput value={vacuum} onChange={setVacuum} step="1" /></BuilderRow>
      </div>

      <BuildButton label={`Build ${elA}${elB} Moiré`} onClick={handleBuild} />
      {status && <StatusLine status={status} />}
    </div>
  )
}
