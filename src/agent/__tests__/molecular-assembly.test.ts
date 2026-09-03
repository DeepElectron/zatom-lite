import { assertDeepEqual, assertEqual, assertTrue } from '../../testing/assert'
import type { ZatomStructure } from '../contracts'
import { ZATOM_STRUCTURE_SCHEMA } from '../contracts'
import { callZatomMcpTool } from '../mcp-adapter'
import { createMoleculeFromTemplate } from '../molecule'
import { assembleMolecularSystem, MolecularAssemblyInputError } from '../molecular-assembly'
import { distance, fingerprintStructure } from '../structure-math'

function molecule(template: 'water' | 'methane'): ZatomStructure {
  return createMoleculeFromTemplate({ template }).structure
}

function monatomic(id: string, element: string, formalCharge: number): ZatomStructure {
  return {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    label: `${element} ion`,
    atoms: [{ id, element, position: [0, 0, 0], properties: { formalCharge } }],
    bonds: [],
  }
}

function testRigidAssemblyIsDeterministicAndTopologyPreserving() {
  const water = molecule('water')
  const options = {
    label: 'two rigid waters',
    components: [
      { id: 'water-a', structure: water },
      {
        id: 'water-b',
        structure: water,
        translationA: [4, 0, 0] as [number, number, number],
        rotationAxis: [0, 0, 1] as [number, number, number],
        rotationAngleDeg: 180,
      },
    ],
    minimumIntercomponentDistanceA: 0.65,
    intercomponentWarningDistanceA: 0.9,
  }
  const first = assembleMolecularSystem(options)
  const replay = assembleMolecularSystem(options)
  assertEqual(first.structure.atoms.length, 6)
  assertEqual(first.structure.bonds?.length, 4)
  assertEqual(first.components.length, 2)
  assertTrue(first.structure.atoms.every((atom) => atom.id.startsWith('water-a::') || atom.id.startsWith('water-b::')))
  assertEqual(first.structure.atoms[0].properties?.['zatom.assembly.componentId'], 'water-a')
  assertEqual(first.structure.atoms[3].properties?.['zatom.assembly.sourceAtomId'], water.atoms[0].id)
  assertTrue((first.minimumIntercomponentDistanceA ?? 0) > 1)
  assertTrue(first.checks.every((check) => check.status !== 'fail'))
  assertTrue(first.checks.some((check) => check.id === 'assembly.transform_round_trip' && check.status === 'pass'))
  assertEqual(fingerprintStructure(first.structure), fingerprintStructure(replay.structure))
  const sourceBondLength = distance(water.atoms[0].position, water.atoms[1].position)
  const transformedBondLength = distance(first.structure.atoms[3].position, first.structure.atoms[4].position)
  assertTrue(Math.abs(sourceBondLength - transformedBondLength) < 1e-10)
}

function testExternalBondAndPeriodicMinimumImage() {
  const carbon = monatomic('c', 'C', 0)
  const linked = assembleMolecularSystem({
    components: [
      { id: 'left', structure: carbon },
      { id: 'right', structure: carbon, translationA: [1.54, 0, 0] },
    ],
    externalBonds: [{
      id: 'left-right',
      atomA: { componentId: 'left', atomId: 'c' },
      atomB: { componentId: 'right', atomId: 'c' },
      order: 1,
      properties: { role: 'assembly-link' },
    }],
  })
  assertEqual(linked.externalBondCount, 1)
  assertDeepEqual(linked.structure.bonds?.[0].atomIds, ['left::c', 'right::c'])
  assertEqual(linked.structure.bonds?.[0].properties?.role, 'assembly-link')
  assertEqual(linked.formalCharge, 0)

  const sodium = monatomic('na', 'Na', 1)
  const chloride = monatomic('cl', 'Cl', -1)
  const periodic = assembleMolecularSystem({
    components: [
      { id: 'sodium', structure: sodium, translationA: [0.5, 5, 5] },
      { id: 'chloride', structure: chloride, translationA: [9.7, 5, 5] },
    ],
    lattice: {
      vectors: [[10, 0, 0], [0, 10, 0], [0, 0, 10]],
      periodic: [true, true, true],
    },
    minimumIntercomponentDistanceA: 0.65,
    intercomponentWarningDistanceA: 0.9,
  })
  assertTrue(Math.abs((periodic.minimumIntercomponentDistanceA ?? 0) - 0.8) < 1e-10)
  assertTrue(periodic.checks.some((check) => check.id === 'assembly.minimum_intercomponent_distance' && check.status === 'warn'))
  assertEqual(periodic.formalCharge, 0)
}

