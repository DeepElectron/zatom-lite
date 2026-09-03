/**
 * wyckoff-table —— Hand-curated Wyckoff position table for common space groups.
 *
 * Source: International Tables for Crystallography Vol. A (public data, mathematical facts).
 * Here are only the SGs commonly used in projects (cubic + hex + few common tet/ortho/mono), with
 * The assign-by-orbit algorithm in `wyckoff.ts` classifies atoms.
 *
 * Table shape: List site for each SG → multiplicity + letter + site symmetry +
 * representative coordinates (in fractional). In actual use, only multiplicity and
 * representative is enough for orbit-equivalence match.
 *
 * Unlisted SGs do not affect functionality - the panel displays "unsupported" when Wyckoff lookup misses.
 */

export interface WyckoffSite {
  /** multiplicity in the conventional cell */
  multiplicity: number
  /** letter (a, b, c, ...) */
  letter: string
  /** site symmetry (Schoenflies / Hermann-Mauguin compact, e.g. 'm-3m', '4mm') */
  siteSymmetry: string
  /**
  * representative fractional coordinate.
  * 'x', 'y', 'z' free parameters left as strings; numeric values resolved to numbers.
  * For pure orbit matching we only use the numeric part: free params get assigned to atom coords.
  */
  representative: WyckoffCoord
}

/**
 * Wyckoff representative as a triplet of expressions.
 * Each expression is either a literal number (e.g. 0, 0.5, 0.25) or a free-param tag.
 */
export type WyckoffCoord = readonly [WyckoffCoordExpr, WyckoffCoordExpr, WyckoffCoordExpr]
export type WyckoffCoordExpr = number | 'x' | 'y' | 'z' | 'free'

export interface SpaceGroupWyckoff {
  number: number
  /** Hermann-Mauguin symbol */
  hm: string
  crystalSystem: string
  /** sites listed from highest multiplicity down to lowest is conventional but we keep ITA order */
  sites: WyckoffSite[]
}

/**
 * Hand-curated table. Coverage:
 * - SG 221 Pm-3m (CsCl, perovskites)
 * - SG 225 Fm-3m (NaCl, fluorite, Cu, diamond approx)
 * - SG 227 Fd-3m (diamond, spinel)
 * - SG 229 Im-3m (bcc, W, Fe-α)
 * - SG 194 P6_3/mmc (hcp Mg, Zn)
 * - SG 152 P3_121 (α-quartz)
 * - SG 154 P3_221 (α-quartz enantiomer)
 * - SG 111 P-42m (tetragonal, point group -42m)
 * - SG 136 P4_2/mnm (rutile)
 * - SG 14 P2_1/c (common monoclinic organic)
 * - SG 62 Pnma (common orthorhombic, perovskite-distorted)
 *
 * Data copied from Bilbao Crystallographic Server / ITA public table, real numbers only include 0, 1/8, 1/4, 3/8, 1/2, 5/8, 3/4, 7/8.
 */
