import { assertDeepEqual, assertEqual, assertTrue } from '../../testing/assert'
import type { ZatomStructure, ZatomToolContext } from '../contracts'
import { ZATOM_STRUCTURE_SCHEMA } from '../contracts'
import { callZatomMcpTool } from '../mcp-adapter'
import { placeStructureComponent } from '../component-placement'
import { buildCanonicalMetalCluster, MetalClusterInputError } from '../metal-cluster'
import { fingerprintStructure } from '../structure-math'

const host: ZatomStructure = {
  schemaVersion: ZATOM_STRUCTURE_SCHEMA,
  label: 'periodic host',
  lattice: { vectors: [[20, 0, 0], [0, 20, 0], [0, 0, 20]], periodic: [true, true, true] },
  atoms: [
    { id: 'shared', element: 'C', position: [1, 1, 1] },
    { id: 'guest::shared', element: 'C', position: [3, 3, 3] },
  ],
  bonds: [{ id: 'shared-bond', atomIds: ['shared', 'guest::shared'], order: 1 }],
}

const component: ZatomStructure = {
  schemaVersion: ZATOM_STRUCTURE_SCHEMA,
  label: 'finite component',
  atoms: [
    { id: 'shared', element: 'H', position: [0, 0, 0] },
    { id: 'other', element: 'H', position: [1, 0, 0] },
  ],
  bonds: [{ id: 'shared-bond', atomIds: ['shared', 'other'], order: 1 }],
}

