/** Browser-safe keys for structure-bound spglib analysis and construction evidence. */

import type { ZatomStructure } from './contracts'

export const ZATOM_SPGLIB_SYMMETRY_ANNOTATION_SCHEMA = 'zatom.spglib-symmetry/v1' as const
export const ZATOM_SPGLIB_EXPANSION_ANNOTATION_SCHEMA = 'zatom.spglib-expansion/v1' as const

export const ZATOM_SPGLIB_SYMMETRY_METADATA_KEY = 'zatom.analysis.spglib' as const
export const ZATOM_SPGLIB_SYMMETRY_PROPERTY_PREFIX = 'zatom.analysis.spglib' as const
export const ZATOM_SPGLIB_EXPANSION_METADATA_KEY = 'zatom.construction.spglib' as const
export const ZATOM_SPGLIB_EXPANSION_PROPERTY_PREFIX = 'zatom.construction.spglib' as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/** True only for a canonical annotation whose declared atom ordering is still exact. */
export function hasZatomSpglibStructureAnnotation(structure: ZatomStructure): boolean {
  const atomIds = structure.atoms.map((atom) => atom.id)
  const analysis = structure.metadata?.[ZATOM_SPGLIB_SYMMETRY_METADATA_KEY]
  if (isRecord(analysis)
    && analysis.schemaVersion === ZATOM_SPGLIB_SYMMETRY_ANNOTATION_SCHEMA
    && Array.isArray(analysis.atomIds)
    && analysis.atomIds.length === atomIds.length
    && analysis.atomIds.every((id, index) => id === atomIds[index])) return true

  const expansion = structure.metadata?.[ZATOM_SPGLIB_EXPANSION_METADATA_KEY]
  return isRecord(expansion)
    && expansion.schemaVersion === ZATOM_SPGLIB_EXPANSION_ANNOTATION_SCHEMA
    && Array.isArray(expansion.atomIds)
    && expansion.atomIds.length === atomIds.length
    && expansion.atomIds.every((id, index) => id === atomIds[index])
}
