import { useEffect, useState } from "react"
import { useActiveCrystalStore as useCrystalStore } from "../../orchestration/ViewportContext"

function SupercellAxisInput({
  axis,
  value,
  onCommit,
}: {
  axis: 'nx' | 'ny' | 'nz'
  value: number
  onCommit: (value: number) => void
}) {
  const [draft, setDraft] = useState(String(value))

  useEffect(() => setDraft(String(value)), [value])

  const commit = () => {
    const parsed = Number(draft)
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
      setDraft(String(value))
      return
    }
    onCommit(parsed)
    setDraft(String(parsed))
  }

  return (
    <div>
      <label className="mb-1 block text-[10px] text-[var(--text-tertiary)]">{axis}</label>
      <input
        type="number"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') {
            setDraft(String(value))
            event.currentTarget.blur()
          }
        }}
        min={1}
        max={100}
        step={1}
        className="zatom-field w-full rounded px-2 py-1.5 text-sm tabular-nums"
      />
    </div>
  )
}

export function SupercellControls() {
  const supercellParams = useCrystalStore((state) => state.supercellParams)
  const setSupercellParams = useCrystalStore((state) => state.setSupercellParams)
  const supercellMode = useCrystalStore((state) => state.supercellMode)
  const setSupercellMode = useCrystalStore((state) => state.setSupercellMode)

  const setMode = (mode: 'normal' | 'fork') => {
    setSupercellMode(mode)
  }

  const doubleAxis = (axis: 'nx' | 'ny' | 'nz') => {
    setSupercellParams({ [axis]: supercellParams[axis] * 2 })
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="mb-2 block text-xs text-[var(--text-secondary)]">Expansion Mode</label>
        <div className="flex gap-2" role="group" aria-label="Expansion mode">
          <button
            type="button"
            aria-pressed={supercellMode === 'normal'}
            data-selected={supercellMode === 'normal'}
            onClick={() => setMode('normal')}
            className="zatom-choice zatom-pressable flex-1 rounded px-3 py-1.5 text-xs font-medium"
          >
            Normal
          </button>
          <button
            type="button"
            aria-pressed={supercellMode === 'fork'}
            data-selected={supercellMode === 'fork'}
            onClick={() => setMode('fork')}
            className="zatom-choice zatom-pressable flex-1 rounded px-3 py-1.5 text-xs font-medium"
          >
            Fork
          </button>
        </div>
        <p className="mt-1 text-[10px] text-[var(--text-tertiary)]">
          {supercellMode === 'normal'
            ? 'Add unit cells while preserving edits'
            : 'Duplicate the edited structure along one axis'}
        </p>
      </div>

      <div>
        <label className="mb-2 block text-xs text-[var(--text-secondary)]">
          {supercellMode === 'fork' ? 'Double an axis' : 'Supercell Dimensions'}
        </label>

        {supercellMode === 'fork' ? (
          <div className="grid grid-cols-3 gap-2">
            {(['nx', 'ny', 'nz'] as const).map((axis) => (
              <button
                key={axis}
                type="button"
                onClick={() => doubleAxis(axis)}
                className="zatom-choice zatom-pressable rounded px-2 py-2 text-xs font-medium tabular-nums"
              >
                {axis.slice(1).toUpperCase()}: {supercellParams[axis]} → {supercellParams[axis] * 2}
              </button>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {(['nx', 'ny', 'nz'] as const).map((axis) => (
              <SupercellAxisInput
                key={axis}
                axis={axis}
                value={supercellParams[axis]}
                onCommit={(value) => setSupercellParams({ [axis]: value })}
              />
            ))}
          </div>
        )}

        {supercellMode === 'fork' && (
          <p className="mt-2 text-center text-[10px] text-[var(--text-tertiary)] tabular-nums">
            Current: {supercellParams.nx} × {supercellParams.ny} × {supercellParams.nz}
          </p>
        )}
      </div>
    </div>
  )
}
