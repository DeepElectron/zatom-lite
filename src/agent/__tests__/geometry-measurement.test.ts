import { assertEqual, assertTrue } from '../../testing/assert'
import { ZATOM_STRUCTURE_SCHEMA, type ZatomStructure } from '../contracts'
import {
  measureStructureGeometry,
  parseGeometryMeasurements,
} from '../geometry-measurement'
import { callZatomMcpTool } from '../mcp-adapter'
import { fingerprintStructure } from '../structure-math'

function approximate(actual: number, expected: number, tolerance = 1e-9) {
  assertTrue(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`)
}

const periodic: ZatomStructure = {
  schemaVersion: ZATOM_STRUCTURE_SCHEMA,
  lattice: { vectors: [[10, 0, 0], [4, 10, 0], [0, 0, 10]], periodic: [true, true, true] },
  atoms: [
    { id: 'origin', element: 'C', position: [0.14, 0.1, 0] },
    { id: 'across-x', element: 'C', position: [9.94, 0.1, 0] },
    { id: 'across-y', element: 'C', position: [4.06, 9.9, 0] },
  ],
}

const finiteDihedral: ZatomStructure = {
  schemaVersion: ZATOM_STRUCTURE_SCHEMA,
  atoms: [
    { id: 'a', element: 'C', position: [0, 0, 0] },
    { id: 'b', element: 'C', position: [1, 0, 0] },
    { id: 'c', element: 'C', position: [1, 1, 0] },
    { id: 'd', element: 'C', position: [1, 1, 1] },
  ],
}

function testCertifiedPeriodicDistanceAndAngle() {
  const requests = parseGeometryMeasurements([
    {
      id: 'seam-distance',
      kind: 'distance',
      atomIds: ['origin', 'across-x'],
      periodic: true,
      minimumA: 0.19,
      maximumA: 0.21,
    },
    {
      id: 'seam-angle',
      kind: 'angle',
      atomIds: ['across-x', 'origin', 'across-y'],
      periodic: true,
      minimumDeg: 67,
      maximumDeg: 69,
    },
  ])
  const first = measureStructureGeometry({ structure: periodic, measurements: requests })
  const second = measureStructureGeometry({ structure: periodic, measurements: requests })

  assertEqual(first.verdict, 'pass')
  approximate(first.measurements[0].value, 0.2)
  approximate(first.measurements[1].value, Math.atan2(10, 4) * 180 / Math.PI)
  assertTrue(first.totalMinimumImageCandidateEvaluations > 0)
  assertEqual(first.fingerprint, second.fingerprint)
  assertEqual(first.structureFingerprint, fingerprintStructure(periodic))
  assertEqual(first.inspectionTargets.length, 2)
}

function testSignedDihedralAndGateFailure() {
  const result = measureStructureGeometry({
    structure: finiteDihedral,
    measurements: [{
      id: 'signed-torsion',
      kind: 'dihedral',
      atomIds: ['a', 'b', 'c', 'd'],
      periodic: false,
      minimumDeg: -91,
      maximumDeg: -89,
    }],
  })
  approximate(result.measurements[0].value, -90)
  assertEqual(result.verdict, 'pass')

  const failed = measureStructureGeometry({
    structure: periodic,
    measurements: [{
      id: 'too-short-gate',
      kind: 'distance',
      atomIds: ['origin', 'across-x'],
      periodic: true,
      maximumA: 0.1,
    }],
  })
  assertEqual(failed.verdict, 'fail')
  assertTrue(failed.checks.some((check) => check.id === 'geometry_measurement.too-short-gate' && check.status === 'fail'))
}

async function testMcpContract() {
  const response = await callZatomMcpTool('structure_measure_geometry', {
    structure: finiteDihedral,
    measurements: [{
      id: 'mcp-torsion',
      kind: 'dihedral',
      atomIds: ['a', 'b', 'c', 'd'],
      periodic: false,
      minimumDeg: -91,
      maximumDeg: -89,
    }],
  })
  assertTrue(response.structuredContent.ok, response.structuredContent.summary)
  const data = response.structuredContent.data as {
    structureFingerprint: string
    verdict: string
    measurements: Array<{ value: number; unit: string }>
    inspectionTargets: Array<{ atomIds: string[] }>
  }
  assertEqual(data.structureFingerprint, fingerprintStructure(finiteDihedral))
  assertEqual(data.verdict, 'pass')
  approximate(data.measurements[0].value, -90)
  assertEqual(data.measurements[0].unit, 'degree')
  assertEqual(data.inspectionTargets[0].atomIds.length, 4)
}

async function main() {
  testCertifiedPeriodicDistanceAndAngle()
  testSignedDihedralAndGateFailure()
  await testMcpContract()
}

void main()
