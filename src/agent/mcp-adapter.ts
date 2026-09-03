/** Thin MCP-shape adapter over the host-neutral zatom tool registry. */

import type { ZatomToolContext, ZatomToolManifest, ZatomToolResult } from './contracts'
import { executeZatomAgentTool, listZatomAgentTools } from './tools'

export interface McpToolDefinition {
  name: string
  title?: string
  version: string
  description: string
  inputSchema: Record<string, unknown>
  effects: ZatomToolManifest['effects']
  tags: string[]
}

export type McpContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }

export interface McpToolCallResult {
  content: McpContentBlock[]
  structuredContent: ZatomToolResult
  isError?: boolean
}

export function listZatomMcpTools(): McpToolDefinition[] {
  return listZatomAgentTools().map((tool) => ({
    name: tool.name,
    title: tool.title,
    version: tool.version,
    description: tool.description,
    inputSchema: tool.inputSchema,
    effects: tool.effects,
    tags: [...tool.tags],
  }))
}

function collectImages(value: unknown, out: Array<{ data: string; mimeType: string }>, seen = new Set<unknown>()): void {
  if (!value || typeof value !== 'object' || seen.has(value)) return
  seen.add(value)
  if (!Array.isArray(value)) {
    const obj = value as Record<string, unknown>
    if (typeof obj.imageBase64 === 'string' && typeof obj.mimeType === 'string') {
      out.push({ data: obj.imageBase64, mimeType: obj.mimeType })
    }
    for (const nested of Object.values(obj)) collectImages(nested, out, seen)
  } else {
    for (const nested of value) collectImages(nested, out, seen)
  }
}

function omitImageBytes(value: unknown, ancestors = new Set<unknown>()): unknown {
  if (!value || typeof value !== 'object') return value
  if (ancestors.has(value)) return '[circular]'
  const nextAncestors = new Set(ancestors)
  nextAncestors.add(value)
  if (Array.isArray(value)) return value.map((item) => omitImageBytes(item, nextAncestors))
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
    key,
    key === 'imageBase64' && typeof nested === 'string'
      ? `[${nested.length} base64 chars emitted as MCP image]`
      : omitImageBytes(nested, nextAncestors),
  ]))
}

function conciseResultText(result: ZatomToolResult): string {
  const lines = [`${result.ok ? 'OK' : 'ERROR'} ${result.tool}: ${result.summary}`]
  if (result.error) lines.push(`Error code: ${result.error.code}`)
  if (result.checks?.length) {
    const counts = { pass: 0, warn: 0, fail: 0, skipped: 0 }
    for (const check of result.checks) counts[check.status]++
    lines.push(`Checks: ${counts.pass} pass, ${counts.warn} warn, ${counts.fail} fail, ${counts.skipped} skipped`)
  }
  return lines.join('\n')
}

export async function callZatomMcpTool(
  name: string,
  args: Record<string, unknown> = {},
  context: ZatomToolContext = {},
): Promise<McpToolCallResult> {
  const result = await executeZatomAgentTool(name, args, context)
  const images: Array<{ data: string; mimeType: string }> = []
  collectImages(result.data, images)
  const safeResult = omitImageBytes(result) as ZatomToolResult
  return {
    content: [
      { type: 'text', text: conciseResultText(safeResult) },
      ...images.map((image): McpContentBlock => ({ type: 'image', data: image.data, mimeType: image.mimeType })),
    ],
    structuredContent: safeResult,
    ...(result.ok ? {} : { isError: true }),
  }
}
