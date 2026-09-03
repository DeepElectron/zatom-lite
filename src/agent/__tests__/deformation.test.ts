import { assertEqual, assertTrue } from '../../testing/assert'
import type { ZatomStructure } from '../contracts'
import { ZATOM_STRUCTURE_SCHEMA } from '../contracts'
import { applyCylindricalBend, DeformationInputError } from '../deformation'
import { callZatomMcpTool } from '../mcp-adapter'

const finiteBeam: ZatomStructure = {
  schemaVersion: ZATOM_STRUCTURE_SCHEMA,
  label: 'finite beam',
  atoms: [
    { id: 'a', element: 'Si', position: [-5, -0.5, 0] },
    { id: 'b', element: 'Si', position: [-5, 0.5, 0] },
    { id: 'c', element: 'Si', position: [5, -0.5, 0] },
    { id: 'd', element: 'Si', position: [5, 0.5, 0] },
  ],
}

function testAnalyticBendMetricsAndInverse() {
  const result = applyCylindricalBend({
    structure: finiteBeam,
    radiusA: 100,
    tangent: [1, 0, 0],
    radial: [0, 1, 0],
    bendOrigin: [0, 0, 0],
  })
  assertTrue(result.changeSet.maxPositionDisplacementA > 0)
  assertTrue(Math.abs(result.metrics.maxAbsFiberStrain - 0.005) < 1e-12)
  assertTrue(result.metrics.maxInverseRoundTripErrorA < 1e-10)
  assertEqual(result.metrics.wrapsHalfTurn, false)
  assertTrue(result.checks.some((check) => check.id === 'bend.fiber_strain' && check.status === 'pass'))
  assertTrue(result.checks.every((check) => check.status !== 'fail'))
}

function testPeriodicSourceNeedsExplicitAcknowledgement() {
  let code = ''
  try {
    applyCylindricalBend({
      structure: {
        ...finiteBeam,
        lattice: { vectors: [[12, 0, 0], [0, 3, 0], [0, 0, 3]], periodic: [true, true, true] },
      },
      radiusA: 100,
      tangent: [1, 0, 0],
      radial: [0, 1, 0],
    })
  } catch (error) {
    code = error instanceof DeformationInputError ? error.code : ''
  }
  assertEqual(code, 'drop_lattice_acknowledgement_required')
}

async function testHighStrainCandidateCannotOverwriteViewport() {
  let writes = 0
  const response = await callZatomMcpTool('structure_apply_cylindrical_bend', {
    structure: finiteBeam,
    radiusA: 2,
    tangent: [1, 0, 0],
    radial: [0, 1, 0],
    bendOrigin: [0, 0, 0],
    applyToWorkspace: true,
    captureAfter: false,
  }, {
    writeStructure: () => { writes++ },
  })
  const envelope = response.structuredContent.data as { appliedToWorkspace: boolean; applicationBlocked: boolean }
  assertTrue(response.structuredContent.ok)
  assertEqual(envelope.appliedToWorkspace, false)
  assertEqual(envelope.applicationBlocked, true)
  assertEqual(writes, 0)
  assertTrue(response.structuredContent.checks?.some((check) => check.id === 'bend.fiber_strain' && check.status === 'fail') === true)
}

async function main() {
  testAnalyticBendMetricsAndInverse()
  testPeriodicSourceNeedsExplicitAcknowledgement()
  await testHighStrainCandidateCannotOverwriteViewport()
}

void main()
