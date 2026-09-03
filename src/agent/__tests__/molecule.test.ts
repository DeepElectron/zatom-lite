import { assertDeepEqual, assertEqual, assertTrue } from '../../testing/assert'
import { callZatomMcpTool } from '../mcp-adapter'
import {
  assignOpenMmIdentity,
  createMoleculeFromTemplate,
  optimizeMoleculeGeometry,
  validateMolecularTopology,
} from '../molecule'
import type { ZatomStructure } from '../contracts'
import { fingerprintStructure } from '../structure-math'
import { validateStructure } from '../structure-validation'

function testTemplateHasDeterministicExplicitTopology() {
  const first = createMoleculeFromTemplate({ template: 'water', center: [1, 2, 3] })
  const second = createMoleculeFromTemplate({ template: 'water', center: [1, 2, 3] })
  assertEqual(first.structure.atoms.length, 3)
  assertEqual(first.structure.bonds?.length, 2)
  assertEqual(first.topology.formula, 'H2O')
  assertEqual(first.topology.componentCount, 1)
  assertTrue(first.checks.every((check) => check.status !== 'fail'))
  assertEqual(fingerprintStructure(first.structure), fingerprintStructure(second.structure))
  assertDeepEqual(first.structure.atoms.map((atom) => atom.id), second.structure.atoms.map((atom) => atom.id))
}

function testTopologyRejectsMissingEndpoint() {
  const molecule = createMoleculeFromTemplate({ template: 'h2' }).structure
  molecule.bonds![0] = { ...molecule.bonds![0], atomIds: [molecule.atoms[0].id, 'missing'] }
  const report = validateMolecularTopology(molecule)
  assertTrue(report.checks.some((check) => check.id === 'molecule.connected_components' && check.status === 'fail'))
}

function testEmpiricalCleanupPreservesTopology() {
  const source = createMoleculeFromTemplate({ template: 'water' }).structure
  source.atoms[1] = { ...source.atoms[1], position: [4, 0, 0] }
  assertTrue(validateMolecularTopology(source).checks.some((check) => check.id === 'molecule.bond_lengths' && check.status === 'fail'))
  const result = optimizeMoleculeGeometry({ structure: source, maxIters: 600 })
  assertEqual(result.structure.bonds?.length, 2)
  assertDeepEqual(result.structure.bonds, source.bonds)
  assertTrue(result.changeSet.maxPositionDisplacementA > 0)
  assertTrue(result.checks.some((check) => check.id === 'molecule.empirical_cleanup_scope' && check.status === 'warn'))
  assertTrue(result.checks.some((check) => check.id === 'molecule.cleanup_clashes' && check.status === 'pass'))
}

function testEmpiricalCleanupCanRepairOverlappingInput() {
  const source = createMoleculeFromTemplate({ template: 'h2' }).structure
  source.atoms[1] = {
    ...source.atoms[1],
    position: [source.atoms[0].position[0] + 0.01, source.atoms[0].position[1], source.atoms[0].position[2]],
  }
  const sourceValidation = validateStructure(source)
  assertTrue(sourceValidation.checks.some((check) => check.id === 'structure.minimum_distance' && check.status === 'fail'))
  const result = optimizeMoleculeGeometry({ structure: source, maxIters: 600 })
  const delta = result.structure.atoms[1].position.map((value, axis) => value - result.structure.atoms[0].position[axis])
  assertTrue(Math.hypot(delta[0], delta[1], delta[2]) > 0.35)
  assertTrue(result.validation.checks.every((check) => check.status !== 'fail'))
}

function openMmWaterAssignment(source: ZatomStructure) {
  return [{
    chainId: 'W',
    residueName: 'HOH',
    residueId: '1',
    atoms: source.atoms.map((atom, index) => ({
      atomId: atom.id,
      atomName: index === 0 ? 'O' : `H${index}`,
    })),
  }]
}

