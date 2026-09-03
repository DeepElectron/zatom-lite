import { assertDeepEqual, assertEqual, assertTrue } from '../../testing/assert'
import type { CapturedImage, ZatomStructure, ZatomToolContext, ZatomToolDefinition } from '../contracts'
import { ZATOM_STRUCTURE_SCHEMA } from '../contracts'
import { callZatomMcpTool, listZatomMcpTools } from '../mcp-adapter'
import { generateSqs, SqsInputError, type GenerateSqsOptions } from '../sqs'
import { fingerprintStructure } from '../structure-math'
import { validateStructure } from '../structure-validation'
import { createZatomAgentToolRegistry } from '../tools'

const parent: ZatomStructure = {
  schemaVersion: ZATOM_STRUCTURE_SCHEMA,
  label: 'two crystallographic Si sites',
  lattice: {
    vectors: [[3, 0, 0], [0, 3, 0], [0, 0, 3]],
    periodic: [true, true, true],
  },
  atoms: [
    { id: 'site-a', element: 'Si', position: [0, 0, 0] },
    { id: 'site-b', element: 'Si', position: [1.5, 1.5, 1.5] },
  ],
}

function testMultiSublatticeSqsIsExactAndDeterministic() {
  const options: GenerateSqsOptions = {
    structure: parent,
    supercell: [2, 2, 2] as [number, number, number],
    sublattices: [
      { id: 'a-sites', siteAtomIds: ['site-a'], composition: { Si: 0.5, Ge: 0.5 } },
      { id: 'b-sites', siteAtomIds: ['site-b'], composition: { Si: 0.5, Sn: 0.5 } },
    ],
    shellCount: 3,
    seed: 73,
    restarts: 4,
    stepsPerRestart: 80,
  }
  const first = generateSqs(options)
  const second = generateSqs(options)

  assertEqual(first.structure.atoms.length, 16)
  assertEqual(first.changeSet.maxPositionDisplacementA, 0)
  assertEqual(first.validation.verdict, 'pass')
  assertTrue(first.quality.pairShells.length > 0, 'pair-shell quality must be measured')
  assertEqual(fingerprintStructure(first.structure), fingerprintStructure(second.structure), 'same seed must replay exactly')
  assertDeepEqual(first.quality, second.quality, 'same seed must reproduce quality report')

  const byParentSite = { a: new Map<string, number>(), b: new Map<string, number>() }
  for (const atom of first.structure.atoms) {
    const group = atom.id.startsWith('site-a@') ? byParentSite.a : byParentSite.b
    group.set(atom.element, (group.get(atom.element) ?? 0) + 1)
  }
  assertEqual(byParentSite.a.get('Ge'), 4)
  assertEqual(byParentSite.a.get('Si'), 4)
  assertEqual(byParentSite.b.get('Si'), 4)
  assertEqual(byParentSite.b.get('Sn'), 4)
  assertTrue(!byParentSite.a.has('Sn'), 'site-a selector must not leak onto the second Si crystallographic site')
  assertTrue(!byParentSite.b.has('Ge'), 'site-b selector must not leak onto the first Si crystallographic site')
}

function testWurtziteSqsQualityRegression() {
  const a = 3.189
  const c = 5.185
  const u = 0.377
  const lattice: ZatomStructure['lattice'] = {
    vectors: [[a, 0, 0], [-a / 2, Math.sqrt(3) * a / 2, 0], [0, 0, c]],
    periodic: [true, true, true],
  }
  const cartesian = (fractional: [number, number, number]): [number, number, number] => [
    fractional[0] * lattice.vectors[0][0] + fractional[1] * lattice.vectors[1][0],
    fractional[0] * lattice.vectors[0][1] + fractional[1] * lattice.vectors[1][1],
    fractional[2] * c,
  ]
  const structure: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    label: 'wurtzite GaN',
    lattice,
    atoms: [
      { id: 'ga-1', element: 'Ga', position: cartesian([0, 0, 0]) },
      { id: 'ga-2', element: 'Ga', position: cartesian([2 / 3, 1 / 3, 0.5]) },
      { id: 'n-1', element: 'N', position: cartesian([0, 0, u]) },
      { id: 'n-2', element: 'N', position: cartesian([2 / 3, 1 / 3, 0.5 + u]) },
    ],
  }
  const result = generateSqs({
    structure,
    sublattices: [{ id: 'cation', siteElements: ['Ga'], composition: { Ga: 0.75, Sc: 0.25 } }],
    supercell: [4, 4, 2],
    shellCount: 4,
    seed: 42,
  })
  assertEqual(result.structure.atoms.length, 128)
  assertEqual(result.quality.verdict, 'near-ideal')
  assertTrue((result.quality.maxAbsPairError ?? 1) < 0.01)
  assertEqual(result.quality.compositions[0].counts.Ga, 48)
  assertEqual(result.quality.compositions[0].counts.Sc, 16)
  assertTrue(result.checks.some((check) => check.id === 'sqs.shells_inside_half_cell' && check.status === 'warn'), 'short c-axis must trigger a finite-cell shell warning')
}

