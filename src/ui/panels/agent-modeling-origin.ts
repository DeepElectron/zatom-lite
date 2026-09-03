export interface AgentModelingOrigin {
  viewportId: string
  structureFingerprint: string | null
  trajectoryFingerprint: string | null
}

/** Return a user-facing mismatch reason, or null when a candidate still targets its exact origin. */
export function agentModelingOriginMismatch(
  expected: AgentModelingOrigin,
  current: AgentModelingOrigin,
): string | null {
  if (current.viewportId !== expected.viewportId) {
    return `Active viewport changed from ${expected.viewportId} to ${current.viewportId}`
  }
  if (current.structureFingerprint !== expected.structureFingerprint) {
    return 'The active structure changed after this candidate was generated'
  }
  if (current.trajectoryFingerprint !== expected.trajectoryFingerprint) {
    return 'The active trajectory changed after this candidate was generated'
  }
  return null
}
