/**
 * trajectory-color — map a per-atom extended-XYZ scalar (charge, |force|, …) to
 * a colormap colour for the trajectory "color by" overlay. Thin glue over
 * sampleColormap (lib/viz/colormap.ts), kept separate so both atom renderers
 * (instanced + detail) and the colorbar legend share one definition.
 */
import type { AuxValue } from '../crystal/xyz-parser'
import { sampleColormap, type ColormapName } from './colormap'

/**
 * Extract the scalar value for `prop` from an atom's extended-XYZ props.
 * The synthetic name `fmag` resolves to the magnitude of the `forces` vector
 * (so force fields double as a scalar field). Returns null when absent.
 */
export function atomScalarValue(props: Record<string, AuxValue> | undefined, prop: string): number | null {
  if (!props) return null
  if (prop === 'fmag') {
    const f = props.forces
    return f && f.kind === 'vector' ? Math.hypot(f.value[0], f.value[1], f.value[2]) : null
  }
  const p = props[prop]
  return p && p.kind === 'scalar' ? p.value : null
}

/** min/max of scalar `prop` over a set of atoms; null when no atom has it. */
export function scalarRange(
  atoms: Array<{ props?: Record<string, AuxValue> }>,
  prop: string,
): [number, number] | null {
  let lo = Infinity
  let hi = -Infinity
  for (const a of atoms) {
    const v = atomScalarValue(a.props, prop)
    if (v === null) continue
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  return lo <= hi ? [lo, hi] : null
}

/**
 * Memoised `scalarRange` for the render path.
 *
 * The detail atom renderer is a per-atom component, so an auto colour range was
 * recomputed once per atom — an O(N) scan × N atoms = O(N²) on every frame change
 * with "color by" active. Every caller passes the same store array reference, so
 * a two-entry cache keyed by (atoms identity, prop) collapses that back to O(N).
 *
 * Kept out of `scalarRange` itself so that function stays pure for tests and for
 * one-off callers (colorbar legend) that have no reuse to exploit.
 */
let rangeCache: Array<{
  atoms: Array<{ props?: Record<string, AuxValue> }>
  prop: string
  result: [number, number] | null
}> = []

export function scalarRangeCached(
  atoms: Array<{ props?: Record<string, AuxValue> }>,
  prop: string,
): [number, number] | null {
  for (const entry of rangeCache) {
    if (entry.atoms === atoms && entry.prop === prop) return entry.result
  }
  const result = scalarRange(atoms, prop)
  // Two entries: the active frame's atoms under at most a couple of props. Any
  // structure edit swaps the array reference, so stale entries fall out on their own.
  rangeCache = [{ atoms, prop, result }, ...rangeCache].slice(0, 2)
  return result
}

/** Map a scalar value to a `#rrggbb` hex using `colormap` over `[min,max]`. */
export function scalarColorHex(value: number, range: [number, number], colormap: ColormapName): string {
  const [lo, hi] = range
  const t = hi > lo ? (value - lo) / (hi - lo) : 0.5
  const [r, g, b] = sampleColormap(colormap, t)
  const h = (n: number) => Math.round(Math.max(0, Math.min(1, n)) * 255).toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}
