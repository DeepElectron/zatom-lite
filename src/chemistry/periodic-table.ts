/**
 * Periodic-table mapping between atomic number and symbol for Z=1..103.
 *
 * Shared chemistry constants contain no UI or domain-specific data. Colors, radii, masses, and
 * other modeler metadata remain in lib/crystal/elements.ELEMENTS.
 *
 * This mapping previously appeared in four places:
 * - canvas/ui/canvas-utils.Z_TO_SYMBOL (Z 1-58)
 * - shared/parsers/structureParser.ELEMENT_TO_Z (Z 1-92)
 * - modeler/lib/crystal/xyz-parser.getElementFromAtomicNumber (Z 0-103)
 * - modeler/lib/crystal/elements.atomicNumberToSymbol (derived sparsely from ELEMENTS)
 *
 * All callers now import this canonical table.
 */

// Index 0 is the unknown `X` placeholder; indices 1-103 are real elements.
const ELEMENT_SYMBOLS: readonly string[] = [
  'X',
  'H', 'He', 'Li', 'Be', 'B', 'C', 'N', 'O', 'F', 'Ne',                          // 1-10
  'Na', 'Mg', 'Al', 'Si', 'P', 'S', 'Cl', 'Ar',                                  // 11-18
  'K', 'Ca', 'Sc', 'Ti', 'V', 'Cr', 'Mn', 'Fe', 'Co', 'Ni', 'Cu', 'Zn',          // 19-30
  'Ga', 'Ge', 'As', 'Se', 'Br', 'Kr',                                            // 31-36
  'Rb', 'Sr', 'Y', 'Zr', 'Nb', 'Mo', 'Tc', 'Ru', 'Rh', 'Pd', 'Ag', 'Cd',         // 37-48
  'In', 'Sn', 'Sb', 'Te', 'I', 'Xe',                                             // 49-54
  'Cs', 'Ba',
  'La', 'Ce', 'Pr', 'Nd', 'Pm', 'Sm', 'Eu', 'Gd', 'Tb', 'Dy', 'Ho', 'Er', 'Tm', 'Yb', 'Lu', // 57-71
  'Hf', 'Ta', 'W', 'Re', 'Os', 'Ir', 'Pt', 'Au', 'Hg',                           // 72-80
  'Tl', 'Pb', 'Bi', 'Po', 'At', 'Rn',                                            // 81-86
  'Fr', 'Ra',
  'Ac', 'Th', 'Pa', 'U', 'Np', 'Pu', 'Am', 'Cm', 'Bk', 'Cf', 'Es', 'Fm', 'Md', 'No', 'Lr', // 89-103
]

/** Atomic number to symbol, including 0 -> `X`. */
export const Z_TO_SYMBOL: Readonly<Record<number, string>> = (() => {
  const m: Record<number, string> = {}
  ELEMENT_SYMBOLS.forEach((sym, z) => { m[z] = sym })
  return m
})()

/** Symbol to atomic number, including `X` -> 0. */
export const SYMBOL_TO_Z: Readonly<Record<string, number>> = (() => {
  const m: Record<string, number> = {}
  ELEMENT_SYMBOLS.forEach((sym, z) => { m[sym] = z })
  return m
})()

/** Convert an atomic number to a symbol; unknown values return `X`. */
export function atomicNumberToSymbol(z: number): string {
  return Z_TO_SYMBOL[z] || 'X'
}

/**
 * Convert an element symbol to an atomic number.
 *
 * Accept element symbols case-insensitively, numeric strings, or numbers directly.
 *
 * Unknown values return 0, the atomic number used by the `X` placeholder.
 */
export function symbolToAtomicNumber(sym: unknown): number {
  if (typeof sym === 'number') return sym
  if (typeof sym !== 'string') return 0
  const s = sym.trim()
  if (!s) return 0
  if (/^\d+$/.test(s)) return Number(s)
  // Normalize symbol case, for example `fe` -> `Fe`.
  const capitalized = s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
  return SYMBOL_TO_Z[capitalized] || 0
}
