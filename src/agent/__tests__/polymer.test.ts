import { assertDeepEqual, assertEqual, assertTrue } from '../../testing/assert'
import type { ZatomStructure } from '../contracts'
import { ZATOM_STRUCTURE_SCHEMA } from '../contracts'
import { callZatomMcpTool } from '../mcp-adapter'
import { buildLinearPolymer, PolymerInputError, type PolymerPort } from '../polymer'
import { distance, fingerprintStructure } from '../structure-math'

function ethaneRepeatUnit(): ZatomStructure {
  const atoms: ZatomStructure['atoms'] = [
    { id: 'c-head', element: 'C', position: [-0.76, 0, 0], properties: { formalCharge: 0 } },
    { id: 'c-tail', element: 'C', position: [0.76, 0, 0], properties: { formalCharge: 0 } },
    { id: 'h-head-port', element: 'H', position: [-1.85, 0, 0], properties: { formalCharge: 0 } },
    { id: 'h-head-a', element: 'H', position: [-0.76, 1.09, 0], properties: { formalCharge: 0 } },
    { id: 'h-head-b', element: 'H', position: [-0.76, -0.545, 0.944], properties: { formalCharge: 0 } },
    { id: 'h-tail-port', element: 'H', position: [1.85, 0, 0], properties: { formalCharge: 0 } },
    { id: 'h-tail-a', element: 'H', position: [0.76, -1.09, 0], properties: { formalCharge: 0 } },
    { id: 'h-tail-b', element: 'H', position: [0.76, 0.545, -0.944], properties: { formalCharge: 0 } },
  ]
  const pairs: Array<[string, string]> = [
    ['c-head', 'c-tail'],
    ['c-head', 'h-head-port'],
    ['c-head', 'h-head-a'],
    ['c-head', 'h-head-b'],
    ['c-tail', 'h-tail-port'],
    ['c-tail', 'h-tail-a'],
    ['c-tail', 'h-tail-b'],
  ]
  return {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    label: 'explicitly capped ethane repeat unit',
    atoms,
    bonds: pairs.map(([first, second], index) => ({
      id: `ethane-bond-${index + 1}`,
      atomIds: [first, second],
      order: 1,
      properties: { sourceRole: index === 0 ? 'backbone' : 'hydrogen' },
    })),
    metadata: { fixture: 'polymer-explicit-port' },
  }
}

const head: PolymerPort = {
  anchorAtomId: 'c-head',
  directionAtomId: 'h-head-port',
  removeAtomIds: ['h-head-port'],
}

const tail: PolymerPort = {
  anchorAtomId: 'c-tail',
  directionAtomId: 'h-tail-port',
  removeAtomIds: ['h-tail-port'],
}

function buildOptions() {
  return {
    structure: ethaneRepeatUnit(),
    head,
    tail,
    repeatCount: 4,
    bondOrder: 1 as const,
    targetBondLengthA: 1.52,
    twistDeg: 180,
    minimumInterrepeatDistanceA: 0.65,
    interrepeatWarningDistanceA: 0.9,
    maxInterrepeatPairChecks: 10_000,
    maxAtoms: 100,
  }
}

function testDeterministicCappedLinearPolymer() {
  const first = buildLinearPolymer(buildOptions())
  const replay = buildLinearPolymer(buildOptions())
  assertEqual(first.structure.atoms.length, 26)
  assertEqual(first.structure.bonds?.length, 25)
  assertEqual(first.repeats.length, 4)
  assertEqual(first.junctions.length, 3)
  assertEqual(first.removedAtomCount, 6)
  assertEqual(first.formalCharge, 0)
  assertTrue(first.structure.atoms.some((atom) => atom.id === 'repeat-0001::h-head-port'))
  assertTrue(first.structure.atoms.some((atom) => atom.id === 'repeat-0004::h-tail-port'))
  assertTrue(!first.structure.atoms.some((atom) => atom.id === 'repeat-0002::h-head-port'))
  assertTrue(!first.structure.atoms.some((atom) => atom.id === 'repeat-0002::h-tail-port'))
  assertEqual(first.structure.atoms[0].properties?.['zatom.polymer.repeatIndex'], 0)
  assertEqual(first.structure.bonds?.find((bond) => bond.id === 'polymer-link-0001')?.properties?.['zatom.polymer.role'], 'repeat-link')
  assertTrue(first.junctions.every((junction) => Math.abs(junction.bondLengthA - 1.52) < 1e-10))
  assertTrue(first.junctions.every((junction) => junction.headPortAngleErrorDeg < 1e-6 && junction.tailPortAngleErrorDeg < 1e-6))
  assertTrue(first.checks.every((check) => check.status !== 'fail'))
  assertTrue(first.checks.some((check) => check.id === 'polymer.port_contract' && check.status === 'pass'))
  assertTrue(first.checks.some((check) => check.id === 'polymer.junction_geometry' && check.status === 'pass'))
  assertEqual(fingerprintStructure(first.structure), fingerprintStructure(replay.structure))
  assertDeepEqual(first.retainedTerminalLeavingGroups, {
    head: ['repeat-0001::h-head-port'],
    tail: ['repeat-0004::h-tail-port'],
  })

  const firstJunction = first.junctions[0]
  const atomById = new Map(first.structure.atoms.map((atom) => [atom.id, atom]))
  assertTrue(Math.abs(distance(
    atomById.get(firstJunction.tailAtomId)!.position,
    atomById.get(firstJunction.headAtomId)!.position,
  ) - 1.52) < 1e-10)
}

