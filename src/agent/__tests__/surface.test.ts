import { assertEqual, assertTrue } from '../../testing/assert'
import type { ZatomStructure } from '../contracts'
import { ZATOM_STRUCTURE_SCHEMA } from '../contracts'
import { callZatomMcpTool } from '../mcp-adapter'
import { enumerateAdsorptionConfigurations } from '../adsorption-configuration-search'
import { fingerprintStructure } from '../structure-math'
import { buildMillerSlab, detectAdsorptionSites, placeAdsorbate } from '../surface'
import { SURFACE_ZATOM_AGENT_TOOLS } from '../surface-tools'

const cubicSource: ZatomStructure = {
  schemaVersion: ZATOM_STRUCTURE_SCHEMA,
  label: 'simple cubic Cu',
  lattice: { vectors: [[3, 0, 0], [0, 3, 0], [0, 0, 3]], periodic: [true, true, true] },
  atoms: [{ id: 'cu', element: 'Cu', position: [0, 0, 0] }],
}

function testMillerSlabHasRequestedVacuumAndBounds() {
  const result = buildMillerSlab({ structure: cubicSource, miller: [0, 0, 1], layers: 3, vacuumA: 8 })
  assertEqual(result.structure.atoms.length, 3)
  assertTrue(result.metrics.measuredVacuumA >= 8 - 1e-4)
  assertEqual(result.validation.verdict, 'pass')
  assertTrue(result.checks.every((check) => check.status !== 'fail'))
  assertTrue(result.inspectionTargets.some((target) => target.id === 'slab-top-surface'))
}

const ptSurface: ZatomStructure = {
  schemaVersion: ZATOM_STRUCTURE_SCHEMA,
  label: 'Pt square surface',
  atoms: [
    { id: 'pt-00', element: 'Pt', position: [0, 0, 0] },
    { id: 'pt-10', element: 'Pt', position: [2.7, 0, 0] },
    { id: 'pt-01', element: 'Pt', position: [0, 2.7, 0] },
    { id: 'pt-11', element: 'Pt', position: [2.7, 2.7, 0] },
    { id: 'pt-bottom', element: 'Pt', position: [0, 0, -2] },
  ],
}

const pendingCandidateStatus = (candidateSetId: string) => ({
  candidateSetId,
  status: 'pending' as const,
  focusedIndex: null,
  choice: null,
  decidedAt: null,
  timedOut: false,
})

const guidanceWithPendingCandidates = (candidateSetId: string) => ({
  plan: null,
  annotations: [],
  candidates: {
    id: candidateSetId,
    label: 'Which adsorption site?',
    items: [],
    focusedIndex: null,
    decision: { status: 'pending' as const, index: null, at: null },
  },
})

function testSiteDetectionAndAdsorbatePlacement() {
  const detected = detectAdsorptionSites({ structure: ptSurface, surfaceUp: [0, 0, 1] })
  assertEqual(detected.surfaceAtomIds.length, 4)
  assertEqual(detected.sites.filter((site) => site.kind === 'top').length, 4)
  assertTrue(detected.sites.some((site) => site.kind === 'bridge'))

  const placed = placeAdsorbate({ structure: ptSurface, fragment: 'OH', siteAtomIds: ['pt-00'] })
  assertEqual(placed.addedAtomIds.length, 2)
  assertEqual(placed.structure.bonds?.length, 1)
  assertEqual(placed.collision, null)
  assertEqual(placed.validation.verdict, 'pass')
  assertTrue(placed.anchorDistanceA > 1)
  assertEqual(placed.changeSet.addedCount, 2)
}

function testSurfaceAtomLimitRunsBeforePeriodicMeshBudget() {
  const atoms: ZatomStructure['atoms'] = []
  for (let index = 0; index < 201; index++) {
    atoms.push({ id: `top-${index}`, element: 'Pt', position: [index * 3, 0, 4] })
    atoms.push({ id: `bottom-${index}`, element: 'Pt', position: [index * 3, 0, 0] })
  }
  const oversized: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    label: 'oversized finite surface',
    atoms,
  }
  let rejected: unknown = null
  try {
    detectAdsorptionSites({
      structure: oversized,
      surfaceUp: [0, 0, 1],
      maxSurfaceAtoms: 200,
      // If periodic-point accounting ran first, this deliberately smaller
      // budget would win with the wrong error and prove the guard is too late.
      maxExpandedSurfacePoints: 1,
    })
  } catch (error) {
    rejected = error
  }
  assertTrue(rejected instanceof Error, 'an oversized surface must be rejected')
  assertEqual((rejected as Error & { code?: string }).code, 'surface_too_large')
  assertTrue((rejected as Error).message.includes('201 surface atoms'))
}

