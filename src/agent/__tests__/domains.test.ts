import { describe, expect, it } from 'vitest'

import {
  resolveZatomToolDomains,
  ZATOM_DEFAULT_TOOL_DOMAINS,
  ZATOM_READ_TOOL_NAMES,
  ZATOM_TOOL_DOMAINS,
  zatomToolDomain,
  zatomToolMutatesWorkspace,
  zatomToolTier,
} from '../domains'
import { listZatomMcpTools } from '../mcp-adapter'
import { listZatomAgentTools } from '../tools'

/**
 * The domain map is the context budget's only enforcement point, so these
 * tests cover the two ways it can silently fail: a tool drifting out of every
 * domain, and the default surface growing back toward the 74k-token problem
 * this split exists to solve.
 */
describe('zatom tool domains', () => {
  it('assigns every registered tool to exactly one domain', () => {
    const registered = listZatomAgentTools().map((tool) => tool.name)
    const unassigned = registered.filter((name) => zatomToolDomain(name) === undefined)
    expect(unassigned).toEqual([])

    const seen = new Map<string, number>()
    for (const domain of ZATOM_TOOL_DOMAINS) {
      for (const tool of domain.tools) seen.set(tool, (seen.get(tool) ?? 0) + 1)
    }
    expect([...seen.entries()].filter(([, count]) => count > 1)).toEqual([])
  })

  it('keeps the default tool listing far below the full surface', () => {
    const defaults = new Set(ZATOM_DEFAULT_TOOL_DOMAINS)
    const listing = listZatomMcpTools()
    const measure = (tools: typeof listing) => JSON.stringify(
      tools.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema })),
    ).length

    const full = measure(listing)
    const enabled = measure(listing.filter((tool) => {
      const domain = zatomToolDomain(tool.name)
      return domain !== undefined && defaults.has(domain)
    }))

    // The full surface measured ~295 KB when this split was introduced. The
    // default slice must stay a small fraction of it for a CLI agent to have
    // room left to work in. The ceiling was 80 KB until the guide/camera tools
    // and structure_propose_operations landed; propose carries the same 10 KB
    // operations schema as structure_apply_operations because the two sit in
    // different tiers (read vs mutate) and so cannot be one tool.
    //
    // Raised again from 96 KB / 30% when the perception loop landed: ten small
    // tools (viewer_observe, scene_layers/fragments/resolve_reference,
    // guide_present/focus_candidate, structure_check_sanity, workspace_history/
    // undo/redo) measured ~14 KB together, and the two pose ops added ~2 KB to
    // each copy of the operations schema. Measured 111 KB of 346 KB (32%).
    expect(enabled).toBeLessThan(full * 0.35)
    expect(enabled).toBeLessThan(128 * 1024)
  })

  /**
   * Tier is the axis the review and takeover gates key off, so a tool landing
   * in the wrong tier is a safety bug, not a cosmetic one. Two directions to
   * protect: a mutating tool must never read as `read` (it would bypass review
   * entirely), and the `read` set must not name tools that no longer exist
   * (a rename would silently downgrade the real tool to `compute`).
   */
  it('classifies every mutating tool above the read tier', () => {
    const registered = new Set(listZatomAgentTools().map((tool) => tool.name))

    // Every name in the read set must still be a real tool, otherwise the
    // entry is dead and its live counterpart was silently reclassified.
    const staleReads = [...ZATOM_READ_TOOL_NAMES].filter((name) => !registered.has(name))
    expect(staleReads).toEqual([])

    // The tools that replace what the user is looking at, spot-checked
    // against the tier function rather than the literal set.
    for (const name of ['structure_apply_operations', 'workspace_set_active_structure', 'viewport_clear_pane']) {
      expect(registered.has(name)).toBe(true)
      expect(zatomToolTier(name)).toBe('mutate')
      expect(zatomToolMutatesWorkspace(name)).toBe(true)
    }

    // Layout/mount are reversible workspace presentations: propose-only may
    // run them, but they still serialize and open one review card.
    for (const name of ['viewport_mount_structures', 'viewport_set_layout', 'assets_mount_visualization_bundle']) {
      expect(registered.has(name)).toBe(true)
      expect(zatomToolTier(name)).toBe('compute')
      expect(zatomToolMutatesWorkspace(name)).toBe(true)
    }

    // Analysis tools that share a domain with mutating ones must stay
    // non-mutating — this is the read/write split the domain axis cannot express.
    for (const name of ['structure_measure_geometry', 'workspace_get_active_structure', 'viewport_describe']) {
      expect(zatomToolMutatesWorkspace(name)).toBe(false)
    }
    expect(zatomToolTier('viewport_activate')).toBe('read')
    expect(zatomToolMutatesWorkspace('viewport_activate')).toBe(false)

    // `build` tools return candidates; they only touch the workspace when the
    // caller opts in, so they must not be classified `mutate`.
    expect(zatomToolTier('structure_build_miller_slab')).toBe('compute')
    expect(zatomToolTier('surface_detect_adsorption_sites')).toBe('read')
    // Local-file inspection is safe in Propose only; only an explicit mount is
    // a mutation. The tier must follow the request rather than the tool name.
    expect(zatomToolTier('assets_mount_local_file')).toBe('compute')
    expect(zatomToolTier('assets_mount_local_file', { applyToWorkspace: false })).toBe('compute')
    expect(zatomToolTier('assets_mount_local_file', { applyToWorkspace: true })).toBe('mutate')
    expect(zatomToolDomain('structure_apply_operations')).toBe('direct-edit')
    expect(ZATOM_DEFAULT_TOOL_DOMAINS).not.toContain('direct-edit')
    expect(ZATOM_DEFAULT_TOOL_DOMAINS).not.toContain('assets')
  })

  it('always keeps session reachable and reports unknown domain names', () => {
    // Without `session` a mistyped selection could not be recovered from,
    // because the tools that list and enable domains live there.
    expect(resolveZatomToolDomains(['build']).domains).toContain('session')
    expect(resolveZatomToolDomains(['nope']).unknown).toEqual(['nope'])
    expect(resolveZatomToolDomains(undefined).domains).toEqual(ZATOM_DEFAULT_TOOL_DOMAINS)
  })
})
