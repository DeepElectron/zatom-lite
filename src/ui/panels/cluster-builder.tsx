"use client"

import { useState } from "react"
import { Sparkles } from "lucide-react"
import { useActiveCrystalStore as useCrystalStore } from "../../orchestration/ViewportContext"
import {
  buildMetalCluster,
  type ClusterGeometry,
  type MetalClusterOptions,
} from "../../lib/analysis/builders/cluster"
import { StatusLine } from "./builder-controls"

const GEOMETRIES: Array<{ id: ClusterGeometry; label: string; shellBased: boolean }> = [
  { id: 'icosahedral', label: 'Icosahedral', shellBased: true },
  { id: 'octahedral', label: 'Octahedral', shellBased: true },
  { id: 'cuboctahedral', label: 'Cuboctahedral', shellBased: true },
  { id: 'fcc', label: 'FCC sphere', shellBased: false },
  { id: 'hcp', label: 'HCP sphere', shellBased: false },
  { id: 'decahedral', label: 'Decahedral', shellBased: true },
]

export function ClusterBuilderSection() {
  const loadFromXYZ = useCrystalStore((s) => s.loadFromXYZ)
  const setPeriodic = useCrystalStore((s) => s.setPeriodic)

  const [geometry, setGeometry] = useState<ClusterGeometry>('icosahedral')
  const [element, setElement] = useState('Pt')
  const [shells, setShells] = useState('2')
  const [radius, setRadius] = useState('6')
  const [vacuum, setVacuum] = useState('10')
  const [bondLength, setBondLength] = useState('')
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null)

  const isShellBased = GEOMETRIES.find((g) => g.id === geometry)?.shellBased ?? false
  const shellsN = Math.max(1, Math.min(6, parseInt(shells) || 2))
  const radiusN = Math.max(2, Math.min(40, parseFloat(radius) || 6))
  const vacuumN = Math.max(5, Math.min(30, parseFloat(vacuum) || 10))
  const bondN = bondLength.trim() === '' ? undefined : Math.max(0.5, parseFloat(bondLength) || 0)

  const handleBuild = async () => {
    setStatus(null)
    try {
      const opts: MetalClusterOptions = {
        geometry,
        element: element.trim() || 'Pt',
        shells: isShellBased ? shellsN : undefined,
        radius_angstrom: !isShellBased ? radiusN : undefined,
        vacuum_angstrom: vacuumN,
        bond_length: bondN,
      }
      const result = buildMetalCluster(opts)
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <div style={{ fontSize: 13, color: 'var(--panel-text)', marginBottom: 4 }}>
          Metal nanocluster
        </div>
        <p style={{ fontSize: 11, color: 'var(--panel-text-tertiary)', lineHeight: 1.5 }}>
          Closed-form vertex/atom sets for catalysis-relevant nanocluster geometries.
        </p>
      </div>

      <div className="rounded-lg p-3" style={{ backgroundColor: 'var(--panel-elevated)', border: '1px solid var(--panel-border)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6, marginBottom: 10 }}>
          {GEOMETRIES.map((g) => (
            <button
              key={g.id}
              onClick={() => { setGeometry(g.id);  }}
              data-selected={geometry === g.id}
              className="zatom-choice zatom-pressable rounded-md px-2 py-1.5 text-[11px] font-medium"
            >
              {g.label}
            </button>
          ))}
        </div>

        <Row label="Element">
          <input
            type="text"
            value={element}
            onChange={(e) => setElement(e.target.value)}
            className="zatom-field w-16 rounded px-1.5 py-0.5 text-right text-[11px]"
          />
        </Row>

        {isShellBased ? (
          <Row label="Shells">
            <input
              type="number"
              min={1}
              max={6}
              value={shells}
              onChange={(e) => setShells(e.target.value)}
              className="zatom-field w-16 rounded px-1.5 py-0.5 text-right text-[11px] tabular-nums"
            />
          </Row>
        ) : (
          <Row label="Radius (Å)">
            <input
              type="number"
              step="0.5"
              min={2}
              max={40}
              value={radius}
              onChange={(e) => setRadius(e.target.value)}
              className="zatom-field w-16 rounded px-1.5 py-0.5 text-right text-[11px] tabular-nums"
            />
          </Row>
        )}

        <Row label="Bond len (Å)">
          <input
            type="text"
            placeholder="auto"
            value={bondLength}
            onChange={(e) => setBondLength(e.target.value)}
            className="zatom-field w-16 rounded px-1.5 py-0.5 text-right text-[11px] tabular-nums"
          />
        </Row>

        <Row label="Vacuum (Å)">
          <input
            type="number"
            step="1"
            min={5}
            max={30}
            value={vacuum}
            onChange={(e) => setVacuum(e.target.value)}
            className="zatom-field w-16 rounded px-1.5 py-0.5 text-right text-[11px] tabular-nums"
          />
        </Row>
      </div>

      <button
        onClick={handleBuild}
        className="zatom-primary zatom-pressable flex w-full items-center justify-center gap-1.5 rounded-lg py-2.5 text-[12px] font-medium"
      >
        <Sparkles className="w-3.5 h-3.5" />
        Build {element} {geometry}
      </button>

      {status && <StatusLine status={status} />}
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 mb-1.5">
      <span className="text-[10px]" style={{ color: 'var(--panel-text-tertiary)' }}>{label}</span>
      {children}
    </div>
  )
}