function testPrepareAdsorptionPublishesTopologyBudgets() {
  const prepare = SURFACE_ZATOM_AGENT_TOOLS.find((tool) => tool.manifest.name === 'surface_prepare_adsorption')
  assertTrue(prepare !== undefined)
  const properties = prepare!.manifest.inputSchema.properties as Record<string, { default?: number }> | undefined
  assertEqual(properties?.maxSurfaceAtoms?.default, 200)
  assertEqual(properties?.maxExpandedSurfacePoints?.default, 50_000)
}

function testBulkCrystalCannotPretendToHaveAdsorptionSites() {
  let rejected: unknown = null
  try {
    detectAdsorptionSites({ structure: cubicSource })
  } catch (error) {
    rejected = error
  }
  assertTrue(rejected instanceof Error, 'a fully periodic bulk cell must not produce adsorption sites')
  assertEqual((rejected as Error & { code?: string }).code, 'bulk_has_no_surface')
  assertTrue(
    (rejected as Error).message.includes('Slab tool'),
    `bulk rejection must tell the agent how to recover: ${(rejected as Error).message}`,
  )
}

function testPeriodicDelaunaySitesCrossCellEdges() {
  const periodic: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    lattice: { vectors: [[2.7, 0, 0], [0, 2.7, 0], [0, 0, 15]], periodic: [true, true, true] },
    atoms: [
      { id: 'pt', element: 'Pt', position: [0, 0, 7.5] },
      { id: 'subsurface', element: 'Pt', position: [0, 0, 5] },
    ],
  }
  const detected = detectAdsorptionSites({
    structure: periodic,
    surfaceUp: [0, 0, 1],
    bondCutoffA: 3,
    triangleCutoffA: 4,
  })
  assertEqual(detected.inPlanePeriodicAxes.join(','), '0,1')
  assertEqual(detected.sites.filter((site) => site.kind === 'top').length, 1)
  assertEqual(detected.sites.filter((site) => site.kind === 'bridge').length, 2)
  assertEqual(detected.sites.filter((site) => site.kind === 'hollow').length, 2)
  assertTrue(detected.sites.some((site) => site.atomImages.some((image) => image.some((value) => value !== 0))))
  assertTrue(detected.checks.some((check) => check.id === 'surface.periodic_edge_sites' && check.status === 'pass'))
}

function testTaggedAdsorbateOverlayerCannotReplaceHostSurface() {
  const covered: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    lattice: { vectors: [[6, 0, 0], [0, 6, 0], [0, 0, 18]], periodic: [true, true, true] },
    atoms: [
      { id: 'pt-1', element: 'Pt', position: [0, 0, 7] },
      { id: 'pt-2', element: 'Pt', position: [3, 0, 7] },
      { id: 'pt-3', element: 'Pt', position: [0, 3, 7] },
      { id: 'pt-4', element: 'Pt', position: [3, 3, 7] },
      ...Array.from({ length: 8 }, (_, index) => ({
        id: `ads-${index + 1}`,
        element: index % 3 === 0 ? 'O' : 'H',
        position: [index % 4 * 1.2, Math.floor(index / 4) * 1.2, 9 + (index % 2) * 0.4] as [number, number, number],
        properties: { 'zatom.role': 'adsorbate' },
      })),
    ],
  }
  const detected = detectAdsorptionSites({ structure: covered, surfaceUp: [0, 0, 1] })
  assertEqual(detected.surfaceAtomIds.sort().join(','), ['pt-1', 'pt-2', 'pt-3', 'pt-4'].join(','))
  assertTrue(detected.checks.some((check) => (
    check.id === 'surface.adsorbates_excluded'
    && check.metrics?.excludedAdsorbateAtomCount === 8
  )))
}

function testVacuumAlongAOwnsTheInferredSurfaceNormal() {
  const slabAlongA: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    lattice: { vectors: [[18, 0, 0], [0, 5, 0], [0, 0, 5]], periodic: [true, true, true] },
    atoms: [
      { id: 'left-1', element: 'Pt', position: [7, 0, 0] },
      { id: 'left-2', element: 'Pt', position: [7, 2.5, 2.5] },
      { id: 'right-1', element: 'Pt', position: [10, 0, 0] },
      { id: 'right-2', element: 'Pt', position: [10, 2.5, 2.5] },
    ],
  }
  const detected = detectAdsorptionSites({ structure: slabAlongA })
  assertTrue(Math.abs(detected.normal[0]) > 0.99, `vacuum-axis-a normal must be ±x, received ${detected.normal}`)
  assertTrue(Math.abs(detected.normal[1]) < 1e-9 && Math.abs(detected.normal[2]) < 1e-9)
  assertTrue(
    detected.surfaceAtomIds.every((id) => id.startsWith(detected.normal[0] > 0 ? 'right-' : 'left-')),
    `surface atoms must come from one x face, received ${detected.surfaceAtomIds.join(',')}`,
  )

  const catalog = enumerateAdsorptionConfigurations({
    structure: slabAlongA,
    fragment: 'H',
    siteKinds: ['top'],
    maxCandidates: 16,
  })
  assertTrue(
    Math.abs(catalog.catalog.candidates[0].site.normal[0]) > 0.99,
    'configuration search must replay the detector-owned ±x surface normal',
  )
}