export const SPACE_GROUP_WYCKOFF: Record<number, SpaceGroupWyckoff> = {
  // ── Cubic ────────────────────────────────────────────────────────────────

  221: {
    number: 221,
    hm: 'Pm-3m',
    crystalSystem: 'cubic',
    sites: [
      { multiplicity: 1, letter: 'a', siteSymmetry: 'm-3m', representative: [0, 0, 0] },
      { multiplicity: 1, letter: 'b', siteSymmetry: 'm-3m', representative: [0.5, 0.5, 0.5] },
      { multiplicity: 3, letter: 'c', siteSymmetry: '4/mmm', representative: [0, 0.5, 0.5] },
      { multiplicity: 3, letter: 'd', siteSymmetry: '4/mmm', representative: [0.5, 0, 0] },
      { multiplicity: 6, letter: 'e', siteSymmetry: '4mm', representative: ['x', 0, 0] },
      { multiplicity: 6, letter: 'f', siteSymmetry: '4mm', representative: ['x', 0.5, 0.5] },
      { multiplicity: 8, letter: 'g', siteSymmetry: '3m', representative: ['x', 'x', 'x'] },
      { multiplicity: 12, letter: 'h', siteSymmetry: 'mm', representative: ['x', 0.5, 0] },
    ],
  },

  225: {
    number: 225,
    hm: 'Fm-3m',
    crystalSystem: 'cubic',
    sites: [
      // NaCl Na 4a, Cl 4b: 4a at (0,0,0), 4b at (1/2,1/2,1/2)
      { multiplicity: 4, letter: 'a', siteSymmetry: 'm-3m', representative: [0, 0, 0] },
      { multiplicity: 4, letter: 'b', siteSymmetry: 'm-3m', representative: [0.5, 0.5, 0.5] },
      { multiplicity: 8, letter: 'c', siteSymmetry: '-43m', representative: [0.25, 0.25, 0.25] },
      { multiplicity: 24, letter: 'd', siteSymmetry: 'mmm', representative: [0, 0.25, 0.25] },
      { multiplicity: 24, letter: 'e', siteSymmetry: '4mm', representative: ['x', 0, 0] },
      { multiplicity: 32, letter: 'f', siteSymmetry: '3m', representative: ['x', 'x', 'x'] },
    ],
  },

  227: {
    number: 227,
    hm: 'Fd-3m',
    crystalSystem: 'cubic',
    sites: [
      // diamond: C at 8a (0,0,0)
      { multiplicity: 8, letter: 'a', siteSymmetry: '-43m', representative: [0.125, 0.125, 0.125] },
      { multiplicity: 8, letter: 'b', siteSymmetry: '-43m', representative: [0.375, 0.375, 0.375] },
      { multiplicity: 16, letter: 'c', siteSymmetry: '.-3m', representative: [0, 0, 0] },
      { multiplicity: 16, letter: 'd', siteSymmetry: '.-3m', representative: [0.5, 0.5, 0.5] },
      { multiplicity: 32, letter: 'e', siteSymmetry: '.3m', representative: ['x', 'x', 'x'] },
      { multiplicity: 48, letter: 'f', siteSymmetry: '2.mm', representative: ['x', 0.125, 0.125] },
    ],
  },

  229: {
    number: 229,
    hm: 'Im-3m',
    crystalSystem: 'cubic',
    sites: [
      // bcc W/Fe-α: 2a (0,0,0)
      { multiplicity: 2, letter: 'a', siteSymmetry: 'm-3m', representative: [0, 0, 0] },
      { multiplicity: 6, letter: 'b', siteSymmetry: '4/mmm', representative: [0, 0.5, 0.5] },
      { multiplicity: 8, letter: 'c', siteSymmetry: '-3m', representative: [0.25, 0.25, 0.25] },
      { multiplicity: 12, letter: 'd', siteSymmetry: '-4m2', representative: [0.25, 0.5, 0] },
      { multiplicity: 12, letter: 'e', siteSymmetry: '4mm', representative: ['x', 0, 0] },
      { multiplicity: 16, letter: 'f', siteSymmetry: '3m', representative: ['x', 'x', 'x'] },
      { multiplicity: 24, letter: 'g', siteSymmetry: 'mm', representative: ['x', 0, 0.5] },
    ],
  },

  // ── Hexagonal ────────────────────────────────────────────────────────────

  194: {
    number: 194,
    hm: 'P6_3/mmc',
    crystalSystem: 'hexagonal',
    sites: [
      // hcp Mg/Zn: 2c at (1/3, 2/3, 1/4)
      { multiplicity: 2, letter: 'a', siteSymmetry: '-3m', representative: [0, 0, 0] },
      { multiplicity: 2, letter: 'b', siteSymmetry: '-6m2', representative: [0, 0, 0.25] },
      { multiplicity: 2, letter: 'c', siteSymmetry: '-6m2', representative: [1 / 3, 2 / 3, 0.25] },
      { multiplicity: 2, letter: 'd', siteSymmetry: '-6m2', representative: [1 / 3, 2 / 3, 0.75] },
      { multiplicity: 4, letter: 'e', siteSymmetry: '3m', representative: [0, 0, 'z'] },
      { multiplicity: 4, letter: 'f', siteSymmetry: '3m', representative: [1 / 3, 2 / 3, 'z'] },
      { multiplicity: 6, letter: 'g', siteSymmetry: '.2/m.', representative: [0.5, 0, 0] },
      { multiplicity: 6, letter: 'h', siteSymmetry: 'mm', representative: ['x', 'y', 0.25] },
    ],
  },

  // ── Trigonal ─────────────────────────────────────────────────────────────

  152: {
    number: 152,
    hm: 'P3_121',
    crystalSystem: 'trigonal',
    sites: [
      // α-quartz: Si on 3a, O on 6c
      { multiplicity: 3, letter: 'a', siteSymmetry: '.2.', representative: ['x', 0, 1 / 3] },
      { multiplicity: 3, letter: 'b', siteSymmetry: '.2.', representative: ['x', 0, 5 / 6] },
      { multiplicity: 6, letter: 'c', siteSymmetry: '1', representative: ['x', 'y', 'z'] },
    ],
  },

  154: {
    number: 154,
    hm: 'P3_221',
    crystalSystem: 'trigonal',
    sites: [
      { multiplicity: 3, letter: 'a', siteSymmetry: '.2.', representative: ['x', 0, 1 / 6] },
      { multiplicity: 3, letter: 'b', siteSymmetry: '.2.', representative: ['x', 0, 2 / 3] },
      { multiplicity: 6, letter: 'c', siteSymmetry: '1', representative: ['x', 'y', 'z'] },
    ],
  },

  // ── Tetragonal ───────────────────────────────────────────────────────────

  111: {
    // P-42m, point group -42m (D2d). Generators of the 8 ops:
    //   E, C2z, -4z+/-, C2x, C2y, σd[110], σd[-110].
    //
    // Site symmetry written in 3-position tetragonal -42m convention
    // (first.second.third = c-axis . [100]/[010] . [110]/[-110]).
    //
    // Coverage: 4 corner 1-folds, 2-fold orbits on C2z axis, 4-fold orbits on
    // C2[100] axes (z=0, z=1/2, x-edge midpoint variants) and σd diagonals,
    // 8-fold general. Letters follow Bilbao Crystallographic Server WPLIST.
    number: 111,
    hm: 'P-42m',
    crystalSystem: 'tetragonal',
    sites: [
      { multiplicity: 1, letter: 'a', siteSymmetry: '-42m', representative: [0, 0, 0] },
      { multiplicity: 1, letter: 'b', siteSymmetry: '-42m', representative: [0, 0, 0.5] },
      { multiplicity: 1, letter: 'c', siteSymmetry: '-42m', representative: [0.5, 0.5, 0.5] },
      { multiplicity: 1, letter: 'd', siteSymmetry: '-42m', representative: [0.5, 0.5, 0] },
      // 2-fold orbits on (1/2, 0, 0) ↔ (0, 1/2, 0) — stabilizer = D2 (222.)
      { multiplicity: 2, letter: 'e', siteSymmetry: '222.', representative: [0.5, 0, 0] },
      { multiplicity: 2, letter: 'f', siteSymmetry: '222.', representative: [0.5, 0, 0.5] },
      // 2-fold orbits on C2z axis with z free — stabilizer = C2v with σd's
      { multiplicity: 2, letter: 'g', siteSymmetry: '2.mm', representative: [0, 0, 'z'] },
      { multiplicity: 2, letter: 'h', siteSymmetry: '2.mm', representative: [0.5, 0.5, 'z'] },
      // 4-fold orbits with site symmetry .2. (on C2[100] axis, two z planes)
      { multiplicity: 4, letter: 'i', siteSymmetry: '.2.', representative: ['x', 0.5, 0] },
      { multiplicity: 4, letter: 'j', siteSymmetry: '.2.', representative: ['x', 0.5, 0.5] },
      { multiplicity: 4, letter: 'k', siteSymmetry: '.2.', representative: ['x', 0, 0.5] },
      { multiplicity: 4, letter: 'l', siteSymmetry: '.2.', representative: ['x', 0, 0] },
      // 4-fold orbit with site symmetry ..m (on σd[110] diagonal mirror)
      { multiplicity: 4, letter: 'm', siteSymmetry: '..m', representative: ['x', 'x', 0.5] },
      { multiplicity: 4, letter: 'n', siteSymmetry: '..m', representative: ['x', 'x', 'z'] },
      // General position
      { multiplicity: 8, letter: 'o', siteSymmetry: '1', representative: ['x', 'y', 'z'] },
    ],
  },

  136: {
    number: 136,
    hm: 'P4_2/mnm',
    crystalSystem: 'tetragonal',
    sites: [
      // rutile TiO2: Ti at 2a, O at 4f
      { multiplicity: 2, letter: 'a', siteSymmetry: 'm.mm', representative: [0, 0, 0] },
      { multiplicity: 2, letter: 'b', siteSymmetry: '-42m', representative: [0, 0, 0.5] },
      { multiplicity: 4, letter: 'c', siteSymmetry: 'm.2m', representative: [0, 0.5, 0] },
      { multiplicity: 4, letter: 'd', siteSymmetry: '-4..', representative: [0, 0.5, 0.25] },
      { multiplicity: 4, letter: 'e', siteSymmetry: '2mm', representative: [0, 0, 'z'] },
      { multiplicity: 4, letter: 'f', siteSymmetry: 'm.2m', representative: ['x', 'x', 0] },
      { multiplicity: 8, letter: 'h', siteSymmetry: 'm..', representative: [0, 0.5, 'z'] },
      { multiplicity: 8, letter: 'i', siteSymmetry: 'm..', representative: ['x', 'y', 0] },
      { multiplicity: 8, letter: 'j', siteSymmetry: '..2', representative: ['x', 'x', 'z'] },
      { multiplicity: 16, letter: 'k', siteSymmetry: '1', representative: ['x', 'y', 'z'] },
    ],
  },

  // ── Orthorhombic ────────────────────────────────────────────────────────

  62: {
    number: 62,
    hm: 'Pnma',
    crystalSystem: 'orthorhombic',
    sites: [
      { multiplicity: 4, letter: 'a', siteSymmetry: '-1', representative: [0, 0, 0] },
      { multiplicity: 4, letter: 'b', siteSymmetry: '-1', representative: [0, 0, 0.5] },
      { multiplicity: 4, letter: 'c', siteSymmetry: '.m.', representative: ['x', 0.25, 'z'] },
      { multiplicity: 8, letter: 'd', siteSymmetry: '1', representative: ['x', 'y', 'z'] },
    ],
  },

  // ── Monoclinic ──────────────────────────────────────────────────────────

  14: {
    number: 14,
    hm: 'P2_1/c',
    crystalSystem: 'monoclinic',
    sites: [
      { multiplicity: 2, letter: 'a', siteSymmetry: '-1', representative: [0, 0, 0] },
      { multiplicity: 2, letter: 'b', siteSymmetry: '-1', representative: [0.5, 0, 0] },
      { multiplicity: 2, letter: 'c', siteSymmetry: '-1', representative: [0, 0, 0.5] },
      { multiplicity: 2, letter: 'd', siteSymmetry: '-1', representative: [0.5, 0, 0.5] },
      { multiplicity: 4, letter: 'e', siteSymmetry: '1', representative: ['x', 'y', 'z'] },
    ],
  },

  // ── Triclinic ───────────────────────────────────────────────────────────

  1: {
    number: 1,
    hm: 'P1',
    crystalSystem: 'triclinic',
    sites: [
      { multiplicity: 1, letter: 'a', siteSymmetry: '1', representative: ['x', 'y', 'z'] },
    ],
  },

  2: {
    number: 2,
    hm: 'P-1',
    crystalSystem: 'triclinic',
    sites: [
      { multiplicity: 1, letter: 'a', siteSymmetry: '-1', representative: [0, 0, 0] },
      { multiplicity: 1, letter: 'b', siteSymmetry: '-1', representative: [0, 0, 0.5] },
      { multiplicity: 1, letter: 'c', siteSymmetry: '-1', representative: [0, 0.5, 0] },
      { multiplicity: 1, letter: 'd', siteSymmetry: '-1', representative: [0.5, 0, 0] },
      { multiplicity: 1, letter: 'e', siteSymmetry: '-1', representative: [0.5, 0.5, 0] },
      { multiplicity: 1, letter: 'f', siteSymmetry: '-1', representative: [0.5, 0, 0.5] },
      { multiplicity: 1, letter: 'g', siteSymmetry: '-1', representative: [0, 0.5, 0.5] },
      { multiplicity: 1, letter: 'h', siteSymmetry: '-1', representative: [0.5, 0.5, 0.5] },
      { multiplicity: 2, letter: 'i', siteSymmetry: '1', representative: ['x', 'y', 'z'] },
    ],
  },
}

/**
 * List all space group numbers with data in this table.
 */
export function getSupportedSpaceGroups(): number[] {
  return Object.keys(SPACE_GROUP_WYCKOFF).map(Number).sort((a, b) => a - b)
}

/**
 * Lookup space-group data; returns null if not tabulated.
 */
export function getSpaceGroupData(sgNumber: number): SpaceGroupWyckoff | null {
  return SPACE_GROUP_WYCKOFF[sgNumber] ?? null
}
