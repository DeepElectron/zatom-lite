/**
 * Coarse semantic domains for progressive tool exposure.
 *
 * The registry ships 75+ tools whose full `tools/list` payload is ~295 KB
 * (~74k tokens), which consumes a third of a CLI agent's context before any
 * work begins. The existing `tags` are far too fine-grained to gate on (~250
 * distinct tags, most covering a single tool), so this module maintains a
 * separate coarse map: every tool belongs to exactly one domain, and only the
 * default domains are enabled on a fresh connection.
 *
 * Membership lives here as an explicit literal rather than being derived from
 * tags or name prefixes. A derived rule would silently reclassify tools as
 * names drift; an explicit map plus the exhaustiveness test fails loudly
 * instead, which is the behavior we want for a context budget.
 */

/** Tools an agent needs to discover capabilities and target a viewport. */
const SESSION_TOOLS = [
  'zatom_domains',
  'zatom_enable_domains',
  'app_instances',
  'modeling_route_capabilities',
  'modeling_validate_plan',
  'modeling_list_providers',
] as const

/** Tools the agent uses to narrate its work to the human beside it. */
const GUIDE_TOOLS = [
  'guide_set_plan',
  'guide_annotate',
  'guide_present_candidates',
  'guide_focus_candidate',
  'guide_candidate_status',
  'guide_clear',
] as const

const VIEWPORT_TOOLS = [
  'viewport_describe',
  'viewport_activate',
  'viewport_set_layout',
  'viewport_clear_pane',
  'viewport_mount_structures',
  'viewer_observe',
  'viewer_look_at',
  'viewer_set_view',
  'viewer_tour',
  'viewer_focus_target',
  'viewer_capture',
  'viewer_get_style',
  'viewer_set_style',
  'workspace_get_active_structure',
  'workspace_set_active_structure',
  'workspace_history',
  'workspace_undo',
  'workspace_redo',
  'scene_observe',
  'scene_layers',
  'scene_fragments',
  'scene_resolve_reference',
  'scene_grid',
  'scene_grid_views',
  'scene_probe_cell',
  'scene_contacts',
  'scene_burial',
  'scene_interfaces',
  'scene_linkages',
  'scene_repeat_units',
  'scene_scaffold',
] as const

const ASSETS_TOOLS = [
  'assets_list_batches',
  'assets_create_batch',
  'assets_rename_batch',
  'assets_move_frames',
  'assets_list_local_directory',
  'assets_mount_local_file',
  'assets_mount_visualization_bundle',
] as const

const IO_TOOLS = [
  'structure_import_text',
  'structure_export_text',
  'structure_validate',
  'structure_check_sanity',
] as const

const EDIT_TOOLS = [
  'structure_propose_operations',
  'structure_proposal_status',
  'structure_cancel_proposal',
  'structure_pose_component',
  'structure_select_atoms',
  'structure_measure_geometry',
  'structure_analyze_local_environment',
] as const

/** Explicit direct-write escape hatch; safe proposal editing stays default. */
const DIRECT_EDIT_TOOLS = [
  'structure_apply_operations',
] as const

/** Safe spatial surface perception available before the user enables builders. */
const SURFACE_ANALYSIS_TOOLS = [
  'surface_prepare_adsorption',
  'surface_detect_adsorption_sites',
  'surface_enumerate_adsorbate_configurations',
  'structure_build_miller_slab',
  'structure_place_adsorbate',
  'structure_ensure_slab_vacuum',
] as const

const BUILD_TOOLS = [
  'structure_build_periodic_crystal',
  'structure_build_interface',
  'structure_build_metal_cluster',
  'structure_build_polycrystal',
  'structure_build_polarization_domain_wall',
  'structure_generate_sqs',
  'structure_apply_cylindrical_bend',
  'structure_place_component',
  'structure_validate_ensemble',
  'structure_validate_periodic_ensemble',
  'interface_compose_adhesion_evidence',
  'interface_enumerate_registry_configurations',
  'interface_find_diagonal_matches',
  'interface_partition_reference_structures',
  'molecule_assemble_system',
  'molecule_assign_openmm_identity',
  'molecule_build_linear_polymer',
  'molecule_create_from_template',
  'molecule_optimize_geometry',
  'molecule_validate_topology',
  'bio_ladder_drill',
  'force_field_validate_package',
] as const

const TRAJECTORY_TOOLS = [
  'trajectory_analyze_density_profile',
  'trajectory_analyze_hydrogen_bonds',
  'trajectory_analyze_msd',
  'trajectory_analyze_orientation',
  'trajectory_analyze_rdf',
  'trajectory_analyze_replicas',
  'trajectory_analyze_stationarity',
  'trajectory_stitch_segments',
] as const

