/** MCP-facing validation for canonical fixed-charge parameter packages. */

import type { ZatomToolDefinition, ZatomToolResult } from './contracts'
import { ZATOM_STRUCTURE_JSON_SCHEMA } from './contracts'
import {
  parseZatomForceFieldPackage,
  type ZatomForceFieldPackageValidation,
  ZatomForceFieldPackageInputError,
  ZATOM_FORCE_FIELD_PACKAGE_SCHEMA,
} from './force-field-package'
import { parseZatomStructure, ZatomStructureInputError } from './structure-validation'

const validatePackageTool: ZatomToolDefinition<ZatomForceFieldPackageValidation> = {
  manifest: {
    name: 'force_field_validate_package',
    title: 'Validate a canonical ligand force-field parameter package',
    version: '1.0.0',
    description: 'Validate and canonicalize a topology-bound fixed-charge parameter artifact, enforce complete atom/bond/angle/proper coverage and provenance, compute its stable fingerprint, and return visual targets for extreme parameters and bond-reference mismatch.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['package'],
      properties: {
        package: {
          type: 'object',
          description: `Canonical ${ZATOM_FORCE_FIELD_PACKAGE_SCHEMA} artifact from a trusted parameterization provider.`,
          required: ['schemaVersion', 'structureFingerprint', 'topologyFingerprint', 'atomIds', 'template', 'nonbonded', 'atoms', 'bonds', 'angles', 'properTorsions', 'improperTorsions', 'provenance'],
          properties: { schemaVersion: { const: ZATOM_FORCE_FIELD_PACKAGE_SCHEMA } },
        },
        structure: ZATOM_STRUCTURE_JSON_SCHEMA,
        useActiveStructure: {
          type: 'boolean',
          default: true,
          description: 'Read the active structure when an explicit structure is omitted.',
        },
        allowCompatibleGeometry: {
          type: 'boolean',
          default: false,
          description: 'Allow coordinate/metadata drift from the original parameterization source while still requiring the exact topology fingerprint, ordered mapping, elements, formal charge, and bonded coverage.',
        },
      },
    },
    effects: { structure: 'read', workspace: 'read', visual: 'none' },
    tags: ['force-field', 'ligand', 'parameterization', 'topology', 'validation', 'fingerprint', 'visual-validation'],
  },
  execute: async (input, context): Promise<ZatomToolResult<ZatomForceFieldPackageValidation>> => {
    try {
      const rawStructure = input.structure !== undefined
        ? input.structure
        : input.useActiveStructure === false
          ? null
          : await context.readStructure?.() ?? null
      if (!rawStructure) {
        throw new ZatomForceFieldPackageInputError(
          'force_field_package_structure_required',
          'An explicit or active canonical structure is required to validate the package',
        )
      }
      const structure = parseZatomStructure(rawStructure)
      const result = parseZatomForceFieldPackage(input.package, {
        structure,
        allowCompatibleGeometry: input.allowCompatibleGeometry === true,
      })
      return {
        ok: true,
        tool: 'force_field_validate_package',
        summary: `Validated ${result.package.schemaVersion} ${result.fingerprint} for ${result.package.atomIds.length} atoms`,
        data: result,
        checks: result.checks,
      }
    } catch (error) {
      if (error instanceof ZatomForceFieldPackageInputError || error instanceof ZatomStructureInputError) {
        return {
          ok: false,
          tool: 'force_field_validate_package',
          summary: error.message,
          error: { code: error.code, message: error.message },
        }
      }
      const message = error instanceof Error ? error.message : String(error)
      return {
        ok: false,
        tool: 'force_field_validate_package',
        summary: message,
        error: { code: 'force_field_package_validation_failed', message },
      }
    }
  },
}

export const FORCE_FIELD_PACKAGE_ZATOM_AGENT_TOOLS: readonly ZatomToolDefinition[] = [validatePackageTool]
