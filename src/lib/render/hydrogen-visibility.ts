/**
 * Hydrogen visibility: hide every H except an explicit keep-list.
 *
 * Chemists routinely hide hydrogens to declutter a figure, but almost always
 * want a few kept — the ones on a reacting centre, a hydrogen bond donor, a
 * stereocentre. So the control is not a boolean; it is "hide hydrogens,
 * except these", where "these" is typed the way people already read the
 * on-screen labels: `1,3,5-8`.
 *
 * The numbers are the 1-based atom ordinals shown by the `number` label mode
 * (see atom-labels.tsx: `atomIndex + 1`). Using the same numbering the user
 * can see on screen is the whole point; any other indexing would force them
 * to guess.
 */

export interface KeptHydrogenParse {
  /** 1-based ordinals that parsed cleanly. */
  readonly ordinals: ReadonlySet<number>
  /** Tokens that could not be read, verbatim, so the UI can show them. */
  readonly rejected: readonly string[]
}

/**
 * Parse `1,3,5-8` into ordinals. Whitespace and repeated separators are
 * tolerated; reversed ranges (`8-5`) are accepted and normalised; anything
 * non-numeric or non-positive is reported rather than silently dropped, since
 * a typo that hides the one hydrogen you cared about is the failure mode to
 * guard against.
 */
export function parseKeptHydrogenOrdinals(input: string): KeptHydrogenParse {
  const ordinals = new Set<number>()
  const rejected: string[] = []

  for (const raw of input.split(/[,\s;]+/)) {
    const token = raw.trim()
    if (token.length === 0) continue

    const range = /^(\d+)\s*[-–—]\s*(\d+)$/.exec(token)
    if (range) {
      const a = Number.parseInt(range[1], 10)
      const b = Number.parseInt(range[2], 10)
      if (a < 1 || b < 1) {
        rejected.push(token)
        continue
      }
      const [lo, hi] = a <= b ? [a, b] : [b, a]
      // A range like 1-1000000 is almost certainly a typo; refusing it keeps a
      // stray keystroke from allocating a huge set.
      if (hi - lo > 100_000) {
        rejected.push(token)
        continue
      }
      for (let i = lo; i <= hi; i++) ordinals.add(i)
      continue
    }

    if (/^\d+$/.test(token)) {
      const n = Number.parseInt(token, 10)
      if (n >= 1) ordinals.add(n)
      else rejected.push(token)
      continue
    }

    rejected.push(token)
  }

  return { ordinals, rejected }
}

export interface HydrogenVisibilityOptions {
  /** Master switch. When false nothing is hidden regardless of the keep-list. */
  readonly hideHydrogens: boolean
  /** Raw keep-list text as typed, e.g. `1,3,5-8`. */
  readonly keptHydrogens: string
}

/**
 * Ids of hydrogens to hide. Returns an empty set when hiding is off so
 * callers can merge it unconditionally into their existing hidden-id set.
 *
 * `atoms` must be the same ordered array the label layer numbers from, or the
 * ordinals will not line up with what the user sees.
 */
export function hiddenHydrogenIds(
  atoms: ReadonlyArray<{ readonly id: string; readonly element: string }>,
  options: HydrogenVisibilityOptions,
): Set<string> {
  const hidden = new Set<string>()
  if (!options.hideHydrogens) return hidden

  const kept = parseKeptHydrogenOrdinals(options.keptHydrogens).ordinals
  for (let i = 0; i < atoms.length; i++) {
    const atom = atoms[i]
    if (atom.element !== 'H' && atom.element !== 'D' && atom.element !== 'T') continue
    if (kept.has(i + 1)) continue
    hidden.add(atom.id)
  }
  return hidden
}