function testCollisionIsAHardGate() {
  const placed = placeAdsorbate({
    structure: ptSurface,
    fragment: 'H',
    siteAtomIds: ['pt-00'],
    bondLengthA: 0.1,
  })
  assertTrue(placed.collision !== null)
  assertTrue(placed.checks.some((check) => check.id === 'adsorbate.collision' && check.status === 'fail'))
}

function testOrientationAndDeclaredSurfaceBond() {
  const placed = placeAdsorbate({
    structure: ptSurface,
    fragment: 'OH',
    siteAtomIds: ['pt-00'],
    tiltDeg: 90,
    azimuthDeg: 90,
    surfaceBondPolicy: 'anchor-to-site-atoms',
    surfaceBondOrder: 1,
  })
  const anchor = placed.structure.atoms.find((atom) => atom.id === placed.addedAtomIds[0])!
  const hydrogen = placed.structure.atoms.find((atom) => atom.id === placed.addedAtomIds[1])!
  assertTrue(Math.abs(hydrogen.position[0] - anchor.position[0]) < 1e-10)
  assertTrue(Math.abs(hydrogen.position[1] - anchor.position[1] - 0.97) < 1e-10)
  assertTrue(Math.abs(hydrogen.position[2] - anchor.position[2]) < 1e-10)
  assertEqual(placed.surfaceBondIds.length, 1)
  assertEqual(placed.structure.bonds?.length, 2)
  assertTrue(placed.structure.bonds?.some((bond) => bond.properties?.['zatom.role'] === 'declared-adsorbate-surface-bond') === true)
  assertTrue(placed.checks.some((check) => check.id === 'adsorbate.surface_bonds' && check.status === 'pass'))
}

function testPeriodicAdsorbateCollisionIsExact() {
  const periodic: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    lattice: { vectors: [[4, 0, 0], [0, 4, 0], [0, 0, 4]], periodic: [true, true, true] },
    atoms: [
      { id: 'site', element: 'Pt', position: [3.9, 0, 0] },
      { id: 'periodic-neighbor', element: 'Pt', position: [0.7, 0, 0] },
    ],
  }
  const placed = placeAdsorbate({
    structure: periodic,
    fragment: 'H',
    siteAtomIds: ['site'],
    surfaceUp: [1, 0, 0],
    bondLengthA: 1.7,
  })
  assertEqual(placed.collision?.existingAtomId, 'periodic-neighbor')
  assertTrue(placed.collision !== null && Math.abs(placed.collision.distanceA - 0.9) < 1e-10)
  assertTrue(placed.checks.some((check) => check.id === 'adsorbate.collision' && check.status === 'fail'))
}

function testManualBridgeSelectionUsesNearestPeriodicImages() {
  const periodic: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    lattice: { vectors: [[10, 0, 0], [0, 10, 0], [0, 0, 15]], periodic: [true, true, true] },
    atoms: [
      { id: 'left-edge', element: 'Pt', position: [0.2, 5, 7.5] },
      { id: 'right-edge', element: 'Pt', position: [9.8, 5, 7.5] },
      { id: 'subsurface', element: 'Pt', position: [5, 5, 5] },
    ],
  }
  const placed = placeAdsorbate({
    structure: periodic,
    fragment: 'H',
    siteAtomIds: ['left-edge', 'right-edge'],
    surfaceUp: [0, 0, 1],
  })
  const x = placed.site.bindingPosition[0]
  assertTrue(
    x < 0.5 || x > 9.5,
    `a cross-boundary bridge must stay at the periodic edge, not jump to cell center (x=${x})`,
  )
  assertTrue(
    placed.site.atomImages.some((image) => image.some((value) => value !== 0)),
    'manual cross-boundary site must report the periodic anchor image it used',
  )
}

function testAdsorptionSearchDeduplicatesWithoutRanking() {
  const result = enumerateAdsorptionConfigurations({
    structure: ptSurface,
    fragment: 'H',
    siteKinds: ['top'],
    tiltAnglesDeg: [0, 90],
    azimuthAnglesDeg: [0, 90],
  })
  assertEqual(result.catalog.search.evaluatedCombinationCount, 16)
  assertEqual(result.catalog.search.uniqueCandidateCount, 4)
  assertEqual(result.catalog.search.duplicateGeometryCount, 12)
  assertEqual(result.catalog.search.validCandidateCount, 4)
  assertTrue(result.catalog.candidates.every((candidate) => candidate.status === 'valid'))
  assertTrue(result.catalog.candidates.every((candidate) => candidate.replayInput.expectedSourceFingerprint === fingerprintStructure(ptSurface)))
  assertTrue(result.checks.some((check) => check.id === 'adsorption_search.model_scope' && check.status === 'warn'))
}

