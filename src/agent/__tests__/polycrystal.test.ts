import { assertEqual, assertTrue } from '../../testing/assert'
import type { ZatomStructure } from '../contracts'
import { ZATOM_STRUCTURE_SCHEMA } from '../contracts'
import { callZatomMcpTool, listZatomMcpTools } from '../mcp-adapter'
import {
  buildZatomPolycrystal,
  ZATOM_POLYCRYSTAL_GRAIN_ID_PROPERTY,
  ZATOM_POLYCRYSTAL_SOURCE_ATOM_ID_PROPERTY,
} from '../polycrystal'
import { fingerprintStructure } from '../structure-math'

function fccParent(): ZatomStructure {
  const a = 3.6
  return {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    label: 'Cu FCC parent',
    lattice: { vectors: [[a, 0, 0], [0, a, 0], [0, 0, a]], periodic: [true, true, true] },
    atoms: [
      { id: 'cu-1', element: 'Cu', position: [0, 0, 0], properties: { sourceRole: 'corner' } },
      { id: 'cu-2', element: 'Cu', position: [0, a / 2, a / 2] },
      { id: 'cu-3', element: 'Cu', position: [a / 2, 0, a / 2] },
      { id: 'cu-4', element: 'Cu', position: [a / 2, a / 2, 0] },
    ],
  }
}

function testDeterministicGeneralParentConstruction(): void {
  const options = {
    source: fccParent(),
    boxSizeA: 24,
    grainCount: 5,
    minSeedDistanceA: 3,
    overlapDistanceA: 1.5,
    maxAtoms: 20_000,
    seed: 77,
  }
  const first = buildZatomPolycrystal(options)
  const replay = buildZatomPolycrystal(options)
  assertEqual(fingerprintStructure(first.structure), fingerprintStructure(replay.structure))
  assertEqual(first.metrics.realizedGrainCount, 5)
  assertEqual(first.metrics.crossGrainViolationCount, 0)
  assertTrue(first.metrics.atomCount > 500)
  assertTrue(first.checks.every((check) => check.status !== 'fail'))
  assertEqual(first.structure.lattice?.periodic.join(','), 'false,false,false')
  assertTrue(first.structure.atoms.every((atom) => Number.isSafeInteger(
    atom.properties?.[ZATOM_POLYCRYSTAL_GRAIN_ID_PROPERTY],
  )))
  assertTrue(first.structure.atoms.every((atom) => typeof (
    atom.properties?.[ZATOM_POLYCRYSTAL_SOURCE_ATOM_ID_PROPERTY]
  ) === 'string'))
  assertTrue(first.structure.atoms.some((atom) => atom.properties?.sourceRole === 'corner'))
  const metadata = first.structure.metadata?.['zatom.polycrystal'] as {
    grainSeeds: number[][]
    grainRotations: number[][]
  }
  assertEqual(metadata.grainSeeds.length, 5)
  assertEqual(metadata.grainRotations.length, 5)
  assertTrue(first.inspectionTargets.some((target) => target.id === 'polycrystal-overview'))
  assertTrue(first.inspectionTargets.some((target) => target.id === 'polycrystal-grain-0001'))
}

async function testMcpApplicationAndFailureBoundary(): Promise<void> {
  assertTrue(listZatomMcpTools().some((tool) => tool.name === 'structure_build_polycrystal'))
  let active: ZatomStructure | null = fccParent()
  const response = await callZatomMcpTool('structure_build_polycrystal', {
    boxSizeA: 18,
    grainCount: 4,
    minSeedDistanceA: 2,
    overlapDistanceA: 1.5,
    maxAtoms: 10_000,
    seed: 19,
    applyToWorkspace: true,
    captureAfter: false,
  }, {
    readStructure: () => active,
    writeStructure: (structure) => { active = structuredClone(structure) },
  })
  assertTrue(response.structuredContent.ok, response.structuredContent.summary)
  const data = response.structuredContent.data as {
    appliedToWorkspace: boolean
    applicationVerified: boolean
    result: { structure: ZatomStructure; metrics: { realizedGrainCount: number } }
  }
  assertTrue(data.appliedToWorkspace)
  assertTrue(data.applicationVerified)
  assertEqual(data.result.metrics.realizedGrainCount, 4)
  assertEqual(fingerprintStructure(active!), fingerprintStructure(data.result.structure))

  const impossible = await callZatomMcpTool('structure_build_polycrystal', {
    structure: fccParent(),
    boxSizeA: 2,
    grainCount: 2,
    minSeedDistanceA: 10,
    overlapDistanceA: 0,
    maxAtoms: 100,
  })
  assertEqual(impossible.structuredContent.error?.code, 'polycrystal_generation_failed')
}

async function main(): Promise<void> {
  testDeterministicGeneralParentConstruction()
  await testMcpApplicationAndFailureBoundary()
  console.log('agent polycrystal modeling tests passed')
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
