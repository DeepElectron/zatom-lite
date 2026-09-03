import { assertEqual, assertTrue } from '../../testing/assert'
import { ZATOM_STRUCTURE_SCHEMA, type ZatomStructure } from '../contracts'
import { auditStructureHealth, summarizeStructureHealth } from '../structure-health'

function statusOf(structure: ZatomStructure, id: string, options = {}) {
  return auditStructureHealth(structure, options).checks.find((check) => check.id === id)
}

/** A 9 Å C-C bond is topologically valid but chemically impossible, so health must fail. */
function testOverstretchedBondFails(): void {
  const check = statusOf({
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    atoms: [
      { id: 'left', element: 'C', position: [0.5, 0.5, 0.5] },
      { id: 'right', element: 'C', position: [9.5, 0.5, 0.5] },
    ],
    bonds: [{ id: 'span', atomIds: ['left', 'right'], order: 1 }],
    lattice: { vectors: [[20, 0, 0], [0, 20, 0], [0, 0, 20]], periodic: [true, true, true] },
  }, 'health.bond_lengths')
  assertEqual(check?.status, 'fail')
  assertTrue(String(check?.message).includes('1.80×'), check?.message ?? 'no message')
  assertTrue(Number(check?.metrics?.worstCovalentRatio) > 1.8, String(check?.metrics?.worstCovalentRatio))
}

/** A bond that closes only through an image must warn because its direct rendering crosses the cell. */
function testImageClosingBondWarns(): void {
  const check = statusOf({
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    atoms: [
      { id: 'left', element: 'C', position: [0.8, 0.5, 0.5] },
      { id: 'right', element: 'C', position: [9.2, 0.5, 0.5] },
    ],
    bonds: [{ id: 'span', atomIds: ['left', 'right'], order: 1 }],
    lattice: { vectors: [[10, 0, 0], [0, 10, 0], [0, 0, 10]], periodic: [true, true, true] },
  }, 'health.bond_lengths')
  assertEqual(check?.status, 'warn')
  assertTrue(String(check?.message).includes('close through a periodic image'), check?.message ?? 'no message')
  assertEqual(Number(check?.metrics?.imageClosingBonds), 1)
}

/** A normal 1.54 Å C-C single bond must not produce a false positive. */
function testPhysicalBondPasses(): void {
  const check = statusOf({
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    atoms: [
      { id: 'a', element: 'C', position: [0, 0, 0] },
      { id: 'b', element: 'C', position: [1.54, 0, 0] },
    ],
    bonds: [{ id: 'cc', atomIds: ['a', 'b'], order: 1 }],
  }, 'health.bond_lengths')
  assertEqual(check?.status, 'pass')
}

/** A slab warns below 10 Å of vacuum and passes above it; only the c axis is sparse. */
function testThinVacuumWarnsAndThickVacuumPasses(): void {
  const slab = (cHeight: number): ZatomStructure => ({
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    atoms: [0, 2].flatMap((z) =>
      [0, 2].flatMap((y) =>
        [0, 2].map((x) => ({ id: `a${x}${y}${z}`, element: 'Al' as const, position: [x, y, z] as [number, number, number] })),
      ),
    ),
    lattice: { vectors: [[4, 0, 0], [0, 4, 0], [0, 0, cHeight]], periodic: [true, true, true] },
  })
  const thin = statusOf(slab(8), 'health.vacuum_gap')
  assertEqual(thin?.status, 'warn')
  assertEqual(thin?.metrics?.vacuumAxis, 'c')
  assertTrue(String(thin?.message).includes('thinner than 10'), thin?.message ?? 'no message')

  const thick = statusOf(slab(20), 'health.vacuum_gap')
  assertEqual(thick?.status, 'pass')
  assertTrue(Number(thick?.metrics?.vacuumThicknessA) > 10, String(thick?.metrics?.vacuumThicknessA))
}

/** A thin bulk cell must not be mistaken for a slab with insufficient vacuum. */
function testBulkCellReportsNoVacuum(): void {
  const check = statusOf({
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    atoms: [{ id: 'only', element: 'Al', position: [0, 0, 0] }],
    lattice: { vectors: [[4, 0, 0], [0, 4, 0], [0, 0, 4]], periodic: [true, true, true] },
  }, 'health.vacuum_gap')
  assertEqual(check?.status, 'pass')
  assertEqual(check?.metrics?.vacuumAxis, null)
  assertTrue(String(check?.message).includes('bulk'), check?.message ?? 'no message')
}

function testAdsorbateDoesNotHideAnOtherwiseClearVacuumAxis(): void {
  const atoms: ZatomStructure['atoms'] = [5, 7].flatMap((z) => (
    [0, 2.7].flatMap((y) => [0, 2.7].map((x, index) => ({
      id: `pt-${z}-${y}-${index}`,
      element: 'Pt',
      position: [x, y, z] as [number, number, number],
    })))
  ))
  atoms.push(
    { id: 'water-o', element: 'O', position: [1.35, 1.35, 9.02], properties: { 'zatom.role': 'adsorbate' } },
    { id: 'water-h1', element: 'H', position: [2.1, 1.35, 9.62], properties: { 'zatom.role': 'adsorbate' } },
    { id: 'water-h2', element: 'H', position: [0.6, 1.35, 9.62], properties: { 'zatom.role': 'adsorbate' } },
  )
  const check = statusOf({
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    atoms,
    lattice: { vectors: [[5.4, 0, 0], [0, 5.4, 0], [0, 0, 18]], periodic: [true, true, true] },
  }, 'health.vacuum_gap')
  assertEqual(check?.metrics?.vacuumAxis, 'c')
  assertTrue(Number(check?.metrics?.vacuumThicknessA) > 8, String(check?.metrics?.vacuumThicknessA))
}

