import { assertEqual, assertTrue } from '../../testing/assert'
import type { CapturedImage, ZatomStructure, ZatomToolContext } from '../contracts'
import { buildPeriodicCrystal } from '../periodic-crystal'
import { callZatomMcpTool } from '../mcp-adapter'
import { cartesianToFractional, fingerprintStructure } from '../structure-math'
import { listZatomAgentTools } from '../tools'

function approximate(actual: number, expected: number, tolerance = 1e-10): void {
  assertTrue(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`)
}

const cell = {
  aA: 3,
  bA: 4,
  cA: 5,
  alphaDeg: 80,
  betaDeg: 75,
  gammaDeg: 70,
}

const basis = [
  { id: 'site-c', element: 'c', fractionalPosition: [0, 0, 0] as [number, number, number], properties: { role: 'origin' } },
  { id: 'site-o', element: 'O', fractionalPosition: [0.25, 0.5, 0.75] as [number, number, number] },
]

function testDeterministicTriclinicReplication(): void {
  const first = buildPeriodicCrystal({ label: 'triclinic CO basis', cell, basis, supercell: [2, 1, 3] })
  const second = buildPeriodicCrystal({ label: 'triclinic CO basis', cell, basis, supercell: [2, 1, 3] })
  assertEqual(first.structure.atoms.length, 12)
  assertEqual(first.structure.atoms[0].id, 'site-c@0,0,0')
  assertEqual(first.structure.atoms[1].id, 'site-o@0,0,0')
  assertEqual(first.structure.atoms[11].id, 'site-o@1,0,2')
  assertEqual(first.structure.atoms[0].element, 'C')
  assertEqual(first.structure.atoms[0].properties?.role, 'origin')
  assertEqual(first.structure.atoms[11].properties?.['zatom.crystal.cellIndex']?.toString(), '1,0,2')
  approximate(first.metrics.resultVolumeA3, first.metrics.primitiveVolumeA3 * 6)
  assertEqual(first.metrics.supercell.join(','), '2,1,3')
  assertTrue(first.metrics.primitiveMinimumDistanceA !== null && first.metrics.primitiveMinimumDistanceA > 0.35)
  assertTrue(first.checks.every((check) => check.status !== 'fail'))
  assertEqual(fingerprintStructure(first.structure), fingerprintStructure(second.structure))
  const finalFractional = cartesianToFractional(first.structure.atoms[11].position, first.structure.lattice!.vectors)!
  approximate(finalFractional[0], 0.625)
  approximate(finalFractional[1], 0.5)
  approximate(finalFractional[2], 2.75 / 3)
  assertTrue(first.inspectionTargets.some((target) => target.id === 'periodic-crystal-cell-overview'))
}

function testPrimitiveContactGateCoversLargeReplication(): void {
  const result = buildPeriodicCrystal({
    cell: { aA: 2.5, bA: 2.5, cA: 2.5, alphaDeg: 90, betaDeg: 90, gammaDeg: 90 },
    basis: [{ id: 'ar', element: 'Ar', fractionalPosition: [0, 0, 0] }],
    supercell: [13, 13, 13],
    maxOutputAtoms: 3_000,
  })
  assertEqual(result.structure.atoms.length, 2_197)
  assertEqual(
    result.validation.checks.find((check) => check.id === 'structure.minimum_distance')?.status,
    'pass',
  )
  assertEqual(
    result.checks.find((check) => check.id === 'periodic_crystal.primitive_contact_equivalence')?.status,
    'pass',
  )
  approximate(result.metrics.primitiveMinimumDistanceA!, 2.5)
}

async function testOverlapBlocksWorkspaceApplication(): Promise<void> {
  let writes = 0
  const response = await callZatomMcpTool('structure_build_periodic_crystal', {
    cell: { aA: 4, bA: 4, cA: 4, alphaDeg: 90, betaDeg: 90, gammaDeg: 90 },
    basis: [
      { id: 'first', element: 'Si', fractionalPosition: [0, 0, 0] },
      { id: 'second', element: 'Ge', fractionalPosition: [0, 0, 0] },
    ],
    applyToWorkspace: true,
  }, { writeStructure: () => { writes += 1 } })
  assertTrue(response.structuredContent.ok, response.structuredContent.summary)
  const data = response.structuredContent.data as {
    applicationBlocked: boolean
    result: { checks: Array<{ id: string; status: string }> }
  }
  assertEqual(data.applicationBlocked, true)
  assertEqual(writes, 0)
  assertTrue(data.result.checks.some((check) => (
    check.id === 'periodic_crystal.primitive_contact_equivalence' && check.status === 'fail'
  )))
  assertTrue(data.result.checks.some((check) => check.id === 'candidate.application_gate' && check.status === 'fail'))
}

async function testMcpApplyReadbackAndCapture(): Promise<void> {
  const manifest = listZatomAgentTools().find((tool) => tool.name === 'structure_build_periodic_crystal')!
  assertEqual(manifest.version, '1.0.0')
  let active: ZatomStructure | null = null
  const image: CapturedImage = {
    imageBase64: 'cGVyaW9kaWMtY3J5c3RhbA==',
    mimeType: 'image/jpeg',
    width: 320,
    height: 240,
  }
  const context: ZatomToolContext = {
    writeStructure: (structure) => { active = structure },
    readStructure: () => active,
    captureViewport: () => image,
  }
  const response = await callZatomMcpTool('structure_build_periodic_crystal', {
    label: 'simple cubic silicon',
    cell: { aA: 5.43, bA: 5.43, cA: 5.43, alphaDeg: 90, betaDeg: 90, gammaDeg: 90 },
    basis: [{ id: 'si', element: 'Si', fractionalPosition: [0, 0, 0] }],
    supercell: [2, 1, 1],
    applyToWorkspace: true,
    captureAfter: true,
  }, context)
  assertTrue(response.structuredContent.ok, response.structuredContent.summary)
  const data = response.structuredContent.data as {
    appliedToWorkspace: boolean
    applicationVerified: boolean
    visualEvidence: CapturedImage | null
    result: { structure: ZatomStructure; metrics: { atomCount: number } }
  }
  assertEqual(data.appliedToWorkspace, true)
  assertEqual(data.applicationVerified, true)
  assertTrue(!!data.visualEvidence)
  assertEqual(response.content.filter((block) => block.type === 'image').length, 1)
  assertTrue(!JSON.stringify(response.structuredContent).includes(image.imageBase64))
  assertEqual(data.result.metrics.atomCount, 2)
  assertEqual(fingerprintStructure(active!), fingerprintStructure(data.result.structure))
}

async function testInputAndAtomBudgetsFailClosed(): Promise<void> {
  const invalidCell = await callZatomMcpTool('structure_build_periodic_crystal', {
    cell: { aA: 3, bA: 3, cA: 3, alphaDeg: 90, betaDeg: 90, gammaDeg: 180 },
    basis: [{ id: 'a', element: 'C', fractionalPosition: [0, 0, 0] }],
  })
  assertEqual(invalidCell.structuredContent.ok, false)
  assertEqual(invalidCell.structuredContent.error?.code, 'invalid_tool_input')

  const overBudget = await callZatomMcpTool('structure_build_periodic_crystal', {
    cell: { aA: 3, bA: 3, cA: 3, alphaDeg: 90, betaDeg: 90, gammaDeg: 90 },
    basis: [{ id: 'a', element: 'C', fractionalPosition: [0, 0, 0] }],
    supercell: [3, 3, 3],
    maxOutputAtoms: 20,
  })
  assertEqual(overBudget.structuredContent.ok, false)
  assertEqual(overBudget.structuredContent.error?.code, 'periodic_crystal_atom_budget_exceeded')

  const propertyBudget = await callZatomMcpTool('structure_build_periodic_crystal', {
    cell: { aA: 3, bA: 3, cA: 3, alphaDeg: 90, betaDeg: 90, gammaDeg: 90 },
    basis: [{ id: 'a', element: 'C', fractionalPosition: [0, 0, 0], properties: { payload: 'x'.repeat(40_000) } }],
    supercell: [10, 10, 10],
  })
  assertEqual(propertyBudget.structuredContent.ok, false)
  assertEqual(propertyBudget.structuredContent.error?.code, 'periodic_crystal_property_budget_exceeded')
}

async function main(): Promise<void> {
  testDeterministicTriclinicReplication()
  testPrimitiveContactGateCoversLargeReplication()
  await testOverlapBlocksWorkspaceApplication()
  await testMcpApplyReadbackAndCapture()
  await testInputAndAtomBudgetsFailClosed()
  console.log('agent periodic crystal builder tests passed')
}

void main()
