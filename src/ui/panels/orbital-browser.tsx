import { useMemo, useState } from 'react'
import type { MoldenData } from '../../lib/molecular-orbitals/MoldenParser'
import { getHomoIndex, getLumoIndex } from '../../lib/molecular-orbitals/state'

const HARTREE_TO_EV = 27.211386245988
/** Rows shown either side of the HOMO/LUMO pair before "Show all". */
const WINDOW = 6

/** Energy-sorted Molden orbitals labeled relative to HOMO/LUMO and displayed in eV. */
export function OrbitalBrowser({
  data,
  selectedIndex,
  onSelect,
}: {
  data: MoldenData
  selectedIndex: number
  onSelect: (index: number) => void
}) {
  const [showAll, setShowAll] = useState(false)
  const homo = getHomoIndex(data)
  const lumo = getLumoIndex(data)
  const total = data.orbitals.length

  const gapEv = useMemo(() => {
    if (homo < 0 || lumo < 0) return null
    return (data.orbitals[lumo].energy - data.orbitals[homo].energy) * HARTREE_TO_EV
  }, [data, homo, lumo])

  const [from, to] = useMemo(() => {
    if (showAll || homo < 0) return [0, total]
    return [Math.max(0, homo - WINDOW + 1), Math.min(total, homo + WINDOW + 1)]
  }, [showAll, homo, total])

  const relLabel = (i: number) => {
    if (i === homo) return 'HOMO'
    if (i === lumo) return 'LUMO'
    if (homo >= 0 && i < homo) return `HOMO−${homo - i}`
    if (lumo >= 0 && i > lumo) return `LUMO+${i - lumo}`
    return ''
  }

  return (
    <div className="space-y-1.5" role="group" aria-label="Molecular orbitals">
      <div className="flex items-baseline justify-between">
        <span className="text-[12px]" style={{ color: 'var(--panel-text)' }}>Orbitals</span>
        <span className="font-mono text-[10px]" style={{ color: 'var(--panel-text-secondary)' }}>
          {total} MOs{gapEv !== null ? ` · gap ${gapEv.toFixed(2)} eV` : ''}
        </span>
      </div>

      <ul
        className="max-h-56 overflow-y-auto rounded-xl"
        style={{ background: 'var(--panel-elevated)', border: '1px solid var(--panel-border)' }}
        aria-label="Orbital list"
      >
        {from > 0 && <MoreRow count={from} onClick={() => setShowAll(true)} />}
        {data.orbitals.slice(from, to).map((orb, k) => {
          const i = from + k
          const selected = i === selectedIndex
          const frontier = i === homo || i === lumo
          const occupied = (orb.occupation ?? 0) > 0.0001
          const rel = relLabel(i)
          return (
            <li key={i}>
              <button
                type="button"
                onClick={() => { onSelect(i);  }}
                aria-current={selected ? 'true' : undefined}
                className="zatom-pressable grid w-full grid-cols-[2.25rem_1fr_auto_2.5rem] items-center gap-2 px-2 py-1 text-left font-mono text-[11px]"
                style={{
                  background: selected ? 'var(--panel-accent-bg)' : 'transparent',
                  color: selected ? 'var(--panel-accent)' : 'var(--panel-text)',
                  borderLeft: `2px solid ${frontier ? 'var(--panel-accent)' : 'transparent'}`,
                }}
                title={`${orb.symmetry || 'MO'} · ${orb.spin || ''} · ${orb.energy.toFixed(6)} Eh`}
              >
                <span style={{ color: 'var(--panel-text-secondary)' }}>{i + 1}</span>
                <span className="truncate" style={{ fontWeight: frontier ? 600 : 400 }}>
                  {rel || orb.symmetry || 'MO'}
                </span>
                <span>{(orb.energy * HARTREE_TO_EV).toFixed(2)} eV</span>
                <span
                  className="justify-self-end rounded px-1 text-[10px]"
                  style={{
                    background: occupied ? 'var(--panel-accent-bg)' : 'transparent',
                    color: occupied ? 'var(--panel-accent)' : 'var(--panel-text-secondary)',
                    border: occupied ? 'none' : '1px solid var(--panel-border)',
                  }}
                  aria-label={`occupation ${orb.occupation}`}
                >
                  {formatOcc(orb.occupation)}
                </span>
              </button>
            </li>
          )
        })}
        {to < total && <MoreRow count={total - to} onClick={() => setShowAll(true)} />}
      </ul>

      {showAll && total > 2 * WINDOW && (
        <button
          type="button"
          onClick={() => setShowAll(false)}
          className="zatom-pressable text-[10px] underline-offset-2 hover:underline"
          style={{ color: 'var(--panel-text-secondary)' }}
        >
          Back to frontier window
        </button>
      )}
    </div>
  )
}

function MoreRow({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="zatom-pressable w-full px-2 py-1 text-center text-[10px]"
        style={{ color: 'var(--panel-text-secondary)' }}
      >
        … {count} more
      </button>
    </li>
  )
}

function formatOcc(occ: number) {
  if (!Number.isFinite(occ)) return '–'
  if (Math.abs(occ - Math.round(occ)) < 1e-4) return String(Math.round(occ))
  return occ.toFixed(2)
}
