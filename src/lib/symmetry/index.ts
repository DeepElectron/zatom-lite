/**
 * symmetry - Pure-TS Wyckoff position lookup + orbit-based assignment.
 *
 * Usage:
 * ```
 * import { assignWyckoffPositions } from '../lib/symmetry'
 * const result = assignWyckoffPositions(atoms, 225, opsFromBackend)
 * // result.assignments[i] = { label: '4a', element: 'Na', site, ... }
 * ```
 *
 * Data source: `wyckoff-table.ts` Handwriting overlay common SG (cubic + hex + few others).
 * The real space group + operation set is still provided by backend `structure_symmetry_analyze`; this module only does
 * orbit → Local matching of Wyckoff label, without introducing new backend dependencies.
 */

export {
  SPACE_GROUP_WYCKOFF,
  getSpaceGroupData,
  getSupportedSpaceGroups,
  type WyckoffSite,
  type WyckoffCoord,
  type WyckoffCoordExpr,
  type SpaceGroupWyckoff,
} from './wyckoff-table'

export {
  assignWyckoffPositions,
  generateOrbit,
  groupAtomsByOrbit,
  matchOrbitToSite,
  type WyckoffAtomInput,
  type WyckoffAssignment,
  type WyckoffAnalysis,
  type SymmetryOperation,
  type FractionalCoord,
} from './wyckoff'
