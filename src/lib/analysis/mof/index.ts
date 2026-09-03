/**
 * Barrel for the MOF analysis module.
 *
 * Re-exports the public API surface. UI / store integrations should
 * import from this file rather than reaching into individual modules so
 * we can reshape the internals without touching callers.
 */

export {
  COMMON_DONORS,
  isAlkaliOrAlkalineEarth,
  isCommonDonor,
  isMetal,
  isTransitionMetal,
  normalizeElementSymbol,
} from './metal-table'

export type {
  RacFeature,
  RacVector,
  SBU,
  SBUKind,
  SbuDetectionResult,
} from './types'

export type { SbuDetectionOptions } from './sbu-detect'
export { detectSbus } from './sbu-detect'

export { describeSbuTopology } from './topology'

export type { RacOptions } from './rac'
export { computeAllMetalRacs, computeRac } from './rac'
