export const ZATOM_LOCAL_ARTIFACT_REFERENCE_SCHEMA = 'zatom.local-artifact-ref/v1' as const
export const ZATOM_LOCAL_JSON_ARTIFACT_SCHEMA = 'zatom.local-json-artifact/v1' as const

export interface LocalJsonArtifactReference {
  schemaVersion: typeof ZATOM_LOCAL_ARTIFACT_REFERENCE_SCHEMA
  sha256: string
  mediaType: 'application/json'
  bytes: number
}

export interface StoredLocalJsonArtifact {
  schemaVersion: typeof ZATOM_LOCAL_JSON_ARTIFACT_SCHEMA
  sha256: string
  mediaType: 'application/json'
  bytes: number
  json: string
}

export function utf8Bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Web Crypto SHA-256 is required for local modeling artifacts')
  }
  const input = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(input).set(bytes)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', input)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function localJsonArtifactReference(
  artifact: StoredLocalJsonArtifact,
): LocalJsonArtifactReference {
  return {
    schemaVersion: ZATOM_LOCAL_ARTIFACT_REFERENCE_SCHEMA,
    sha256: artifact.sha256,
    mediaType: artifact.mediaType,
    bytes: artifact.bytes,
  }
}
