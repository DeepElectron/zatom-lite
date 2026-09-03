import { useEffect, useMemo, useState } from "react"
import { Trash2, X } from "lucide-react"
import { useActiveCrystalStore as useCrystalStore } from "../../orchestration/ViewportContext"
import { ELEMENTS, getElement } from "../../lib/crystal/elements"
import { BOND_LENGTHS, DEFAULT_BOND_TOLERANCE } from "../../lib/crystal/bonds"
import { SectionLabel, SliderRow, ToggleRow } from "./panel-ui"

/**
 * Bond rules page.
 *
 * Presentation follows the Tools page: flat label/control rows grouped by a
 * hairline rule plus an uppercase label, no card containers. Boxes are for
 * transient state (an armed manual bond), never for grouping — six equally
 * weighted cards read as a form, not as controls.
 *
 * Layout follows scope, widest first: criterion (all pairs) -> periodicity
 * (whole structure) -> pair overrides (one pair). Read-only material sits
 * behind one disclosure so it cannot crowd the controls.
 */

function normalizeElementSymbol(value: string): string {
  const trimmed = value.trim()
  return trimmed ? `${trimmed[0].toUpperCase()}${trimmed.slice(1).toLowerCase()}` : ''
}

/** Hairline group separator, matching the Tools page. */
function Rule() {
  return <div className="h-px" style={{ background: 'var(--panel-border)' }} aria-hidden />
}

/**
 * SliderRow that commits on release instead of on every frame.
 *
 * Bond detection is O(n^2) over atoms, so committing each drag frame stalls
 * large cells. The draft drives the readout while dragging; pointer release,
 * arrow keyUp, and blur are the commit points.
 */
function DeferredSliderRow({
  label,
  value,
  min,
  max,
  step,
  display,
  onCommit,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  display: (v: number) => string
  onCommit: (v: number) => void
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])

  const commit = () => {
    if (Math.abs(draft - value) > 1e-9) onCommit(draft)
  }

  return (
    <div
      onPointerUp={commit}
      onBlur={commit}
      onKeyUp={(e) => {
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) commit()
      }}
    >
      <SliderRow
        label={label}
        value={draft}
        min={min}
        max={max}
        step={step}
        display={display(draft)}
        onChange={setDraft}
      />
    </div>
  )
}

