import { assertEqual, assertTrue } from '../../testing/assert'
import { ZATOM_STRUCTURE_SCHEMA, type ZatomStructure } from '../contracts'
import { callZatomMcpTool } from '../mcp-adapter'
import { fractionalToCartesian } from '../structure-math'
import { validateStructure } from '../structure-validation'
import { listZatomAgentTools } from '../tools'

function approximate(actual: number | null, expected: number, tolerance = 1e-12): void {
  assertTrue(actual !== null && Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`)
}

const skewLattice: NonNullable<ZatomStructure['lattice']> = {
  vectors: [[1, 0, 0], [3.1, 1, 0], [0, 0, 5]],
  periodic: [true, true, true],
}

function skewPair(): ZatomStructure {
  const fractionalDelta = [-0.35739964707463223, -0.48913955690993205, -0.12524550793663558]
  return {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    atoms: [
      { id: 'origin', element: 'C', position: [0, 0, 0] },
      { id: 'skew-copy', element: 'C', position: fractionalToCartesian(fractionalDelta, skewLattice.vectors) },
    ],
    lattice: skewLattice,
  }
}

function testCertifiedSkewCellPairSearch(): void {
  const report = validateStructure(skewPair(), {
    overlapDistanceA: 0.82,
    closePairWarningA: 0.83,
    maxMinimumImageCandidateEvaluations: 10_000,
  })
  assertEqual(report.verdict, 'fail')
  approximate(report.minPairDistanceA, 0.8045880786764901)
  assertEqual(report.closestPair?.[0], 'origin')
  assertEqual(report.closestPair?.[1], 'skew-copy')
  const check = report.checks.find((candidate) => candidate.id === 'structure.minimum_distance')
  assertEqual(check?.status, 'fail')
  assertEqual(check?.metrics?.closestFractionalImage, '2,0,0')
  assertTrue(Number(check?.metrics?.minimumImageCandidateEvaluations) > 0)
  assertEqual(report.inspectionTargets[0]?.atomIds.join(','), 'origin,skew-copy')
}

function testPeriodicSelfImageIsGated(): void {
  const report = validateStructure({
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    atoms: [{ id: 'solo', element: 'H', position: [0, 0, 0] }],
    lattice: { vectors: [[0.2, 0, 0], [0, 5, 0], [0, 0, 5]], periodic: [true, true, true] },
  })
  assertEqual(report.verdict, 'fail')
  approximate(report.minPairDistanceA, 0.2)
  assertEqual(report.closestPair?.join(','), 'solo,solo')
  assertEqual(
    report.checks.find((check) => check.id === 'structure.periodic_self_image_distance')?.status,
    'fail',
  )
  assertEqual(report.inspectionTargets[0]?.atomIds.join(','), 'solo')
}

function testCertifiedBudgetFailureIsExplicit(): void {
  const report = validateStructure(skewPair(), { maxMinimumImageCandidateEvaluations: 100 })
  assertEqual(report.verdict, 'fail')
  assertEqual(
    report.checks.find((check) => check.id === 'structure.periodic_self_image_distance')?.status,
    'fail',
  )
  assertTrue(report.checks.some((check) => (
    check.id === 'structure.minimum_distance'
      && check.status === 'fail'
      && check.message.includes('budget')
  )))
}

function testLeftHandedLatticeIsRejected(): void {
  const report = validateStructure({
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    atoms: [{ id: 'left', element: 'C', position: [0, 0, 0] }],
    lattice: { vectors: [[1, 0, 0], [0, 1, 0], [0, 0, -1]], periodic: [true, true, true] },
  })
  assertEqual(report.verdict, 'fail')
  assertEqual(report.checks.find((check) => check.id === 'structure.lattice_nonsingular')?.status, 'fail')
}

function testLargePeriodicBoundaryOverlapUsesCompleteSpatialAudit(): void {
  const atoms = Array.from({ length: 2_100 }, (_, index) => ({
    id: `safe-${index}`,
    element: 'C',
    position: [2 + index * 2, 10, 10] as [number, number, number],
  }))
  atoms.push({ id: 'boundary-left', element: 'C', position: [0.1, 10, 10] })
  atoms.push({ id: 'boundary-right-last', element: 'C', position: [9_999.9, 10, 10] })
  const report = validateStructure({
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    atoms,
    lattice: {
      vectors: [[10_000, 0, 0], [0, 100, 0], [0, 0, 100]],
      periodic: [true, true, true],
    },
  })
  const check = report.checks.find((candidate) => candidate.id === 'structure.minimum_distance')
  assertEqual(report.verdict, 'fail')
  approximate(report.minPairDistanceA, 0.2, 1e-9)
  assertEqual(check?.status, 'fail')
  assertEqual(check?.metrics?.scanMode, 'complete-spatial-threshold')
  assertEqual(check?.metrics?.coverageComplete, true)
  assertEqual(report.closestPair?.join(','), 'boundary-left,boundary-right-last')
}

async function testMcpContract(): Promise<void> {
  const manifest = listZatomAgentTools().find((tool) => tool.name === 'structure_validate')!
  assertEqual(manifest.version, '2.0.0')
  assertTrue(Object.hasOwn(
    manifest.inputSchema.properties as Record<string, unknown>,
    'maxMinimumImageCandidateEvaluations',
  ))
  assertTrue(Object.hasOwn(
    manifest.inputSchema.properties as Record<string, unknown>,
    'maxClosePairCandidates',
  ))
  const response = await callZatomMcpTool('structure_validate', {
    structure: skewPair(),
    overlapDistanceA: 0.82,
    closePairWarningA: 0.83,
    maxMinimumImageCandidateEvaluations: 10_000,
  })
  assertTrue(response.structuredContent.ok, response.structuredContent.summary)
  const data = response.structuredContent.data as {
    verdict: string
    minPairDistanceA: number
    checks: Array<{ id: string; status: string }>
  }
  assertEqual(data.verdict, 'fail')
  approximate(data.minPairDistanceA, 0.8045880786764901)
  assertTrue(data.checks.some((check) => check.id === 'structure.minimum_distance' && check.status === 'fail'))
}

async function main(): Promise<void> {
  testCertifiedSkewCellPairSearch()
  testPeriodicSelfImageIsGated()
  testCertifiedBudgetFailureIsExplicit()
  testLeftHandedLatticeIsRejected()
  testLargePeriodicBoundaryOverlapUsesCompleteSpatialAudit()
  await testMcpContract()
  console.log('agent certified structure validation tests passed')
}

void main()
