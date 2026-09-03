/**
 * Periodic-table partition used by the MOF SBU detector.
 *
 * The split is the standard inorganic-chemistry heuristic:
 *   - Metals: groups 1-2 (alkali / alkaline earth), groups 3-12 (transition
 *     metals), group 13 except B (Al, Ga, In, Tl), Sn / Pb from group 14,
 *     Bi from group 15, and all lanthanides / actinides.
 *   - Non-metals: H, B, C, N, O, F, P, S, Cl, Se, Br, I, Te, At, plus the
 *     noble gases. Si / Ge are treated as non-metals for MOF-detection
 *     purposes because they almost never sit at an SBU node in published
 *     MOF chemistry; classify them as non-metal here even though they are
 *     metalloids on the textbook colour-coded chart.
 *
 * Boundary calls (treated as NON-metal for MOF detection):
 *   - B  (boron)
 *   - Si (silicon)
 *   - As (arsenic)
 *   - Te (tellurium)
 *
 * Boundary calls (treated as metal): Ge is *not* included — kept as
 * non-metal because Ge-MOFs are extremely rare and Ge is more commonly a
 * linker constituent (germanium-imidazolate frameworks have C-Ge as part
 * of the organic backbone).
 *
 * If you need to override the call for a specific dataset, pass an
 * explicit set into the SBU detector — the algorithm consumes this module
 * only via `isMetal()`.
 */

const TRANSITION_METALS: ReadonlySet<string> = new Set([
  // d-block, periods 4-7
  'Sc', 'Ti', 'V', 'Cr', 'Mn', 'Fe', 'Co', 'Ni', 'Cu', 'Zn',
  'Y',  'Zr', 'Nb', 'Mo', 'Tc', 'Ru', 'Rh', 'Pd', 'Ag', 'Cd',
  'Hf', 'Ta', 'W',  'Re', 'Os', 'Ir', 'Pt', 'Au', 'Hg',
  'Rf', 'Db', 'Sg', 'Bh', 'Hs', 'Mt', 'Ds', 'Rg', 'Cn',
])

const ALKALI_ALKALINE_EARTH: ReadonlySet<string> = new Set([
  // Group 1 (excluding H — H is a non-metal in MOF chemistry)
  'Li', 'Na', 'K', 'Rb', 'Cs', 'Fr',
  // Group 2
  'Be', 'Mg', 'Ca', 'Sr', 'Ba', 'Ra',
])

const LANTHANIDES: ReadonlySet<string> = new Set([
  'La', 'Ce', 'Pr', 'Nd', 'Pm', 'Sm', 'Eu', 'Gd',
  'Tb', 'Dy', 'Ho', 'Er', 'Tm', 'Yb', 'Lu',
])

const ACTINIDES: ReadonlySet<string> = new Set([
  'Ac', 'Th', 'Pa', 'U', 'Np', 'Pu', 'Am', 'Cm',
  'Bk', 'Cf', 'Es', 'Fm', 'Md', 'No', 'Lr',
])

/** Post-transition metals + Bi etc. that count as MOF metals. */
const OTHER_METALS: ReadonlySet<string> = new Set([
  // Group 13 (B is non-metal; Tl included)
  'Al', 'Ga', 'In', 'Tl',
  // Group 14 — Sn, Pb (Si, Ge stay non-metal)
  'Sn', 'Pb',
  // Group 15 — Bi only
  'Bi',
  // Group 16 — Po
  'Po',
])

/** Explicit non-metal set used for sanity checks. */
const NON_METALS: ReadonlySet<string> = new Set([
  'H',
  'B',
  'C', 'N', 'O', 'F',
  'Si', 'P', 'S', 'Cl',
  'Ge', 'As', 'Se', 'Br',
  'Te', 'I', 'At',
  // Noble gases
  'He', 'Ne', 'Ar', 'Kr', 'Xe', 'Rn',
])

/**
 * Canonicalize an element symbol to the `Fe` / `C` casing used by the sets above.
 *
 * The sets are written in standard mixed case, but element symbols do not always
 * arrive that way. PDB and mmCIF store `type_symbol` in uppercase (`FE`, `CU`,
 * `ZN`), and the agent's structure operations accept a bare `element` string with
 * no enum or normalization — so `{ op: 'substitute', element: 'FE' }` puts `FE`
 * straight into the structure. Comparing that against a set containing `Fe`
 * silently failed, and because every predicate here defaults to "not a metal",
 * the failure was invisible: an all-iron structure reported zero metals and MOF
 * SBU detection found no nodes at all.
 *
 * Normalizing on read keeps stored symbols untouched, which matters because the
 * PDB exporter re-uppercases on write and its output is byte-compared in tests.
 */
export function normalizeElementSymbol(element: string): string {
  if (!element) return ''
  return element.charAt(0).toUpperCase() + element.slice(1).toLowerCase()
}

/**
 * Return true if `element` is treated as a metal for MOF SBU detection.
 *
 * Accepts any casing. Unknown symbols fall back to `false` (safer to
 * under-classify than to accidentally promote a non-metal to a node).
 */
export function isMetal(element: string): boolean {
  const symbol = normalizeElementSymbol(element)
  if (NON_METALS.has(symbol)) return false
  if (TRANSITION_METALS.has(symbol)) return true
  if (ALKALI_ALKALINE_EARTH.has(symbol)) return true
  if (LANTHANIDES.has(symbol)) return true
  if (ACTINIDES.has(symbol)) return true
  if (OTHER_METALS.has(symbol)) return true
  return false
}

/** d-block transition metal (groups 3-12 across periods 4-7). Any casing. */
export function isTransitionMetal(element: string): boolean {
  return TRANSITION_METALS.has(normalizeElementSymbol(element))
}

/** Group 1 or 2 (excluding hydrogen). Any casing. */
export function isAlkaliOrAlkalineEarth(element: string): boolean {
  return ALKALI_ALKALINE_EARTH.has(normalizeElementSymbol(element))
}

/**
 * Donor atoms commonly used as bridging coordinating atoms in MOF linkers.
 *
 * Used by the SBU detector to decide which non-metals can serve as
 * μ-bridges between two metal centres (carboxylate-O, pyridyl-N, etc.).
 */
export const COMMON_DONORS: ReadonlySet<string> = new Set([
  'O', 'N', 'S', 'F', 'Cl', 'Br', 'I', 'P',
])

/**
 * Case-insensitive membership test for {@link COMMON_DONORS}.
 *
 * Prefer this over `COMMON_DONORS.has(...)` on raw input. Most donors are
 * single-letter symbols where casing cannot matter, which is exactly why the
 * problem hides: only the two-letter halides `Cl` and `Br` misbehave, so a
 * chloride- or bromide-bridged node is dropped while every oxygen and nitrogen
 * bridge in the same structure resolves correctly.
 */
export function isCommonDonor(element: string): boolean {
  return COMMON_DONORS.has(normalizeElementSymbol(element))
}