function triangularSqsOptions(): GenerateSqsOptions {
  return {
    structure: {
      schemaVersion: ZATOM_STRUCTURE_SCHEMA,
      label: 'triangular substitutional parent',
      lattice: {
        vectors: [[1, 0, 0], [0.5, Math.sqrt(3) / 2, 0], [0, 0, 10]],
        periodic: [true, true, false],
      },
      atoms: [{ id: 'site', element: 'Si', position: [0, 0, 0] }],
    },
    sublattices: [{ id: 'alloy', siteAtomIds: ['site'], composition: { Si: 0.5, Ge: 0.5 } }],
    supercell: [4, 4, 1],
    shellCount: 1,
    shellToleranceA: 0.02,
    tripletCutoffA: 1.01,
    seed: 19,
    restarts: 4,
    stepsPerRestart: 96,
  }
}

function testBoundedTripletSqsHasExactFiniteCellTarget() {
  const first = generateSqs(triangularSqsOptions())
  const second = generateSqs(triangularSqsOptions())
  assertEqual(first.search.algorithm, 'zatom-pair-triplet-anneal')
  assertEqual(first.search.tripletClusterCount, 1)
  assertTrue(first.search.tripletFigureCount > 0)
  assertEqual(fingerprintStructure(first.structure), fingerprintStructure(second.structure), 'triplet search must replay exactly')
  assertDeepEqual(first.quality, second.quality, 'triplet quality report must replay exactly')

  const cluster = first.quality.tripletClusters[0]
  assertTrue(cluster !== undefined, 'equilateral triangular lattice must produce a triplet cluster')
  assertTrue(cluster.sideLengthsA.every((value) => Math.abs(value - 1) < 1e-10))
  assertTrue(Math.abs(cluster.targetTripletFractions['Ge>Ge>Ge'] - 0.1) < 1e-12)
  assertTrue(Math.abs(cluster.targetTripletFractions['Ge>Ge>Si'] - 0.4) < 1e-12)
  assertTrue(Math.abs(cluster.targetTripletFractions['Ge>Si>Si'] - 0.4) < 1e-12)
  assertTrue(Math.abs(cluster.targetTripletFractions['Si>Si>Si'] - 0.1) < 1e-12)
  const targetSum = Object.values(cluster.targetTripletFractions).reduce((sum, value) => sum + value, 0)
  const actualSum = Object.values(cluster.actualTripletFractions).reduce((sum, value) => sum + value, 0)
  assertTrue(Math.abs(targetSum - 1) < 1e-12)
  assertTrue(Math.abs(actualSum - 1) < 1e-12)
  assertTrue(first.checks.some((check) => check.id === 'sqs.triplet_correlations' && check.status !== 'skipped'))
  assertTrue(first.checks.some((check) => check.id === 'sqs.cluster_space_scope' && check.status === 'warn'))
}

function testTripletEnumerationBudgetIsHard() {
  let error: unknown = null
  try {
    generateSqs({ ...triangularSqsOptions(), maxTripletFigures: 1 })
  } catch (caught) {
    error = caught
  }
  assertTrue(error instanceof SqsInputError)
  assertEqual((error as SqsInputError).code, 'triplet_search_too_large')
}