async function testDetectedSiteIdsAreBoundToTheirSourceStructure() {
  const detection = await callZatomMcpTool('surface_detect_adsorption_sites', { structure: ptSurface })
  const detected = detection.structuredContent.data as {
    sourceFingerprint: string
    sites: { id: string }[]
  }
  assertEqual(detected.sourceFingerprint, fingerprintStructure(ptSurface),
    'detection must publish the fingerprint its site IDs are meaningful for')
  const siteId = detected.sites[0].id

  // The user nudges a surface atom after detection. The same site ID now names
  // different geometry, so replaying it against the edited surface must fail
  // loudly rather than quietly adsorbing at the wrong place.
  const edited: ZatomStructure = {
    ...ptSurface,
    atoms: ptSurface.atoms.map((atom, index) => index === 0
      ? { ...atom, position: [atom.position[0] + 0.4, atom.position[1], atom.position[2]] }
      : atom),
  }
  const stale = await callZatomMcpTool('structure_place_adsorbate', {
    structure: edited,
    fragment: 'H',
    siteId,
    expectedSourceFingerprint: detected.sourceFingerprint,
  })
  assertEqual(stale.structuredContent.error?.code, 'stale_adsorption_source',
    'a site ID carried across a structure edit must be rejected, not silently re-resolved')

  // A site ID with no binding at all is the more dangerous case: nothing in the
  // request says which structure it came from, so it must not resolve by luck.
  const unbound = await callZatomMcpTool('structure_place_adsorbate', {
    structure: ptSurface,
    fragment: 'H',
    siteId,
  })
  assertEqual(unbound.structuredContent.error?.code, 'unbound_site_id',
    'placing by siteId without expectedSourceFingerprint must be refused')

  const fresh = await callZatomMcpTool('structure_place_adsorbate', {
    structure: ptSurface,
    fragment: 'H',
    siteId,
    expectedSourceFingerprint: detected.sourceFingerprint,
  })
  assertTrue(fresh.structuredContent.ok, 'the same binding must still place on the unmodified source')
}

function testInvalidPlacementParametersAreRejected() {
  let rejected = false
  try {
    placeAdsorbate({
      structure: ptSurface,
      fragment: 'H',
      siteAtomIds: ['pt-00', 'pt-00'],
      collisionFactor: -1,
    })
  } catch {
    rejected = true
  }
  assertTrue(rejected, 'invalid numeric/manual-site inputs must be rejected before geometry generation')
}

async function testSurfaceMcpContractsAndApplicationGate() {
  const detection = await callZatomMcpTool('surface_detect_adsorption_sites', {
    structure: ptSurface,
    kind: 'top',
    offset: 1,
    limit: 2,
  })
  const detected = detection.structuredContent.data as {
    matchedSiteCount: number
    returnedSiteCount: number
    sites: unknown[]
  }
  assertTrue(detection.structuredContent.ok)
  assertEqual(detected.matchedSiteCount, 4)
  assertEqual(detected.returnedSiteCount, 2)
  assertEqual(detected.sites.length, 2)

  let writes = 0
  const collision = await callZatomMcpTool('structure_place_adsorbate', {
    fragment: 'H',
    siteAtomIds: ['pt-00'],
    bondLengthA: 0.1,
    applyToWorkspace: true,
    captureAfter: false,
  }, {
    readStructure: () => ptSurface,
    writeStructure: () => { writes++ },
  })
  const collisionEnvelope = collision.structuredContent.data as {
    appliedToWorkspace: boolean
    applicationBlocked: boolean
  }
  assertTrue(collision.structuredContent.ok, 'a rejected candidate remains inspectable as a successful tool result')
  assertEqual(collisionEnvelope.appliedToWorkspace, false)
  assertEqual(collisionEnvelope.applicationBlocked, true)
  assertEqual(writes, 0)
  assertTrue(collision.structuredContent.checks?.some((check) => check.id === 'candidate.application_gate' && check.status === 'fail') === true)

  const slab = await callZatomMcpTool('structure_build_miller_slab', {
    structure: cubicSource,
    miller: [0, 0, 1],
    layers: 2,
    vacuumA: 6,
  }, {
    writeStructure: () => { writes++ },
  })
  const slabEnvelope = slab.structuredContent.data as { appliedToWorkspace: boolean }
  assertTrue(slab.structuredContent.ok)
  assertEqual(slabEnvelope.appliedToWorkspace, false, 'explicit structures must default to candidate-only mode')
  assertEqual(writes, 0)
}

