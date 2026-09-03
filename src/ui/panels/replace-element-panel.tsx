import { useMemo, useState } from "react"
import { ChevronRight, Search } from "lucide-react"
import { getAllElementSymbols, getElement } from "../../lib/crystal/elements"

// Fast path: covers the overwhelming majority of substitutions in practice.
const QUICK_ELEMENTS = ['H', 'C', 'N', 'O', 'F', 'Si', 'P', 'S', 'Cl', 'Fe']

// Periodic table layout - row/period data for main group elements
const PERIODIC_TABLE_LAYOUT: { symbol: string; row: number; col: number }[] = [
  // Period 1
  { symbol: 'H', row: 1, col: 1 }, { symbol: 'He', row: 1, col: 18 },
  // Period 2
  { symbol: 'Li', row: 2, col: 1 }, { symbol: 'Be', row: 2, col: 2 },
  { symbol: 'B', row: 2, col: 13 }, { symbol: 'C', row: 2, col: 14 }, { symbol: 'N', row: 2, col: 15 }, { symbol: 'O', row: 2, col: 16 }, { symbol: 'F', row: 2, col: 17 }, { symbol: 'Ne', row: 2, col: 18 },
  // Period 3
  { symbol: 'Na', row: 3, col: 1 }, { symbol: 'Mg', row: 3, col: 2 },
  { symbol: 'Al', row: 3, col: 13 }, { symbol: 'Si', row: 3, col: 14 }, { symbol: 'P', row: 3, col: 15 }, { symbol: 'S', row: 3, col: 16 }, { symbol: 'Cl', row: 3, col: 17 }, { symbol: 'Ar', row: 3, col: 18 },
  // Period 4
  { symbol: 'K', row: 4, col: 1 }, { symbol: 'Ca', row: 4, col: 2 },
  { symbol: 'Sc', row: 4, col: 3 }, { symbol: 'Ti', row: 4, col: 4 }, { symbol: 'V', row: 4, col: 5 }, { symbol: 'Cr', row: 4, col: 6 }, { symbol: 'Mn', row: 4, col: 7 }, { symbol: 'Fe', row: 4, col: 8 }, { symbol: 'Co', row: 4, col: 9 }, { symbol: 'Ni', row: 4, col: 10 }, { symbol: 'Cu', row: 4, col: 11 }, { symbol: 'Zn', row: 4, col: 12 },
  { symbol: 'Ga', row: 4, col: 13 }, { symbol: 'Ge', row: 4, col: 14 }, { symbol: 'As', row: 4, col: 15 }, { symbol: 'Se', row: 4, col: 16 }, { symbol: 'Br', row: 4, col: 17 }, { symbol: 'Kr', row: 4, col: 18 },
  // Period 5
  { symbol: 'Rb', row: 5, col: 1 }, { symbol: 'Sr', row: 5, col: 2 },
  { symbol: 'Y', row: 5, col: 3 }, { symbol: 'Zr', row: 5, col: 4 }, { symbol: 'Nb', row: 5, col: 5 }, { symbol: 'Mo', row: 5, col: 6 }, { symbol: 'Tc', row: 5, col: 7 }, { symbol: 'Ru', row: 5, col: 8 }, { symbol: 'Rh', row: 5, col: 9 }, { symbol: 'Pd', row: 5, col: 10 }, { symbol: 'Ag', row: 5, col: 11 }, { symbol: 'Cd', row: 5, col: 12 },
  { symbol: 'In', row: 5, col: 13 }, { symbol: 'Sn', row: 5, col: 14 }, { symbol: 'Sb', row: 5, col: 15 }, { symbol: 'Te', row: 5, col: 16 }, { symbol: 'I', row: 5, col: 17 }, { symbol: 'Xe', row: 5, col: 18 },
  // Period 6
  { symbol: 'Cs', row: 6, col: 1 }, { symbol: 'Ba', row: 6, col: 2 },
  { symbol: 'La', row: 6, col: 3 }, { symbol: 'Hf', row: 6, col: 4 }, { symbol: 'Ta', row: 6, col: 5 }, { symbol: 'W', row: 6, col: 6 }, { symbol: 'Re', row: 6, col: 7 }, { symbol: 'Os', row: 6, col: 8 }, { symbol: 'Ir', row: 6, col: 9 }, { symbol: 'Pt', row: 6, col: 10 }, { symbol: 'Au', row: 6, col: 11 }, { symbol: 'Hg', row: 6, col: 12 },
  { symbol: 'Tl', row: 6, col: 13 }, { symbol: 'Pb', row: 6, col: 14 }, { symbol: 'Bi', row: 6, col: 15 }, { symbol: 'Po', row: 6, col: 16 }, { symbol: 'At', row: 6, col: 17 }, { symbol: 'Rn', row: 6, col: 18 },
  // Period 7
  { symbol: 'Fr', row: 7, col: 1 }, { symbol: 'Ra', row: 7, col: 2 },
  { symbol: 'Ac', row: 7, col: 3 }, { symbol: 'Rf', row: 7, col: 4 }, { symbol: 'Db', row: 7, col: 5 }, { symbol: 'Sg', row: 7, col: 6 }, { symbol: 'Bh', row: 7, col: 7 }, { symbol: 'Hs', row: 7, col: 8 }, { symbol: 'Mt', row: 7, col: 9 }, { symbol: 'Ds', row: 7, col: 10 }, { symbol: 'Rg', row: 7, col: 11 }, { symbol: 'Cn', row: 7, col: 12 },
  { symbol: 'Nh', row: 7, col: 13 }, { symbol: 'Fl', row: 7, col: 14 }, { symbol: 'Mc', row: 7, col: 15 }, { symbol: 'Lv', row: 7, col: 16 }, { symbol: 'Ts', row: 7, col: 17 }, { symbol: 'Og', row: 7, col: 18 },
  // Lanthanides (row 8)
  { symbol: 'Ce', row: 8, col: 4 }, { symbol: 'Pr', row: 8, col: 5 }, { symbol: 'Nd', row: 8, col: 6 }, { symbol: 'Pm', row: 8, col: 7 }, { symbol: 'Sm', row: 8, col: 8 }, { symbol: 'Eu', row: 8, col: 9 }, { symbol: 'Gd', row: 8, col: 10 }, { symbol: 'Tb', row: 8, col: 11 }, { symbol: 'Dy', row: 8, col: 12 }, { symbol: 'Ho', row: 8, col: 13 }, { symbol: 'Er', row: 8, col: 14 }, { symbol: 'Tm', row: 8, col: 15 }, { symbol: 'Yb', row: 8, col: 16 }, { symbol: 'Lu', row: 8, col: 17 },
  // Actinides (row 9)
  { symbol: 'Th', row: 9, col: 4 }, { symbol: 'Pa', row: 9, col: 5 }, { symbol: 'U', row: 9, col: 6 }, { symbol: 'Np', row: 9, col: 7 }, { symbol: 'Pu', row: 9, col: 8 }, { symbol: 'Am', row: 9, col: 9 }, { symbol: 'Cm', row: 9, col: 10 }, { symbol: 'Bk', row: 9, col: 11 }, { symbol: 'Cf', row: 9, col: 12 }, { symbol: 'Es', row: 9, col: 13 }, { symbol: 'Fm', row: 9, col: 14 }, { symbol: 'Md', row: 9, col: 15 }, { symbol: 'No', row: 9, col: 16 }, { symbol: 'Lr', row: 9, col: 17 },
]

