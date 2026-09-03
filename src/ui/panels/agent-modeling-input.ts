export interface AgentInputSchema {
  type?: string | string[]
  title?: string
  description?: string
  default?: unknown
  const?: unknown
  enum?: unknown[]
  minimum?: number
  maximum?: number
  exclusiveMinimum?: number
  exclusiveMaximum?: number
  minLength?: number
  maxLength?: number
  minItems?: number
  maxItems?: number
  contentEncoding?: string
  contentMediaType?: string
  properties?: Record<string, AgentInputSchema>
  required?: string[]
  items?: AgentInputSchema
  oneOf?: AgentInputSchema[]
  anyOf?: AgentInputSchema[]
  allOf?: AgentInputSchema[]
}

export interface ParsedAgentInput {
  input: Record<string, unknown>
  errors: Record<string, string>
}

function schemaType(schema: AgentInputSchema): string | undefined {
  return Array.isArray(schema.type) ? schema.type.find((value) => value !== 'null') : schema.type
}

export function formatAgentFieldLabel(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/^./, (letter) => letter.toUpperCase())
}

export function encodeAgentDraftValue(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value, null, 2)
}

export function createAgentInputDraft(
  schema: AgentInputSchema,
  preset: Record<string, unknown> = {},
): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [name, field] of Object.entries(schema.properties ?? {})) {
    const value = Object.prototype.hasOwnProperty.call(preset, name) ? preset[name] : field.default
    result[name] = encodeAgentDraftValue(value)
  }
  for (const [name, value] of Object.entries(preset)) {
    if (!(name in result)) result[name] = encodeAgentDraftValue(value)
  }
  return result
}

function parseJson(raw: string, expected: 'array' | 'object'): unknown {
  const parsed = JSON.parse(raw)
  if (expected === 'array' && !Array.isArray(parsed)) throw new Error('Must be a JSON array')
  if (expected === 'object' && (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))) {
    throw new Error('Must be a JSON object')
  }
  return parsed
}

function parseNumber(raw: string, integer: boolean, schema: AgentInputSchema): number {
  const value = Number(raw)
  if (!Number.isFinite(value)) throw new Error('Must be a finite number')
  if (integer && !Number.isInteger(value)) throw new Error('Must be an integer')
  if (schema.minimum !== undefined && value < schema.minimum) throw new Error(`Must be at least ${schema.minimum}`)
  if (schema.maximum !== undefined && value > schema.maximum) throw new Error(`Must be at most ${schema.maximum}`)
  if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) {
    throw new Error(`Must be greater than ${schema.exclusiveMinimum}`)
  }
  if (schema.exclusiveMaximum !== undefined && value >= schema.exclusiveMaximum) {
    throw new Error(`Must be less than ${schema.exclusiveMaximum}`)
  }
  return value
}

function parseArray(raw: string, schema: AgentInputSchema): unknown[] {
  const itemType = schemaType(schema.items ?? {})
  const parsed = raw.trim().startsWith('[')
    ? parseJson(raw, 'array') as unknown[]
    : raw.split(',').map((value) => value.trim()).filter(Boolean).map((value) => {
        if (itemType === 'number') return parseNumber(value, false, schema.items ?? {})
        if (itemType === 'integer') return parseNumber(value, true, schema.items ?? {})
        if (itemType === 'boolean') {
          if (value !== 'true' && value !== 'false') throw new Error('Boolean arrays must contain true or false')
          return value === 'true'
        }
        return value
      })
  if (schema.minItems !== undefined && parsed.length < schema.minItems) {
    throw new Error(`Requires at least ${schema.minItems} item${schema.minItems === 1 ? '' : 's'}`)
  }
  if (schema.maxItems !== undefined && parsed.length > schema.maxItems) {
    throw new Error(`Allows at most ${schema.maxItems} item${schema.maxItems === 1 ? '' : 's'}`)
  }
  return parsed
}

function parseValue(raw: string, schema: AgentInputSchema): unknown {
  if (schema.const !== undefined) return schema.const
  if (schema.enum?.length) {
    const match = schema.enum.find((candidate) => String(candidate) === raw)
    if (match === undefined) throw new Error('Choose one of the supported values')
    return match
  }
  const type = schemaType(schema)
  if (type === 'boolean') {
    if (raw !== 'true' && raw !== 'false') throw new Error('Choose true or false')
    return raw === 'true'
  }
  if (type === 'number') return parseNumber(raw, false, schema)
  if (type === 'integer') return parseNumber(raw, true, schema)
  if (type === 'array') return parseArray(raw, schema)
  if (type === 'object' || schema.properties) return parseJson(raw, 'object')
  return raw
}

export function parseAgentInputDraft(
  schema: AgentInputSchema,
  draft: Record<string, string>,
): ParsedAgentInput {
  const input: Record<string, unknown> = {}
  const errors: Record<string, string> = {}
  const required = new Set(schema.required ?? [])
  for (const [name, field] of Object.entries(schema.properties ?? {})) {
    const raw = draft[name]?.trim() ?? ''
    if (!raw) {
      if (required.has(name) && field.const === undefined) errors[name] = 'Required'
      else if (field.const !== undefined) input[name] = field.const
      continue
    }
    try {
      input[name] = parseValue(raw, field)
    } catch (error) {
      errors[name] = error instanceof Error ? error.message : String(error)
    }
  }
  return { input, errors }
}

export function agentFieldUsesJsonEditor(schema: AgentInputSchema): boolean {
  const type = schemaType(schema)
  const variants = schema.oneOf ?? schema.anyOf ?? schema.allOf ?? []
  const item = schema.items ?? {}
  const itemVariants = item.oneOf ?? item.anyOf ?? item.allOf ?? []
  return type === 'object'
    || !!schema.properties
    || variants.some((variant) => schemaType(variant) === 'object' || !!variant.properties)
    || (type === 'array' && (
      schemaType(item) === 'object'
      || !!item.properties
      || itemVariants.some((variant) => schemaType(variant) === 'object' || !!variant.properties)
    ))
}

export function agentFieldUsesMultilineEditor(schema: AgentInputSchema): boolean {
  return schemaType(schema) === 'string' && (schema.maxLength ?? 0) >= 4096
}

export function agentFieldUsesFilePicker(schema: AgentInputSchema): boolean {
  return schemaType(schema) === 'string' && schema.contentEncoding === 'base64'
}

export function encodeAgentFileBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunkSize = 32 * 1024
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)))
  }
  return btoa(binary)
}

export function agentFieldIsAdvanced(name: string): boolean {
  return ['structure', 'sourceTrajectory', 'forceFieldPackage', 'chemicalStateEnsemble',
    'restarts', 'stepsPerRestart', 'shellToleranceA', 'tripletWeight', 'quadrupletWeight'].includes(name)
    || name.startsWith('max')
    || name.startsWith('maximum')
}
