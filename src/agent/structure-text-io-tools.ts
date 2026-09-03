/** MCP tools for strict common-format structure text import and export. */

import { finalizeStructureCandidate, type CandidateEnvelope } from './candidate-tool'
import type { ZatomToolDefinition, ZatomToolManifest } from './contracts'
import { ZATOM_STRUCTURE_JSON_SCHEMA } from './contracts'
import {
  exportStructureText,
  importStructureText,
  ZATOM_STRUCTURE_TEXT_EXPORT_FORMATS,
  ZATOM_STRUCTURE_TEXT_IMPORT_FORMATS,
  ZATOM_STRUCTURE_TEXT_MAX_BYTES,
  ZatomStructureTextIoError,
  type StructureTextImportResult,
  type ZatomStructureTextExportFormat,
  type ZatomStructureTextImportFormat,
} from './structure-text-io'
import { objectSchema, resolveStructure, toolError } from './tool-helpers'

const periodicSchema = {
  type: 'array',
  minItems: 3,
  maxItems: 3,
  items: { type: 'boolean' },
  description: 'Per-axis PBC, required only when extXYZ supplies Lattice without pbc',
}

function importFormat(value: unknown): ZatomStructureTextImportFormat {
  if (typeof value !== 'string' || !ZATOM_STRUCTURE_TEXT_IMPORT_FORMATS.includes(value as ZatomStructureTextImportFormat)) {
    throw new ZatomStructureTextIoError('unsupported_structure_text_format', 'import format is not supported')
  }
  return value as ZatomStructureTextImportFormat
}

function exportFormat(value: unknown): ZatomStructureTextExportFormat {
  if (typeof value !== 'string' || !ZATOM_STRUCTURE_TEXT_EXPORT_FORMATS.includes(value as ZatomStructureTextExportFormat)) {
    throw new ZatomStructureTextIoError('unsupported_structure_text_format', 'export format is not supported')
  }
  return value as ZatomStructureTextExportFormat
}

function periodic(value: unknown): [boolean, boolean, boolean] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length !== 3 || value.some((item) => typeof item !== 'boolean')) {
    throw new ZatomStructureTextIoError('invalid_periodicity', 'periodic must contain three booleans')
  }
  return [value[0], value[1], value[2]]
}

const importManifest: ZatomToolManifest = {
  name: 'structure_import_text',
  title: 'Import strict structure text',
  version: '1.0.0',
  description: 'Parse bounded P1 CIF, VASP 5 POSCAR/CONTCAR or XDATCAR, single-frame XYZ, extXYZ, or MOL V2000 text into a deterministic canonical structure; multi-frame XDATCAR and extXYZ also yield a time-explicit canonical trajectory. Unsupported or silently lossy source semantics fail closed.',
  inputSchema: objectSchema({
    format: { enum: ZATOM_STRUCTURE_TEXT_IMPORT_FORMATS },
    text: {
      type: 'string',
      minLength: 1,
      maxLength: ZATOM_STRUCTURE_TEXT_MAX_BYTES,
      description: 'Complete UTF-8-compatible structure text; runtime limit is measured in bytes',
    },
    label: { type: 'string', minLength: 1, maxLength: 512 },
    periodic: periodicSchema,
    frameTimeStepPs: {
      type: 'number',
      exclusiveMinimum: 0,
      description: 'Required physical spacing in ps for multi-frame extXYZ or between stored XDATCAR configurations',
    },
    applyToWorkspace: { type: 'boolean', default: false, description: 'Apply only when explicitly true and numeric checks pass' },
    captureAfter: { type: 'boolean', description: 'Default true only when applying in a viewport-enabled host' },
  }, ['format', 'text']),
  effects: { structure: 'create', workspace: 'write', visual: 'read' },
  tags: ['structure', 'import', 'cif', 'poscar', 'xdatcar', 'vasp', 'xyz', 'extxyz', 'mol', 'trajectory', 'agent'],
}

type ImportToolData = CandidateEnvelope<StructureTextImportResult>

const importTool: ZatomToolDefinition<ImportToolData> = {
  manifest: importManifest,
  execute: async (input, context) => {
    try {
      const result = importStructureText({
        format: importFormat(input.format),
        text: typeof input.text === 'string' ? input.text : '',
        ...(typeof input.label === 'string' ? { label: input.label } : {}),
        ...(input.periodic === undefined ? {} : { periodic: periodic(input.periodic) }),
        ...(input.frameTimeStepPs === undefined ? {} : { frameTimeStepPs: Number(input.frameTimeStepPs) }),
      })
      const requestedApply = input.applyToWorkspace === true
      const captureAfter = typeof input.captureAfter === 'boolean' ? input.captureAfter : requestedApply
      return await finalizeStructureCandidate({
        tool: importManifest.name,
        result,
        requestedApply,
        captureAfter,
        context,
        summary: (applied, blocked, verified) => (
          `Imported ${result.structure.atoms.length.toLocaleString()} atoms from ${result.format}`
          + `${result.trajectory ? ` with ${result.trajectory.frames.length.toLocaleString()} trajectory frames` : ''}`
          + `${applied ? verified === true ? ' and fingerprint-verified workspace readback' : ' and applied it without verified readback' : blocked ? '; workspace application was blocked' : ''}`
        ),
      })
    } catch (error) {
      return toolError<ImportToolData>(importManifest.name, error)
    }
  },
}

const exportManifest: ZatomToolManifest = {
  name: 'structure_export_text',
  title: 'Export structure text',
  version: '1.0.0',
  description: 'Serialize an explicit or active canonical structure as P1 CIF, VASP 5 POSCAR, XYZ, extXYZ, or MOL V2000 text and enumerate every canonical field the target format cannot represent.',
  inputSchema: objectSchema({
    format: { enum: ZATOM_STRUCTURE_TEXT_EXPORT_FORMATS },
    structure: ZATOM_STRUCTURE_JSON_SCHEMA,
  }, ['format']),
  effects: { structure: 'read', workspace: 'read', visual: 'none' },
  tags: ['structure', 'export', 'cif', 'poscar', 'vasp', 'xyz', 'extxyz', 'mol', 'agent'],
}

const exportTool: ZatomToolDefinition<ReturnType<typeof exportStructureText>> = {
  manifest: exportManifest,
  execute: async (input, context) => {
    try {
      const structure = await resolveStructure(input, context)
      const result = exportStructureText({ structure, format: exportFormat(input.format) })
      return {
        ok: true,
        tool: exportManifest.name,
        summary: `Exported ${structure.atoms.length.toLocaleString()} atoms as ${result.format} (${result.byteCount.toLocaleString()} bytes, ${result.limitations.length} explicit limitations)`,
        data: result,
        checks: result.checks,
      }
    } catch (error) {
      return toolError(exportManifest.name, error)
    }
  },
}

export const STRUCTURE_TEXT_IO_ZATOM_AGENT_TOOLS: readonly ZatomToolDefinition[] = [importTool, exportTool]