/** Periodic-table fills encode s/p/d/f blocks; CPK colors remain atom identity cues. */
type Block = 's' | 'p' | 'd' | 'f'

function blockOf(row: number, col: number): Block {
  if (row >= 8) return 'f'
  if (col <= 2) return 's'
  if (col >= 13) return 'p'
  return 'd'
}

// Keep all four block shades perceptually distinct, including the lightest f block.
const BLOCK_FILL: Record<Block, string> = {
  s: 'color-mix(in oklab, var(--panel-text) 24%, transparent)',
  p: 'color-mix(in oklab, var(--panel-text) 16%, transparent)',
  d: 'color-mix(in oklab, var(--panel-text) 10%, transparent)',
  f: 'color-mix(in oklab, var(--panel-text) 5%, transparent)',
}

export function ReplaceElementPanel({
  onReplace,
  currentElements = [],
}: {
  onReplace: (element: string) => void
/** Elements currently present in the selection, outlined in the table. */
  currentElements?: string[]
}) {
  const [search, setSearch] = useState('')
  const [isExpanded, setIsExpanded] = useState(false)

  const current = useMemo(() => new Set(currentElements), [currentElements])

// Search filters the table in place instead of creating a separate result list.
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return null
    const hit = new Set<string>()
    for (const symbol of getAllElementSymbols()) {
      const el = getElement(symbol)
      if (symbol.toLowerCase().startsWith(q) || el.name.toLowerCase().includes(q)) {
        hit.add(symbol)
      }
    }
    return hit
  }, [search])

  const handleSelect = (symbol: string) => {
    onReplace(symbol)
    setSearch('')
    setIsExpanded(false)
  }

  return (
    <section
      className="rounded-xl border"
      style={{ background: 'var(--panel-bg)', borderColor: 'var(--panel-border)' }}
    >
      <button
        type="button"
        aria-expanded={isExpanded}
        className="zatom-pressable flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left"
        onClick={() => {
          setIsExpanded(!isExpanded)
        }}
      >
        <span
          className="text-[11px] font-medium uppercase tracking-[0.06em]"
          style={{ color: 'var(--panel-text-tertiary)' }}
        >
          Replace element
        </span>
        <ChevronRight
          className={`h-3.5 w-3.5 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
          style={{ color: 'var(--panel-text-tertiary)' }}
        />
      </button>

      {isExpanded && (
        <div className="flex flex-col gap-3 border-t px-3 pb-3 pt-3" style={{ borderColor: 'var(--panel-border)' }}>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2"
              style={{ color: 'var(--panel-text-tertiary)' }}
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter by name or symbol"
              aria-label="Filter elements"
              className="zatom-field w-full rounded-lg py-1.5 pl-8 pr-2.5 text-xs"
            />
          </div>

          <div className="flex flex-wrap gap-1">
            {QUICK_ELEMENTS.map((symbol) => {
              const el = getElement(symbol)
              const isCurrent = current.has(symbol)
              return (
                <button
                  key={symbol}
                  type="button"
                  data-selected={isCurrent}
                  onClick={() => handleSelect(symbol)}
                  className="zatom-choice zatom-pressable flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium"
                >
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: el.color }} />
                  {symbol}
                </button>
              )
            })}
          </div>

          <div
            className="grid gap-px"
            style={{
              gridTemplateColumns: 'repeat(18, minmax(15px, 1fr))',
              gridTemplateRows: 'repeat(9, auto)',
            }}
          >
            {PERIODIC_TABLE_LAYOUT.map(({ symbol, row, col }) => {
              const el = getElement(symbol)
              if (!el) return null
              const isCurrent = current.has(symbol)
              const dimmed = matches !== null && !matches.has(symbol)
              return (
                <button
                  key={symbol}
                  type="button"
                  onClick={() => handleSelect(symbol)}
                  tabIndex={dimmed ? -1 : 0}
                  aria-hidden={dimmed}
                  title={`${el.name} · ${el.atomicNumber}`}
                  className="zatom-pressable flex aspect-square items-center justify-center rounded-[3px] text-[9px] font-semibold tabular-nums"
                  style={{
                    gridRow: row,
                    gridColumn: col,
                    background: isCurrent ? 'var(--panel-accent-bg)' : BLOCK_FILL[blockOf(row, col)],
                    color: isCurrent ? 'var(--panel-accent)' : 'var(--panel-text)',
                    boxShadow: isCurrent ? 'inset 0 0 0 1px var(--panel-accent)' : undefined,
                    opacity: dimmed ? 0.2 : 1,
                    pointerEvents: dimmed ? 'none' : undefined,
                  }}
                >
                  {symbol}
                </button>
              )
            })}
          </div>

          {matches !== null && matches.size === 0 && (
            <p className="text-[11px]" style={{ color: 'var(--panel-text-tertiary)' }}>
              No element matches “{search.trim()}”.
            </p>
          )}
        </div>
      )}
    </section>
  )
}