function testSeedEnsembleRanksAndReplaysTheSelectedCandidate() {
  const options: GenerateSqsOptions = {
    ...triangularSqsOptions(),
    ensembleSize: 4,
    restarts: 3,
    stepsPerRestart: 64,
    maxSearchEvaluations: 10_000,
    maxObjectiveTermEvaluations: 10_000_000,
  }
  const first = generateSqs(options)
  const second = generateSqs(options)
  assertEqual(first.search.ensembleSize, 4)
  assertEqual(first.search.ensemble.completedSize, 4)
  assertEqual(first.search.ensemble.candidates.length, 4)
  assertEqual(first.search.selectedSeed, first.search.ensemble.candidates[0].seed)
  assertEqual(first.search.finalObjective, first.search.ensemble.bestObjective)
  assertEqual(new Set(first.search.ensemble.candidates.map((candidate) => candidate.seed)).size, 4)
  assertTrue(first.search.ensemble.candidates.every((candidate, index, candidates) => (
    candidate.rank === index + 1
    && (index === 0 || candidate.finalObjective >= candidates[index - 1].finalObjective)
  )))
  assertEqual(fingerprintStructure(first.structure), fingerprintStructure(second.structure))
  assertDeepEqual(first.search.ensemble, second.search.ensemble)
  assertTrue(first.checks.some((check) => check.id === 'sqs.seed_ensemble' && check.status === 'pass'))
  assertTrue(first.checks.some((check) => check.id === 'sqs.search_budget' && check.status === 'pass'))

  const selectedReplay = generateSqs({
    ...options,
    seed: first.search.selectedSeed,
    ensembleSize: 1,
  })
  assertEqual(fingerprintStructure(first.structure), fingerprintStructure(selectedReplay.structure))
  assertEqual(
    first.search.ensemble.candidates[0].occupationFingerprint,
    selectedReplay.search.ensemble.candidates[0].occupationFingerprint,
  )
}

function testSeedEnsembleBudgetsFailBeforeSearch() {
  let evaluationError: unknown = null
  try {
    generateSqs({
      ...triangularSqsOptions(),
      ensembleSize: 4,
      restarts: 3,
      stepsPerRestart: 64,
      maxSearchEvaluations: 10,
    })
  } catch (caught) {
    evaluationError = caught
  }
  assertTrue(evaluationError instanceof SqsInputError)
  assertEqual((evaluationError as SqsInputError).code, 'search_evaluation_budget_exceeded')

  let figureError: unknown = null
  try {
    generateSqs({
      ...triangularSqsOptions(),
      ensembleSize: 2,
      restarts: 1,
      stepsPerRestart: 8,
      maxSearchEvaluations: 1_000,
      maxObjectiveTermEvaluations: 1,
    })
  } catch (caught) {
    figureError = caught
  }
  assertTrue(figureError instanceof SqsInputError)
  assertEqual((figureError as SqsInputError).code, 'objective_term_budget_exceeded')
}

function fccQuadrupletOptions(): GenerateSqsOptions {
  const a = 2
  return {
    structure: {
      schemaVersion: ZATOM_STRUCTURE_SCHEMA,
      label: 'fcc primitive substitutional parent',
      lattice: {
        vectors: [[0, a / 2, a / 2], [a / 2, 0, a / 2], [a / 2, a / 2, 0]],
        periodic: [true, true, true],
      },
      atoms: [{ id: 'fcc-site', element: 'Si', position: [0, 0, 0] }],
    },
    sublattices: [{ id: 'fcc-alloy', siteAtomIds: ['fcc-site'], composition: { Si: 0.5, Ge: 0.5 } }],
    supercell: [2, 2, 2],
    shellCount: 1,
    shellToleranceA: 0.01,
    quadrupletCutoffA: Math.SQRT2 + 0.01,
    quadrupletWeight: 1,
    seed: 29,
    restarts: 4,
    stepsPerRestart: 96,
  }
}