async function testSearchCatalogReplaysExactCandidate() {
  const search = await callZatomMcpTool('surface_enumerate_adsorbate_configurations', {
    structure: ptSurface,
    fragment: 'H',
    siteKinds: ['top'],
    tiltAnglesDeg: [0, 90],
    azimuthAnglesDeg: [0, 90],
  })
  assertTrue(search.structuredContent.ok, search.structuredContent.summary)
  const searchData = search.structuredContent.data as ReturnType<typeof enumerateAdsorptionConfigurations>
  const candidate = searchData.catalog.candidates[0]
  assertEqual(searchData.catalog.search.uniqueCandidateCount, 4)
  let active: ZatomStructure | null = ptSurface
  const replay = await callZatomMcpTool('structure_place_adsorbate', {
    structure: ptSurface,
    ...candidate.replayInput,
    applyToWorkspace: true,
  }, {
    writeStructure: (structure) => { active = structuredClone(structure) },
    readStructure: () => active,
  })
  assertTrue(replay.structuredContent.ok, replay.structuredContent.summary)
  const replayData = replay.structuredContent.data as {
    appliedToWorkspace: boolean
    applicationVerified: boolean
    result: { structure: ZatomStructure }
  }
  assertTrue(replayData.appliedToWorkspace)
  assertTrue(replayData.applicationVerified)
  assertEqual(fingerprintStructure(replayData.result.structure), candidate.resultStructureFingerprint)

  const stale = await callZatomMcpTool('structure_place_adsorbate', {
    structure: {
      ...ptSurface,
      atoms: ptSurface.atoms.map((atom, index) => index === 0
        ? { ...atom, position: [0.01, atom.position[1], atom.position[2]] }
        : atom),
    },
    ...candidate.replayInput,
  })
  assertEqual(stale.structuredContent.error?.code, 'stale_adsorption_source')
}

async function testPrepareAdsorptionHonorsSelectionAndPublishesExactPoints() {
  let shown: Array<{
    atomIds?: string[]
    position?: [number, number, number]
    anchorPositions?: Array<[number, number, number]>
    label: string
  }> = []
  const emptyGuidance = { plan: null, annotations: [], candidates: null }
  const prepared = await callZatomMcpTool('surface_prepare_adsorption', {
    siteKinds: ['top', 'bridge', 'hollow'],
    selectionOnly: true,
    maxCandidates: 3,
  }, {
    readStructure: () => ptSurface,
    workspaceIdentity: () => ({
      viewportId: 'vp-selection',
      revision: 4,
      structureFingerprint: fingerprintStructure(ptSurface),
      trajectoryFingerprint: null,
    }),
    readViewerScene: () => ({
      pose: null,
      viewportSizePx: [800, 600],
      selectedAtomIds: ['pt-00'],
      selectedBondIds: [],
      selectedFaceIds: [],
      selectedEdgeIds: [],
      boxSelectionActive: false,
      hoveredAtomId: null,
      lastFocus: null,
    }),
    guidance: {
      read: () => emptyGuidance,
      setPlan: () => emptyGuidance,
      advance: () => emptyGuidance,
      setCaption: () => emptyGuidance,
      annotate: () => emptyGuidance,
      presentCandidates: (_label, items) => {
        shown = items
        return guidanceWithPendingCandidates('surface-choice-1')
      },
      focusCandidate: () => emptyGuidance,
      candidateStatus: pendingCandidateStatus,
      clear: () => emptyGuidance,
    },
    camera: {
      lookAt: async () => ({ center: [0, 0, 0], distance: 5, direction: [0, 0, 1], atomIds: [], interrupted: false }),
      setView: async () => ({ center: [0, 0, 0], distance: 5, direction: [0, 0, 1], atomIds: [], interrupted: false }),
    },
  })
  assertTrue(prepared.structuredContent.ok, prepared.structuredContent.summary)
  const data = prepared.structuredContent.data as {
    candidateSetId: string | null
    viewportId: string
    workspaceRevision: number
    candidates: Array<{ atomIds: string[]; position: [number, number, number]; placeInput: Record<string, unknown> }>
    moleculeCandidates: unknown[]
  }
  assertEqual(data.viewportId, 'vp-selection')
  assertEqual(data.workspaceRevision, 4)
  assertTrue(data.candidates.every((candidate) => candidate.atomIds.includes('pt-00')))
  assertEqual(shown.length, data.candidates.length)
  assertTrue(shown.every((candidate) => Array.isArray(candidate.position)))
  assertTrue(shown.every((candidate) => candidate.anchorPositions?.length === (candidate.atomIds?.length ?? 0)))
  assertTrue(data.moleculeCandidates.length >= 3)
  assertEqual(data.candidateSetId, 'surface-choice-1')
  assertTrue(prepared.structuredContent.summary.includes('guide_candidate_status'))
  assertTrue(data.candidates.every((candidate) => candidate.placeInput.applyToWorkspace === true))
  assertTrue(data.candidates.every((candidate) => candidate.placeInput.resolvedSite !== undefined))

  const replay = await callZatomMcpTool('structure_place_adsorbate', {
    structure: ptSurface,
    fragment: 'H',
    ...data.candidates[0].placeInput,
    applyToWorkspace: false,
  })
  assertTrue(replay.structuredContent.ok, replay.structuredContent.summary)

  const bottomFace = await callZatomMcpTool('surface_prepare_adsorption', {
    siteKinds: ['top'], selectionOnly: true, maxCandidates: 1,
  }, {
    readStructure: () => ptSurface,
    workspaceIdentity: () => ({
      viewportId: 'vp-selection', revision: 4,
      structureFingerprint: fingerprintStructure(ptSurface), trajectoryFingerprint: null,
    }),
    readViewerScene: () => ({
      pose: null, viewportSizePx: [800, 600], selectedAtomIds: ['pt-bottom'],
      selectedBondIds: [], selectedFaceIds: [], selectedEdgeIds: [],
      boxSelectionActive: false, hoveredAtomId: null, lastFocus: null,
    }),
  })
  assertTrue(bottomFace.structuredContent.ok, bottomFace.structuredContent.summary)
  const bottomCandidate = (bottomFace.structuredContent.data as {
    candidates: Array<{ atomIds: string[]; normal: [number, number, number] }>
  }).candidates[0]
  assertTrue(bottomCandidate.atomIds.includes('pt-bottom'))
  assertTrue(bottomCandidate.normal[2] < -0.99, 'selected bottom face must flip the outward normal')
}