const CHEMSTATE_TOOLS = [
  'chemical_state_compose_structural_distribution',
  'chemical_state_compose_structure_catalog',
  'chemical_state_sample_structural_distribution',
  'chemical_state_select_structural_member',
  'chemical_state_validate_ensemble',
  'chemical_state_validate_structural_distribution',
  'chemical_state_validate_structure_catalog',
  'microstate_compose_potential_mixture',
  'microstate_diagnose_potential_samples',
  'microstate_scan_titration',
  'microstate_solve_populations',
  'microstate_validate_potential_ensemble',
  'microstate_validate_state_coverage',
  'microstate_validate_transition_graph',
  'micro_pka_validate_evidence',
] as const

const EVIDENCE_TOOLS = [
  'periodic_dislocation_compose_core_evidence',
  'periodic_dislocation_compose_relaxation_evidence',
  'periodic_dislocation_compose_relaxation_series',
  'periodic_dislocation_prepare_relaxation_reference',
  'periodic_dislocation_validate_core_evidence',
  'periodic_dislocation_validate_dipole_evidence',
  'periodic_dislocation_validate_relaxation_evidence',
  'periodic_dislocation_validate_relaxation_series',
  'continuum_dislocation_validate_evidence',
  'relaxation_validate_fixed_cell_evidence',
  'sqs_validate_quality_evidence',
] as const

const PROVIDER_TOOLS = [
  'modeling_run_provider',
] as const

/**
 * Risk tier — orthogonal to domain.
 *
 * Domains answer "what is this tool about" and gate specialist capabilities.
 * WebMCP directly exposes a compact core, while the rest remain discoverable
 * through its facade. Safe proposal editing is enabled by default; the large
 * direct-write operations schema lives in a separate disabled `direct-edit`
 * domain so a fresh connection never silently gains a bypass.
 *
 * Tier is that second axis:
 *  - `read`     observes the workspace; cannot change what the user sees.
 *  - `compute`  derives new structures//evidence but does not touch the
 *               workspace unless the caller opts in (`applyToWorkspace`).
 *  - `mutate`   replaces or edits the live structure the user is looking at.
 *
 * Only `mutate` needs a user-visible review, so this is the axis the review
 * gate and the takeover gate key off — not the domain.
 */
export type ZatomToolTier = 'read' | 'compute' | 'mutate'

/**
 * Tools that replace or edit the structure currently in the workspace.
 *
 * Listed explicitly rather than inferred from a name prefix: `structure_build_*`
 * tools are `compute` (they return a candidate unless asked to apply it) while
 * `structure_apply_operations` is `mutate`, so any prefix rule would
 * misclassify one of them. An explicit set plus the exhaustiveness test fails
 * loudly when a new tool is added without a tier decision.
 */
const MUTATE_TOOLS: ReadonlySet<string> = new Set([
  'structure_apply_operations',
  'workspace_set_active_structure',
  'workspace_undo',
  'workspace_redo',
  'viewport_clear_pane',
  'assets_move_frames',
  'assets_create_batch',
  'assets_rename_batch',
  'assets_mount_local_file',
])

/** These are only mutations when the caller explicitly asks to apply. */
const CONDITIONAL_MUTATE_TOOLS: ReadonlySet<string> = new Set([
  'assets_mount_local_file',
])

/** Reversible visual/workspace operations still serialize and open review. */
const WORKSPACE_MUTATION_TOOLS: ReadonlySet<string> = new Set([
  ...MUTATE_TOOLS,
  'viewport_mount_structures',
  'viewport_set_layout',
  'assets_mount_visualization_bundle',
])

/**
 * Tools that only observe. Everything not listed here and not in
 * `MUTATE_TOOLS` is `compute`: it produces a new structure or evidence bundle,
 * which is harmless until someone applies it.
 */
const READ_TOOLS: ReadonlySet<string> = new Set([
  'zatom_domains',
  'zatom_enable_domains',
  'app_instances',
  'modeling_route_capabilities',
  'modeling_validate_plan',
  'modeling_list_providers',
  'viewport_describe',
  'viewport_activate',
  'workspace_get_active_structure',
  'workspace_history',
  'viewer_observe',
  'scene_observe',
  'scene_layers',
  'scene_fragments',
  'scene_resolve_reference',
  'structure_check_sanity',
  'scene_grid',
  'scene_grid_views',
  'scene_probe_cell',
  'scene_contacts',
  'scene_burial',
  'scene_interfaces',
  'scene_linkages',
  'scene_repeat_units',
  'scene_scaffold',
  'viewer_focus_target',
  'viewer_capture',
  // Presentation-only: changes how the structure is drawn, never the structure,
  // so it stays out of the review/takeover gate like viewer_focus_target.
  'viewer_get_style',
  'viewer_set_style',
  // Camera flights: move the user's eye, never the atoms.
  'viewer_look_at',
  'viewer_set_view',
  'viewer_tour',
  // Guidance: plan strip and 3D labels are overlays, not structure.
  'guide_set_plan',
  'guide_annotate',
  'guide_present_candidates',
  'guide_focus_candidate',
  'guide_candidate_status',
  'guide_clear',
  // Proposals: the candidate is only ghosted; the workspace changes when the
  // *user* presses Apply, and that path opens the ordinary review card.
  'structure_propose_operations',
  'structure_proposal_status',
  'structure_cancel_proposal',
  'assets_list_batches',
  'assets_list_local_directory',
  'structure_export_text',
  'structure_validate',
  'structure_select_atoms',
  'structure_measure_geometry',
  'structure_analyze_local_environment',
  'surface_detect_adsorption_sites',
  'surface_prepare_adsorption',
])