function approximate(actual: number, expected: number, tolerance = 1e-10) {
  assertTrue(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`)
}

function testPlacementPreservesHostLatticeTopologyAndDeterministicIdentity() {
  const first = placeStructureComponent({
    host,
    component,
    componentId: 'guest',
    translationA: [10, 0, 0],
    rotationAxis: [0, 0, 1],
    rotationAngleDeg: 90,
    rotationOriginA: [0, 0, 0],
  })
  const second = placeStructureComponent({
    host,
    component,
    componentId: 'guest',
    translationA: [10, 0, 0],
    rotationAxis: [0, 0, 1],
    rotationAngleDeg: 90,
    rotationOriginA: [0, 0, 0],
  })

  assertDeepEqual(first.structure.lattice, host.lattice)
  assertEqual(first.structure.atoms.length, 4)
  assertDeepEqual(first.component.renamedAtomIds, [{ sourceId: 'shared', resultId: 'guest::shared#2' }])
  assertDeepEqual(first.component.renamedBondIds, [{ sourceId: 'shared-bond', resultId: 'guest::shared-bond' }])
  const placedShared = first.structure.atoms.find((atom) => atom.id === 'guest::shared#2')!
  const placedOther = first.structure.atoms.find((atom) => atom.id === 'other')!
  approximate(placedShared.position[0], 10)
  approximate(placedShared.position[1], 0)
  approximate(placedOther.position[0], 10)
  approximate(placedOther.position[1], 1)
  const placedBond = first.structure.bonds?.find((bond) => bond.id === 'guest::shared-bond')
  assertDeepEqual(placedBond?.atomIds, ['guest::shared#2', 'other'])
  assertTrue(first.checks.some((check) => check.id === 'component.rigid_rotation' && check.status === 'pass'))
  assertTrue(first.checks.some((check) => check.id === 'component.host_collision' && check.status !== 'fail'))
  assertEqual(first.validation.verdict, 'pass')
  assertEqual(fingerprintStructure(first.structure), fingerprintStructure(second.structure))
}

async function testPlacementAppliesThroughCanonicalCandidateGate() {
  let active = structuredClone(host)
  let writeCount = 0
  const context: ZatomToolContext = {
    readStructure: () => structuredClone(active),
    writeStructure: (value) => {
      writeCount++
      active = structuredClone(value)
    },
  }
  const response = await callZatomMcpTool('structure_place_component', {
    component,
    componentId: 'applied',
    translationA: [12, 0, 0],
    applyToWorkspace: true,
    captureAfter: false,
  }, context)
  assertTrue(response.structuredContent.ok, response.structuredContent.summary)
  const data = response.structuredContent.data as {
    appliedToWorkspace: boolean
    applicationVerified: boolean
    result: { structure: ZatomStructure }
  }
  assertEqual(data.appliedToWorkspace, true)
  assertEqual(data.applicationVerified, true)
  assertEqual(writeCount, 1)
  assertEqual(active.atoms.length, 4)
  assertEqual(fingerprintStructure(active), fingerprintStructure(data.result.structure))
}

async function testPeriodicCollisionFailsClosedWithoutWriting() {
  const periodicHost: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    lattice: { vectors: [[10, 0, 0], [0, 10, 0], [0, 0, 10]], periodic: [true, true, true] },
    atoms: [{ id: 'host', element: 'He', position: [0.1, 0, 0] }],
  }
  const periodicComponent: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    atoms: [{ id: 'component', element: 'He', position: [9.9, 0, 0] }],
  }
  let writeCount = 0
  const response = await callZatomMcpTool('structure_place_component', {
    component: periodicComponent,
    componentId: 'collision',
    minimumHostDistanceA: 0.5,
    applyToWorkspace: true,
    captureAfter: false,
  }, {
    readStructure: () => periodicHost,
    writeStructure: () => { writeCount++ },
  })
  assertTrue(response.structuredContent.ok, response.structuredContent.summary)
  const data = response.structuredContent.data as {
    appliedToWorkspace: boolean
    applicationBlocked: boolean
    result: {
      collision: { distanceA: number } | null
      periodicImageCandidateEvaluations: number
      checks: Array<{ id: string; status: string }>
    }
  }
  assertEqual(data.appliedToWorkspace, false)
  assertEqual(data.applicationBlocked, true)
  assertEqual(writeCount, 0)
  approximate(data.result.collision?.distanceA ?? -1, 0.2)
  assertTrue(data.result.periodicImageCandidateEvaluations > 0)
  assertTrue(data.result.checks.some((check) => check.id === 'component.host_collision' && check.status === 'fail'))
}

async function testMetalClusterCandidateFeedsPlacementDirectly() {
  const built = await callZatomMcpTool('structure_build_metal_cluster', {
    geometry: 'icosahedral',
    element: 'Pt',
    shells: 1,
    applyToWorkspace: false,
  })
  assertTrue(built.structuredContent.ok, built.structuredContent.summary)
  const builtData = built.structuredContent.data as {
    appliedToWorkspace: boolean
    result: { structure: ZatomStructure; metrics: { atomCount: number }; checks: Array<{ id: string; status: string }> }
  }
  assertEqual(builtData.appliedToWorkspace, false)
  assertEqual(builtData.result.metrics.atomCount, 13)
  assertEqual(builtData.result.structure.lattice, undefined)
  assertTrue(builtData.result.checks.some((check) => check.id === 'metal_cluster.finite_component' && check.status === 'pass'))

  const finiteHost: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    atoms: [{ id: 'anchor', element: 'He', position: [0, 0, 0] }],
  }
  const placed = await callZatomMcpTool('structure_place_component', {
    structure: finiteHost,
    component: builtData.result.structure,
    componentId: 'pt-cluster',
    translationA: [20, 0, 0],
    applyToWorkspace: false,
  })
  assertTrue(placed.structuredContent.ok, placed.structuredContent.summary)
  const placedData = placed.structuredContent.data as {
    result: { structure: ZatomStructure; component: { atomCount: number } }
  }
  assertEqual(placedData.result.component.atomCount, 13)
  assertEqual(placedData.result.structure.atoms.length, 14)
}

function testMetalClusterEnumerationBudgetRejectsTinyBondLengthBeforeBuilding() {
  let caught: unknown
  try {
    buildCanonicalMetalCluster({
      geometry: 'fcc',
      element: 'Pt',
      radiusA: 100,
      bondLengthA: 1e-9,
      maxEnumerationSites: 100_000,
      maxAtoms: 50_000,
    })
  } catch (error) {
    caught = error
  }
  assertTrue(caught instanceof MetalClusterInputError)
  assertEqual((caught as MetalClusterInputError).code, 'metal_cluster_enumeration_budget_exceeded')
}

function testMetalClusterRejectsIgnoredParametersAndNonMetals() {
  for (const [options, expectedCode] of [
    [{ geometry: 'icosahedral', element: 'Pt', radiusA: 8 }, 'unsupported_metal_cluster_parameter'],
    [{ geometry: 'fcc', element: 'Pt', shells: 3 }, 'unsupported_metal_cluster_parameter'],
    [{ geometry: 'fcc', element: 'C', radiusA: 6 }, 'non_metal_cluster_element'],
  ] as const) {
    let caught: unknown
    try {
      buildCanonicalMetalCluster(options)
    } catch (error) {
      caught = error
    }
    assertTrue(caught instanceof MetalClusterInputError)
    assertEqual((caught as MetalClusterInputError).code, expectedCode)
  }
}

async function main() {
  testPlacementPreservesHostLatticeTopologyAndDeterministicIdentity()
  await testPlacementAppliesThroughCanonicalCandidateGate()
  await testPeriodicCollisionFailsClosedWithoutWriting()
  await testMetalClusterCandidateFeedsPlacementDirectly()
  testMetalClusterEnumerationBudgetRejectsTinyBondLengthBeforeBuilding()
  testMetalClusterRejectsIgnoredParametersAndNonMetals()
}

void main()