function testTwistChangesGeometryWithoutChangingTopologyCounts() {
  const anti = buildLinearPolymer(buildOptions())
  const syn = buildLinearPolymer({ ...buildOptions(), twistDeg: 0 })
  assertEqual(syn.structure.atoms.length, anti.structure.atoms.length)
  assertEqual(syn.structure.bonds?.length, anti.structure.bonds?.length)
  assertTrue(fingerprintStructure(syn.structure) !== fingerprintStructure(anti.structure))
  assertTrue(syn.checks.some((check) => check.id === 'polymer.junction_geometry' && check.status === 'pass'))
}

function testPortsAndPreflightBudgetsFailClosed() {
  let invalidBoundary = false
  try {
    buildLinearPolymer({
      ...buildOptions(),
      head: { ...head, removeAtomIds: ['h-head-port', 'h-head-a'] },
    })
  } catch (error) {
    invalidBoundary = error instanceof PolymerInputError && error.code === 'disconnected_polymer_leaving_group'
  }
  assertTrue(invalidBoundary)

  let atomBudget = false
  try {
    buildLinearPolymer({ ...buildOptions(), maxAtoms: 10 })
  } catch (error) {
    atomBudget = error instanceof PolymerInputError && error.code === 'polymer_atom_budget_exceeded'
  }
  assertTrue(atomBudget)

  const pairBudget = buildLinearPolymer({ ...buildOptions(), maxInterrepeatPairChecks: 1 })
  assertTrue(pairBudget.checks.some((check) => check.id === 'polymer.interrepeat_pair_budget' && check.status === 'fail'))
  assertTrue(pairBudget.checks.some((check) => check.id === 'polymer.minimum_interrepeat_distance' && check.status === 'skipped'))
}

async function testMcpActiveReadbackAndApplicationGate() {
  const source = ethaneRepeatUnit()
  const holder: { current?: ZatomStructure } = {}
  const response = await callZatomMcpTool('molecule_build_linear_polymer', {
    head,
    tail,
    repeatCount: 3,
    targetBondLengthA: 1.52,
    twistDeg: 180,
    maxInterrepeatPairChecks: 10_000,
    applyToWorkspace: true,
    captureAfter: false,
  }, {
    readStructure: () => holder.current ?? source,
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
  assertEqual(data.result.structure.atoms.length, 20)
  assertEqual(fingerprintStructure(holder.current!), fingerprintStructure(data.result.structure))

  let writes = 0
  const blocked = await callZatomMcpTool('molecule_build_linear_polymer', {
    structure: source,
    head,
    tail,
    repeatCount: 4,
    targetBondLengthA: 1.52,
    maxInterrepeatPairChecks: 1,
    applyToWorkspace: true,
    captureAfter: false,
  }, {
    writeStructure: () => { writes++ },
  })
  assertTrue(blocked.structuredContent.ok)
  const blockedData = blocked.structuredContent.data as { applicationBlocked: boolean; appliedToWorkspace: boolean }
  assertEqual(blockedData.applicationBlocked, true)
  assertEqual(blockedData.appliedToWorkspace, false)
  assertEqual(writes, 0)
}

async function main() {
  testDeterministicCappedLinearPolymer()
  testTwistChangesGeometryWithoutChangingTopologyCounts()
  testPortsAndPreflightBudgetsFailClosed()
  await testMcpActiveReadbackAndApplicationGate()
  console.log('agent polymer tests passed')
}

void main()
