/** Bounded, connection-local storage for MCP results that do not fit one message. */

import { createHash } from 'node:crypto'

import type { InspectionTarget, ValidationCheck, ZatomToolResult } from './contracts'
import type { McpToolCallResult } from './mcp-adapter'

export const ZATOM_MCP_INLINE_RESULT_MAX_BYTES = 4 * 1024 * 1024
export const ZATOM_MCP_ARTIFACT_CHUNK_BYTES = 512 * 1024
export const ZATOM_MCP_MAX_ARTIFACT_BYTES = 128 * 1024 * 1024
export const ZATOM_MCP_MAX_STORED_BYTES = 256 * 1024 * 1024

export interface ZatomMcpArtifactReference {
  schemaVersion: 'zatom.mcp-artifact-ref/v1'
  sha256: string
  manifestUri: string
  chunkUriTemplate: string
  mediaType: 'application/json'
  bytes: number
  chunkCount: number
}

export interface ZatomMcpArtifactManifest {
  schemaVersion: 'zatom.mcp-artifact-manifest/v1'
  artifact: ZatomMcpArtifactReference
  tool: string
  summary: string
}

interface StoredArtifact {
  bytes: Buffer
  chunks: Array<{ start: number; end: number }>
  manifest: ZatomMcpArtifactManifest
}

export interface ZatomMcpInspectionTargetIndexEntry {
  inspectionTarget: InspectionTarget
  expectedStructureFingerprint?: string
  expectedTrajectoryFingerprint?: string
}

export class ZatomMcpArtifactStoreError extends Error {
  readonly code: 'mcp_artifact_too_large' | 'mcp_artifact_store_full' | 'mcp_artifact_not_found' | 'mcp_artifact_chunk_not_found'

  constructor(
    code: 'mcp_artifact_too_large' | 'mcp_artifact_store_full' | 'mcp_artifact_not_found' | 'mcp_artifact_chunk_not_found',
    message: string,
  ) {
    super(message)
    this.name = 'ZatomMcpArtifactStoreError'
    this.code = code
  }
}

function digestOf(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function chunkRanges(bytes: Buffer): Array<{ start: number; end: number }> {
  const chunks: Array<{ start: number; end: number }> = []
  let start = 0
  while (start < bytes.length) {
    let end = Math.min(bytes.length, start + ZATOM_MCP_ARTIFACT_CHUNK_BYTES)
    if (end < bytes.length) {
      while (end > start && (bytes[end] & 0xc0) === 0x80) end--
    }
    if (end === start) throw new Error('MCP artifact chunk size cannot contain one UTF-8 code point')
    chunks.push({ start, end })
    start = end
  }
  return chunks
}

function requireDigest(value: string): string {
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new ZatomMcpArtifactStoreError('mcp_artifact_not_found', 'Artifact digest must be 64 lowercase hexadecimal characters')
  }
  return value
}

export class ZatomMcpArtifactStore {
  private readonly artifacts = new Map<string, StoredArtifact>()
  private storedBytes = 0

  put(result: ZatomToolResult, serialized: string): ZatomMcpArtifactReference {
    const bytes = Buffer.from(serialized, 'utf8')
    if (bytes.length > ZATOM_MCP_MAX_ARTIFACT_BYTES) {
      throw new ZatomMcpArtifactStoreError(
        'mcp_artifact_too_large',
        `Structured result uses ${bytes.length} bytes; the MCP artifact limit is ${ZATOM_MCP_MAX_ARTIFACT_BYTES}`,
      )
    }
    const digest = digestOf(bytes)
    const existing = this.artifacts.get(digest)
    if (existing) return existing.manifest.artifact
    if (this.storedBytes + bytes.length > ZATOM_MCP_MAX_STORED_BYTES) {
      throw new ZatomMcpArtifactStoreError(
        'mcp_artifact_store_full',
        `Storing this result would exceed the connection artifact budget ${ZATOM_MCP_MAX_STORED_BYTES} bytes`,
      )
    }
    const chunks = chunkRanges(bytes)
    const artifact: ZatomMcpArtifactReference = {
      schemaVersion: 'zatom.mcp-artifact-ref/v1',
      sha256: digest,
      manifestUri: `zatom-artifact://sha256/${digest}/manifest`,
      chunkUriTemplate: `zatom-artifact://sha256/${digest}/chunks/{index}`,
      mediaType: 'application/json',
      bytes: bytes.length,
      chunkCount: chunks.length,
    }
    this.artifacts.set(digest, {
      bytes,
      chunks,
      manifest: {
        schemaVersion: 'zatom.mcp-artifact-manifest/v1',
        artifact,
        tool: result.tool,
        summary: result.summary,
      },
    })
    this.storedBytes += bytes.length
    return artifact
  }

  manifest(digest: string): ZatomMcpArtifactManifest {
    const artifact = this.artifacts.get(requireDigest(digest))
    if (!artifact) throw new ZatomMcpArtifactStoreError('mcp_artifact_not_found', `Artifact ${digest} is not stored in this MCP connection`)
    return artifact.manifest
  }