function testBoundedQuadrupletsUseExactFiniteCellTargets() {
  const first = generateSqs(fccQuadrupletOptions())
  const second = generateSqs(fccQuadrupletOptions())
  assertEqual(first.search.algorithm, 'zatom-pair-quadruplet-anneal')
  assertTrue(first.search.quadrupletClusterCount > 0)
  assertTrue(first.search.quadrupletFigureCount > 0)
  assertTrue(first.search.quadrupletCandidateCount >= first.search.quadrupletFigureCount)
  assertEqual(fingerprintStructure(first.structure), fingerprintStructure(second.structure))
  assertDeepEqual(first.quality, second.quality)

  const regular = first.quality.quadrupletClusters.find((cluster) => (
    cluster.edgeLengthsA.every((value) => Math.abs(value - Math.SQRT2) < 1e-10)
  ))
  assertTrue(regular !== undefined, 'fcc nearest-neighbor graph must contain regular tetrahedral figures')
  assertTrue(Math.abs(regular!.targetQuadrupletFractions['Ge>Ge>Ge>Ge'] - 1 / 70) < 1e-12)
  assertTrue(Math.abs(regular!.targetQuadrupletFractions['Ge>Ge>Ge>Si'] - 16 / 70) < 1e-12)
  assertTrue(Math.abs(regular!.targetQuadrupletFractions['Ge>Ge>Si>Si'] - 36 / 70) < 1e-12)
  assertTrue(Math.abs(regular!.targetQuadrupletFractions['Ge>Si>Si>Si'] - 16 / 70) < 1e-12)
  assertTrue(Math.abs(regular!.targetQuadrupletFractions['Si>Si>Si>Si'] - 1 / 70) < 1e-12)
  const targetSum = Object.values(regular!.targetQuadrupletFractions).reduce((sum, value) => sum + value, 0)
  const actualSum = Object.values(regular!.actualQuadrupletFractions).reduce((sum, value) => sum + value, 0)
  assertTrue(Math.abs(targetSum - 1) < 1e-12)
  assertTrue(Math.abs(actualSum - 1) < 1e-12)
  assertTrue(first.checks.some((check) => check.id === 'sqs.quadruplet_correlations' && check.status !== 'skipped'))
  assertTrue(first.checks.some((check) => check.id === 'sqs.cluster_space_scope'
    && check.metrics?.maximumClusterOrder === 4))
}

function testQuadrupletFigureBudgetIsHard() {
  let error: unknown = null
  try {
    generateSqs({ ...fccQuadrupletOptions(), maxQuadrupletFigures: 1 })
  } catch (caught) {
    error = caught
  }
  assertTrue(error instanceof SqsInputError)
  assertEqual((error as SqsInputError).code, 'quadruplet_search_too_large')
}

function testNumericValidationCreatesPositionTarget() {
  const report = validateStructure({
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    atoms: [
      { id: 'h-1', element: 'H', position: [0, 0, 0] },
      { id: 'h-2', element: 'H', position: [0.1, 0, 0] },
    ],
  })
  assertEqual(report.verdict, 'fail')
  assertEqual(report.closestPair?.[0], 'h-1')
  assertEqual(report.closestPair?.[1], 'h-2')
  assertEqual(report.inspectionTargets.length, 1)
  assertTrue(Math.abs(report.inspectionTargets[0].center[0] - 0.05) < 1e-12)
}

