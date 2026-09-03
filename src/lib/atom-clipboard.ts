/**
 * Atom-level clipboard shared across viewports and structure reloads.
 * Fragments retain absolute Cartesian coordinates, while repeated internal
 * pastes receive an increasing offset. XYZ serialization supports interchange
 * with external scientific and text tools.
 */

import { ELEMENTS } from './crystal/elements'

export interface ClipboardAtom {
  element: string
  cartesian: [number, number, number]
}

export interface ClipboardFragment {
  atoms: ClipboardAtom[]
  /** Source structure label written only to the XYZ comment line. */
  sourceLabel?: string
}

/** Offset step in Å used to keep repeated pastes from overlapping. */
export const PASTE_OFFSET_STEP: [number, number, number] = [2, 2, 0]

let fragment: ClipboardFragment | null = null
/** Number of times the current fragment has been pasted. */
let pasteCount = 0
/**
 * Last XYZ text written by Zatom. Matching clipboard text follows the internal
 * paste path so it receives the normal increasing offset instead of overlapping
 * the source fragment.
 */
let selfWrittenText: string | null = null

export function setClipboardFragment(next: ClipboardFragment | null): void {
  fragment = next && next.atoms.length > 0 ? next : null
  pasteCount = 0
}

export function markSelfWrittenText(text: string | null): void {
  selfWrittenText = text
}

/** Return whether text matches the last clipboard payload written by Zatom. */
export function isSelfWrittenText(text: string): boolean {
  return selfWrittenText !== null && selfWrittenText.trim() === text.trim()
}

export function getClipboardFragment(): ClipboardFragment | null {
  return fragment
}

export function hasClipboardFragment(): boolean {
  return fragment !== null && fragment.atoms.length > 0
}

/** Advance and return the offset for the next paste. */
export function nextPasteOffset(): [number, number, number] {
  pasteCount += 1
  return [
    PASTE_OFFSET_STEP[0] * pasteCount,
    PASTE_OFFSET_STEP[1] * pasteCount,
    PASTE_OFFSET_STEP[2] * pasteCount,
  ]
}

/** Format standard XYZ: atom count, comment, then `Symbol x y z` rows. */
export function formatFragmentAsXyz(frag: ClipboardFragment): string {
  const lines: string[] = [String(frag.atoms.length)]
  lines.push(frag.sourceLabel ? `Fragment from ${frag.sourceLabel}` : 'Fragment copied from Zatom')
  for (const a of frag.atoms) {
    const [x, y, z] = a.cartesian
    lines.push(`${a.element} ${x.toFixed(6)} ${y.toFixed(6)} ${z.toFixed(6)}`)
  }
  return lines.join('\n')
}

function normalizeSymbol(raw: string): string | null {
  if (!raw) return null
  // Accept common labels such as CU, cu, Cu1, and Cu_surf, then normalize case.
  const letters = raw.replace(/[^A-Za-z]/g, '')
  if (!letters) return null
  for (const len of [2, 1]) {
    if (letters.length < len) continue
    const cand = letters[0].toUpperCase() + letters.slice(1, len).toLowerCase()
    if (ELEMENTS[cand]) return cand
  }
  return null
}

/**
 * Parse an XYZ fragment with optional count/comment lines and permissive
 * whitespace. Return null when no valid atom row can be recovered.
 */
export function parseXyzFragment(text: string): ClipboardFragment | null {
  const rawLines = text.split(/\r?\n/).map((l) => l.trim())
  const lines = rawLines.filter((l) => l.length > 0)
  if (lines.length === 0) return null

  let body = lines
  const declared = Number.parseInt(lines[0], 10)
  // A numeric first line identifies standard XYZ, so skip its comment line too.
  if (Number.isInteger(declared) && String(declared) === lines[0] && declared > 0) {
    body = lines.slice(2)
    if (body.length > declared) body = body.slice(0, declared)
  }

  const atoms: ClipboardAtom[] = []
  for (const line of body) {
    const parts = line.split(/[\s,]+/)
    if (parts.length < 4) continue
    const element = normalizeSymbol(parts[0])
    if (!element) continue
    const x = Number.parseFloat(parts[1])
    const y = Number.parseFloat(parts[2])
    const z = Number.parseFloat(parts[3])
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue
    atoms.push({ element, cartesian: [x, y, z] })
  }

  return atoms.length > 0 ? { atoms } : null
}
