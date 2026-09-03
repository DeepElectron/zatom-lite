import { Validator, type Schema, type ValidationError } from 'jsonschema'

export interface ZatomJsonSchemaError {
  instancePath: string
  keyword: string
  message: string
  additionalProperty?: string
}

export interface ZatomJsonSchemaValidation {
  valid: boolean
  errors: readonly ZatomJsonSchemaError[]
}

export type ZatomJsonSchemaValidator = (value: unknown) => ZatomJsonSchemaValidation

const schemaReference: Schema = { $ref: '#' }
const schemaArray: Schema = { type: 'array', minItems: 1, items: schemaReference }

/** Closed Draft-07 subset accepted at the public tool/provider registration boundary. */
const ZATOM_INPUT_SCHEMA_META_SCHEMA: Schema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    $schema: { type: 'string' },
    $ref: { type: 'string' },
    id: { type: 'string' },
    type: {
      oneOf: [
        { enum: ['null', 'boolean', 'object', 'array', 'number', 'integer', 'string'] },
        {
          type: 'array',
          minItems: 1,
          uniqueItems: true,
          items: { enum: ['null', 'boolean', 'object', 'array', 'number', 'integer', 'string'] },
        },
      ],
    },
    title: { type: 'string' },
    description: { type: 'string' },
    default: {},
    const: {},
    enum: { type: 'array', minItems: 1, uniqueItems: true },
    // Container for reusable subschemas. `$ref` was already admitted above, but
    // with no place to define targets the only usable reference was `#` (whole
    // -schema recursion), which forced large shared subschemas to be inlined at
    // every use site. The selection DSL alone is ~3.6 KB and appears 8 times in
    // structure_apply_operations, so that duplication consumed roughly a quarter
    // of the tool-listing budget the model has to read.
    $defs: { type: 'object', additionalProperties: schemaReference },
    properties: { type: 'object', additionalProperties: schemaReference },
    patternProperties: { type: 'object', additionalProperties: schemaReference },
    additionalProperties: { oneOf: [{ type: 'boolean' }, schemaReference] },
    additionalItems: { oneOf: [{ type: 'boolean' }, schemaReference] },
    required: { type: 'array', uniqueItems: true, items: { type: 'string', minLength: 1 } },
    dependencies: {
      type: 'object',
      additionalProperties: {
        oneOf: [
          schemaReference,
          { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'string', minLength: 1 } },
        ],
      },
    },
    propertyNames: schemaReference,
    items: schemaReference,
    contains: schemaReference,
    minItems: { type: 'integer', minimum: 0 },
    maxItems: { type: 'integer', minimum: 0 },
    uniqueItems: { type: 'boolean' },
    minProperties: { type: 'integer', minimum: 0 },
    maxProperties: { type: 'integer', minimum: 0 },
    multipleOf: { type: 'number', exclusiveMinimum: 0 },
    minimum: { type: 'number' },
    maximum: { type: 'number' },
    exclusiveMinimum: { type: 'number' },
    exclusiveMaximum: { type: 'number' },
    minLength: { type: 'integer', minimum: 0 },
    maxLength: { type: 'integer', minimum: 0 },
    pattern: { type: 'string' },
    format: { type: 'string' },
    contentEncoding: { type: 'string' },
    contentMediaType: { type: 'string' },
    oneOf: schemaArray,
    anyOf: schemaArray,
    allOf: schemaArray,
    not: schemaReference,
    if: schemaReference,
    then: schemaReference,
    else: schemaReference,
  },
}

const validationOptions = {
  allowUnknownAttributes: false,
  nestedErrors: false,
  required: true,
} as const

// The closed meta-schema above rejects unknown public keywords. The runtime
// interpreter may therefore ignore supported annotation-only Draft-07 fields
// such as contentEncoding/contentMediaType without weakening schema admission.
const instanceValidationOptions = {
  ...validationOptions,
  allowUnknownAttributes: true,
} as const

function escapeJsonPointerToken(value: string | number): string {
  return String(value).replaceAll('~', '~0').replaceAll('/', '~1')
}