async function testMcpToolAppliesAndReturnsVisualEvidence() {
  const singleSite: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    label: 'Si parent',
    lattice: { vectors: [[2.7, 0, 0], [0, 2.7, 0], [0, 0, 2.7]], periodic: [true, true, true] },
    atoms: [{ id: 'si', element: 'Si', position: [0, 0, 0] }],
  }
  const written: { value: ZatomStructure | null } = { value: null }
  const image: CapturedImage = {
    imageBase64: 'ZmFrZS1pbWFnZQ==',
    mimeType: 'image/jpeg',
    width: 320,
    height: 240,
  }
  const context: ZatomToolContext = {
    readStructure: () => written.value ?? singleSite,
    writeStructure: (structure) => { written.value = structure },
    captureViewport: () => image,
  }
  const input = {
    targetElement: 'Si',
    substituteElement: 'Ge',
    fraction: 0.25,
    supercell: [2, 2, 2],
    shellCount: 2,
    seed: 11,
    restarts: 2,
    stepsPerRestart: 32,
  }
  const preview = await callZatomMcpTool('structure_generate_sqs', input, context)
  const previewEnvelope = preview.structuredContent.data as { appliedToWorkspace: boolean }
  assertTrue(preview.structuredContent.ok)
  assertEqual(previewEnvelope.appliedToWorkspace, false)
  assertEqual(written.value, null, 'omitting applyToWorkspace must not mutate the active workspace')

  const response = await callZatomMcpTool('structure_generate_sqs', {
    ...input,
    applyToWorkspace: true,
  }, context)

  assertEqual(response.isError, undefined)
  assertTrue(response.structuredContent.ok)
  assertEqual(written.value?.atoms.length ?? 0, 8)
  assertEqual(written.value?.atoms.filter((atom) => atom.element === 'Ge').length ?? 0, 2)
  const envelope = response.structuredContent.data as { applicationVerified: boolean | null }
  assertEqual(envelope.applicationVerified, true)
  assertEqual(response.content.filter((block) => block.type === 'image').length, 1)
  const text = response.content.find((block) => block.type === 'text')
  assertTrue(text?.type === 'text' && !text.text.includes('ZmFrZS1pbWFnZQ=='), 'base64 bytes must not be duplicated in MCP text')
  assertTrue(text?.type === 'text' && !text.text.includes('schemaVersion'), 'structured artifacts must not be duplicated in MCP text')
  assertTrue(!JSON.stringify(response.structuredContent).includes('ZmFrZS1pbWFnZQ=='), 'base64 bytes must not be duplicated in MCP structured content')
}

async function testFocusToolResolvesIdsAndCaptures() {
  let focusedCenter: [number, number, number] | null = null
  const context: ZatomToolContext = {
    readStructure: () => parent,
    focusInspectionTarget: (target) => {
      focusedCenter = target.center
      return {
        centerNdc: [0, 0, 0.25],
        centerPx: [200, 150],
        viewportSizePx: [400, 300],
        projectedRadiusPx: 24,
        centerVisible: true,
        regionVisible: true,
      }
    },
    captureViewport: () => ({
      imageBase64: 'Zm9jdXNlZA==',
      mimeType: 'image/jpeg',
      width: 400,
      height: 300,
    }),
  }
  const response = await callZatomMcpTool('viewer_focus_target', {
    atomIds: ['site-b'],
    radius: 1.5,
    expectedStructureFingerprint: fingerprintStructure(parent),
  }, context)

  assertTrue(response.structuredContent.ok)
  assertDeepEqual(focusedCenter, [1.5, 1.5, 1.5])
  assertEqual(response.content.filter((block) => block.type === 'image').length, 1)
  assertTrue(response.structuredContent.checks?.some((check) => check.id === 'visual.target_atom_ids_present' && check.status === 'pass') === true)
  assertTrue(response.structuredContent.checks?.some((check) => check.id === 'visual.target_screen_placement' && check.status === 'pass') === true)

  const overview = await callZatomMcpTool('viewer_capture', {
    expectedStructureFingerprint: fingerprintStructure(parent),
  }, context)
  assertTrue(overview.structuredContent.ok)
  assertTrue(overview.structuredContent.checks?.some((check) => check.id === 'visual.structure_identity' && check.status === 'pass') === true)

  const stale = await callZatomMcpTool('viewer_focus_target', {
    atomIds: ['site-b'],
    expectedStructureFingerprint: 'fnv1a64:stale',
  }, context)
  assertEqual(stale.structuredContent.ok, false)

  const outside = await callZatomMcpTool('viewer_focus_target', {
    atomIds: ['site-b'],
    expectedStructureFingerprint: fingerprintStructure(parent),
  }, {
    ...context,
    focusInspectionTarget: () => ({
      centerNdc: [-0.9, 0, 0.25],
      centerPx: [20, 150],
      viewportSizePx: [400, 300],
      projectedRadiusPx: 24,
      centerVisible: true,
      regionVisible: false,
    }),
  })
  assertEqual(outside.structuredContent.error?.code, 'visual_target_outside_viewport')
  assertEqual(stale.structuredContent.error?.code, 'visual_structure_identity_mismatch')
}

