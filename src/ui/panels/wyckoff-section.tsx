/**
 * Wyckoff table from backend site arrays, with local table and orbit-grouping
 * fallbacks. Selecting a row selects and focuses its complete equivalent site.
 */

import { useState } from 'react'
import { Loader2, Sparkles, Focus } from 'lucide-react'
import { useActiveCrystalStore as useCrystalStore } from '../../orchestration/ViewportContext'
import { getGlobalBackendClient } from '../../host'
import { getElement } from '../../lib/crystal/elements'
import { assignWyckoffPositions, groupAtomsByOrbit } from '../../lib/symmetry'
import type { WyckoffAnalysis, WyckoffAssignment } from '../../lib/symmetry'
import type { Atom, LatticeVectors } from '../../lib/crystal/types'

/** Convert store atom to a fractional triplet. */
function atomFrac(atom: Atom): [number, number, number] {
  return atom.position ?? [0, 0, 0]
}

/** Build assignments from spglib per-atom orbit, letter, and site-symmetry arrays. */
function buildAssignmentsFromBackend(
  atoms: Atom[],
  wyckoffs: string[],
  equivalentAtoms: number[],
  siteSymmetrySymbols: string[],
): Pick<WyckoffAnalysis, 'assignments' | 'unclassified'> {
  const byRep = new Map<number, number[]>()
  for (let i = 0; i < atoms.length; i++) {
    const rep = equivalentAtoms[i]
    if (!byRep.has(rep)) byRep.set(rep, [])
    byRep.get(rep)!.push(i)
  }
  const assignments: WyckoffAssignment[] = []
  for (const [rep, indices] of byRep) {
    const repAtom = atoms[rep]
    const repFrac = atomFrac(repAtom)
    const letter = wyckoffs[rep] ?? '?'
    const siteSym = siteSymmetrySymbols[rep] ?? '?'
    assignments.push({
      atomIndices: indices,
      element: repAtom.element,
    // The table reads only site symmetry, multiplicity, letter, and representative.
      site: {
        multiplicity: indices.length,
        letter,
        siteSymmetry: siteSym,
        representative: repFrac as [number, number, number],
      },
      label: `${indices.length}${letter}`,
      representative: repFrac,
    })
  }
  // Sort by multiplicity ascending (a → b → ...), matching ITA convention.
  assignments.sort((a, b) => a.atomIndices.length - b.atomIndices.length || a.label.localeCompare(b.label))
  return { assignments, unclassified: [] }
}

