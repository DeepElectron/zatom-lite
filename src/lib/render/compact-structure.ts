import { getElement } from '../crystal/elements'
import { grainColorHex } from '../polycrystal/grain-colors'

export interface CompactStructure {
  /** cartesian xyz, length 3*count */
  positions: Float32Array
  /** index into `elements`, length count */
  elementIndex: Uint8Array
  /** elementIndex → element symbol */
  elements: string[]
  /** optional grain id per atom, length count */
  grainId?: Uint32Array
  count: number
  bbox: { min: [number, number, number]; max: [number, number, number] }
  /** optional RGB(0..1) override per element index (length 3*elements) — used by the
  *  species-trajectory path so two species render with high contrast instead of the
  *  periodic-table colors. */
  palette?: Float32Array
}

export interface ElementTables {
  /** radius per element index (Å) */
  radii: Float32Array
  /** rgb (0..1) per element index, length 3*elements */
  colors: Float32Array
}

/** Ball-and-stick base factor — matches AtomMesh / InstancedAtoms (elementRadius * 0.5 * scale).
 *  Without it the impostors render ~2x too large (space-fill-like). */
export const BALL_STICK_RADIUS_FACTOR = 0.5

/** Radius factor per view mode — mirrors the detail-path visual radii so switching
 *  between Atom[] and compact render keeps atom sizes consistent. */
export function viewModeRadiusFactor(viewMode: string): number {
  if (viewMode === 'stick') throw new Error('Compact structures cannot render stick geometry without a bond graph')
  if (viewMode === 'space-fill') return 1.25 // base(0.5) * 2.5
  if (viewMode === 'wireframe') return 0.15  // base(0.5) * 0.3
  return BALL_STICK_RADIUS_FACTOR
}

function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
  ]
}

/** Precompute per-element-index radius + base color once (not per atom). */
export function buildElementTables(elements: string[]): ElementTables {
  const radii = new Float32Array(elements.length)
  const colors = new Float32Array(elements.length * 3)
  for (let i = 0; i < elements.length; i++) {
    const e = getElement(elements[i])
    radii[i] = e.radius
    const [r, g, b] = hexToRgb(e.color)
    colors[i * 3] = r; colors[i * 3 + 1] = g; colors[i * 3 + 2] = b
  }
  return { radii, colors }
}

/** Per-instance radius = element radius × 0.5 × scale (ball-and-stick sizing). */
export function buildInstanceRadii(c: CompactStructure, tables: ElementTables, scale: number, factor: number = BALL_STICK_RADIUS_FACTOR): Float32Array {
  const out = new Float32Array(c.count)
  const k = factor * scale
  for (let i = 0; i < c.count; i++) out[i] = tables.radii[c.elementIndex[i]] * k
  return out
}

/** Per-instance rgb (0..1): grain color when showGrainColoring (and grainId present), else element base color. */
export function buildInstanceColors(c: CompactStructure, tables: ElementTables, showGrainColoring: boolean): Float32Array {
  const out = new Float32Array(c.count * 3)
  const grain = showGrainColoring && c.grainId
  for (let i = 0; i < c.count; i++) {
    if (grain) {
      const [r, g, b] = hexToRgb(grainColorHex(c.grainId![i]))
      out[i * 3] = r; out[i * 3 + 1] = g; out[i * 3 + 2] = b
    } else {
      const ei = c.elementIndex[i]
      const pal = c.palette
      if (pal && pal.length >= (ei + 1) * 3) {
        out[i * 3] = pal[ei * 3]; out[i * 3 + 1] = pal[ei * 3 + 1]; out[i * 3 + 2] = pal[ei * 3 + 2]
      } else {
        out[i * 3] = tables.colors[ei * 3]
        out[i * 3 + 1] = tables.colors[ei * 3 + 1]
        out[i * 3 + 2] = tables.colors[ei * 3 + 2]
      }
    }
  }
  return out
}

/** RGB(0..1) per species index — `palette` (length ≥ 3*elements) overrides element colors. */
export function buildSpeciesColorTable(elements: string[], palette?: Float32Array): Float32Array {
  if (palette && palette.length >= elements.length * 3) return palette.slice(0, elements.length * 3)
  return buildElementTables(elements).colors
}

/** species index per atom → aColor buffer (length 3*count). Stepped (no lerp). */
export function writeSpeciesColors(species: Uint8Array, table: Float32Array, out: Float32Array): void {
  for (let i = 0; i < species.length; i++) {
    const ei = species[i]
    out[i * 3] = table[ei * 3]
    out[i * 3 + 1] = table[ei * 3 + 1]
    out[i * 3 + 2] = table[ei * 3 + 2]
  }
}