function testOpenMmIdentityAssignmentIsCompletePropertyAwareAndGeometryPreserving() {
  const source = createMoleculeFromTemplate({ template: 'water' }).structure
  source.atoms = source.atoms.map((atom) => ({
    ...atom,
    properties: { ...atom.properties, formalCharge: 0 },
  }))
  const result = assignOpenMmIdentity({ structure: source, residues: openMmWaterAssignment(source) })
  assertTrue(fingerprintStructure(result.structure) !== fingerprintStructure(source))
  assertEqual(result.changeSet.maxPositionDisplacementA, 0)
  assertEqual(result.changeSet.changedAtomPropertiesCount, 3)
  assertEqual(result.changeSet.structureMetadataChanged, true)
  assertEqual(result.externalBondCount, 0)
  assertEqual(result.formalCharge, 0)
  assertDeepEqual(result.structure.atoms.map((atom) => atom.position), source.atoms.map((atom) => atom.position))
  assertDeepEqual(result.structure.bonds, source.bonds)
  assertEqual(result.structure.atoms[0].properties?.['zatom.bio.chainId'], 'W')
  assertEqual(result.structure.atoms[0].properties?.['zatom.bio.residueName'], 'HOH')
  assertEqual(result.structure.atoms[0].properties?.['zatom.bio.atomName'], 'O')
  assertTrue(result.checks.some((check) => check.id === 'openmm_identity.complete_coverage' && check.status === 'pass'))
  assertTrue(result.checks.some((check) => check.id === 'openmm_identity.template_scope' && check.status === 'warn'))

  let rejected = false
  try {
    const reversed = openMmWaterAssignment(source)
    reversed[0].atoms.reverse()
    assignOpenMmIdentity({ structure: source, residues: reversed })
  } catch (error) {
    rejected = error instanceof Error && error.message.includes('source order')
  }
  assertTrue(rejected)
}

async function testMcpTemplateCanApplyWithTopology() {
  let writtenBonds = -1
  const response = await callZatomMcpTool('molecule_create_from_template', {
    template: 'benzene',
    applyToWorkspace: true,
    captureAfter: false,
  }, {
    writeStructure: (structure) => { writtenBonds = structure.bonds?.length ?? -1 },
  })
  const envelope = response.structuredContent.data as { appliedToWorkspace: boolean; applicationBlocked: boolean }
  assertTrue(response.structuredContent.ok)
  assertEqual(envelope.appliedToWorkspace, true)
  assertEqual(envelope.applicationBlocked, false)
  assertEqual(writtenBonds, 12)
}

async function testMcpOpenMmIdentityReadbackIncludesProperties() {
  const source = createMoleculeFromTemplate({ template: 'water' }).structure
  source.atoms = source.atoms.map((atom) => ({
    ...atom,
    properties: { ...atom.properties, formalCharge: 0 },
  }))
  const written: { current?: ZatomStructure } = {}
  const response = await callZatomMcpTool('molecule_assign_openmm_identity', {
    structure: source,
    residues: openMmWaterAssignment(source),
    applyToWorkspace: true,
    captureAfter: false,
  }, {
    writeStructure: (structure) => { written.current = structure },
    readStructure: () => written.current ?? null,
  })
  assertTrue(response.structuredContent.ok, response.structuredContent.summary)
  const envelope = response.structuredContent.data as {
    applicationBlocked: boolean
    applicationVerified: boolean
    result: { structure: ZatomStructure; changeSet: { changedAtomPropertiesCount: number } }
  }
  assertEqual(envelope.applicationBlocked, false)
  assertEqual(envelope.applicationVerified, true)
  assertEqual(envelope.result.changeSet.changedAtomPropertiesCount, 3)
  assertTrue(written.current !== undefined)
  assertEqual(written.current?.atoms[1].properties?.['zatom.bio.atomName'], 'H1')
}

async function main() {
  testTemplateHasDeterministicExplicitTopology()
  testTopologyRejectsMissingEndpoint()
  testEmpiricalCleanupPreservesTopology()
  testEmpiricalCleanupCanRepairOverlappingInput()
  testOpenMmIdentityAssignmentIsCompletePropertyAwareAndGeometryPreserving()
  await testMcpTemplateCanApplyWithTopology()
  await testMcpOpenMmIdentityReadbackIncludesProperties()
}

void main()
