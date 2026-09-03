"use client"

import { useMemo } from "react"
import { Play, Trash2, Copy } from "lucide-react"
import { useActiveCrystalStore as useCrystalStore } from "../../orchestration/ViewportContext"
import { SBU_KIND_COLORS } from "../../orchestration/slices/atom-attributes-slice"
import type { SBUKind } from "../../lib/analysis/mof"
import { Toggle } from "./panel-ui"

const KIND_LABELS: Record<SBUKind, string> = {
  metal_cluster: 'Metal cluster',
  metal_paddlewheel: 'Paddle-wheel',
  metal_oxocluster: 'Oxocluster',
  metal_monomer: 'Monomer',
  linker: 'Linker',
  capping: 'Capping',
}

export function MofAnalyzerSection() {
  const atoms = useCrystalStore((s) => s.atoms)
  const mofSbus = useCrystalStore((s) => s.mofSbus)
  const mofRacs = useCrystalStore((s) => s.mofRacs)
  const mofWarnings = useCrystalStore((s) => s.mofWarnings)
  const showSbuColoring = useCrystalStore((s) => s.showMofSbuColoring)
  const setShowSbuColoring = useCrystalStore((s) => s.setShowMofSbuColoring)
  const selectedSbuId = useCrystalStore((s) => s.selectedSbuId)
  const setSelectedSbuId = useCrystalStore((s) => s.setSelectedSbuId)
  const runMofAnalysis = useCrystalStore((s) => s.runMofAnalysis)
  const clearMofAnalysis = useCrystalStore((s) => s.clearMofAnalysis)

  const selectedSbu = useMemo(
    () => mofSbus.find((s) => s.id === selectedSbuId) ?? null,
    [mofSbus, selectedSbuId],
  )

  // Find a RAC vector to display: prefer one anchored on an atom in the
  // selected SBU; otherwise the first available.
  const selectedRac = useMemo(() => {
    if (!selectedSbu) return mofRacs[0] ?? null
    const inSbu = mofRacs.find((r) => selectedSbu.atom_ids.includes(r.metal_atom_id))
    return inSbu ?? mofRacs[0] ?? null
  }, [selectedSbu, mofRacs])

  const handleRun = () => {
    const result = runMofAnalysis()
    if (result.ok) {
      setShowSbuColoring(true)
    }
  }

  const handleCopyRac = async () => {
    if (!selectedRac) return
    const payload = {
      metal_atom_id: selectedRac.metal_atom_id,
      features: selectedRac.features.map((f) => ({
        property: f.property,
        depth: f.depth,
        kind: f.kind,
        scope: f.scope,
        value: f.value,
      })),
    }
    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2))
  }

  const canRun = atoms.length > 0
  const hasResults = mofSbus.length > 0

  return (
    <div className="flex flex-col gap-3">
      <div>
        <div style={{ fontSize: 13, color: 'var(--panel-text)', marginBottom: 4 }}>
          MOF SBU + RAC
        </div>
        <p style={{ fontSize: 11, color: 'var(--panel-text-tertiary)', lineHeight: 1.5 }}>
          Detect metal nodes / linkers / capping ligands and compute Revised
          Autocorrelation descriptors (Janet & Kulik 2017) around every metal centre.
        </p>
      </div>

      <div className="flex gap-2">
        <button
          onClick={handleRun}
          disabled={!canRun}
          className="zatom-primary zatom-pressable flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-[12px] font-medium"
        >
          <Play className="w-3.5 h-3.5" />
          {canRun ? 'Run analysis' : 'Load a structure'}
        </button>
        {hasResults && (
          <button
            onClick={() => { clearMofAnalysis();  }}
            className="zatom-choice zatom-pressable flex items-center justify-center rounded-lg px-2 py-2"
            title="Clear MOF analysis"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {hasResults && (
        <>
          <label className="flex items-center justify-between cursor-pointer px-1">
            <span className="text-[11px]" style={{ color: 'var(--panel-text-secondary)' }}>
              Color atoms by SBU
            </span>
            <Toggle
              checked={showSbuColoring}
              onChange={(checked) => { setShowSbuColoring(checked);  }}
            />
          </label>

          {mofWarnings.length > 0 && (
            <div
              className="text-[10px] px-2 py-1.5 rounded"
              style={{
                color: '#FFCC00',
                backgroundColor: 'rgba(255,204,0,0.08)',
                border: '1px solid rgba(255,204,0,0.25)',
              }}
            >
              {mofWarnings.map((w, i) => <div key={i}>· {w}</div>)}
            </div>
          )}

          <div>
            <div style={{ fontSize: 10, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--panel-text-tertiary)', marginBottom: 6 }}>
              {mofSbus.length} SBU{mofSbus.length === 1 ? '' : 's'} detected
            </div>
            <div className="flex flex-col gap-1 max-h-[220px] overflow-y-auto">
              {mofSbus.map((sbu) => {
                const isSelected = sbu.id === selectedSbuId
                return (
                  <button
                    key={sbu.id}
                    onClick={() => setSelectedSbuId(isSelected ? null : sbu.id)}
                    data-selected={isSelected}
                    className="zatom-choice zatom-pressable flex items-center gap-2 rounded px-2 py-1.5 text-left"
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-sm shrink-0"
                      style={{ backgroundColor: SBU_KIND_COLORS[sbu.kind] }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] font-medium truncate" style={{ color: 'var(--panel-text)' }}>
                          {sbu.topology}
                        </span>
                        <span
                          className="text-[9px] px-1 py-px rounded shrink-0"
                          style={{
                            color: 'var(--panel-text-secondary)',
                            backgroundColor: 'var(--panel-hover)',
                          }}
                        >
                          {KIND_LABELS[sbu.kind]}
                        </span>
                      </div>
                      <div className="text-[10px] opacity-70 tabular-nums" style={{ color: 'var(--panel-text-tertiary)' }}>
                        {sbu.formula} · {sbu.atom_ids.length} atoms · {sbu.points_of_extension.length} POE
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {selectedRac && (
            <div>
              <div className="flex items-center justify-between mb-2 px-1">
                <span style={{ fontSize: 10, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--panel-text-tertiary)' }}>
                  RAC · metal atom {selectedRac.metal_atom_id}
                </span>
                <button
                  onClick={handleCopyRac}
                  className="zatom-choice zatom-pressable flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px]"
                  style={{ color: 'var(--panel-text-secondary)' }}
                  title="Copy RAC vector as JSON"
                >
                  <Copy className="w-3 h-3" /> Copy
                </button>
              </div>
              <RacMatrix vector={selectedRac} />
            </div>
          )}
        </>
      )}
    </div>
  )
}

function RacMatrix({ vector }: { vector: { features: Array<{ property: string; depth: number; kind: string; value: number }> } }) {
  // Group features by (property, kind) → depths → value.
  const grouped = useMemo(() => {
    const map = new Map<string, Map<number, number>>()
    for (const f of vector.features) {
      const key = `${f.property}|${f.kind}`
      if (!map.has(key)) map.set(key, new Map())
      map.get(key)!.set(f.depth, f.value)
    }
    return map
  }, [vector])

  const depths = useMemo(() => {
    const all = new Set<number>()
    for (const f of vector.features) all.add(f.depth)
    return [...all].sort((a, b) => a - b)
  }, [vector])

  // Order rows by property → kind.
  const keyOrder = ['Z|P', 'Z|D', 'chi|P', 'chi|D', 'T|P', 'T|D', 'I|P', 'I|D', 'S|P', 'S|D', 'alpha|P', 'alpha|D']
  const presentKeys = keyOrder.filter((k) => grouped.has(k))

  return (
    <div className="rounded overflow-hidden" style={{ border: '1px solid var(--panel-border)' }}>
      <table className="w-full text-[10px] tabular-nums">
        <thead>
          <tr style={{ backgroundColor: 'var(--panel-elevated)' }}>
            <th className="text-left px-2 py-1" style={{ color: 'var(--panel-text-tertiary)' }}>Prop</th>
            <th className="text-left px-1 py-1" style={{ color: 'var(--panel-text-tertiary)' }}>•</th>
            {depths.map((d) => (
              <th key={d} className="text-right px-2 py-1" style={{ color: 'var(--panel-text-tertiary)' }}>
                d={d}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {presentKeys.map((key) => {
            const [prop, kind] = key.split('|')
            const row = grouped.get(key)
            return (
              <tr key={key} style={{ borderTop: '1px solid var(--panel-border)' }}>
                <td className="px-2 py-1" style={{ color: 'var(--panel-text)' }}>{prop}</td>
                <td className="px-1 py-1" style={{ color: kind === 'P' ? '#22d3ee' : '#f97316' }}>{kind}</td>
                {depths.map((d) => {
                  const v = row?.get(d) ?? 0
                  return (
                    <td key={d} className="px-2 py-1 text-right" style={{ color: 'var(--panel-text-secondary)' }}>
                      {Math.abs(v) < 1e-4 && v !== 0 ? v.toExponential(2) : v.toFixed(2)}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
