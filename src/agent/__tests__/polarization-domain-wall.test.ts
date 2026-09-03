import { assertEqual, assertTrue } from '../../testing/assert'
import type { ZatomStructure } from '../contracts'
import { ZATOM_STRUCTURE_SCHEMA } from '../contracts'
import { callZatomMcpTool, listZatomMcpTools } from '../mcp-adapter'
import {
  buildPolarizationDomainWall,
  ZATOM_DOMAIN_WALL_SOURCE_ATOM_ID_PROPERTY,
  ZATOM_DOMAIN_WALL_WEIGHT_B_PROPERTY,
} from '../polarization-domain-wall'
import { auditStructureCloseContacts } from '../structure-close-contact'
import { cartesianToFractional, fingerprintStructure } from '../structure-math'

function approximate(actual: number, expected: number, tolerance = 1e-10): void {
  assertTrue(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`)
}

function endpoints(): { domainA: ZatomStructure; domainB: ZatomStructure } {
  const lattice = {
    vectors: [[4, 0, 0], [0, 4, 0], [0, 0, 4]] as [[number, number, number], [number, number, number], [number, number, number]],
    periodic: [true, true, true] as [boolean, boolean, boolean],
  }
  const domainA: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    label: 'Tetragonal domain A',
    lattice,
    atoms: [
      { id: 'Ba', element: 'Ba', position: [0, 0, 0], properties: { sublattice: 'A' } },
      { id: 'Ti', element: 'Ti', position: [2, 2, 2.2], properties: { sublattice: 'B' } },
    ],
  }
  return {
    domainA,
    domainB: {
      ...domainA,
      label: 'Tetragonal domain B',
      atoms: [
        { id: 'Ba', element: 'Ba', position: [0, 0, 0], properties: { sublattice: 'A' } },
        { id: 'Ti', element: 'Ti', position: [2, 2, 1.8], properties: { sublattice: 'B' } },
      ],
    },
  }
}

function testDeterministicPeriodicPair(): void {
  const { domainA, domainB } = endpoints()
  const options = {
    domainA,
    domainB,
    polarizationA_CPerM2: [0, 0, 0.5] as [number, number, number],
    polarizationB_CPerM2: [0, 0, -0.5] as [number, number, number],
    stackingAxis: 'a' as const,
    boundaryMode: 'periodic-pair' as const,
    expectedElectrostaticClass: 'neutral' as const,
    domainACells: 2,
    domainBCells: 2,
    transitionCells: 1,
  }
  const result = buildPolarizationDomainWall(options)
  const replay = buildPolarizationDomainWall(options)
  assertEqual(fingerprintStructure(result.structure), fingerprintStructure(replay.structure))
  assertEqual(result.structure.atoms.length, 12)
  assertEqual(result.structure.lattice?.periodic.join(','), 'true,true,true')
  assertEqual(result.profile.map((cell) => cell.domainBWeight).join(','), '0,0,0.5,1,1,0.5')
  assertEqual(result.metrics.wallCount, 2)
  assertEqual(result.metrics.electrostaticClass, 'neutral')
  approximate(result.metrics.boundChargeAB_CPerM2, 0)
  approximate(result.metrics.maximumEndpointDisplacementA, 0.4)
  assertTrue(result.checks.every((check) => check.status !== 'fail'))
  assertTrue(result.structure.atoms.every((atom) => typeof atom.properties?.[ZATOM_DOMAIN_WALL_SOURCE_ATOM_ID_PROPERTY] === 'string'))
  assertTrue(result.structure.atoms.some((atom) => atom.properties?.[ZATOM_DOMAIN_WALL_WEIGHT_B_PROPERTY] === 0.5))
  assertTrue(result.inspectionTargets.some((target) => target.id === 'polarization-domain-wall-01'))
  assertTrue(result.inspectionTargets.some((target) => target.id === 'polarization-domain-wall-02'))
  assertEqual(result.changeSet.kind, 'create')
}

function testFiniteSingleWallAndElectrostaticGate(): void {
  const { domainA, domainB } = endpoints()
  const finite = buildPolarizationDomainWall({
    domainA,
    domainB,
    polarizationA_CPerM2: [0, 0, 0.5],
    polarizationB_CPerM2: [0, 0, -0.5],
    stackingAxis: 'a',
    boundaryMode: 'finite-single',
    expectedElectrostaticClass: 'neutral',
    domainACells: 2,
    domainBCells: 2,
    transitionCells: 1,
    surfacePaddingA: 3,
  })
  assertEqual(finite.structure.atoms.length, 10)
  assertEqual(finite.structure.lattice?.periodic.join(','), 'false,true,true')
  assertEqual(finite.metrics.wallCount, 1)
  approximate(finite.structure.lattice!.vectors[0][0], 26)
  assertTrue(finite.structure.atoms.every((atom) => {
    const fractional = cartesianToFractional(atom.position, finite.structure.lattice!.vectors)!
    return fractional.every((component) => component >= 0 && component < 1)
  }))

  const mismatch = buildPolarizationDomainWall({
    domainA,
    domainB,
    polarizationA_CPerM2: [0.5, 0, 0],
    polarizationB_CPerM2: [-0.5, 0, 0],
    stackingAxis: 'a',
    boundaryMode: 'periodic-pair',
    expectedElectrostaticClass: 'neutral',
  })
  assertEqual(mismatch.metrics.electrostaticClass, 'charged')
  approximate(mismatch.metrics.boundChargeAB_CPerM2, 1)
  assertTrue(mismatch.checks.some((check) => (
    check.id === 'polarization_domain_wall.polarization_discontinuity' && check.status === 'fail'
  )))
}

function testReciprocalSafeSkewContactAudit(): void {
  const lattice = {
    vectors: [[10, 0, 0], [9.5, 1.2, 0], [0, 0, 10]] as [[number, number, number], [number, number, number], [number, number, number]],
    periodic: [true, true, true] as [boolean, boolean, boolean],
  }
  const structure: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    lattice,
    atoms: [
      { id: 'left', element: 'Si', position: [0, 0, 0] },
      { id: 'right', element: 'Si', position: [0.225, -0.54, 0] },
    ],
  }
  const audit = auditStructureCloseContacts(structure, {
    cutoffA: 0.6,
    violationFloorA: 0.35,
    maxPairCandidates: 100,
    maxMinimumImageCandidateEvaluations: 100_000,
  })
  approximate(audit.minimumDistanceA!, Math.hypot(0.225, 0.54))
  assertEqual(audit.closestPair?.join(','), '0,1')
  assertEqual(audit.distinctPairViolations, 0)
}

async function testMcpApplyAndFailureBoundary(): Promise<void> {
  assertTrue(listZatomMcpTools().some((tool) => tool.name === 'structure_build_polarization_domain_wall'))
  const { domainA, domainB } = endpoints()
  let active: ZatomStructure | null = domainA
  let writes = 0
  const context = {
    readStructure: () => active,
    writeStructure: (structure: ZatomStructure) => { active = structuredClone(structure); writes += 1 },
  }
  const applied = await callZatomMcpTool('structure_build_polarization_domain_wall', {
    domainB,
    polarizationA_CPerM2: [0, 0, 0.5],
    polarizationB_CPerM2: [0, 0, -0.5],
    stackingAxis: 'a',
    boundaryMode: 'periodic-pair',
    expectedElectrostaticClass: 'neutral',
    transitionCells: 1,
    applyToWorkspace: true,
    captureAfter: false,
  }, context)
  assertTrue(applied.structuredContent.ok, applied.structuredContent.summary)
  const appliedData = applied.structuredContent.data as {
    appliedToWorkspace: boolean
    applicationVerified: boolean
    result: { structure: ZatomStructure }
  }
  assertTrue(appliedData.appliedToWorkspace)
  assertTrue(appliedData.applicationVerified)
  assertEqual(fingerprintStructure(active!), fingerprintStructure(appliedData.result.structure))
  assertEqual(writes, 1)

  const blocked = await callZatomMcpTool('structure_build_polarization_domain_wall', {
    structure: domainA,
    domainB,
    polarizationA_CPerM2: [0.5, 0, 0],
    polarizationB_CPerM2: [-0.5, 0, 0],
    stackingAxis: 'a',
    boundaryMode: 'periodic-pair',
    expectedElectrostaticClass: 'neutral',
    applyToWorkspace: true,
    captureAfter: false,
  }, context)
  assertTrue(blocked.structuredContent.ok, blocked.structuredContent.summary)
  const blockedData = blocked.structuredContent.data as {
    applicationBlocked: boolean
    result: { checks: Array<{ id: string; status: string }> }
  }
  assertTrue(blockedData.applicationBlocked)
  assertEqual(writes, 1)
  assertTrue(blockedData.result.checks.some((check) => check.id === 'candidate.application_gate' && check.status === 'fail'))
}

async function main(): Promise<void> {
  testDeterministicPeriodicPair()
  testFiniteSingleWallAndElectrostaticGate()
  testReciprocalSafeSkewContactAudit()
  await testMcpApplyAndFailureBoundary()
  console.log('agent polarization domain-wall modeling tests passed')
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
