/**
 * Function-pin storage — which functions occupy the inspector's 6-slot FUNCTIONS
 * grid (the rest live in the "MORE" expansion). Shared so the marketplace can
 * auto-pin a tool on install and the inspector reacts live.
 */
import { FUNCTION_ORDER } from './installedToolsStore'

export const FUNCTION_PIN_STORAGE_KEY = 'zatom:modeler:function-pins'
export const DEFAULT_PINNED_FUNCTION_IDS = ['tools', 'cell', 'select', 'measure', 'super', 'plane']
/** Fires (window event) whenever the pin set changes, so mounted panels reload. */
export const FUNCTION_PINS_CHANGED = 'zatom:function-pins-changed'

export function normalizePinnedFunctionIds(input: readonly string[]): string[] {
  const allowed = new Set<string>(FUNCTION_ORDER)
  const next: string[] = []
  for (const id of input) {
    if (allowed.has(id) && !next.includes(id)) next.push(id)
  }
  for (const id of DEFAULT_PINNED_FUNCTION_IDS) {
    if (next.length >= 6) break
    if (!next.includes(id)) next.push(id)
  }
  for (const id of FUNCTION_ORDER) {
    if (next.length >= 6) break
    if (!next.includes(id)) next.push(id)
  }
  return next.slice(0, 6)
}

export function loadPinnedFunctionIds(): string[] {
  if (typeof window === 'undefined') return DEFAULT_PINNED_FUNCTION_IDS
  try {
    const parsed = JSON.parse(window.localStorage.getItem(FUNCTION_PIN_STORAGE_KEY) || '[]')
    return normalizePinnedFunctionIds(Array.isArray(parsed) ? parsed : DEFAULT_PINNED_FUNCTION_IDS)
  } catch {
    return DEFAULT_PINNED_FUNCTION_IDS
  }
}

export function savePinnedFunctionIds(ids: readonly string[]) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(FUNCTION_PIN_STORAGE_KEY, JSON.stringify(ids))
}

/** Surface a function in the 6-slot grid (bumping the oldest non-pinned). Used
 *  when a tool is installed from the marketplace so "install = visible". */
export function pinFunctionId(id: string) {
  if (!(FUNCTION_ORDER as readonly string[]).includes(id)) return
  const cur = loadPinnedFunctionIds()
  if (cur.includes(id)) return
  const next = normalizePinnedFunctionIds([id, ...cur.filter((x) => x !== id)])
  savePinnedFunctionIds(next)
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(FUNCTION_PINS_CHANGED))
}
