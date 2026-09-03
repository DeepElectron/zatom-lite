import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import {
  getActiveViewportStoreApi,
  useActiveCrystalStore as useCrystalStore,
} from '../../../orchestration/ViewportContext'
import {
  bioAtomSetToResidueIndices,
  bioResidueIndicesInChainRange,
  bioResidueIndicesToAtomSet,
  buildBioSequenceChains,
} from '../../../lib/biomolecule/sequence'
import type { BioStructure } from '../../../lib/biomolecule/types'

const SECONDARY_COLOR = {
  helix: 'var(--status-red)',
  sheet: 'var(--status-amber)',
  coil: 'var(--panel-text-secondary)',
} as const

const ACIDIC_RESIDUES = new Set(['ASP', 'GLU'])
const BASIC_RESIDUES = new Set(['ARG', 'LYS', 'HIS'])

type SequencePickOperation = 'replace' | 'add' | 'subtract'

interface BioSequenceGestureStore {
  getState: () => { bioStructure: BioStructure | null }
}

/**
 * A residue gesture may commit only while both its viewport store and exact
 * topology are still current. Zustand writes are synchronous, so checking the
 * store here also closes the small window before React can replace an old event
 * handler after a document or active-viewport change.
 */
export function currentBioSequenceGestureStore<T extends BioSequenceGestureStore>(
  gestureStore: T | null,
  activeStore: T,
  gestureStructure: BioStructure | null,
): T | null {
  if (!gestureStore || !gestureStructure || gestureStore !== activeStore) return null
  return gestureStore.getState().bioStructure === gestureStructure ? gestureStore : null
}

export function bioResidueDragRange(start: number, end: number): readonly [number, number] {
  return [Math.min(start, end), Math.max(start, end)]
}

export function bioResidueDragEndpoint(current: number | null, fallback: number): number {
  return current ?? fallback
}

export function bioSequencePickOperation(modifiers: {
  shiftKey: boolean
  metaKey: boolean
  ctrlKey: boolean
}): SequencePickOperation {
  if (modifiers.shiftKey) return 'add'
  if (modifiers.metaKey || modifiers.ctrlKey) return 'subtract'
  return 'replace'
}

export function bioResidueSequenceColor(
  residueName: string,
  secondaryStructure: keyof typeof SECONDARY_COLOR,
): string {
  const normalized = residueName.toUpperCase()
  if (ACIDIC_RESIDUES.has(normalized)) return 'var(--status-red)'
  if (BASIC_RESIDUES.has(normalized)) return 'var(--control-selected-text)'
  return SECONDARY_COLOR[secondaryStructure]
}

