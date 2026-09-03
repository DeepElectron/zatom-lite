import { assertDeepEqual, assertEqual, assertTrue } from '../testing/assert'
import { buildDomainWallInterfacePlane } from '../lib/plane/domain-wall-interface-plane'

function near(a: number, b: number, tol = 1e-8): boolean {
  return Math.abs(a - b) <= tol
}

function testBuildsVdwPlaneAtBoundaryFraction() {
  const plane = buildDomainWallInterfacePlane({
    latticeVectors: {
      a: [10, 0, 0],
      b: [0, 20, 0],
      c: [0, 0, 30],
    },
    domainWall: {
      wallType: 'vdw',
      domainSelectionAxis: 0,
      polarizationFlipAxis: 2,
      boundaryFrac: 0.5,
    },
  })

  assertTrue(!!plane, 'VDW metadata should produce an interface plane')
  assertDeepEqual(plane?.center, [5, 10, 15])
  assertDeepEqual(plane?.normal, [1, 0, 0])
  assertEqual(plane?.d, -5)
  assertEqual(plane?.sourceIds[0], 'domain-wall-interface:vdw:axis-0:frac-0.5')
}

function testNormalUsesReciprocalAxisForSkewedCell() {
  const plane = buildDomainWallInterfacePlane({
    latticeVectors: {
      a: [4, 0, 0],
      b: [1, 5, 0],
      c: [0, 0, 8],
    },
    domainWall: {
      wallType: 'vdw',
      domainSelectionAxis: 0,
      boundaryFrac: 0.25,
    },
  })

  assertTrue(!!plane, 'skewed VDW cell should produce a plane')
  const normal = plane!.normal
  const dotWithB = normal[0] * 1 + normal[1] * 5 + normal[2] * 0
  const dotWithC = normal[0] * 0 + normal[1] * 0 + normal[2] * 8
  assertTrue(near(dotWithB, 0), `normal should be perpendicular to b, got ${dotWithB}`)
  assertTrue(near(dotWithC, 0), `normal should be perpendicular to c, got ${dotWithC}`)
  assertDeepEqual(plane?.center, [1.5, 2.5, 4])
}

function testIgnoresNonVdwMetadataForFirstVersion() {
  const plane = buildDomainWallInterfacePlane({
    latticeVectors: {
      a: [10, 0, 0],
      b: [0, 20, 0],
      c: [0, 0, 30],
    },
    domainWall: {
      wallType: 'hdw',
      domainSelectionAxis: 2,
      boundaryFrac: 0.5,
    },
  })

  assertEqual(plane, null)
}

testBuildsVdwPlaneAtBoundaryFraction()
testNormalUsesReciprocalAxisForSkewedCell()
testIgnoresNonVdwMetadataForFirstVersion()
console.log('domain wall interface plane tests passed')