export function BondSettings() {
  const bondSettings = useCrystalStore((s) => s.bondSettings)
  const setBondDefaultRadius = useCrystalStore((s) => s.setBondDefaultRadius)
  const setBondTolerance = useCrystalStore((s) => s.setBondTolerance)
  const setPeriodicBonds = useCrystalStore((s) => s.setPeriodicBonds)
  const setElementPairRadius = useCrystalStore((s) => s.setElementPairRadius)
  const removeElementPairRadius = useCrystalStore((s) => s.removeElementPairRadius)
  const setRestrictToConfiguredPairs = useCrystalStore((s) => s.setRestrictToConfiguredPairs)
  const pendingBondAtomId = useCrystalStore((s) => s.pendingBondAtomId)
  const setPendingBondAtom = useCrystalStore((s) => s.setPendingBondAtom)
  const atoms = useCrystalStore((s) => s.atoms)
  const periodic = useCrystalStore((s) => s.periodic)
  const bonds = useCrystalStore((s) => s.bonds)

  const [newPair, setNewPair] = useState({ e1: 'Cu', e2: 'O', radius: '2.5' })
  const [pairError, setPairError] = useState<string | null>(null)
  const [detail, setDetail] = useState<'none' | 'resolved' | 'reference'>('none')

  const addElementPair = () => {
    const e1 = normalizeElementSymbol(newPair.e1)
    const e2 = normalizeElementSymbol(newPair.e2)
    const radius = Number(newPair.radius)
    if (!ELEMENTS[e1] || !ELEMENTS[e2]) {
      setPairError('Enter two valid element symbols.')
      return
    }
    if (!Number.isFinite(radius) || radius < 0.5 || radius > 8) {
      setPairError('Distance must be between 0.5 and 8 Å.')
      return
    }
    setPairError(null)
    setNewPair({ e1, e2, radius: String(radius) })
    setElementPairRadius(e1, e2, radius)
  }

  const pendingAtom = pendingBondAtomId ? atoms.find(a => a.id === pendingBondAtomId) : null
  const overrides: [string, number][] = Object.entries(bondSettings.elementPairRadii)

  /**
   * Pairs present in this structure, with the limit that resolves for each.
   * Answers "why are these two atoms not bonded" — always a comparison
   * against one number.
   */
  const activeCriteria = useMemo(() => {
    const present = [...new Set(atoms.map(a => a.element))].sort()
    const rows: { pair: string; limit: number; source: 'override' | 'auto'; capped: boolean }[] = []
    for (let i = 0; i < present.length; i++) {
      for (let j = i; j < present.length; j++) {
        const key = [present[i], present[j]].sort().join('-')
        const override = bondSettings.elementPairRadii[key]
        if (override !== undefined) {
          rows.push({ pair: key, limit: override, source: 'override', capped: false })
          continue
        }
        if (bondSettings.restrictToConfiguredPairs) continue
        const auto = getElement(present[i]).radius + getElement(present[j]).radius + bondSettings.tolerance
        rows.push({
          pair: key,
          limit: Math.min(auto, bondSettings.defaultRadius),
          source: 'auto',
          capped: auto > bondSettings.defaultRadius,
        })
      }
    }
    return rows
  }, [atoms, bondSettings.elementPairRadii, bondSettings.restrictToConfiguredPairs, bondSettings.tolerance, bondSettings.defaultRadius])

  const crossBoundaryCount = useMemo(
    () => bonds.filter(b => b.latticeOffset?.some(v => v !== 0)).length,
    [bonds],
  )

  const referenceRows = useMemo(() => Object.entries(BOND_LENGTHS), [])
  const toleranceChanged = Math.abs(bondSettings.tolerance - DEFAULT_BOND_TOLERANCE) > 1e-9

  return (
    <div className="flex flex-col gap-4">
      {/* Manual bonding is a transient mode, not a rule: one line of hint text,
          and a tinted row only while it is actually armed. */}
      {pendingAtom ? (
        <div
          className="flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5"
          style={{ background: 'var(--panel-accent-bg)', border: '1px solid var(--panel-accent-border)' }}
        >
          <span className="text-[12px] text-[var(--panel-text-secondary)]">
            First atom <span className="font-mono text-[var(--panel-text)]">{pendingAtom.element}</span> — click a second
          </span>
          <button
            onClick={() => setPendingBondAtom(null)}
            aria-label="Cancel pending bond"
            className="zatom-pressable rounded p-1 text-[var(--panel-text-tertiary)]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <p className="text-[11px] leading-relaxed text-[var(--panel-text-tertiary)]">
          Click two atoms to bond them directly, bypassing the rules below.
        </p>
      )}

      <Rule />

      {/* Criterion — applies to every pair. */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <SectionLabel>Detection criterion</SectionLabel>
          <span className="font-mono text-[10px] tabular-nums text-[var(--panel-text-tertiary)]">
            d &lt; r1 + r2 + {bondSettings.tolerance.toFixed(2)} Å, max {bondSettings.defaultRadius.toFixed(1)} Å
          </span>
        </div>
        <DeferredSliderRow
          label="Covalent tolerance"
          value={bondSettings.tolerance}
          min={0}
          max={1.2}
          step={0.05}
          display={(v) => v.toFixed(2)}
          onCommit={setBondTolerance}
        />
        <p className="-mt-1 text-[10px] text-[var(--panel-text-tertiary)]">
          {toleranceChanged
            ? `Raise to catch stretched bonds. Default ${DEFAULT_BOND_TOLERANCE.toFixed(2)} Å.`
            : 'Raise to catch stretched bonds, lower to drop spurious contacts.'}
        </p>
        <DeferredSliderRow
          label="Hard distance limit"
          value={bondSettings.defaultRadius}
          min={1.5}
          max={5}
          step={0.1}
          display={(v) => v.toFixed(1)}
          onCommit={setBondDefaultRadius}
        />
        <p className="-mt-1 text-[10px] text-[var(--panel-text-tertiary)]">
          No pair bonds beyond this distance, whatever the tolerance allows.
        </p>
      </div>

      <Rule />

      {/* Periodicity — applies to the whole structure. */}
      <div className={periodic ? undefined : 'pointer-events-none opacity-40'}>
        <ToggleRow
          label="Bond across cell boundaries"
          description={
            !periodic
              ? 'No lattice in this structure.'
              : bondSettings.periodicBonds
                ? `${crossBoundaryCount} of ${bonds.length} bonds cross a boundary`
                : 'Off — coordination is under-counted at cell faces'
          }
          checked={bondSettings.periodicBonds}
          onChange={setPeriodicBonds}
        />
      </div>

      <Rule />

      {/* Pair overrides — one pair at a time, wins over the criterion. */}
      <div className="flex flex-col gap-3">
        <SectionLabel>Pair overrides</SectionLabel>
        <ToggleRow
          label="Listed pairs only"
          description={
            bondSettings.restrictToConfiguredPairs
              ? 'Unlisted pairs never bond'
              : 'Unlisted pairs still follow the criterion'
          }
          checked={bondSettings.restrictToConfiguredPairs}
          onChange={setRestrictToConfiguredPairs}
        />

        {overrides.length > 0 && (
          <div className="flex flex-col">
            {overrides.map(([pair, radius]) => (
              <div
                key={pair}
                className="flex items-center justify-between border-b py-1.5 last:border-b-0"
                style={{ borderColor: 'var(--panel-border)' }}
              >
                <span className="font-mono text-[12px] text-[var(--panel-text)]">{pair}</span>
                <div className="flex items-center gap-2">
                  <span className="text-[12px] tabular-nums text-[var(--panel-text-secondary)]">{radius} Å</span>
                  <button
                    onClick={() => {
                      const [e1, e2] = pair.split('-')
                      removeElementPairRadius(e1, e2)
                    }}
                    aria-label={`Remove ${pair} distance override`}
                    className="status-red status-hover-red rounded p-1"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-1.5">
          <input
            type="text"
            value={newPair.e1}
            onChange={(e) => setNewPair(p => ({ ...p, e1: e.target.value }))}
            placeholder="Cu"
            aria-label="First element"
            className="zatom-field w-11 rounded-lg px-2 py-1.5 text-center text-[12px]"
          />
          <span className="self-center text-[var(--panel-text-tertiary)]">–</span>
          <input
            type="text"
            value={newPair.e2}
            onChange={(e) => setNewPair(p => ({ ...p, e2: e.target.value }))}
            placeholder="O"
            aria-label="Second element"
            className="zatom-field w-11 rounded-lg px-2 py-1.5 text-center text-[12px]"
          />
          <input
            type="number"
            value={newPair.radius}
            onChange={(e) => setNewPair(p => ({ ...p, radius: e.target.value }))}
            step="0.1"
            min="0.5"
            max="8"
            aria-label="Maximum distance in angstrom"
            className="zatom-field w-14 rounded-lg px-2 py-1.5 text-[12px]"
          />
          <button
            onClick={addElementPair}
            className="zatom-primary zatom-pressable flex-1 rounded-lg px-3 py-1.5 text-[12px] font-medium"
          >
            Add
          </button>
        </div>
        {pairError && (
          <p role="alert" className="text-[11px] text-[var(--status-red)]">{pairError}</p>
        )}
      </div>

      <Rule />

      {/* Read-only reference behind one disclosure. */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <SectionLabel>Reference</SectionLabel>
          <div className="flex gap-3">
            <button
              onClick={() => setDetail(d => (d === 'resolved' ? 'none' : 'resolved'))}
              aria-pressed={detail === 'resolved'}
              className={`text-[11px] underline-offset-2 hover:underline ${
                detail === 'resolved' ? 'text-[var(--panel-text)]' : 'text-[var(--panel-text-tertiary)]'
              }`}
            >
              This structure
            </button>
            <button
              onClick={() => setDetail(d => (d === 'reference' ? 'none' : 'reference'))}
              aria-pressed={detail === 'reference'}
              className={`text-[11px] underline-offset-2 hover:underline ${
                detail === 'reference' ? 'text-[var(--panel-text)]' : 'text-[var(--panel-text-tertiary)]'
              }`}
            >
              CRC lengths
            </button>
          </div>
        </div>

        {detail === 'resolved' && (
          activeCriteria.length > 0 ? (
            <div className="flex max-h-52 flex-col gap-0.5 overflow-y-auto">
              {activeCriteria.map(row => (
                <div key={row.pair} className="flex items-baseline justify-between gap-2 text-[12px]">
                  <span className="font-mono text-[var(--panel-text-secondary)]">{row.pair}</span>
                  <span className="flex items-baseline gap-1.5">
                    <span className="text-[10px] text-[var(--panel-text-tertiary)]">
                      {row.source === 'override' ? 'override' : row.capped ? 'capped' : ''}
                    </span>
                    <span className="tabular-nums text-[var(--panel-text)]">{row.limit.toFixed(2)} Å</span>
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <span className="text-[10px] text-[var(--panel-text-tertiary)]">No atoms loaded.</span>
          )
        )}

        {detail === 'reference' && (
          <div className="flex flex-col gap-1">
            <span className="text-[10px] leading-relaxed text-[var(--panel-text-tertiary)]">
              Single/double/triple order is labelled from these values. They never decide whether a bond exists.
            </span>
            <div className="flex max-h-52 flex-col gap-0.5 overflow-y-auto">
              {referenceRows.map(([pair, data]) => (
                <div key={pair} className="flex items-baseline justify-between gap-2 text-[12px]">
                  <span className="font-mono text-[var(--panel-text-secondary)]">{pair}</span>
                  <span className="flex gap-3 tabular-nums">
                    <span className="w-9 text-right text-[var(--panel-text)]">{data.single.toFixed(2)}</span>
                    <span className="w-9 text-right text-[var(--panel-text-tertiary)]">
                      {data.double ? data.double.toFixed(2) : '—'}
                    </span>
                    <span className="w-9 text-right text-[var(--panel-text-tertiary)]">
                      {data.triple ? data.triple.toFixed(2) : '—'}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