function testInvalidComponentsAndBudgetsFailClosed() {
  const water = molecule('water')
  let disconnectedRejected = false
  try {
    assembleMolecularSystem({
      components: [{
        id: 'broken',
        structure: { ...water, bonds: [] },
      }],
    })
  } catch (error) {
    disconnectedRejected = error instanceof MolecularAssemblyInputError && error.code === 'disconnected_component'
  }
  assertTrue(disconnectedRejected)

  const budgeted = assembleMolecularSystem({
    components: [
      { id: 'a', structure: water },
      { id: 'b', structure: water, translationA: [4, 0, 0] },
    ],
    maxIntercomponentPairChecks: 1,
  })
  assertEqual(budgeted.intercomponentPairCount, 9)
  assertEqual(budgeted.minimumIntercomponentDistanceA, null)
  assertTrue(budgeted.checks.some((check) => check.id === 'assembly.intercomponent_pair_budget' && check.status === 'fail'))

  let fractionalBudgetRejected = false
  try {
    assembleMolecularSystem({ components: [{ id: 'water', structure: water }], maxIntercomponentPairChecks: 1.5 })
  } catch (error) {
    fractionalBudgetRejected = error instanceof MolecularAssemblyInputError && error.code === 'invalid_pair_budget'
  }
  assertTrue(fractionalBudgetRejected)
}

async function testMcpActiveComponentReadbackAndCollisionGate() {
  const active = molecule('water')
  const methane = molecule('methane')
  const holder: { current?: ZatomStructure } = {}
  const response = await callZatomMcpTool('molecule_assemble_system', {
    components: [
      { id: 'active-water', useActiveStructure: true },
      { id: 'methane', structure: methane, translationA: [5, 0, 0] },
    ],
    applyToWorkspace: true,
    captureAfter: false,
  }, {
    readStructure: () => holder.current ?? active,
    writeStructure: (structure) => { holder.current = structure },
  })
  assertTrue(response.structuredContent.ok, response.structuredContent.summary)
  const data = response.structuredContent.data as {
    appliedToWorkspace: boolean
    applicationBlocked: boolean
    applicationVerified: boolean
    result: { structure: ZatomStructure }
  }
  assertEqual(data.appliedToWorkspace, true)
  assertEqual(data.applicationBlocked, false)
  assertEqual(data.applicationVerified, true)
  assertEqual(data.result.structure.atoms.length, 8)
  assertEqual(holder.current?.atoms[0].properties?.['zatom.assembly.componentId'], 'active-water')

  let writes = 0
  const collision = await callZatomMcpTool('molecule_assemble_system', {
    components: [
      { id: 'a', structure: active },
      { id: 'b', structure: active },
    ],
    applyToWorkspace: true,
    captureAfter: false,
  }, {
    writeStructure: () => { writes++ },
  })
  assertTrue(collision.structuredContent.ok)
  const collisionData = collision.structuredContent.data as { applicationBlocked: boolean; appliedToWorkspace: boolean }
  assertEqual(collisionData.applicationBlocked, true)
  assertEqual(collisionData.appliedToWorkspace, false)
  assertEqual(writes, 0)
  assertTrue(collision.structuredContent.checks?.some((check) => check.id === 'assembly.minimum_intercomponent_distance' && check.status === 'fail') === true)
}

async function main() {
  testRigidAssemblyIsDeterministicAndTopologyPreserving()
  testExternalBondAndPeriodicMinimumImage()
  testInvalidComponentsAndBudgetsFailClosed()
  await testMcpActiveComponentReadbackAndCollisionGate()
  console.log('agent molecular assembly tests passed')
}

void main()