export function BiomoleculeSequenceStrip() {
  // ModelerView keys this component by viewport id. Retaining the store from this
  // mounted instance prevents an old DOM handler from adopting a newly-active
  // viewport during the short interval before React unmounts it.
  const renderedStore = useRef(getActiveViewportStoreApi())
  const structure = useCrystalStore((state) => state.bioStructure)
  const selectedAtomIds = useCrystalStore((state) => state.selectedAtomIds)
  const [open, setOpen] = useState(false)
  const [preview, setPreview] = useState<[number, number] | null>(null)
  const dragStart = useRef<number | null>(null)
  const dragEnd = useRef<number | null>(null)
  const dragChain = useRef<number | null>(null)
  const dragStructure = useRef<BioStructure | null>(null)
  const dragStore = useRef<ReturnType<typeof getActiveViewportStoreApi> | null>(null)
  const dragOperation = useRef<SequencePickOperation>('replace')
  const chains = useMemo(() => structure ? buildBioSequenceChains(structure) : [], [structure])
  const atomIndexById = useMemo(() => structure
    ? new Map(structure.atoms.map((atom) => [atom.id, atom.index]))
    : new Map<string, number>(), [structure])
  const selectedResidues = useMemo(() => {
    if (!structure) return new Set<number>()
    const indices = new Set<number>()
    for (const id of selectedAtomIds) {
      const atomIndex = atomIndexById.get(id)
      if (atomIndex != null) indices.add(atomIndex)
    }
    return bioAtomSetToResidueIndices(structure, indices)
  }, [atomIndexById, selectedAtomIds, structure])

  useEffect(() => {
    // A sequence gesture belongs to the exact BioStructure object that received
    // pointer-down. Loading another PDB in the same viewport must not reinterpret
    // the old residue indices against the new topology.
    dragStart.current = null
    dragEnd.current = null
    dragChain.current = null
    dragStructure.current = null
    dragStore.current = null
    dragOperation.current = 'replace'
    setPreview(null)
  }, [structure])

  if (!structure || chains.length === 0) return null

  const commit = (end: number) => {
    const start = dragStart.current ?? end
    const chainIndex = dragChain.current
    const operation = dragOperation.current
    const gestureStructure = dragStructure.current
    const gestureStore = currentBioSequenceGestureStore(
      dragStore.current,
      getActiveViewportStoreApi(),
      gestureStructure,
    )
    dragStart.current = null
    dragEnd.current = null
    dragChain.current = null
    dragStructure.current = null
    dragStore.current = null
    dragOperation.current = 'replace'
    setPreview(null)
    if (chainIndex == null || !gestureStructure || !gestureStore) return
    const residues = bioResidueIndicesInChainRange(gestureStructure, chainIndex, start, end)
    const picked = bioResidueIndicesToAtomSet(gestureStructure, residues)
    const gestureState = gestureStore.getState()
    const next = new Set(operation === 'replace' ? [] : gestureState.selectedAtomIds)
    for (const atomIndex of picked) {
      const atomId = gestureStructure.atoms[atomIndex]?.id
      if (!atomId) continue
      if (operation === 'subtract') next.delete(atomId)
      else next.add(atomId)
    }
    const ids = [...next]
    gestureState.selectAtoms(ids)
    if (ids.length === 0) gestureState.clearFocusedAtoms()
    else if (gestureState.autoFocusOnAtom) gestureState.focusOnAtoms(ids)
  }

  const updateDragPreview = (event: React.PointerEvent) => {
    const start = dragStart.current
    if (start == null) return
    const target = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>('[data-bio-residue-index]')
    if (!target) return
    const chainIndex = Number(target.dataset.bioChainIndex)
    if (!Number.isInteger(chainIndex) || chainIndex !== dragChain.current) return
    const end = Number(target.dataset.bioResidueIndex)
    if (!Number.isInteger(end)) return
    dragEnd.current = end
    setPreview([...bioResidueDragRange(start, end)])
  }

  return (
    <section
      className="pointer-events-auto relative w-full shrink-0 overflow-hidden rounded-xl"
      style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', backdropFilter: 'var(--glass-blur)' }}
      aria-label="Biomolecular sequence"
    >
      <button
        type="button"
        className="zatom-pressable flex h-8 w-full items-center gap-2 px-3 text-left"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="biomolecule-sequence-content"
      >
        <span className="text-[11px] font-medium" style={{ color: 'var(--panel-text)' }}>Sequence</span>
        <span className="min-w-0 truncate text-[9px]" style={{ color: 'var(--panel-text-tertiary)' }}>Click or drag residues · Shift adds · Ctrl removes</span>
        <ChevronDown className={`ml-auto h-3.5 w-3.5 shrink-0 transition-transform ${open ? '' : 'rotate-180'}`} />
      </button>
      {open && <div
        id="biomolecule-sequence-content"
        className="grid"
      >
        <div className="min-h-0 overflow-hidden">
          <div
            className="max-h-28 overflow-auto px-3 pb-2 custom-scrollbar"
            onPointerMove={updateDragPreview}
          >
            {chains.map((chain) => (
              <div key={chain.chainIndex} className="flex items-start gap-2 py-0.5">
                <span className="w-8 shrink-0 pt-0.5 font-mono text-[9px]" style={{ color: 'var(--panel-text-tertiary)' }}>
                  {chain.chainId || '∅'}
                </span>
                <div className="flex flex-wrap font-mono text-[11px] leading-[16px]">
                  {chain.residues.map((residue) => {
                    const selected = selectedResidues.has(residue.residueIndex)
                    const inPreview = preview && residue.residueIndex >= preview[0] && residue.residueIndex <= preview[1]
                    return (
                      <button
                        type="button"
                        key={residue.residueIndex}
                        data-bio-residue-index={residue.residueIndex}
                        data-bio-chain-index={chain.chainIndex}
                        className="h-4 w-[10px] select-none rounded-[2px] text-center [@media(pointer:coarse)]:h-6 [@media(pointer:coarse)]:w-6"
                        style={{
                          color: selected ? 'var(--control-primary-text)' : bioResidueSequenceColor(residue.residueName, residue.secondaryStructure),
                          background: selected ? 'var(--control-primary-bg)' : inPreview && dragChain.current === chain.chainIndex ? 'var(--control-selected-bg)' : 'transparent',
                        }}
                        title={`${residue.residueName} ${chain.chainId || '<blank>'}${residue.sequenceNumber}${residue.insertionCode}`}
                        aria-label={`${residue.residueName} ${chain.chainId ? `chain ${chain.chainId}` : 'blank chain'} residue ${residue.sequenceNumber}${residue.insertionCode}`}
                        aria-pressed={selected}
                        onPointerDown={(event) => {
                          if (event.button !== 0) return
                          event.currentTarget.setPointerCapture(event.pointerId)
                          dragStart.current = residue.residueIndex
                          dragEnd.current = residue.residueIndex
                          dragChain.current = chain.chainIndex
                          dragStructure.current = structure
                          dragStore.current = renderedStore.current
                          dragOperation.current = bioSequencePickOperation(event)
                          setPreview([residue.residueIndex, residue.residueIndex])
                        }}
                        onPointerUp={(event) => {
                          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
                          commit(bioResidueDragEndpoint(dragEnd.current, residue.residueIndex))
                        }}
                        onPointerCancel={(event) => {
                          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
                          dragStart.current = null
                          dragEnd.current = null
                          dragChain.current = null
                          dragStructure.current = null
                          dragStore.current = null
                          dragOperation.current = 'replace'
                          setPreview(null)
                        }}
                      >
                        {residue.symbol}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>}
    </section>
  )
}
