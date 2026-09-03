/**
 * Per-host write policy — who may change the workspace, decided by *where the
 * agent came in*, not by which tool it called.
 *
 * The registry already knows each tool's risk tier (`zatomToolTier`: read <
 * compute < mutate) and the review gate already handles *when* a write may
 * land. What was missing is *whether* a given host may write at all: a browser
 * extension speaking WebMCP and a `zatom-cli` the user launched themselves were
 * treated identically. A mode is a ceiling on the tier axis:
 *
 *  - `read-only`     read tier only. Observe, measure, point the camera, ghost
 *                    a proposal. Nothing the user sees is replaced.
 *  - `propose-only`  read + compute. May build candidates and run engines, but
 *                    cannot apply them: `mutate` tools are refused and the
 *                    write surfaces are removed from the context, so
 *                    `applyToWorkspace: true` fails at the write, not silently.
 *                    Structure changes only when the user presses Apply.
 *  - `read-write`    everything, still behind the ordinary review card.
 *
 * Enforcement happens once, in the registry's `execute`, before the tool runs.
 * Hosts only supply `{ host, mode }` on the tool context; the page owns the
 * user's choice per host, so a host running in another process asks the page.
 */

import type { ZatomAgentHost, ZatomHostAccess, ZatomHostWriteMode, ZatomToolContext, ZatomToolResult } from './contracts'
import { zatomToolTier, type ZatomToolTier } from './domains'

export type { ZatomAgentHost, ZatomHostAccess, ZatomHostWriteMode }

export const ZATOM_AGENT_HOSTS: readonly ZatomAgentHost[] = ['webmcp', 'cli-bridge']
export const ZATOM_HOST_WRITE_MODES: readonly ZatomHostWriteMode[] = ['read-only', 'propose-only', 'read-write']

/**
 * A CLI process the user launched on their own machine is trusted to edit
 * behind the review card. An in-page agent may build and ghost, while the user
 * applies the result.
 */
export const ZATOM_DEFAULT_HOST_WRITE_MODE: Readonly<Record<ZatomAgentHost, ZatomHostWriteMode>> = {
  webmcp: 'propose-only',
  'cli-bridge': 'read-write',
}

export const ZATOM_AGENT_HOST_LABEL: Readonly<Record<ZatomAgentHost, string>> = {
  webmcp: 'In-page WebMCP',
  'cli-bridge': 'Terminal CLI bridge',
}

export const ZATOM_HOST_WRITE_MODE_LABEL: Readonly<Record<ZatomHostWriteMode, { title: string; detail: string }>> = {
  'read-only': { title: 'Read only', detail: 'Observe, measure and point the camera. Cannot build or change anything.' },
  'propose-only': { title: 'Propose only', detail: 'Build candidates and ghost proposals; you press Apply. Cannot edit directly.' },
  'read-write': { title: 'Read & write', detail: 'Edits land directly, each behind the review card.' },
}

const TIER_RANK: Record<ZatomToolTier, number> = { read: 0, compute: 1, mutate: 2 }
const MODE_CEILING: Record<ZatomHostWriteMode, ZatomToolTier> = {
  'read-only': 'read',
  'propose-only': 'compute',
  'read-write': 'mutate',
}

export function isZatomHostWriteMode(value: unknown): value is ZatomHostWriteMode {
  return typeof value === 'string' && (ZATOM_HOST_WRITE_MODES as readonly string[]).includes(value)
}

export function isZatomAgentHost(value: unknown): value is ZatomAgentHost {
  return typeof value === 'string' && (ZATOM_AGENT_HOSTS as readonly string[]).includes(value)
}

export function hostWriteModeAllows(mode: ZatomHostWriteMode, tier: ZatomToolTier): boolean {
  return TIER_RANK[tier] <= TIER_RANK[MODE_CEILING[mode]]
}

export function describeHostPolicyDenial(
  toolName: string,
  host: ZatomAgentHost,
  mode: ZatomHostWriteMode,
  tier: ZatomToolTier = zatomToolTier(toolName),
): ZatomToolResult {
  const hint = mode === 'read-only'
    ? 'This host may only observe. Ask the user to raise its access in the Agent Access panel.'
    : 'This host may build and propose but not apply. Use structure_propose_operations so the user can press Apply, or ask them to raise its access in the Agent Access panel.'
  const message = `${toolName} is a ${tier}-tier tool and the ${ZATOM_AGENT_HOST_LABEL[host]} host is set to ${ZATOM_HOST_WRITE_MODE_LABEL[mode].title}. ${hint}`
  return { ok: false, tool: toolName, summary: message, error: { code: 'host_policy_denied', message, details: { host, mode, tier } } }
}

/**
 * Remove the structure write surfaces from a context whose host may not write.
 * Layout, asset and history mutations are only reachable through `mutate`-tier
 * tools, which the tier ceiling already refuses; but `compute` tools take
 * `applyToWorkspace` and would otherwise commit through `writeStructure` even
 * though the tool itself was allowed. Without the surface, the candidate path
 * reports `write_unavailable` instead of landing the edit.
 */
export function restrictContextToHostWriteMode(context: ZatomToolContext, mode: ZatomHostWriteMode): ZatomToolContext {
  if (mode === 'read-write') return context
  const { writeStructure: _w, writeTrajectory: _t, writeWorkspace: _workspace, ...rest } = context
  return rest
}
