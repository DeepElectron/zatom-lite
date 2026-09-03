/**
 * Shared helpers for zatom agent tool modules.
 *
 * Every tool module builds manifests and failure envelopes the same way; these
 * canonical implementations replace the per-module copies so a new module only
 * imports them instead of re-deriving the conventions.
 */

import type { ZatomStructure, ZatomToolContext, ZatomToolResult } from './contracts'
import { parseZatomStructure, ZatomStructureInputError } from './structure-validation'

/** Closed-property JSON Schema object, the standard zatom tool input/output shape. */
export const objectSchema = (
  properties: Record<string, unknown>,
  required: string[] = [],
): Record<string, unknown> => ({
  type: 'object',
  additionalProperties: false,
  properties,
  ...(required.length ? { required } : {}),
})

/** Matches the project-wide lowercase snake_case domain error code convention. */
const DOMAIN_ERROR_CODE = /^[a-z][a-z0-9_]{1,63}$/

/**
 * Canonical failure envelope for zatom agent tools.
 *
 * Domain input errors follow one convention project-wide: an Error subclass
 * carrying a lowercase snake_case `code` string. Those surface their own code;
 * everything else maps to `tool_execution_failed`. The format gate keeps
 * platform codes such as Node's uppercase `ENOENT` out of the tool contract.
 */
export function toolError<T = unknown>(tool: string, error: unknown): ZatomToolResult<T> {
  const message = error instanceof Error ? error.message : String(error)
  const rawCode = error instanceof Error ? (error as Error & { code?: unknown }).code : undefined
  const code = typeof rawCode === 'string' && DOMAIN_ERROR_CODE.test(rawCode)
    ? rawCode
    : 'tool_execution_failed'
  return { ok: false, tool, summary: message, error: { code, message } }
}

/**
 * Resolve the structure a tool operates on: an explicit `structure` input wins,
 * otherwise the active workspace structure; both are re-parsed at the boundary.
 */
export async function resolveStructure(
  input: Record<string, unknown>,
  context: ZatomToolContext,
): Promise<ZatomStructure> {
  if (input.structure !== undefined) return parseZatomStructure(input.structure)
  const structure = await context.readStructure?.()
  if (!structure) {
    throw new ZatomStructureInputError(
      'no_active_structure',
      'No structure was supplied and the active workspace is empty',
    )
  }
  return parseZatomStructure(structure)
}

/** Read an optional finite-number input, failing closed on non-numeric values. */
export function numberOption(input: Record<string, unknown>, name: string): number | undefined {
  if (input[name] === undefined) return undefined
  const value = Number(input[name])
  if (!Number.isFinite(value)) {
    throw new ZatomStructureInputError('invalid_number', `${name} must be a finite number`)
  }
  return value
}
