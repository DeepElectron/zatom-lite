import { assertEqual, assertTrue } from '../../testing/assert'
import { ZATOM_STRUCTURE_SCHEMA, type ZatomStructure } from '../contracts'
import {
  analyzeLocalEnvironment,
  LocalEnvironmentInputError,
} from '../local-environment'
import { callZatomMcpTool } from '../mcp-adapter'
import { fingerprintStructure } from '../structure-math'

const primitiveCubic: ZatomStructure = {
  schemaVersion: ZATOM_STRUCTURE_SCHEMA,
  lattice: {
    vectors: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    periodic: [true, true, true],
  },
  atoms: [{ id: 'site', element: 'Si', position: [0, 0, 0] }],
}

function testPeriodicSelfImagesDefinePrimitiveCellCoordination() {
  const result = analyzeLocalEnvironment({
    structure: primitiveCubic,
    cutoffA: 1.01,
    periodic: true,
    minimumCoordination: 6,
    maximumCoordination: 6,
  })
  assertEqual(result.verdict, 'pass')
  assertEqual(result.centers[0].coordination, 6)
  assertEqual(result.centers[0].neighbors.every((neighbor) => neighbor.atomId === 'site'), true)
  assertEqual(new Set(result.centers[0].neighbors.map((neighbor) => neighbor.fractionalImage.join(','))).size, 6)
  assertTrue(result.periodicImageCandidateEvaluations >= 27)
  assertEqual(result.structureFingerprint, fingerprintStructure(primitiveCubic))
}

function testSkewCellEnumerationAndHardBudget() {
  const skew: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    lattice: {
      vectors: [[1, 0, 0], [0.9, 0.1, 0], [0, 0, 5]],
      periodic: [true, true, false],
    },
    atoms: [{ id: 'skew-site', element: 'C', position: [0, 0, 0] }],
  }
  const result = analyzeLocalEnvironment({
    structure: skew,
    cutoffA: 0.15,
    periodic: true,
    minimumCoordination: 2,
    maximumCoordination: 2,
  })
  assertEqual(result.verdict, 'pass')
  assertEqual(result.centers[0].coordination, 2)
  assertTrue(result.centers[0].neighbors.every((neighbor) => Math.abs(neighbor.distanceA - Math.sqrt(0.02)) < 1e-12))

  let error: unknown = null
  try {
    analyzeLocalEnvironment({
      structure: primitiveCubic,
      cutoffA: 1.01,
      periodic: true,
      maxPeriodicImageCandidates: 1,
    })
  } catch (caught) {
    error = caught
  }
  assertTrue(error instanceof LocalEnvironmentInputError)
  assertEqual((error as LocalEnvironmentInputError).code, 'local_environment_image_budget_exceeded')
}

async function testMcpContractAndGateLocalization() {
  const response = await callZatomMcpTool('structure_analyze_local_environment', {
    structure: primitiveCubic,
    cutoffA: 1.01,
    periodic: true,
    maximumCoordination: 5,
  })
  assertTrue(response.structuredContent.ok, response.structuredContent.summary)
  const data = response.structuredContent.data as {
    verdict: string
    centers: Array<{ atomId: string; coordination: number }>
    checks: Array<{ id: string; status: string; atomIds?: string[] }>
    inspectionTargets: Array<{ atomIds: string[] }>
  }
  assertEqual(data.verdict, 'fail')
  assertEqual(data.centers[0].coordination, 6)
  assertTrue(data.checks.some((check) => (
    check.id === 'local_environment.coordination_gate'
    && check.status === 'fail'
    && check.atomIds?.[0] === 'site'
  )))
  assertTrue(data.inspectionTargets.some((target) => target.atomIds.includes('site')))
}

async function main() {
  testPeriodicSelfImagesDefinePrimitiveCellCoordination()
  testSkewCellEnumerationAndHardBudget()
  await testMcpContractAndGateLocalization()
}

void main()
