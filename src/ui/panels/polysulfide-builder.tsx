"use client"

import { useState } from "react"
import { useActiveCrystalStore as useCrystalStore } from "../../orchestration/ViewportContext"
import { buildPolysulfide, type PolysulfideOptions } from "../../lib/analysis/builders/polysulfide"
import { BuilderRow, NumInput, BuildButton, StatusLine } from "./builder-controls"

/**
 * Polysulfide builder panel — Li₂Sₓ (x=1..8) Li–S discharge intermediates as
 * isolated molecules in a vacuum box (cluster/molecular DFT).
 */
export function PolysulfideBuilderSection() {
  const loadFromXYZ = useCrystalStore((s) => s.loadFromXYZ)
  const setPeriodic = useCrystalStore((s) => s.setPeriodic)

  const [x, setX] = useState("8")
  const [vacuum, setVacuum] = useState("12")
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null)

  const handleBuild = async () => {
    setStatus(null)
    try {
      const opts: PolysulfideOptions = {
        x: Math.max(1, Math.min(8, parseInt(x) || 8)),
        vacuum: Math.max(6, parseFloat(vacuum) || 12),
      }
      const result = buildPolysulfide(opts)
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
        <div style={{ fontSize: 13, color: "var(--panel-text)", marginBottom: 4 }}>Polysulfide Li₂Sₓ</div>
        <p style={{ fontSize: 11, color: "var(--panel-text-tertiary)", lineHeight: 1.5 }}>
          Li–S discharge intermediates (x = 1..8) as isolated molecules in a vacuum box. Idealised geometry for relaxation.
        </p>
      </div>

      <div className="rounded-lg p-3" style={{ backgroundColor: "var(--panel-elevated)", border: "1px solid var(--panel-border)" }}>
        <BuilderRow label="x (S count)"><NumInput value={x} onChange={setX} step="1" /></BuilderRow>
        <BuilderRow label="Vacuum (Å)"><NumInput value={vacuum} onChange={setVacuum} step="1" /></BuilderRow>
      </div>

      <BuildButton label={`Build Li₂S${parseInt(x) || 8}`} onClick={handleBuild} />
      {status && <StatusLine status={status} />}
    </div>
  )
}