function normalizeError(error: ValidationError): ZatomJsonSchemaError {
  const instancePath = error.path.length
    ? `/${error.path.map(escapeJsonPointerToken).join('/')}`
    : '/'
  return {
    instancePath,
    keyword: error.name,
    message: error.message,
    ...(error.name === 'additionalProperties' && typeof error.argument === 'string'
      ? { additionalProperty: error.argument }
      : {}),
  }
}

function validatePatterns(schema: Record<string, unknown>, path = '#'): void {
  if (typeof schema.pattern === 'string') {
    try {
      new RegExp(schema.pattern)
    } catch (error) {
      throw new Error(`${path}/pattern is invalid: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const properties = schema.properties
  if (properties && typeof properties === 'object' && !Array.isArray(properties)) {
    for (const [name, child] of Object.entries(properties)) {
      validatePatterns(child as Record<string, unknown>, `${path}/properties/${escapeJsonPointerToken(name)}`)
    }
  }
  const patternProperties = schema.patternProperties
  if (patternProperties && typeof patternProperties === 'object' && !Array.isArray(patternProperties)) {
    for (const [pattern, child] of Object.entries(patternProperties)) {
      try {
        new RegExp(pattern)
      } catch (error) {
        throw new Error(`${path}/patternProperties/${escapeJsonPointerToken(pattern)} is invalid: ${error instanceof Error ? error.message : String(error)}`)
      }
      validatePatterns(child as Record<string, unknown>, `${path}/patternProperties/${escapeJsonPointerToken(pattern)}`)
    }
  }
  if (schema.items && typeof schema.items === 'object' && !Array.isArray(schema.items)) {
    validatePatterns(schema.items as Record<string, unknown>, `${path}/items`)
  }
  if (schema.additionalProperties && typeof schema.additionalProperties === 'object'
    && !Array.isArray(schema.additionalProperties)) {
    validatePatterns(schema.additionalProperties as Record<string, unknown>, `${path}/additionalProperties`)
  }
  if (schema.additionalItems && typeof schema.additionalItems === 'object'
    && !Array.isArray(schema.additionalItems)) {
    validatePatterns(schema.additionalItems as Record<string, unknown>, `${path}/additionalItems`)
  }
  const dependencies = schema.dependencies
  if (dependencies && typeof dependencies === 'object' && !Array.isArray(dependencies)) {
    for (const [name, child] of Object.entries(dependencies)) {
      if (Array.isArray(child)) continue
      validatePatterns(child as Record<string, unknown>, `${path}/dependencies/${escapeJsonPointerToken(name)}`)
    }
  }
  for (const keyword of ['propertyNames', 'contains', 'not', 'if', 'then', 'else'] as const) {
    const child = schema[keyword]
    if (!child || typeof child !== 'object' || Array.isArray(child)) continue
    validatePatterns(child as Record<string, unknown>, `${path}/${keyword}`)
  }
  for (const keyword of ['oneOf', 'anyOf', 'allOf'] as const) {
    const children = schema[keyword]
    if (!Array.isArray(children)) continue
    children.forEach((child, index) => validatePatterns(
      child as Record<string, unknown>,
      `${path}/${keyword}/${index}`,
    ))
  }
}

export function formatZatomJsonSchemaErrors(
  errors: readonly ZatomJsonSchemaError[],
  limit = 8,
): string {
  return errors.slice(0, limit).map((error) => {
    const path = error.additionalProperty
      ? `${error.instancePath === '/' ? '' : error.instancePath}/${escapeJsonPointerToken(error.additionalProperty)}`
      : error.instancePath
    return `${path || '/'} ${error.message}`
  }).join('; ')
}

/** Validate the schema once, then return a synchronous CSP-safe interpreter validator. */
export function compileZatomJsonSchema(schema: Record<string, unknown>): ZatomJsonSchemaValidator {
  const schemaValidator = new Validator()
  const definition = schemaValidator.validate(
    schema,
    ZATOM_INPUT_SCHEMA_META_SCHEMA,
    validationOptions,
  )
  if (!definition.valid) {
    throw new Error(formatZatomJsonSchemaErrors(definition.errors.map(normalizeError)))
  }
  validatePatterns(schema)

  // The published schema keeps `$ref` (it is what MCP/WebMCP hosts receive),
  // but the validator runs on a dereferenced copy: jsonschema resolves refs
  // with `new URL(ref, 'thismessage::/')`, which Node accepts and Chromium
  // rejects, so in-page validation of any `$ref` schema threw before this.
  const runtimeSchema = inlineLocalDefs(schema)
  const validator = new Validator()
  return (value) => {
    const result = validator.validate(value, runtimeSchema as Schema, instanceValidationOptions)
    return {
      valid: result.valid,
      errors: result.errors.flatMap((error) => explainOneOf(error, validator)),
    }
  }
}

/**
 * Replace every `{ $ref: '#/$defs/<name>' }` with the referenced definition.
 * Only this local form is used by the registry; anything else is a schema
 * authoring error and is rejected at compile time rather than at call time.
 */
function inlineLocalDefs(schema: Record<string, unknown>): Record<string, unknown> {
  const defs = (schema.$defs ?? {}) as Record<string, unknown>
  const prefix = '#/$defs/'
  const visit = (node: unknown, seen: readonly string[]): unknown => {
    if (Array.isArray(node)) return node.map((item) => visit(item, seen))
    if (!node || typeof node !== 'object') return node
    const record = node as Record<string, unknown>
    if (typeof record.$ref === 'string') {
      const ref = record.$ref
      if (!ref.startsWith(prefix)) throw new Error(`Unsupported $ref "${ref}": only "#/$defs/<name>" is allowed`)
      const name = ref.slice(prefix.length)
      if (!(name in defs)) throw new Error(`$ref "${ref}" has no matching entry in $defs`)
      if (seen.includes(name)) throw new Error(`$ref "${ref}" is recursive; recursive definitions are not supported`)
      const { $ref: _ref, ...siblings } = record
      return { ...(visit(defs[name], [...seen, name]) as Record<string, unknown>), ...siblings }
    }
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(record)) {
      if (key === '$defs') continue
      out[key] = visit(value, seen)
    }
    return out
  }
  return visit(schema, []) as Record<string, unknown>
}

/**
 * "is not exactly one from [subschema 0],[subschema 1],..." tells a caller
 * nothing. When the oneOf branches are discriminated by a shared `const`
 * property (e.g. `op`), report either the allowed values or the errors of
 * the branch the caller actually selected.
 */
function explainOneOf(error: ValidationError, validator: Validator): ZatomJsonSchemaError[] {
  if (error.name !== 'oneOf') return [normalizeError(error)]
  const branches = (error.schema as { oneOf?: unknown })?.oneOf
  const instance = error.instance
  if (!Array.isArray(branches) || !instance || typeof instance !== 'object' || Array.isArray(instance)) {
    return [normalizeError(error)]
  }
  const constOf = (branch: unknown, key: string): unknown => {
    const property = (branch as { properties?: Record<string, { const?: unknown }> })?.properties?.[key]
    return property && 'const' in property ? property.const : undefined
  }
  const candidateKeys = Object.keys((branches[0] as { properties?: Record<string, unknown> })?.properties ?? {})
  const discriminator = candidateKeys.find((key) => branches.every((branch) => constOf(branch, key) !== undefined))
  if (!discriminator) return [normalizeError(error)]
  const base = normalizeError(error)
  const allowed = branches.map((branch) => JSON.stringify(constOf(branch, discriminator)))
  const actual = (instance as Record<string, unknown>)[discriminator]
  const branch = branches.find((item) => constOf(item, discriminator) === actual)
  if (!branch) {
    return [{
      ...base,
      message: actual === undefined
        ? `requires ${discriminator}, one of ${allowed.join(', ')}`
        : `has ${discriminator} ${JSON.stringify(actual)}; expected one of ${allowed.join(', ')}`,
    }]
  }
  // Branches are already dereferenced (see inlineLocalDefs), so a branch
  // validates standalone.
  const nested = validator.validate(instance, branch as Schema, instanceValidationOptions)
  if (nested.valid) return [base]
  return nested.errors.map((child) => {
    const normalized = normalizeError(child)
    const childPath = normalized.instancePath === '/' ? '' : normalized.instancePath
    return {
      ...normalized,
      instancePath: `${base.instancePath === '/' ? '' : base.instancePath}${childPath}` || '/',
      message: `(${discriminator} ${JSON.stringify(actual)}) ${normalized.message}`,
    }
  })
}