async function testPrepareAdsorptionCropsALargeSurfaceToTheSelectedPatch() {
  const side = 21
  const atoms: ZatomStructure['atoms'] = []
  for (let x = 0; x < side; x++) for (let y = 0; y < side; y++) {
    atoms.push({ id: `top-${x}-${y}`, element: 'Pt', position: [x * 2.7, y * 2.7, 8] })
    atoms.push({ id: `sub-${x}-${y}`, element: 'Pt', position: [x * 2.7, y * 2.7, 5.5] })
  }
  const large: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    label: 'large selected Pt patch',
    lattice: {
      vectors: [[side * 2.7, 0, 0], [0, side * 2.7, 0], [0, 0, 24]],
      periodic: [true, true, true],
    },
    atoms,
  }
  const prepared = await callZatomMcpTool('surface_prepare_adsorption', {
    selectionOnly: true,
    maxCandidates: 3,
  }, {
    readStructure: () => large,
    workspaceIdentity: () => ({
      viewportId: 'vp-large-patch',
      revision: 9,
      structureFingerprint: fingerprintStructure(large),
      trajectoryFingerprint: null,
    }),
    readViewerScene: () => ({
      pose: null,
      viewportSizePx: [800, 600],
      selectedAtomIds: ['top-10-10'],
      selectedBondIds: [], selectedFaceIds: [], selectedEdgeIds: [],
      boxSelectionActive: false, hoveredAtomId: null, lastFocus: null,
    }),
  })
  assertTrue(prepared.structuredContent.ok, prepared.structuredContent.summary)
  const data = prepared.structuredContent.data as {
    surfaceAtomIds: string[]
    candidates: Array<{ atomIds: string[]; placeInput: { resolvedSite: unknown } }>
  }
  assertTrue(data.surfaceAtomIds.length < 200, `local patch should stay bounded, received ${data.surfaceAtomIds.length}`)
  assertTrue(data.candidates.length > 0)
  assertTrue(data.candidates.every((candidate) => candidate.atomIds.includes('top-10-10')))
}

async function testPrepareAdsorptionDoesNotStampOldSitesWithANewerRevision() {
  let revision = 4
  let guidanceWrites = 0
  const identity = () => ({
    viewportId: 'vp-stale-surface',
    revision,
    structureFingerprint: fingerprintStructure(ptSurface),
    trajectoryFingerprint: null,
  })
  const result = await callZatomMcpTool('surface_prepare_adsorption', {}, {
    expectedWorkspace: identity(),
    readStructure: () => ptSurface,
    workspaceIdentity: identity,
    readViewerScene: () => {
      revision = 5
      return {
        pose: null, viewportSizePx: [800, 600], selectedAtomIds: [],
        selectedBondIds: [], selectedFaceIds: [], selectedEdgeIds: [],
        boxSelectionActive: false, hoveredAtomId: null, lastFocus: null,
      }
    },
    guidance: {
      read: () => ({ plan: null, annotations: [], candidates: null }),
      setPlan: () => { guidanceWrites++; return { plan: null, annotations: [], candidates: null } },
      advance: () => ({ plan: null, annotations: [], candidates: null }),
      setCaption: () => ({ plan: null, annotations: [], candidates: null }),
      annotate: () => ({ plan: null, annotations: [], candidates: null }),
      presentCandidates: () => { guidanceWrites++; return { plan: null, annotations: [], candidates: null } },
      focusCandidate: () => ({ plan: null, annotations: [], candidates: null }),
      candidateStatus: pendingCandidateStatus,
      clear: () => ({ plan: null, annotations: [], candidates: null }),
    },
  })
  assertEqual(result.structuredContent.ok, false)
  assertEqual(result.structuredContent.error?.code, 'workspace_identity_changed')
  assertEqual(guidanceWrites, 0)
}