/** Exposed so a test can fail when an entry no longer names a real tool. */
export const ZATOM_READ_TOOL_NAMES: ReadonlySet<string> = READ_TOOLS

export function zatomToolTier(toolName: string, input: Readonly<Record<string, unknown>> = {}): ZatomToolTier {
  if (MUTATE_TOOLS.has(toolName)) {
    if (CONDITIONAL_MUTATE_TOOLS.has(toolName) && input.applyToWorkspace !== true) return 'compute'
    return 'mutate'
  }
  if (READ_TOOLS.has(toolName)) return 'read'
  return 'compute'
}

/** True for tools whose primary action directly mutates the live workspace. */
export function zatomToolMutatesWorkspace(toolName: string): boolean {
  return WORKSPACE_MUTATION_TOOLS.has(toolName)
}

export interface ZatomToolDomain {
  readonly name: string
  /** One-line purpose, shown in the `zatom_domains` index. */
  readonly summary: string
  readonly tools: readonly string[]
  /** Enabled on a fresh connection unless the client selects domains. */
  readonly enabledByDefault: boolean
}

/**
 * The collaboration contract, returned by `zatom_domains` so it is the first
 * thing an agent reads. It exists because the in-page WebMCP host has no
 * server-level `instructions` channel: tool descriptions are the only prose the
 * model sees, and no single description can explain how the tools fit together.
 */
export const ZATOM_WORKFLOW: readonly string[] = [
  'You are working beside a human who is looking at the same 3D viewport. Show, do not just do.',
  '1. Observe the system: scene_observe tells you what it is (crystal / slab / slab-with-adsorbates / molecule / 2D), its periodicity, vacuum, layers, fragments, and what the user selected. Do not pull the whole structure for large systems; drill in with scene_fragments, scene_layers, scene_contacts or structure_analyze_local_environment.',
  '2. Observe the user: viewer_observe gives the live camera, screen right/up/toward-viewer axes, selection/hover/candidates, plus data.workspace={viewportId, revision, fingerprints}. Pass that identity as expectedWorkspace for every camera, selection, guidance, layout, proposal or workspace change, whether calling a core tool directly or through zatom_call_tool; a stale pane or ABA revision must fail closed.',
  '3. Resolve references before acting: scene_resolve_reference turns "the Cu to the right of this one" / "the layer below" / "the O bonded to it" into ranked atoms with an ambiguity score. If ambiguity > 0.5, call guide_present_candidates with the top few and ask the user which one; never guess.',
  '4. Announce the plan: guide_set_plan with 2–8 steps and advance activeIndex as you go.',
  '5. Show before you touch: guide_present_candidates → guide_focus_candidate to walk the user through options; guide_annotate the coordinating atoms while you explain why. viewer_look_at brings the region into view.',
  '6. Propose, do not apply: edits go through structure_propose_operations, or call a validated builder/structure_place_adsorbate/structure_pose_component with applyToWorkspace=true under Propose only — zatom converts it into a viewport-bound ghost proposal instead of writing. Call structure_proposal_status with waitMs up to 30000 so the user decision returns promptly without repeated polling. Only use direct apply in Read & write when the user explicitly asked to skip previews.',
  'For conversational pose changes, structure_pose_component keeps an anchor fixed while pointing a molecular centroid/bisector toward an atom, point, vector, or the surface normal; it can then roll around that axis or translate toward/away without requiring the user to name XYZ coordinates. If a ghost is already awaiting Apply, pass its proposalId plus the latest previewRevision and candidateFingerprint so the same preview is adjusted in place and the user still applies only once.',
  'For adsorption, call surface_prepare_adsorption after observing the slab. If vacuum is insufficient, use structure_ensure_slab_vacuum to build a reviewable candidate first. Preparation honors the current selection, presents exact periodic site badges, and returns replay inputs; let the user choose before previewing a molecule pose.',
  '7. Verify what landed: structure_check_sanity (overlaps, too-close pairs, floating adsorbates) and viewer_look_at the changed region. If it is wrong, workspace_undo and say so; do not declare success on a failed check.',
  'To empty one split pane, use viewport_clear_pane with the exact target slot revision and fingerprints from viewport_describe. It preserves the pane and layout, and gives the user a reversible review; do not confuse it with removing a pane.',
  '8. Finish clean: guide_set_plan with activeIndex past the last step, then guide_clear when the user moves on.',
  'If a mutating call fails with a takeover error, the user has taken control: stop editing, answer questions, and wait for them to resume you.',
  'Always re-observe after every accepted/reverted/manual change. Fingerprints prove content; the monotonic workspace revision also proves no A→B→A edit happened between observation and action.',
]