  chunk(digest: string, index: number): string {
    const artifact = this.artifacts.get(requireDigest(digest))
    if (!artifact) throw new ZatomMcpArtifactStoreError('mcp_artifact_not_found', `Artifact ${digest} is not stored in this MCP connection`)
    if (!Number.isSafeInteger(index) || index < 0 || index >= artifact.chunks.length) {
      throw new ZatomMcpArtifactStoreError('mcp_artifact_chunk_not_found', `Artifact chunk ${index} is outside 0-${artifact.chunks.length - 1}`)
    }
    const chunk = artifact.chunks[index]
    return artifact.bytes.subarray(chunk.start, chunk.end).toString('utf8')
  }
}

function checkIndex(checks: ValidationCheck[] | undefined): {
  items: Array<Pick<ValidationCheck, 'id' | 'status'> & Partial<ValidationCheck>>
  total: number
  truncated: boolean
} | undefined {
  if (!checks) return undefined
  const ordered = [
    ...checks.filter((check) => check.status !== 'pass'),
    ...checks.filter((check) => check.status === 'pass'),
  ]
  const selected = ordered.slice(0, 4_096)
  return {
    items: selected.map((check) => check.status === 'pass'
      ? { id: check.id, status: check.status }
      : { ...check }),
    total: checks.length,
    truncated: selected.length < checks.length,
  }
}

const HEAVY_RESULT_KEYS = new Set([
  'atoms',
  'bonds',
  'frames',
  'positions',
  'velocitiesAperPs',
  'forcesEvPerA',
  'imageBase64',
])
const MAX_INDEX_TARGET_ATOM_IDS = 256

function canonicalInspectionTarget(value: unknown): InspectionTarget | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const target = value as Partial<InspectionTarget>
  if (typeof target.id !== 'string' || typeof target.reason !== 'string'
    || !Array.isArray(target.center) || target.center.length !== 3
    || !target.center.every((item) => typeof item === 'number' && Number.isFinite(item))
    || typeof target.radius !== 'number' || !Number.isFinite(target.radius) || target.radius < 0
    || !Array.isArray(target.atomIds) || !target.atomIds.every((item) => typeof item === 'string')
    || (target.atomIdsTruncated !== undefined && typeof target.atomIdsTruncated !== 'boolean')
    || (target.trajectoryFrameIndex !== undefined
      && (!Number.isSafeInteger(target.trajectoryFrameIndex) || target.trajectoryFrameIndex < 0))) return null
  const atomIds = target.atomIds.slice(0, MAX_INDEX_TARGET_ATOM_IDS)
  return {
    id: target.id,
    reason: target.reason,
    center: [...target.center],
    radius: target.radius,
    atomIds,
    ...(target.atomIdsTruncated === true || atomIds.length < target.atomIds.length
      ? { atomIdsTruncated: true }
      : {}),
    ...(target.trajectoryFrameIndex === undefined ? {} : { trajectoryFrameIndex: target.trajectoryFrameIndex }),
  }
}

function collectInspectionTargetIndex(
  value: unknown,
  output: ZatomMcpInspectionTargetIndexEntry[],
  state: { visited: number; truncated: boolean },
  expectedStructureFingerprint?: string,
  expectedTrajectoryFingerprint?: string,
  seen = new Map<object, Set<string>>(),
): void {
  if (!value || typeof value !== 'object') return
  if (state.visited >= 50_000) {
    state.truncated = true
    return
  }
  const contextKey = `${expectedStructureFingerprint ?? ''}\u0000${expectedTrajectoryFingerprint ?? ''}`
  const seenContexts = seen.get(value as object)
  if (seenContexts?.has(contextKey)) return
  if (seenContexts) seenContexts.add(contextKey)
  else seen.set(value as object, new Set([contextKey]))
  state.visited++
  if (Array.isArray(value)) {
    for (const item of value) {
      if (state.visited >= 50_000) {
        state.truncated = true
        break
      }
      collectInspectionTargetIndex(
        item,
        output,
        state,
        expectedStructureFingerprint,
        expectedTrajectoryFingerprint,
        seen,
      )
    }
    return
  }
  const record = value as Record<string, unknown>
  const provenance = record.provenance && typeof record.provenance === 'object'
    && !Array.isArray(record.provenance)
    ? record.provenance as Record<string, unknown>
    : null
  const nestedStructureFingerprint = typeof record.structureFingerprint === 'string'
    ? record.structureFingerprint
    : record.structure && typeof provenance?.resultFingerprint === 'string'
      ? provenance.resultFingerprint
      : expectedStructureFingerprint
  let nestedTrajectoryFingerprint = expectedTrajectoryFingerprint
  if (typeof record.trajectoryFingerprint === 'string') {
    nestedTrajectoryFingerprint = record.trajectoryFingerprint
  } else if (record.trajectory && typeof provenance?.trajectoryFingerprint === 'string') {
    nestedTrajectoryFingerprint = provenance.trajectoryFingerprint
  } else if (record.trajectory && !record.structure && typeof provenance?.resultFingerprint === 'string') {
    nestedTrajectoryFingerprint = provenance.resultFingerprint
  }
  for (const [key, nested] of Object.entries(record)) {
    if (key === 'inspectionTargets' && Array.isArray(nested)) {
      for (const candidate of nested) {
        const inspectionTarget = canonicalInspectionTarget(candidate)
        if (!inspectionTarget) {
          state.truncated = true
          continue
        }
        output.push({
          inspectionTarget,
          ...(nestedStructureFingerprint ? { expectedStructureFingerprint: nestedStructureFingerprint } : {}),
          ...(nestedTrajectoryFingerprint ? { expectedTrajectoryFingerprint: nestedTrajectoryFingerprint } : {}),
        })
      }
    } else if (!HEAVY_RESULT_KEYS.has(key)) {
      collectInspectionTargetIndex(
        nested,
        output,
        state,
        nestedStructureFingerprint,
        nestedTrajectoryFingerprint,
        seen,
      )
    }
  }
}