async function testPrepareAdsorptionCanAbortBeforeTopologyWork() {
  const controller = new AbortController()
  let guidanceWrites = 0
  const resultPromise = callZatomMcpTool('surface_prepare_adsorption', {}, {
    signal: controller.signal,
    readStructure: () => ptSurface,
    workspaceIdentity: () => ({
      viewportId: 'vp-cancel-surface', revision: 2,
      structureFingerprint: fingerprintStructure(ptSurface), trajectoryFingerprint: null,
    }),
    readViewerScene: () => ({
      pose: null, viewportSizePx: [800, 600], selectedAtomIds: ['pt-00'],
      selectedBondIds: [], selectedFaceIds: [], selectedEdgeIds: [],
      boxSelectionActive: false, hoveredAtomId: null, lastFocus: null,
    }),
    guidance: {
      read: () => ({ plan: null, annotations: [], candidates: null }),
      setPlan: () => { guidanceWrites++; return { plan: null, annotations: [], candidates: null } },
      advance: () => ({ plan: null, annotations: [], candidates: null }),
      setCaption: () => ({ plan: null, annotations: [], candidates: null }),
      annotate: () => ({ plan: null, annotations: [], candidates: null }),
      presentCandidates: () => { guidanceWrites++; return { plan: null, annotations: [], candidates: null } },
      focusCandidate: () => ({ plan: null, annotations: [], candidates: null }),
      candidateStatus: pendingCandidateStatus,
      clear: () => ({ plan: null, annotations: [], candidates: null }),
    },
  })
  // This timer can only win if preparation yields a browser task before the
  // synchronous topology calculation. A chain of resolved-promise awaits is
  // insufficient because it never lets timers/UI input run.
  setTimeout(() => controller.abort(new Error('user cancelled adsorption preparation')), 0)
  const result = await resultPromise
  assertEqual(result.structuredContent.ok, false)
  assertEqual(result.structuredContent.error?.code, 'tool_execution_aborted')
  assertEqual(guidanceWrites, 0)
}

async function testPrepareAdsorptionRejectsSelectionChangeBeforePublication() {
  let viewerReads = 0
  let guidanceWrites = 0
  let cameraCalls = 0
  const emptyGuidance = { plan: null, annotations: [], candidates: null }
  const result = await callZatomMcpTool('surface_prepare_adsorption', {}, {
    readStructure: () => ptSurface,
    workspaceIdentity: () => ({
      viewportId: 'vp-selection-race', revision: 7,
      structureFingerprint: fingerprintStructure(ptSurface), trajectoryFingerprint: null,
    }),
    readViewerScene: () => ({
      pose: null, viewportSizePx: [800, 600],
      selectedAtomIds: viewerReads++ === 0 ? ['pt-00'] : ['pt-10'],
      selectedBondIds: [], selectedFaceIds: [], selectedEdgeIds: [],
      boxSelectionActive: false, hoveredAtomId: null, lastFocus: null,
    }),
    guidance: {
      read: () => emptyGuidance,
      setPlan: () => { guidanceWrites++; return emptyGuidance },
      advance: () => emptyGuidance,
      setCaption: () => emptyGuidance,
      annotate: () => emptyGuidance,
      presentCandidates: () => { guidanceWrites++; return emptyGuidance },
      focusCandidate: () => emptyGuidance,
      candidateStatus: pendingCandidateStatus,
      clear: () => emptyGuidance,
    },
    camera: {
      lookAt: async () => {
        cameraCalls++
        return { center: [0, 0, 0], distance: 5, direction: [0, 0, 1], atomIds: [], interrupted: false }
      },
      setView: async () => ({ center: [0, 0, 0], distance: 5, direction: [0, 0, 1], atomIds: [], interrupted: false }),
    },
  })
  assertEqual(result.structuredContent.ok, false)
  assertEqual(result.structuredContent.error?.code, 'selection_changed')
  assertEqual(guidanceWrites, 0)
  assertEqual(cameraCalls, 0)
}

