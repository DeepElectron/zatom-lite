import { assertDeepEqual, assertEqual, assertTrue } from '../../testing/assert'
import type { ZatomStructure } from '../contracts'
import { ZATOM_STRUCTURE_SCHEMA } from '../contracts'
import { buildMatchedInterface, findDiagonalInterfaceMatches } from '../interface'
import { callZatomMcpTool } from '../mcp-adapter'
import { fingerprintStructure } from '../structure-math'
import { enumerateInterfaceRegistryConfigurations } from '../interface-registry-search'

function squareMonolayer(label: string, latticeA: number, element: string): ZatomStructure {
  return {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    label,
    lattice: {
      vectors: [[latticeA, 0, 0], [0, latticeA, 0], [0, 0, 10]],
      periodic: [true, true, true],
    },
    atoms: [{ id: `${label}-1`, element, position: [0, 0, 2] }],
  }
}

const bottom = squareMonolayer('bottom', 2, 'C')
const commensurateTop = squareMonolayer('top', 3, 'Si')

function testDiagonalMatchAndStacking() {
  const matches = findDiagonalInterfaceMatches({
    bottom,
    top: commensurateTop,
    maxRepeat: 3,
    maxStrain: 0.01,
  })
  assertDeepEqual(matches.recommended.bottomRepeat, [3, 3])
  assertDeepEqual(matches.recommended.topRepeat, [2, 2])
  assertTrue(matches.recommended.maxAbsLinearStrain < 1e-12)
  assertTrue(matches.checks.some((check) => check.id === 'interface.match_found' && check.status === 'pass'))

  const built = buildMatchedInterface({
    bottom,
    top: commensurateTop,
    maxRepeat: 3,
    maxStrain: 0.01,
    gapA: 3,
    vacuumA: 12,
  })
  assertEqual(built.structure.atoms.length, 13)
  assertTrue(Math.abs(built.metrics.measuredGapA - 3) < 1e-8)
  assertTrue(Math.abs(built.metrics.measuredVacuumA - 12) < 1e-8)
  assertTrue(Math.abs((built.metrics.minimumCrossInterfaceDistanceA ?? 0) - 3) < 1e-8)
  assertTrue(built.checks.every((check) => check.status !== 'fail'))
  assertTrue(built.inspectionTargets.some((target) => target.id === 'stacked-interface'))
  assertTrue(built.structure.atoms.every((atom) => atom.id.startsWith('bottom:') || atom.id.startsWith('top:')))
  assertEqual(built.referenceStructures.bottom.atoms.length, 9)
  assertEqual(built.referenceStructures.top.atoms.length, 4)
  assertDeepEqual(built.referenceStructures.bottom.lattice, built.structure.lattice)
  assertDeepEqual(built.referenceStructures.top.lattice, built.structure.lattice)
  assertDeepEqual(
    [...built.referenceStructures.bottom.atoms, ...built.referenceStructures.top.atoms].map((atom) => atom.id),
    built.structure.atoms.map((atom) => atom.id),
  )
  assertEqual(fingerprintStructure(built.referenceStructures.bottom), built.referenceFingerprints.bottom)
  assertEqual(fingerprintStructure(built.referenceStructures.top), built.referenceFingerprints.top)
  assertTrue(built.checks.some((check) => check.id === 'interface.reference_structures' && check.status === 'pass'))
}

function testRegistrySearchCanonicalizesPeriodicOffsets() {
  const result = enumerateInterfaceRegistryConfigurations({
    bottom,
    top: commensurateTop,
    bottomRepeat: [3, 3],
    topRepeat: [2, 2],
    registryOffsetsFractional: [[0, 0], [1, 0]],
    gapsA: [3],
    maxStrain: 0.01,
  })
  assertEqual(result.catalog.search.evaluatedCombinationCount, 2)
  assertEqual(result.catalog.search.uniqueCandidateCount, 1)
  assertEqual(result.catalog.search.duplicateGeometryCount, 1)
  assertEqual(result.catalog.candidates[0].equivalentParameterSets.length, 2)
  assertEqual(result.catalog.candidates[0].status, 'valid')
  assertTrue(result.checks.some((check) => check.id === 'interface_registry_search.model_scope' && check.status === 'warn'))
}

async function testMcpBlocksOverstrainedCandidate() {
  let writes = 0
  const response = await callZatomMcpTool('structure_build_interface', {
    bottom,
    top: commensurateTop,
    bottomRepeat: [1, 1],
    topRepeat: [1, 1],
    maxStrain: 0.05,
    applyToWorkspace: true,
    captureAfter: false,
  }, {
    writeStructure: () => { writes++ },
  })
  const envelope = response.structuredContent.data as {
    appliedToWorkspace: boolean
    applicationBlocked: boolean
  }
  assertTrue(response.structuredContent.ok)
  assertEqual(envelope.appliedToWorkspace, false)
  assertEqual(envelope.applicationBlocked, true)
  assertEqual(writes, 0)
  assertTrue(response.structuredContent.checks?.some((check) => check.id === 'interface.inplane_match' && check.status === 'fail') === true)
  assertTrue(response.structuredContent.checks?.some((check) => check.id === 'candidate.application_gate' && check.status === 'fail') === true)
}

async function testMcpMatchUsesActiveBottom() {
  const response = await callZatomMcpTool('interface_find_diagonal_matches', {
    top: commensurateTop,
    maxRepeat: 3,
    maxStrain: 0.01,
    limit: 3,
  }, {
    readStructure: () => bottom,
  })
  const result = response.structuredContent.data as {
    recommended: { bottomRepeat: [number, number]; topRepeat: [number, number] }
  }
  assertTrue(response.structuredContent.ok)
  assertDeepEqual(result.recommended.bottomRepeat, [3, 3])
  assertDeepEqual(result.recommended.topRepeat, [2, 2])
}

async function testRegistryCatalogReplaysExactInterface() {
  const search = await callZatomMcpTool('interface_enumerate_registry_configurations', {
    bottom,
    top: commensurateTop,
    bottomRepeat: [3, 3],
    topRepeat: [2, 2],
    registryGrid: [2, 1],
    gapsA: [3],
    maxStrain: 0.01,
  })
  assertTrue(search.structuredContent.ok, search.structuredContent.summary)
  const data = search.structuredContent.data as ReturnType<typeof enumerateInterfaceRegistryConfigurations>
  assertEqual(data.catalog.search.uniqueCandidateCount, 2)
  const candidate = data.catalog.candidates[0]
  let active: ZatomStructure | null = null
  const replay = await callZatomMcpTool('structure_build_interface', {
    bottom,
    top: commensurateTop,
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

  const stale = await callZatomMcpTool('structure_build_interface', {
    bottom,
    top: {
      ...commensurateTop,
      atoms: commensurateTop.atoms.map((atom) => ({ ...atom, position: [0.01, atom.position[1], atom.position[2]] })),
    },
    ...candidate.replayInput,
  })
  assertEqual(stale.structuredContent.error?.code, 'stale_interface_top')
}

async function main() {
  testDiagonalMatchAndStacking()
  testRegistrySearchCanonicalizesPeriodicOffsets()
  await testMcpBlocksOverstrainedCandidate()
  await testMcpMatchUsesActiveBottom()
  await testRegistryCatalogReplaysExactInterface()
}

void main()
