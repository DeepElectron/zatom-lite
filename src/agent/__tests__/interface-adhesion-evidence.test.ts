import { assertEqual, assertTrue } from '../../testing/assert'
import type { ZatomStructure } from '../contracts'
import { ZATOM_STRUCTURE_SCHEMA } from '../contracts'
import { composeInterfaceAdhesionEvidence, InterfaceAdhesionEvidenceInputError } from '../interface-adhesion-evidence'
import { buildMatchedInterface } from '../interface'
import { callZatomMcpTool } from '../mcp-adapter'
import { applyStructureOperations } from '../operations'
import { fingerprintStructure } from '../structure-math'
import type { PartitionInterfaceReferenceSetResult } from '../interface-reference-set'

function approximate(actual: number, expected: number, tolerance = 1e-10): void {
  assertTrue(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`)
}

function monolayer(label: string, latticeA: number, element: string): ZatomStructure {
  return {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    label,
    lattice: { vectors: [[latticeA, 0, 0], [0, latticeA, 0], [0, 0, 10]], periodic: [true, true, true] },
    atoms: [{ id: `${label}-1`, element, position: [0, 0, 2] }],
  }
}

function fixture() {
  const built = buildMatchedInterface({
    bottom: monolayer('bottom', 2, 'C'),
    top: monolayer('top', 3, 'Si'),
    bottomRepeat: [3, 3],
    topRepeat: [2, 2],
    maxStrain: 0.01,
  })
  const observation = (id: string, structure: ZatomStructure, energyEv: number) => ({
    id,
    structureFingerprint: fingerprintStructure(structure),
    energyEv,
    artifactFingerprint: `sha256:${id}`,
  })
  return {
    built,
    observations: {
      interface: observation('interface-energy', built.structure, -15),
      bottomReference: observation('bottom-energy', built.referenceStructures.bottom, -5),
      topReference: observation('top-energy', built.referenceStructures.top, -8),
    },
    model: {
      identityFingerprint: 'sha256:model-fixture',
      engine: 'fixture-engine',
      engineVersion: '1.0',
      method: 'Identical fixed settings for all three structures',
      energyKind: 'potential-energy' as const,
      geometryProtocol: 'unrelaxed-single-point' as const,
      applicability: { assessment: 'in-domain' as const, domain: 'C/Si fixture', reasons: ['Explicit fixture coverage'] },
      consistencyStatement: 'Same executable, model parameters, cell convention, and numerical settings',
      citations: ['fixture:model'],
    },
  }
}

function testExactAdhesionArithmeticAndBinding(): void {
  const { built, observations, model } = fixture()
  const result = composeInterfaceAdhesionEvidence({
    interfaceStructure: built.structure,
    bottomReferenceStructure: built.referenceStructures.bottom,
    topReferenceStructure: built.referenceStructures.top,
    observations,
    model,
  })
  approximate(result.evidence.interfaceAreaA2, 36)
  approximate(result.evidence.result.interactionEnergyEv, -2)
  approximate(result.evidence.result.workOfAdhesionEvPerA2, 2 / 36)
  approximate(result.evidence.result.workOfAdhesionJPerM2, (2 / 36) * 16.02176634)
  assertTrue(result.checks.every((check) => check.status !== 'fail'))
  assertTrue(result.checks.some((check) => check.id === 'interface_adhesion.geometry_protocol' && check.status === 'warn'))
  assertTrue(result.inspectionTargets.some((target) => target.id === 'interface-adhesion-geometry'))
  const replay = composeInterfaceAdhesionEvidence({
    interfaceStructure: built.structure,
    bottomReferenceStructure: built.referenceStructures.bottom,
    topReferenceStructure: built.referenceStructures.top,
    observations,
    model,
  })
  assertEqual(result.evidenceFingerprint, replay.evidenceFingerprint)
}

function testReferencePartitionMismatchFailsClosed(): void {
  const { built, observations, model } = fixture()
  let code = ''
  try {
    composeInterfaceAdhesionEvidence({
      interfaceStructure: built.structure,
      bottomReferenceStructure: {
        ...built.referenceStructures.bottom,
        atoms: built.referenceStructures.bottom.atoms.slice(1),
      },
      topReferenceStructure: built.referenceStructures.top,
      observations,
      model,
    })
  } catch (error) {
    if (error instanceof InterfaceAdhesionEvidenceInputError) code = error.code
  }
  assertEqual(code, 'interface_adhesion_partition_mismatch')
}

async function testMcpApplicabilityGate(): Promise<void> {
  const { built, observations, model } = fixture()
  const response = await callZatomMcpTool('interface_compose_adhesion_evidence', {
    interfaceStructure: built.structure,
    bottomReferenceStructure: built.referenceStructures.bottom,
    topReferenceStructure: built.referenceStructures.top,
    observations,
    model: {
      ...model,
      applicability: { assessment: 'out-of-domain', domain: model.applicability.domain, reasons: ['Fixture intentionally outside model scope'] },
    },
  })
  assertTrue(response.structuredContent.ok, response.structuredContent.summary)
  assertTrue(response.structuredContent.checks?.some((check) => (
    check.id === 'interface_adhesion.applicability' && check.status === 'fail'
  )) === true)
}

async function testReconstructedInterfaceReferenceSet(): Promise<void> {
  const { built, model } = fixture()
  const bottomIds = built.structure.atoms
    .filter((atom) => atom.properties?.['zatom.interfaceLayer'] === 'bottom')
    .map((atom) => atom.id)
  const topId = built.structure.atoms.find((atom) => atom.properties?.['zatom.interfaceLayer'] === 'top')!.id
  const reconstructed = applyStructureOperations({
    structure: built.structure,
    operations: [
      { op: 'vacancy', selection: { atomIds: [bottomIds[0]] }, count: 1 },
      {
        op: 'bond_add',
        bonds: [
          { id: 'bottom-reconstruction-bond', atomIds: [bottomIds[1], bottomIds[2]], order: 1 },
          { id: 'cross-interface-bond', atomIds: [bottomIds[1], topId], order: 1 },
        ],
      },
    ],
  }).structure
  const response = await callZatomMcpTool('interface_partition_reference_structures', {
    interfaceStructure: reconstructed,
  })
  assertTrue(response.structuredContent.ok, response.structuredContent.summary)
  const partition = (response.structuredContent.data as {
    result: PartitionInterfaceReferenceSetResult
  }).result
  assertEqual(partition.metrics.bottomAtomCount, built.referenceStructures.bottom.atoms.length - 1)
  assertEqual(partition.metrics.topAtomCount, built.referenceStructures.top.atoms.length)
  assertEqual(partition.metrics.bottomInternalBondCount, 1)
  assertEqual(partition.metrics.omittedCrossInterfaceBondCount, 1)
  assertEqual(partition.referenceStructures.bottom.bonds?.[0]?.id, 'bottom-reconstruction-bond')
  assertEqual(partition.referenceStructures.top.bonds, undefined)
  assertTrue(partition.referenceSetFingerprint !== built.referenceSetFingerprint)

  const observation = (id: string, structure: ZatomStructure, energyEv: number) => ({
    id,
    structureFingerprint: fingerprintStructure(structure),
    energyEv,
    artifactFingerprint: `sha256:${id}`,
  })
  const evidence = composeInterfaceAdhesionEvidence({
    interfaceStructure: partition.structure,
    bottomReferenceStructure: partition.referenceStructures.bottom,
    topReferenceStructure: partition.referenceStructures.top,
    observations: {
      interface: observation('reconstructed-interface', partition.structure, -14),
      bottomReference: observation('reconstructed-bottom', partition.referenceStructures.bottom, -5),
      topReference: observation('reconstructed-top', partition.referenceStructures.top, -8),
    },
    model,
  })
  assertEqual(evidence.evidence.referenceSetFingerprint, partition.referenceSetFingerprint)
  assertTrue(evidence.checks.every((check) => check.status !== 'fail'))

  let topologyMismatchCode = ''
  try {
    composeInterfaceAdhesionEvidence({
      interfaceStructure: partition.structure,
      bottomReferenceStructure: { ...partition.referenceStructures.bottom, bonds: undefined },
      topReferenceStructure: partition.referenceStructures.top,
      observations: {
        interface: observation('tampered-interface', partition.structure, -14),
        bottomReference: observation(
          'tampered-bottom',
          { ...partition.referenceStructures.bottom, bonds: undefined },
          -5,
        ),
        topReference: observation('tampered-top', partition.referenceStructures.top, -8),
      },
      model,
    })
  } catch (error) {
    if (error instanceof InterfaceAdhesionEvidenceInputError) topologyMismatchCode = error.code
  }
  assertEqual(topologyMismatchCode, 'interface_adhesion_partition_mismatch')
}

async function main(): Promise<void> {
  testExactAdhesionArithmeticAndBinding()
  testReferencePartitionMismatchFailsClosed()
  await testMcpApplicabilityGate()
  await testReconstructedInterfaceReferenceSet()
  console.log('agent interface adhesion evidence tests passed')
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
