import { FileUp, Loader2, X } from 'lucide-react'
import { useRef, useState, type CSSProperties } from 'react'
import type { AgentInputSchema } from './agent-modeling-input'
import {
  agentFieldIsAdvanced,
  agentFieldUsesFilePicker,
  agentFieldUsesMultilineEditor,
  agentFieldUsesJsonEditor,
  encodeAgentFileBase64,
  formatAgentFieldLabel,
} from './agent-modeling-input'

const fieldStyle: CSSProperties = {
  width: '100%',
  borderRadius: 8,
  border: '1px solid var(--panel-border)',
  background: 'var(--panel-elevated)',
  color: 'var(--panel-text)',
  fontSize: 12,
  outline: 'none',
}

function schemaType(schema: AgentInputSchema): string | undefined {
  return Array.isArray(schema.type) ? schema.type.find((value) => value !== 'null') : schema.type
}

function boundedTextareaRows(value: string | undefined): number {
  if (!value) return 3
  let rows = 2
  for (let index = 0; index < value.length && rows < 8; index++) if (value.charCodeAt(index) === 10) rows++
  return Math.max(3, rows)
}

function base64ByteCount(value: string): number {
  if (!value || value.length % 4 !== 0) return 0
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
  return value.length / 4 * 3 - padding
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`
}

function Base64FileField({
  name,
  schema,
  value,
  onChange,
}: {
  name: string
  schema: AgentInputSchema
  value: string
  onChange: (value: string) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [reading, setReading] = useState(false)
  const [readError, setReadError] = useState<string | null>(null)
  const selectedBytes = base64ByteCount(value)
  const maximumBytes = schema.maxLength === undefined ? null : Math.floor(schema.maxLength / 4) * 3

  const readFile = async (file: File) => {
    setReading(true)
    setReadError(null)
    try {
      if (maximumBytes !== null && file.size > maximumBytes) {
        throw new Error(`File exceeds the ${formatBytes(maximumBytes)} input limit`)
      }
      const encoded = encodeAgentFileBase64(await file.arrayBuffer())
      if (schema.maxLength !== undefined && encoded.length > schema.maxLength) {
        throw new Error('Encoded file exceeds the provider input limit')
      }
      onChange(encoded)
      setFileName(file.name)
    } catch (error) {
      setReadError(error instanceof Error ? error.message : String(error))
    } finally {
      setReading(false)
    }
  }

  return (
    <div
      className="rounded-lg p-2.5"
      style={{ border: '1px solid var(--panel-border)', background: 'var(--panel-elevated)' }}
      onDragOver={(event) => {
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
      }}
      onDrop={(event) => {
        event.preventDefault()
        const file = event.dataTransfer.files?.[0]
        if (file) void readFile(file)
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={schema.contentMediaType && schema.contentMediaType !== 'application/octet-stream'
          ? schema.contentMediaType
          : undefined}
        className="hidden"
        aria-label={`Choose ${formatAgentFieldLabel(name)} file`}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0]
          event.currentTarget.value = ''
          if (file) void readFile(file)
        }}
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={reading}
          onClick={() => inputRef.current?.click()}
          className="zatom-pressable flex min-h-9 flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-[10px] font-semibold disabled:cursor-wait disabled:opacity-60"
          style={{ color: 'var(--panel-text)', background: 'var(--panel-elevated)', border: '1px solid var(--panel-border)' }}
        >
          {reading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileUp className="h-3.5 w-3.5" />}
          {reading ? 'Reading file…' : value ? 'Replace file' : 'Choose local file'}
        </button>
        {value ? (
          <button
            type="button"
            aria-label={`Clear ${formatAgentFieldLabel(name)} file`}
            onClick={() => {
              onChange('')
              setFileName(null)
              setReadError(null)
            }}
            className="zatom-pressable flex h-9 w-9 shrink-0 items-center justify-center rounded-md"
            style={{ color: 'var(--panel-text-tertiary)', border: '1px solid var(--panel-border)' }}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
      <p className="mt-2 truncate" style={{ fontSize: 10, color: value ? 'var(--panel-text-secondary)' : 'var(--panel-text-tertiary)' }}>
        {value
          ? `${fileName ?? 'Embedded local file'} · ${formatBytes(selectedBytes)}`
          : `Drop a file here${maximumBytes === null ? '' : ` · up to ${formatBytes(maximumBytes)}`}`}
      </p>
      {readError ? <p role="alert" className="mt-1.5" style={{ fontSize: 10, color: 'var(--status-red)' }}>{readError}</p> : null}
    </div>
  )
}

function PrimitiveField({
  name,
  schema,
  required,
  value,
  onChange,
}: {
  name: string
  schema: AgentInputSchema
  required: boolean
  value: string
  onChange: (value: string) => void
}) {
  const label = formatAgentFieldLabel(name)
  const emptyLabel = schema.default === undefined
    ? required ? `Select ${label}` : 'Optional'
    : `Default: ${String(schema.default)}`
  if (schema.enum?.length) {
    return (
      <select
        aria-label={formatAgentFieldLabel(name)}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        style={{ ...fieldStyle, height: 38, padding: '0 10px' }}
      >
        <option value="" disabled={required && schema.default === undefined}>{emptyLabel}</option>
        {schema.enum.map((option) => <option key={String(option)} value={String(option)}>{String(option)}</option>)}
      </select>
    )
  }
  const type = schemaType(schema)
  if (type === 'boolean') {
    return (
      <select
        aria-label={formatAgentFieldLabel(name)}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        style={{ ...fieldStyle, height: 38, padding: '0 10px' }}
      >
        <option value="" disabled={required && schema.default === undefined}>{emptyLabel}</option>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    )
  }
  const numeric = type === 'number' || type === 'integer'
  return (
    <input
      aria-label={formatAgentFieldLabel(name)}
      type={numeric ? 'number' : 'text'}
      value={value}
      step={type === 'integer' ? 1 : 'any'}
      min={schema.minimum}
      max={schema.maximum}
      placeholder={schema.default === undefined
        ? required ? `Enter ${label}` : 'Optional'
        : `Default: ${String(schema.default)}`}
      onChange={(event) => onChange(event.target.value)}
      style={{ ...fieldStyle, height: 38, padding: '0 10px' }}
    />
  )
}

function EnumArrayField({
  name,
  schema,
  value,
  onChange,
}: {
  name: string
  schema: AgentInputSchema
  value: string
  onChange: (value: string) => void
}) {
  const options = schema.items?.enum ?? []
  let selected = new Set<string>()
  try {
    const parsed = value.trim().startsWith('[')
      ? JSON.parse(value) as unknown
      : value.split(',').map((item) => item.trim()).filter(Boolean)
    if (Array.isArray(parsed)) selected = new Set(parsed.map(String))
  } catch {
    // Keep the raw draft intact; the normal parser will surface the syntax error on run.
  }
  const toggle = (option: unknown) => {
    const key = String(option)
    const next = new Set(selected)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    onChange(JSON.stringify(options.filter((candidate) => next.has(String(candidate)))))
  }
  return (
    <div
      role="group"
      aria-label={formatAgentFieldLabel(name)}
      className="flex flex-wrap gap-1.5 rounded-lg p-2"
      style={{ border: '1px solid var(--panel-border)', background: 'var(--panel-elevated)' }}
    >
      {options.map((option) => {
        const active = selected.has(String(option))
        return (
          <button
            key={String(option)}
            type="button"
            aria-pressed={active}
            onClick={() => toggle(option)}
            className="zatom-choice zatom-pressable min-h-8 rounded-md px-2.5 py-1.5 text-[10px] font-medium"
            data-selected={active}
          >
            {String(option)}
          </button>
        )
      })}
    </div>
  )
}

export function AgentSchemaFields({
  schema,
  draft,
  errors,
  onChange,
  showAdvanced,
  omit = [],
}: {
  schema: AgentInputSchema
  draft: Record<string, string>
  errors: Record<string, string>
  onChange: (name: string, value: string) => void
  showAdvanced: boolean
  omit?: string[]
}) {
  const required = new Set(schema.required ?? [])
  const omitted = new Set(omit)
  const fields = Object.entries(schema.properties ?? {}).filter(([name, field]) => (
    field.const === undefined
    && !omitted.has(name)
    && (showAdvanced || !agentFieldIsAdvanced(name))
  ))
  if (!fields.length) {
    return <p style={{ fontSize: 11, color: 'var(--panel-text-tertiary)' }}>No parameters are required.</p>
  }
  return (
    <div className="flex flex-col gap-3">
      {fields.map(([name, field]) => (
        <div
          key={name}
          className="flex flex-col gap-1.5"
          data-agent-field-error={errors[name] ? 'true' : undefined}
        >
          <span className="flex items-center justify-between gap-2" style={{ fontSize: 11, fontWeight: 550, color: 'var(--panel-text-secondary)' }}>
            <span>{formatAgentFieldLabel(name)}{required.has(name) ? <span style={{ color: 'var(--panel-text-tertiary)' }}> *</span> : null}</span>
            <code style={{ fontSize: 9, fontWeight: 400, color: 'var(--panel-text-tertiary)' }}>{name}</code>
          </span>
          {agentFieldUsesFilePicker(field) ? (
            <Base64FileField
              name={name}
              schema={field}
              value={draft[name] ?? ''}
              onChange={(value) => onChange(name, value)}
            />
          ) : schemaType(field) === 'array' && field.items?.enum?.length ? (
            <EnumArrayField
              name={name}
              schema={field}
              value={draft[name] ?? ''}
              onChange={(value) => onChange(name, value)}
            />
          ) : agentFieldUsesJsonEditor(field) || agentFieldUsesMultilineEditor(field) ? (
            <textarea
              aria-label={formatAgentFieldLabel(name)}
              value={draft[name] ?? ''}
              rows={boundedTextareaRows(draft[name])}
              placeholder={agentFieldUsesMultilineEditor(field)
                ? 'Paste complete structure text'
                : schemaType(field) === 'array' ? 'JSON array' : 'JSON object'}
              onChange={(event) => onChange(name, event.target.value)}
              style={{ ...fieldStyle, minHeight: 72, padding: 9, resize: 'vertical', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
            />
          ) : (
            <PrimitiveField
              name={name}
              schema={field}
              required={required.has(name)}
              value={draft[name] ?? ''}
              onChange={(value) => onChange(name, value)}
            />
          )}
          {field.description ? (
            <span style={{ fontSize: 10, lineHeight: 1.5, color: 'var(--panel-text-tertiary)' }}>{field.description}</span>
          ) : null}
          {errors[name] ? <span role="alert" style={{ fontSize: 10, color: 'var(--status-red)' }}>{errors[name]}</span> : null}
        </div>
      ))}
    </div>
  )
}