export const ZATOM_TOOL_DOMAINS: readonly ZatomToolDomain[] = [
  {
    name: 'session',
    summary: 'Discover domains and capabilities, and target an app instance.',
    tools: SESSION_TOOLS,
    enabledByDefault: true,
  },
  {
    name: 'guide',
    summary: 'Tell the user what you are doing: step plan, caption, and 3D labels.',
    tools: GUIDE_TOOLS,
    enabledByDefault: true,
  },
  {
    name: 'viewport',
    summary: 'Look at, tour, style and capture the viewport; read what is on screen; set layout, mount structures, and safely clear a pane.',
    tools: VIEWPORT_TOOLS,
    enabledByDefault: true,
  },
  {
    name: 'assets',
    summary: 'Organize saved structures into named batches.',
    tools: ASSETS_TOOLS,
    enabledByDefault: true,
  },
  {
    name: 'io',
    summary: 'Import and export structure text, and validate a structure.',
    tools: IO_TOOLS,
    enabledByDefault: true,
  },
  {
    name: 'edit',
    summary: 'Propose atom edits and semantic poses, select subsets, and measure local geometry.',
    tools: EDIT_TOOLS,
    enabledByDefault: true,
  },
  {
    name: 'direct-edit',
    summary: 'Apply operation pipelines directly; enable only when the user explicitly wants to skip ghost previews.',
    tools: DIRECT_EDIT_TOOLS,
    enabledByDefault: false,
  },
  {
    name: 'surface',
    summary: 'Understand exposed surfaces, repair slab vacuum through a reviewable candidate, and enumerate adsorption-site/pose candidates.',
    tools: SURFACE_ANALYSIS_TOOLS,
    enabledByDefault: true,
  },
  {
    name: 'build',
    summary: 'Build crystals, slabs, interfaces, clusters, molecules and polymers.',
    tools: BUILD_TOOLS,
    enabledByDefault: false,
  },
  {
    name: 'trajectory',
    summary: 'Analyze MD trajectories: RDF, MSD, hydrogen bonds, stationarity.',
    tools: TRAJECTORY_TOOLS,
    enabledByDefault: false,
  },
  {
    name: 'chemstate',
    summary: 'Chemical-state ensembles, microstate populations and titration.',
    tools: CHEMSTATE_TOOLS,
    enabledByDefault: false,
  },
  {
    name: 'evidence',
    summary: 'Compose and validate dislocation, relaxation and SQS evidence.',
    tools: EVIDENCE_TOOLS,
    enabledByDefault: false,
  },
  {
    name: 'provider',
    summary: 'Run an external modeling provider.',
    tools: PROVIDER_TOOLS,
    enabledByDefault: false,
  },
]

const DOMAIN_BY_TOOL: ReadonlyMap<string, string> = new Map(
  ZATOM_TOOL_DOMAINS.flatMap((domain) => domain.tools.map((tool) => [tool, domain.name] as const)),
)

export const ZATOM_DEFAULT_TOOL_DOMAINS: readonly string[] = ZATOM_TOOL_DOMAINS
  .filter((domain) => domain.enabledByDefault)
  .map((domain) => domain.name)

export function zatomToolDomain(toolName: string): string | undefined {
  return DOMAIN_BY_TOOL.get(toolName)
}

export function zatomToolDomainNames(): readonly string[] {
  return ZATOM_TOOL_DOMAINS.map((domain) => domain.name)
}

/**
 * Resolves a client-supplied domain selection. Unknown names are reported
 * rather than ignored, so a typo in an MCP config surfaces immediately instead
 * of silently yielding a smaller tool surface than the user asked for.
 */
export function resolveZatomToolDomains(
  requested: readonly string[] | undefined,
): { domains: readonly string[]; unknown: readonly string[] } {
  if (!requested || requested.length === 0) {
    return { domains: ZATOM_DEFAULT_TOOL_DOMAINS, unknown: [] }
  }
  const known = new Set(zatomToolDomainNames())
  const unknown = requested.filter((name) => !known.has(name))
  // `session` is always present: without it an agent cannot discover or enable
  // any other domain, which would leave a mistyped selection unrecoverable.
  const domains = ['session', ...requested.filter((name) => known.has(name) && name !== 'session')]
  return { domains, unknown }
}
