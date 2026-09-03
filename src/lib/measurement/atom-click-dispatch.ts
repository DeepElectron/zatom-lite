export type ExactAtomClickDispatch = 'measurement' | 'override' | 'default'

/**
 * Route a click on geometry that identifies one exact atom.
 *
 * Measurement deliberately wins over a presentation-specific picker. This is
 * important for biomolecule layers, whose normal click callback promotes an
 * atom to a residue or chain. A measurement must retain the exact atom id.
 */
export function dispatchExactAtomClick<TEvent, TAtom>({
  measurementActive,
  atomId,
  event,
  atom,
  addMeasurementAtom,
  onAtomClick,
  overrideEnabled = true,
}: {
  measurementActive: boolean
  atomId: string
  event: TEvent
  atom: TAtom
  addMeasurementAtom: (atomId: string) => void
  onAtomClick?: (event: TEvent, atom: TAtom) => void
  overrideEnabled?: boolean
}): ExactAtomClickDispatch {
  if (measurementActive) {
    addMeasurementAtom(atomId)
    return 'measurement'
  }
  if (overrideEnabled && onAtomClick) {
    onAtomClick(event, atom)
    return 'override'
  }
  return 'default'
}