function testMcpCatalogIsStable() {
  assertDeepEqual(
    listZatomMcpTools().map((tool) => tool.name),
    [
      'modeling_route_capabilities',
      'modeling_validate_plan',
      'workspace_get_active_structure',
      'workspace_set_active_structure',
      'workspace_history',
      'workspace_undo',
      'workspace_redo',
      'structure_import_text',
      'structure_export_text',
      'structure_validate',
      'structure_check_sanity',
      'structure_build_periodic_crystal',
      'structure_validate_ensemble',
      'structure_validate_periodic_ensemble',
      'sqs_validate_quality_evidence',
      'continuum_dislocation_validate_evidence',
      'periodic_dislocation_validate_dipole_evidence',
      'relaxation_validate_fixed_cell_evidence',
      'periodic_dislocation_prepare_relaxation_reference',
      'periodic_dislocation_compose_relaxation_evidence',
      'periodic_dislocation_validate_relaxation_evidence',
      'periodic_dislocation_compose_relaxation_series',
      'periodic_dislocation_validate_relaxation_series',
      'periodic_dislocation_compose_core_evidence',
      'periodic_dislocation_validate_core_evidence',
      'structure_select_atoms',
      'bio_ladder_drill',
      'structure_measure_geometry',
      'scene_observe',
      'scene_layers',
      'scene_fragments',
      'scene_resolve_reference',
      'scene_grid',
      'scene_probe_cell',
      'scene_contacts',
      'scene_burial',
      'scene_interfaces',
      'scene_linkages',
      'scene_repeat_units',
      'scene_grid_views',
      'scene_scaffold',
      'structure_analyze_local_environment',
      'structure_propose_operations',
      'structure_proposal_status',
      'structure_cancel_proposal',
      'structure_apply_operations',
      'structure_generate_sqs',
      'zatom_domains',
      'zatom_enable_domains',
      'viewport_describe',
      'viewport_activate',
      'viewport_set_layout',
      'viewport_clear_pane',
      'viewport_mount_structures',
      'assets_list_batches',
      'assets_create_batch',
      'assets_rename_batch',
      'assets_move_frames',
      'app_instances',
      'assets_list_local_directory',
      'assets_mount_local_file',
      'assets_mount_visualization_bundle',
      'surface_prepare_adsorption',
      'surface_detect_adsorption_sites',
      'surface_enumerate_adsorbate_configurations',
      'structure_build_miller_slab',
      'structure_place_adsorbate',
      'structure_ensure_slab_vacuum',
      'interface_find_diagonal_matches',
      'interface_enumerate_registry_configurations',
      'structure_build_interface',
      'interface_partition_reference_structures',
      'interface_compose_adhesion_evidence',
      'molecule_validate_topology',
      'molecule_create_from_template',
      'molecule_optimize_geometry',
      'molecule_assign_openmm_identity',
      'structure_build_metal_cluster',
      'structure_place_component',
      'structure_pose_component',
      'molecule_assemble_system',
      'molecule_build_linear_polymer',
      'structure_build_polycrystal',
      'structure_build_polarization_domain_wall',
      'structure_apply_cylindrical_bend',
      'modeling_list_providers',
      'modeling_run_provider',
      'force_field_validate_package',
      'chemical_state_validate_ensemble',
      'chemical_state_compose_structure_catalog',
      'chemical_state_validate_structure_catalog',
      'chemical_state_compose_structural_distribution',
      'chemical_state_validate_structural_distribution',
      'chemical_state_sample_structural_distribution',
      'chemical_state_select_structural_member',
      'micro_pka_validate_evidence',
      'microstate_validate_transition_graph',
      'microstate_validate_state_coverage',
      'microstate_compose_potential_mixture',
      'microstate_validate_potential_ensemble',
      'microstate_diagnose_potential_samples',
      'microstate_solve_populations',
      'microstate_scan_titration',
      'trajectory_stitch_segments',
      'trajectory_analyze_replicas',
      'trajectory_analyze_rdf',
      'trajectory_analyze_density_profile',
      'trajectory_analyze_hydrogen_bonds',
      'trajectory_analyze_orientation',
      'trajectory_analyze_msd',
      'trajectory_analyze_stationarity',
      'viewer_focus_target',
      'viewer_capture',
      'viewer_get_style',
      'viewer_set_style',
      'viewer_observe',
      'viewer_look_at',
      'viewer_set_view',
      'viewer_tour',
      'guide_set_plan',
      'guide_annotate',
      'guide_present_candidates',
      'guide_focus_candidate',
      'guide_candidate_status',
      'guide_clear',
    ],
  )
}