/** Atoms outside the fractional cell may straddle a periodic boundary and must be locatable. */
function testUnwrappedAtomsWarnWithLocatableIds(): void {
  const check = statusOf({
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    atoms: [
      { id: 'inside', element: 'C', position: [1, 1, 1] },
      { id: 'outside', element: 'C', position: [11, 1, 1] },
    ],
    lattice: { vectors: [[10, 0, 0], [0, 10, 0], [0, 0, 10]], periodic: [true, true, true] },
  }, 'health.periodic_wrap')
  assertEqual(check?.status, 'warn')
  assertEqual(check?.atomIds?.join(','), 'outside')
}

/** The review card folds passing checks into one line while listing each problem. */
function testSummaryFoldsPassedChecks(): void {
  const report = auditStructureHealth({
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    atoms: [
      { id: 'a', element: 'C', position: [0, 0, 0] },
      { id: 'b', element: 'C', position: [1.54, 0, 0] },
    ],
    bonds: [{ id: 'cc', atomIds: ['a', 'b'], order: 1 }],
  })
  const summary = summarizeStructureHealth(report)
  assertEqual(summary.verdict, 'pass')
  assertEqual(summary.lines.filter((line) => line.status !== 'pass').length, 0)
  assertTrue(summary.lines.some((line) => line.message.includes('checks passed')), 'missing folded pass line')
}

/**
 * Regression: validateStructure used to skip every pair above 2,000 atoms and
 * the review-card summary folded the remaining passes into "Checks passed".
 * Put the bad atom last so an order-limited prefix scan cannot accidentally
 * make this test green.
 */
function testLargeLateOverlapFailsReviewHealth(): void {
  const atoms = Array.from({ length: 2_100 }, (_, index) => ({
    id: `safe-${index}`,
    element: 'C',
    position: [index * 2, 0, 0] as [number, number, number],
  }))
  atoms.push({ id: 'late-overlap', element: 'C', position: [0.1, 0, 0] })
  const report = auditStructureHealth({
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    atoms,
  })
  const minimum = report.checks.find((check) => check.id === 'structure.minimum_distance')
  assertEqual(report.verdict, 'fail')
  assertEqual(minimum?.status, 'fail')
  assertEqual(minimum?.metrics?.scanMode, 'complete-spatial-threshold')
  assertEqual(minimum?.metrics?.coverageComplete, true)
  assertTrue(Number(minimum?.metrics?.minPairDistanceA) < 0.35, String(minimum?.metrics?.minPairDistanceA))
  assertEqual(minimum?.atomIds?.join(','), 'safe-0,late-overlap')

  const summary = summarizeStructureHealth(report)
  assertEqual(summary.verdict, 'fail')
  assertTrue(summary.lines.some((line) => line.status === 'fail' && line.message.includes('0.1000')), JSON.stringify(summary.lines))
  assertTrue(!summary.lines.every((line) => line.status === 'pass'), 'review health must not render only Checks passed')
}

/** A spatial-audit budget failure is unresolved and therefore fail-closed. */
function testLargeAuditBudgetCannotPass(): void {
  const atoms = Array.from({ length: 2_001 }, (_, index) => ({
    id: `dense-${index}`,
    element: 'C',
    position: [index * 0.1, 0, 0] as [number, number, number],
  }))
  const report = auditStructureHealth({
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    atoms,
  }, { maxClosePairCandidates: 1 })
  const minimum = report.checks.find((check) => check.id === 'structure.minimum_distance')
  assertEqual(report.verdict, 'fail')
  assertEqual(minimum?.status, 'fail')
  assertEqual(minimum?.metrics?.coverageComplete, false)
  assertTrue(String(minimum?.message).includes('exceeded 1 candidate'), minimum?.message ?? 'no message')
}

/** A sparse large structure earns a pass only after the cutoff neighborhood is fully covered. */
function testLargeSafeStructureHasCertifiedLowerBound(): void {
  const report = auditStructureHealth({
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    atoms: Array.from({ length: 2_001 }, (_, index) => ({
      id: `safe-${index}`,
      element: 'C',
      position: [index * 2, 0, 0] as [number, number, number],
    })),
  })
  const minimum = report.checks.find((check) => check.id === 'structure.minimum_distance')
  assertEqual(report.verdict, 'pass')
  assertEqual(minimum?.status, 'pass')
  assertEqual(minimum?.metrics?.coverageComplete, true)
  assertEqual(minimum?.metrics?.distanceLowerBoundA, 0.6)
  assertTrue(String(minimum?.message).includes('certifies no atom pair below'), minimum?.message ?? 'no message')
}

testOverstretchedBondFails()
testImageClosingBondWarns()
testPhysicalBondPasses()
testThinVacuumWarnsAndThickVacuumPasses()
testBulkCellReportsNoVacuum()
testAdsorbateDoesNotHideAnOtherwiseClearVacuumAxis()
testUnwrappedAtomsWarnWithLocatableIds()
testSummaryFoldsPassedChecks()
testLargeLateOverlapFailsReviewHealth()
testLargeAuditBudgetCannotPass()
testLargeSafeStructureHasCertifiedLowerBound()