export function WyckoffSection() {
  const atoms = useCrystalStore((s) => s.atoms) as Atom[]
  const latticeVectors = useCrystalStore((s) => s.latticeVectors) as LatticeVectors | null
  const setSymmetryAnalysis = useCrystalStore((s) => s.setSymmetryAnalysis)
  const selectAtoms = useCrystalStore((s) => s.selectAtoms)
  const focusOnAtoms = useCrystalStore((s) => s.focusOnAtoms)
  const [busy, setBusy] = useState(false)
  // Rendering needs only assignments and unclassified atoms, so fallback results use a narrow shape.
  // Avoid fabricating a complete SpaceGroupWyckoff value.
  // The backend path can still store the full WyckoffAnalysis result.
  const [result, setResult] = useState<Pick<WyckoffAnalysis, 'assignments' | 'unclassified'> | null>(null)
  const [sgInfo, setSgInfo] = useState<{ symbol: string; number: number } | null>(null)
  const [fallbackNotice, setFallbackNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activeAssignmentIdx, setActiveAssignmentIdx] = useState<number | null>(null)

  const run = async () => {
    setBusy(true)
    setError(null)
    setFallbackNotice(null)
    setActiveAssignmentIdx(null)
    try {
      const client = getGlobalBackendClient()
      if (!client) throw new Error('Backend client not bound (app not bootstrapped yet)')
      if (!latticeVectors) throw new Error('No lattice — symmetry analysis requires a periodic system')
      const symmetry = await client.analyzeSymmetry({
        atoms: atoms.map((a) => {
          const [fx, fy, fz] = atomFrac(a)
          return { element: getElement(a.element).atomicNumber, x: fx, y: fy, z: fz }
        }),
        latticeMatrix: [latticeVectors.a, latticeVectors.b, latticeVectors.c],
      })
      setSymmetryAnalysis(symmetry)
      setSgInfo({ symbol: symmetry.spaceGroup.internationalSymbol, number: symmetry.spaceGroup.number })

      // Prefer backend wyckoff, equivalent-atom, and site-symmetry arrays.
      // Use them only when their lengths match the atom count.
      const wyk = symmetry.wyckoffs
      const equiv = symmetry.equivalentAtoms
      const siteSyms = symmetry.siteSymmetrySymbols
      if (
        wyk && equiv && siteSyms
        && wyk.length === atoms.length
        && equiv.length === atoms.length
        && siteSyms.length === atoms.length
      ) {
        setResult(buildAssignmentsFromBackend(atoms, wyk, equiv, siteSyms))
        return
      }

      // Fall back to local orbit matching and the Wyckoff table for older responses.
      const wyckInput = atoms.map((a, idx) => ({
        index: idx,
        element: a.element,
        frac: atomFrac(a),
      }))
      const operations = symmetry.operations.map((op) => ({
        rotation: op.rotation,
        translation: op.translation,
      }))
      const analysis = assignWyckoffPositions(wyckInput, symmetry.spaceGroup.number, operations)
      if (!analysis) {
        // The local table covers only cubic, hexagonal, and selected common groups.
        // For unsupported groups, compute true orbit equivalence directly from symmetry operations.
        // Rows remain selectable even without official labels such as 4a or 4b.
        const orbits = groupAtomsByOrbit(wyckInput, operations)
        const fallbackAssignments: WyckoffAssignment[] = orbits.map((members) => ({
          atomIndices: members.map((m) => m.index),
          element: members[0].element,
          site: null,
          label: `m${members.length}`,  // Use multiplicity labels to distinguish fallback groups from true Wyckoff labels.
          representative: members[0].frac as [number, number, number],
        }))
        setResult({ assignments: fallbackAssignments, unclassified: [] })
        setFallbackNotice(
          `SG #${symmetry.spaceGroup.number} (${symmetry.spaceGroup.internationalSymbol}) ` +
          `not in local Wyckoff table — showing orbit groups (multiplicity labels) instead. ` +
          `Click rows to highlight symmetry-equivalent atoms.`,
        )
        return
      }
      setResult(analysis)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const handleRowClick = (assignmentIdx: number, atomIndices: number[]) => {
    setActiveAssignmentIdx(assignmentIdx)
    const ids = atomIndices.map((i) => atoms[i]?.id).filter((id): id is string => !!id)
    if (ids.length === 0) return
    selectAtoms(ids)
    focusOnAtoms(ids)
  }

  return (
    <div className="space-y-2">
      <p className="text-[10px] text-[var(--panel-text-tertiary)]">
        Identify each atom&apos;s Wyckoff site (e.g. NaCl: Na→4a, Cl→4b). Click a row to
        focus its atoms in the viewport.
      </p>
      <button
        onClick={run}
        disabled={busy || atoms.length === 0}
        className="zatom-primary zatom-pressable relative flex w-full items-center justify-center gap-1.5 overflow-hidden rounded px-3 py-1.5 text-xs font-medium"
      >
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
        {busy ? 'Computing...' : 'Find Wyckoff Positions'}
      </button>
      {error && <p className="status-amber text-[10px] leading-tight">{error}</p>}
      {fallbackNotice && (
        <p className="text-[10px] text-[var(--panel-text-tertiary)] leading-tight italic">
          {fallbackNotice}
        </p>
      )}
      {sgInfo && (
        <div className="text-[10px] font-mono text-[var(--panel-text-secondary)]">
          Space group:{' '}
          <span className="text-[var(--panel-text)]">
            {sgInfo.symbol} (#{sgInfo.number})
          </span>
        </div>
      )}
      {result && result.assignments.length > 0 && (
        <div className="rounded border border-[var(--panel-border)] overflow-hidden">
          <table className="w-full text-[10px] font-mono">
            <thead className="bg-[var(--panel-elevated)]/40">
              <tr>
                <th className="px-2 py-1 text-left text-[var(--panel-text-tertiary)] font-normal">Wyck.</th>
                <th className="px-2 py-1 text-left text-[var(--panel-text-tertiary)] font-normal">Elem</th>
                <th className="px-2 py-1 text-left text-[var(--panel-text-tertiary)] font-normal">Site sym</th>
                <th className="px-2 py-1 text-left text-[var(--panel-text-tertiary)] font-normal">Coord</th>
                <th className="px-2 py-1 text-right text-[var(--panel-text-tertiary)] font-normal w-6"></th>
              </tr>
            </thead>
            <tbody>
              {result.assignments.map((a, i) => {
                const isActive = activeAssignmentIdx === i
                return (
                  <tr
                    key={i}
                    onClick={() => handleRowClick(i, a.atomIndices)}
                    className={[
                      'group border-t border-[var(--panel-border)]/40 cursor-pointer',
                      'transition-[background-color] duration-[160ms] ease-[cubic-bezier(0.4,0,0.2,1)]',
                      isActive
                        ? 'bg-[var(--control-selected-bg)]'
                        : 'hover:bg-[var(--panel-hover)]/30',
                    ].join(' ')}
                  >
                    <td className={`px-2 py-1 font-semibold ${isActive ? 'text-[var(--control-selected-text)]' : 'text-[var(--panel-text-secondary)]'}`}>
                      {a.label}
                    </td>
                    <td className="px-2 py-1 text-[var(--panel-text)]">{a.element}</td>
                    <td className="px-2 py-1 text-[var(--panel-text-secondary)]">
                      {a.site?.siteSymmetry ?? '—'}
                    </td>
                    <td className="px-2 py-1 text-[var(--panel-text-secondary)]">
                      ({a.representative.map((c) => c.toFixed(3)).join(', ')})
                    </td>
                    <td className="px-2 py-1 text-right">
                      <Focus
                        className={[
                          'w-3 h-3 inline-block transition-opacity duration-[160ms]',
                          isActive
                            ? 'opacity-100 text-[var(--control-selected-text)]'
                            : 'opacity-30 group-hover:opacity-80 text-[var(--panel-text-secondary)]',
                        ].join(' ')}
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {result && result.unclassified.length > 0 && (
        <p className="status-amber text-[9px]">
          {result.unclassified.length} atoms unclassified (orbit didn&apos;t match any tabulated site).
        </p>
      )}
    </div>
  )
}