function testCandidateToolsUseCanonicalApplicationField() {
  // History navigation restores a state the user already accepted; it produces
  // no new candidate, so the candidate gate does not apply. Clearing a pane
  // similarly has no useful ghost representation: it is an exact CAS mutation
  // with a Keep/Revert review that restores the complete prior pane.
  const directReviewTools = new Set(['workspace_undo', 'workspace_redo', 'viewport_clear_pane'])
  for (const tool of listZatomMcpTools()) {
    if (directReviewTools.has(tool.name)) continue
    const candidate = tool.name === 'trajectory_stitch_segments'
      || (tool.effects.workspace === 'write'
        && (tool.effects.structure === 'create' || tool.effects.structure === 'replace'))
    if (!candidate) continue
    const properties = tool.inputSchema.properties as Record<string, unknown> | undefined
    assertTrue(
      !!properties && Object.hasOwn(properties, 'applyToWorkspace'),
      `${tool.name} must expose the canonical applyToWorkspace candidate gate`,
    )
    assertEqual(
      (properties!.applyToWorkspace as Record<string, unknown>).default,
      false,
      `${tool.name} must remain candidate-only unless application is explicit`,
    )
  }
}

async function testProviderRegistryCanExtendWithoutReplacingCore() {
  const registry = createZatomAgentToolRegistry()
  let executions = 0
  const providerTool: ZatomToolDefinition = {
    manifest: {
      name: 'structure_provider_probe',
      title: 'Provider probe',
      version: '1.0.0',
      description: 'Test-only external engine provider.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['value'],
        properties: { value: { type: 'integer', minimum: 1 } },
      },
      effects: { structure: 'read', workspace: 'none', visual: 'none' },
      tags: ['provider'],
    },
    execute: async () => {
      executions++
      return { ok: true, tool: 'structure_provider_probe', summary: 'provider reached', data: { engine: 'external' } }
    },
  }
  const unregister = registry.register(providerTool)
  assertEqual(registry.list()[0].name, 'structure_provider_probe')
  assertTrue((await registry.execute('structure_provider_probe', { value: 1 })).ok)
  const invalid = await registry.execute('structure_provider_probe', { vale: 1 })
  assertEqual(invalid.error?.code, 'invalid_tool_input')
  assertEqual(executions, 1)

  let duplicateRejected = false
  try {
    registry.register(providerTool)
  } catch {
    duplicateRejected = true
  }
  assertTrue(duplicateRejected, 'providers must opt in before replacing another tool')
  unregister()
  assertEqual(registry.list().length, 0)

  let invalidSchemaRejected = false
  try {
    registry.register({
      ...providerTool,
      manifest: {
        ...providerTool.manifest,
        name: 'structure_invalid_schema_probe',
        inputSchema: {
          type: 'object',
          properties: { value: { type: 'number', minumum: 1 } },
        },
      },
    })
  } catch (error) {
    invalidSchemaRejected = error instanceof Error
      && error.message.includes('/properties/value/minumum')
  }
  assertTrue(invalidSchemaRejected, 'tool registration must reject unsupported nested schema keywords')
}

async function main() {
  testMultiSublatticeSqsIsExactAndDeterministic()
  testWurtziteSqsQualityRegression()
  testBoundedTripletSqsHasExactFiniteCellTarget()
  testTripletEnumerationBudgetIsHard()
  testSeedEnsembleRanksAndReplaysTheSelectedCandidate()
  testSeedEnsembleBudgetsFailBeforeSearch()
  testBoundedQuadrupletsUseExactFiniteCellTargets()
  testQuadrupletFigureBudgetIsHard()
  testNumericValidationCreatesPositionTarget()
  await testMcpToolAppliesAndReturnsVisualEvidence()
  await testFocusToolResolvesIdsAndCaptures()
  testMcpCatalogIsStable()
  testCandidateToolsUseCanonicalApplicationField()
  await testProviderRegistryCanExtendWithoutReplacingCore()
}

void main()