export function materializeLargeMcpResult(
  result: McpToolCallResult,
  store: ZatomMcpArtifactStore,
): McpToolCallResult | {
  content: Array<McpToolCallResult['content'][number] | {
    type: 'resource_link'
    uri: string
    name: string
    description: string
    mimeType: string
  }>
  structuredContent: Record<string, unknown>
  isError?: boolean
} {
  const imageBase64Chars = result.content.reduce((total, block) => (
    block.type === 'image' ? total + block.data.length : total
  ), 0)
  if (imageBase64Chars > ZATOM_MCP_INLINE_RESULT_MAX_BYTES) {
    const message = `MCP image payload uses ${imageBase64Chars} base64 characters; retry capture with a smaller maxDim and JPEG format`
    return {
      content: [{ type: 'text', text: `ERROR ${result.structuredContent.tool}: ${message}\nError code: mcp_image_payload_too_large` }],
      structuredContent: {
        ok: false,
        tool: result.structuredContent.tool,
        summary: message,
        error: { code: 'mcp_image_payload_too_large', message },
        imageBase64Chars,
      },
      isError: true,
    }
  }
  const serialized = JSON.stringify(result.structuredContent)
  const bytes = Buffer.byteLength(serialized, 'utf8')
  if (bytes <= ZATOM_MCP_INLINE_RESULT_MAX_BYTES) return result
  try {
    const artifact = store.put(result.structuredContent, serialized)
    const targetIndex: ZatomMcpInspectionTargetIndexEntry[] = []
    const targetIndexState = { visited: 0, truncated: false }
    collectInspectionTargetIndex(result.structuredContent.data, targetIndex, targetIndexState)
    const allUniqueTargets = [...new Map(targetIndex.map((entry) => [
      JSON.stringify([
        entry.expectedStructureFingerprint ?? null,
        entry.expectedTrajectoryFingerprint ?? null,
        entry.inspectionTarget,
      ]),
      entry,
    ])).values()]
    const uniqueTargets = allUniqueTargets.slice(0, 256)
    const checkSummary = checkIndex(result.structuredContent.checks)
    const compact = {
      schemaVersion: 'zatom.mcp-materialized-result/v2',
      ok: result.structuredContent.ok,
      tool: result.structuredContent.tool,
      summary: result.structuredContent.summary,
      ...(result.structuredContent.error ? {
        error: {
          code: result.structuredContent.error.code,
          message: result.structuredContent.error.message,
        },
      } : {}),
      ...(checkSummary ? {
        checks: checkSummary.items,
        checkCount: checkSummary.total,
        checksTruncated: checkSummary.truncated,
      } : {}),
      inspectionTargetIndex: uniqueTargets,
      inspectionTargetCount: allUniqueTargets.length,
      inspectionTargetsTruncated: targetIndexState.truncated || uniqueTargets.length < allUniqueTargets.length,
      artifact,
    }
    return {
      content: [
        ...result.content.filter((block) => block.type === 'text'),
        {
          type: 'resource_link',
          uri: artifact.manifestUri,
          name: `${result.structuredContent.tool} structured result`,
          description: `Complete ${artifact.bytes}-byte canonical result, split into ${artifact.chunkCount} bounded UTF-8 chunks`,
          mimeType: 'application/json',
        },
        ...result.content.filter((block) => block.type === 'image'),
      ],
      structuredContent: compact,
      ...(result.isError ? { isError: true } : {}),
    }
  } catch (error) {
    const code = error instanceof ZatomMcpArtifactStoreError ? error.code : 'mcp_artifact_materialization_failed'
    const message = error instanceof Error ? error.message : String(error)
    return {
      content: [{ type: 'text', text: `ERROR ${result.structuredContent.tool}: ${message}\nError code: ${code}` }],
      structuredContent: {
        ok: false,
        tool: result.structuredContent.tool,
        summary: message,
        error: { code, message },
        originalResultBytes: bytes,
      },
      isError: true,
    }
  }
}
