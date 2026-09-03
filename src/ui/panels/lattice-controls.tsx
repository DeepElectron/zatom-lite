import { useEffect, useState } from "react"
import type { CrystalSystem } from "../../lib/crystal/types"
import { useActiveCrystalStore as useCrystalStore } from "../../orchestration/ViewportContext"

const CRYSTAL_SYSTEMS: Record<CrystalSystem, { name: string; constraints: string }> = {
  cubic: { name: "Cubic", constraints: "a=b=c, α=β=γ=90°" },
  tetragonal: { name: "Tetragonal", constraints: "a=b≠c, α=β=γ=90°" },
  orthorhombic: { name: "Orthorhombic", constraints: "a≠b≠c, α=β=γ=90°" },
  hexagonal: { name: "Hexagonal", constraints: "a=b≠c, α=β=90°, γ=120°" },
  trigonal: { name: "Trigonal", constraints: "a=b=c, α=β=γ≠90°" },
  monoclinic: { name: "Monoclinic", constraints: "a≠b≠c, α=γ=90°, β≠90°" },
  triclinic: { name: "Triclinic", constraints: "a≠b≠c, α≠β≠γ" },
  custom: { name: "Custom", constraints: "Free — set all 6 parameters" },
}

function LatticeNumberField({
  label,
  value,
  step,
  disabled = false,
  min,
  max,
  onCommit,
}: {
  label: string
  value: number
  step: number
  disabled?: boolean
  min: number
  max?: number
  onCommit: (value: number) => boolean
}) {
  const [draft, setDraft] = useState(String(value))
  const [invalid, setInvalid] = useState(false)

  useEffect(() => {
    setDraft(String(value))
    setInvalid(false)
  }, [value])

  const commit = () => {
    const parsed = Number(draft)
    const inRange = Number.isFinite(parsed) && parsed >= min && (max === undefined || parsed <= max)
    if (!inRange || !onCommit(parsed)) {
      setDraft(String(value))
      setInvalid(true)
      return
    }
    setDraft(String(parsed))
    setInvalid(false)
  }

  return (
    <div>
      <label className="text-[10px] text-[var(--text-tertiary)] mb-1 block">{label}</label>
      <input
        type="number"
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value)
          setInvalid(false)
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') {
            setDraft(String(value))
            setInvalid(false)
            event.currentTarget.blur()
          }
        }}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        aria-invalid={invalid}
        title={invalid ? 'Enter a physically valid unit-cell value.' : undefined}
        className="zatom-field w-full rounded px-2 py-1.5 text-sm tabular-nums"
      />
      {invalid && <p role="alert" className="status-red mt-1 text-[9px] leading-tight">Invalid cell value</p>}
    </div>
  )
}

export function LatticeControls() {
  const crystalSystem = useCrystalStore((s) => s.crystalSystem)
  const latticeParams = useCrystalStore((s) => s.latticeParams)
  const setCrystalSystem = useCrystalStore((s) => s.setCrystalSystem)
  const setLatticeParams = useCrystalStore((s) => s.setLatticeParams)
  const cellResizeMode = useCrystalStore((s) => s.cellResizeMode)
  const setCellResizeMode = useCrystalStore((s) => s.setCellResizeMode)
  const cellResizeScaleContents = useCrystalStore((s) => s.cellResizeScaleContents)
  const setCellResizeScaleContents = useCrystalStore((s) => s.setCellResizeScaleContents)

  const isCustom = crystalSystem === 'custom'

  return (
    <div className="space-y-4">
      {/* Interactive 3D resize */}
      <div
        className="rounded-lg p-2.5"
        style={{
          background: cellResizeMode ? "rgba(48, 209, 88, 0.12)" : "var(--glass-bg-subtle)",
          border: cellResizeMode ? "1px solid rgba(48, 209, 88, 0.4)" : "1px solid var(--glass-border-subtle)",
        }}
      >
        <button
          onClick={() => setCellResizeMode(!cellResizeMode)}
          aria-pressed={cellResizeMode}
          data-selected={cellResizeMode}
          className="zatom-choice zatom-pressable w-full rounded-lg py-1.5 text-xs font-medium"
        >
          {cellResizeMode ? "Resize in 3D — On" : "Resize in 3D"}
        </button>
        <p className="text-[10px] text-[var(--text-tertiary)] mt-1.5">
          Drag the colored handles on the cell box to change a / b / c.
        </p>
        {cellResizeMode && (
          <label className="flex items-center justify-between mt-2 cursor-pointer">
            <span className="text-[11px] text-[var(--text-secondary)]">Scale contents</span>
            <input
              type="checkbox"
              checked={cellResizeScaleContents}
              onChange={(e) => setCellResizeScaleContents(e.target.checked)}
              className="accent-[#30D158]"
            />
          </label>
        )}
        {cellResizeMode && (
          <p className="text-[10px] text-[var(--text-tertiary)] mt-1">
            {cellResizeScaleContents
              ? "Atoms keep fractional coords (scale with the cell)."
              : "Atoms stay fixed; only the box grows/shrinks."}
          </p>
        )}
      </div>

      {/* Crystal System Selector */}
      <div>
        <label className="text-xs text-[var(--text-secondary)] mb-1.5 block">
          Crystal System
        </label>
        <select
          value={crystalSystem}
          onChange={(e) => setCrystalSystem(e.target.value as CrystalSystem)}
          className="zatom-field w-full rounded-lg px-3 py-2 text-sm"
        >
          {Object.entries(CRYSTAL_SYSTEMS).map(([key, info]) => (
            <option key={key} value={key}>
              {info.name}
            </option>
          ))}
        </select>
        <div className="text-[10px] text-[var(--text-tertiary)] mt-1">
          {CRYSTAL_SYSTEMS[crystalSystem].constraints}
        </div>
      </div>

      {/* Lattice Parameters */}
      <div className="grid grid-cols-3 gap-2">
        <LatticeNumberField label="a (Å)" value={latticeParams.a} step={0.1} min={0.001} onCommit={(a) => setLatticeParams({ a })} />
        <LatticeNumberField label="b (Å)" value={latticeParams.b} step={0.1} min={0.001} disabled={crystalSystem === 'cubic' || crystalSystem === 'tetragonal' || crystalSystem === 'hexagonal'} onCommit={(b) => setLatticeParams({ b })} />
        <LatticeNumberField label="c (Å)" value={latticeParams.c} step={0.1} min={0.001} disabled={crystalSystem === 'cubic' || crystalSystem === 'trigonal'} onCommit={(c) => setLatticeParams({ c })} />
      </div>

      <div className="grid grid-cols-3 gap-2">
        <LatticeNumberField label="α (°)" value={latticeParams.alpha} step={1} min={0.001} max={179.999} disabled={!isCustom && crystalSystem !== 'triclinic' && crystalSystem !== 'trigonal'} onCommit={(alpha) => setLatticeParams({ alpha })} />
        <LatticeNumberField label="β (°)" value={latticeParams.beta} step={1} min={0.001} max={179.999} disabled={!isCustom && crystalSystem !== 'triclinic' && crystalSystem !== 'monoclinic'} onCommit={(beta) => setLatticeParams({ beta })} />
        <LatticeNumberField label="γ (°)" value={latticeParams.gamma} step={1} min={0.001} max={179.999} disabled={!isCustom && crystalSystem !== 'triclinic' && crystalSystem !== 'hexagonal'} onCommit={(gamma) => setLatticeParams({ gamma })} />
      </div>
    </div>
  )
}