async function testCandidateClickAfterPublicationIsNotRejectedAsStaleInput() {
  let selectedAtomIds = ['pt-00']
  let planVisible = false
  let candidatesVisible = false
  let clearCalls = 0
  let cameraCalls = 0
  const emptyGuidance = { plan: null, annotations: [], candidates: null }
  const result = await callZatomMcpTool('surface_prepare_adsorption', {}, {
    readStructure: () => ptSurface,
    workspaceIdentity: () => ({
      viewportId: 'vp-selection-race', revision: 7,
      structureFingerprint: fingerprintStructure(ptSurface), trajectoryFingerprint: null,
    }),
    readViewerScene: () => ({
      pose: null, viewportSizePx: [800, 600], selectedAtomIds,
      selectedBondIds: [], selectedFaceIds: [], selectedEdgeIds: [],
      boxSelectionActive: false, hoveredAtomId: null, lastFocus: null,
    }),
    guidance: {
      read: () => emptyGuidance,
      setPlan: () => {
        planVisible = true
        return emptyGuidance
      },
      advance: () => emptyGuidance,
      setCaption: () => emptyGuidance,
      annotate: () => emptyGuidance,
      presentCandidates: () => {
        candidatesVisible = true
        // The candidate badges are now live. This is a legitimate click on a
        // presented option, not a stale change to the input selection.
        selectedAtomIds = ['pt-10']
        return guidanceWithPendingCandidates('surface-choice-after-click')
      },
      focusCandidate: () => emptyGuidance,
      candidateStatus: pendingCandidateStatus,
      clear: () => {
        clearCalls++
        planVisible = false
        candidatesVisible = false
        return emptyGuidance
      },
    },
    camera: {
      lookAt: async () => {
        cameraCalls++
        return { center: [0, 0, 0], distance: 5, direction: [0, 0, 1], atomIds: [], interrupted: false }
      },
      setView: async () => ({ center: [0, 0, 0], distance: 5, direction: [0, 0, 1], atomIds: [], interrupted: false }),
    },
  })
  assertEqual(result.structuredContent.ok, true)
  assertEqual(clearCalls, 0)
  assertEqual(planVisible, true)
  assertEqual(candidatesVisible, true)
  assertEqual(cameraCalls, 1)
}

async function testPrepareAdsorptionRejectsAnOversizedSelectedPatchBeforePairSearch() {
  const atoms: ZatomStructure['atoms'] = []
  const selectedAtomIds: string[] = []
  for (let index = 0; index < 201; index++) {
    const x = (index % 20) * 3
    const y = Math.floor(index / 20) * 3
    const topId = `selected-top-${index}`
    selectedAtomIds.push(topId)
    atoms.push({ id: topId, element: 'Pt', position: [x, y, 5] })
    atoms.push({ id: `bottom-${index}`, element: 'Pt', position: [x, y, 0] })
  }
  const structure: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    lattice: { vectors: [[60, 0, 0], [0, 36, 0], [0, 0, 20]], periodic: [true, true, true] },
    atoms,
  }
  const result = await callZatomMcpTool('surface_prepare_adsorption', {}, {
    readStructure: () => structure,
    workspaceIdentity: () => ({
      viewportId: 'vp-large-selection', revision: 1,
      structureFingerprint: fingerprintStructure(structure), trajectoryFingerprint: null,
    }),
    readViewerScene: () => ({
      pose: null, viewportSizePx: [800, 600], selectedAtomIds,
      selectedBondIds: [], selectedFaceIds: [], selectedEdgeIds: [],
      boxSelectionActive: false, hoveredAtomId: null, lastFocus: null,
    }),
  })
  assertEqual(result.structuredContent.ok, false)
  assertEqual(result.structuredContent.error?.code, 'surface_region_too_large')
}

async function main() {
  testMillerSlabHasRequestedVacuumAndBounds()
  testSiteDetectionAndAdsorbatePlacement()
  testSurfaceAtomLimitRunsBeforePeriodicMeshBudget()
  testPrepareAdsorptionPublishesTopologyBudgets()
  testBulkCrystalCannotPretendToHaveAdsorptionSites()
  testPeriodicDelaunaySitesCrossCellEdges()
  testTaggedAdsorbateOverlayerCannotReplaceHostSurface()
  testVacuumAlongAOwnsTheInferredSurfaceNormal()
  testCollisionIsAHardGate()
  testOrientationAndDeclaredSurfaceBond()
  testPeriodicAdsorbateCollisionIsExact()
  testManualBridgeSelectionUsesNearestPeriodicImages()
  testAdsorptionSearchDeduplicatesWithoutRanking()
  testInvalidPlacementParametersAreRejected()
  await testDetectedSiteIdsAreBoundToTheirSourceStructure()
  await testSurfaceMcpContractsAndApplicationGate()
  await testSearchCatalogReplaysExactCandidate()
  await testPrepareAdsorptionHonorsSelectionAndPublishesExactPoints()
  await testPrepareAdsorptionCropsALargeSurfaceToTheSelectedPatch()
  await testPrepareAdsorptionDoesNotStampOldSitesWithANewerRevision()
  await testPrepareAdsorptionCanAbortBeforeTopologyWork()
  await testPrepareAdsorptionRejectsSelectionChangeBeforePublication()
  await testCandidateClickAfterPublicationIsNotRejectedAsStaleInput()
  await testPrepareAdsorptionRejectsAnOversizedSelectedPatchBeforePairSearch()
}

void main()
