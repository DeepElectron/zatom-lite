import { assertEqual, assertTrue } from '../../testing/assert'
import type { ZatomStructure } from '../contracts'
import { ZATOM_STRUCTURE_SCHEMA } from '../contracts'
import { callZatomMcpTool, listZatomMcpTools } from '../mcp-adapter'
import {
  exportStructureText,
  importStructureText,
  ZATOM_VASP_SELECTIVE_DYNAMICS_PROPERTY,
} from '../structure-text-io'

const periodicStructure: ZatomStructure = {
  schemaVersion: ZATOM_STRUCTURE_SCHEMA,
  label: 'NaCl pair',
  lattice: {
    vectors: [[5.64, 0, 0], [0.4, 5.6, 0], [0.2, 0.3, 5.55]],
    periodic: [true, true, true],
  },
  atoms: [
    { id: 'na source', element: 'Na', position: [0, 0, 0] },
    { id: 'cl/source', element: 'Cl', position: [2.82, 2.8, 2.775] },
  ],
}

function assertNear(actual: number, expected: number, tolerance = 1e-9) {
  assertTrue(Math.abs(actual - expected) <= tolerance, `${actual} should be within ${tolerance} of ${expected}`)
}

function testCifP1RoundTripAndOccupancyGate() {
  const exported = exportStructureText({ structure: periodicStructure, format: 'cif' })
  const imported = importStructureText({ format: 'cif', text: exported.text })
  assertEqual(imported.structure.atoms.length, 2)
  assertEqual(imported.structure.lattice?.periodic.join(','), 'true,true,true')
  imported.structure.atoms.forEach((atom, index) => atom.position.forEach((value, axis) => (
    assertNear(value, periodicStructure.atoms[index].position[axis], 1e-10)
  )))
  imported.structure.lattice?.vectors.forEach((row, rowIndex) => row.forEach((value, axis) => (
    assertNear(value, periodicStructure.lattice!.vectors[rowIndex][axis], 1e-10)
  )))

  let occupancyError: unknown
  try {
    importStructureText({ format: 'cif', text: exported.text.replace(/(Cl1 Cl [^\n]+) 1\n/, '$1 0.5\n') })
  } catch (error) {
    occupancyError = error
  }
  assertEqual((occupancyError as { code?: string })?.code, 'unsupported_cif_occupancy')
}

function testExtxyzTrajectoryIdentityAndTiming() {
  const exported = exportStructureText({ structure: periodicStructure, format: 'extxyz' })
  const roundTrip = importStructureText({ format: 'extxyz', text: exported.text })
  assertEqual(roundTrip.structure.atoms.map((atom) => atom.id).join('|'), 'na source|cl/source')
  assertEqual(roundTrip.structure.lattice?.periodic.join(','), 'true,true,true')

  const text = [
    '2',
    'Lattice="5 0 0 0 5 0 0 0 5" pbc="T T T" Properties=species:S:1:pos:R:3:zatom_id:S:1:charge:R:1',
    'Na 0 0 0 "na source" 1',
    'Cl 2.5 2.5 2.5 "cl/source" -1',
    '2',
    'Lattice="5 0 0 0 5 0 0 0 5" pbc="T T T" Properties=species:S:1:pos:R:3:zatom_id:S:1:charge:R:1',
    'Na 0.1 0 0 "na source" 1',
    'Cl 2.6 2.5 2.5 "cl/source" -1',
  ].join('\n')
  const result = importStructureText({ format: 'extxyz', text, frameTimeStepPs: 0.002 })
  assertEqual(result.structure.atoms.map((atom) => atom.id).join('|'), 'na source|cl/source')
  assertEqual(result.structure.atoms[0].properties?.charge, 1)
  assertEqual(result.trajectory?.frames.length, 2)
  assertEqual(result.trajectory?.frames[1].timePs, 0.002)
  assertEqual(result.trajectory?.frames[1].positions[0][0], 0.1)
  assertEqual(result.trajectory?.lattice?.periodic.join(','), 'true,true,true')

  let timeError: unknown
  try {
    importStructureText({ format: 'extxyz', text })
  } catch (error) {
    timeError = error
  }
  assertEqual((timeError as { code?: string })?.code, 'missing_extxyz_time_step')
}

function testPoscarScalingSelectiveDynamicsAndRoundTrip() {
  const targetVolumeText = [
    'target volume selective cell',
    '-27',
    '1 0 0',
    '0 1 0',
    '0 0 1',
    'Si O',
    '1 1',
    'Selective dynamics',
    'Direct',
    '0 0 0 F F F',
    '0.5 0.5 0.5 T F T',
  ].join('\n')
  const imported = importStructureText({ format: 'poscar', text: targetVolumeText })
  assertEqual(imported.structure.lattice?.vectors[0][0], 3)
  assertEqual(imported.structure.lattice?.vectors[1][1], 3)
  assertEqual(imported.structure.lattice?.vectors[2][2], 3)
  assertNear(imported.structure.atoms[1].position[0], 1.5)
  assertEqual(
    JSON.stringify(imported.structure.atoms[0].properties?.[ZATOM_VASP_SELECTIVE_DYNAMICS_PROPERTY]),
    JSON.stringify([false, false, false]),
  )
  assertTrue(imported.checks.some((check) => check.id === 'structure_text.poscar_scaling' && check.status === 'pass'))

  const exported = exportStructureText({ structure: imported.structure, format: 'poscar' })
  assertEqual(exported.extension, '.vasp')
  assertTrue(exported.text.includes('Selective dynamics\nDirect\n'))
  const roundTrip = importStructureText({ format: 'poscar', text: exported.text })
  roundTrip.structure.atoms.forEach((atom, index) => atom.position.forEach((value, axis) => (
    assertNear(value, imported.structure.atoms[index].position[axis], 1e-10)
  )))
  assertEqual(
    JSON.stringify(roundTrip.structure.atoms[1].properties?.[ZATOM_VASP_SELECTIVE_DYNAMICS_PROPERTY]),
    JSON.stringify([true, false, true]),
  )

  const cartesianComponentScale = [
    'component scaled Cartesian cell',
    '2 3 4',
    '1 0 0',
    '0 1 0',
    '0 0 1',
    'H',
    '1',
    'Cartesian',
    '0.5 0.5 0.5',
  ].join('\n')
  const componentScaled = importStructureText({ format: 'poscar', text: cartesianComponentScale })
  assertEqual(componentScaled.structure.lattice?.vectors.flat().join(','), '2,0,0,0,3,0,0,0,4')
  assertEqual(componentScaled.structure.atoms[0].position.join(','), '1,1.5,2')
}

function testPoscarUnknownIdentityAndTailFailClosed() {
  const vasp4 = [
    'VASP 4 identity requires POTCAR',
    '1',
    '3 0 0',
    '0 3 0',
    '0 0 3',
    '2',
    'Direct',
    '0 0 0',
    '0.5 0.5 0.5',
  ].join('\n')
  let vasp4Error: unknown
  try {
    importStructureText({ format: 'poscar', text: vasp4 })
  } catch (error) {
    vasp4Error = error
  }
  assertEqual((vasp4Error as { code?: string })?.code, 'unsupported_poscar_vasp4')

  const withVelocityTail = [
    'velocity tail',
    '1',
    '3 0 0',
    '0 3 0',
    '0 0 3',
    'H',
    '1',
    'Direct',
    '0 0 0',
    'Cartesian',
    '0.1 0 0',
  ].join('\n')
  let tailError: unknown
  try {
    importStructureText({ format: 'poscar', text: withVelocityTail })
  } catch (error) {
    tailError = error
  }
  assertEqual((tailError as { code?: string })?.code, 'unsupported_poscar_tail')
}

function testXdatcarFixedAndVariableCellTrajectories() {
  const fixedCell = [
    'SiO trajectory',
    '1',
    '3 0 0',
    '0 3 0',
    '0 0 3',
    'Si O',
    '1 1',
    'Direct configuration= 1',
    '0 0 0',
    '0.5 0.5 0.5',
    'Direct configuration= 3',
    '0.1 0 0',
    '0.6 0.5 0.5',
  ].join('\n')
  const fixed = importStructureText({ format: 'xdatcar', text: fixedCell, frameTimeStepPs: 0.004 })
  assertEqual(fixed.structure.atoms.map((atom) => atom.id).join('|'), 'atom-000001|atom-000002')
  assertEqual(fixed.trajectory?.frames.length, 2)
  assertEqual(fixed.trajectory?.frames.map((frame) => frame.step).join(','), '1,3')
  assertEqual(fixed.trajectory?.frames[1].timePs, 0.004)
  assertNear(fixed.structure.atoms[0].position[0], 0.3)
  assertEqual(fixed.trajectory?.frames[1].positions[0][0], fixed.structure.atoms[0].position[0])
  assertTrue(fixed.trajectory?.lattice !== undefined)
  assertTrue(fixed.trajectory?.frames.every((frame) => frame.lattice === undefined) === true)
  assertTrue(fixed.inspectionTargets.some((target) => target.trajectoryFrameIndex === 0))
  assertTrue(fixed.inspectionTargets.some((target) => target.trajectoryFrameIndex === 1))

  const variableCell = [
    'variable H trajectory',
    '1',
    '2 0 0',
    '0 2 0',
    '0 0 2',
    'H',
    '1',
    'Direct configuration= 4',
    '0.25 0 0',
    'variable H trajectory',
    '1',
    '4 0 0',
    '0 2 0',
    '0 0 2',
    'H',
    '1',
    'Direct configuration= 8',
    '0.5 0 0',
  ].join('\n')
  const variable = importStructureText({ format: 'xdatcar', text: variableCell, frameTimeStepPs: 0.01 })
  assertEqual(variable.trajectory?.lattice, undefined)
  assertTrue(variable.trajectory?.frames.every((frame) => frame.lattice !== undefined) === true)
  assertEqual(variable.trajectory?.frames[0].lattice?.vectors[0][0], 2)
  assertEqual(variable.trajectory?.frames[1].lattice?.vectors[0][0], 4)
  assertEqual(variable.structure.lattice?.vectors[0][0], 4)
  assertEqual(variable.structure.atoms[0].position[0], 2)
}

function testXdatcarFailsClosedOnMissingTimeAndIdentityDrift() {
  const twoFrames = [
    'H trajectory',
    '1',
    '2 0 0',
    '0 2 0',
    '0 0 2',
    'H',
    '1',
    'Direct configuration= 1',
    '0 0 0',
    'Direct configuration= 2',
    '0.1 0 0',
  ].join('\n')
  let timeError: unknown
  try {
    importStructureText({ format: 'xdatcar', text: twoFrames })
  } catch (error) {
    timeError = error
  }
  assertEqual((timeError as { code?: string })?.code, 'missing_xdatcar_time_step')

  const identityDrift = `${twoFrames.split('\n').slice(0, 9).join('\n')}\n${[
    'He trajectory',
    '1',
    '2 0 0',
    '0 2 0',
    '0 0 2',
    'He',
    '1',
    'Direct configuration= 2',
    '0.1 0 0',
  ].join('\n')}`
  let identityError: unknown
  try {
    importStructureText({ format: 'xdatcar', text: identityDrift, frameTimeStepPs: 0.01 })
  } catch (error) {
    identityError = error
  }
  assertEqual((identityError as { code?: string })?.code, 'xdatcar_identity_drift')
}

function testMolTopologyAndChargeRoundTrip() {
  const molecule: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    label: 'charged aromatic fragment',
    atoms: [
      { id: 'c1', element: 'C', position: [0, 0, 0], properties: { formalCharge: 1 } },
      { id: 'c2', element: 'C', position: [1.4, 0, 0] },
    ],
    bonds: [{ id: 'aromatic', atomIds: ['c1', 'c2'], order: 1.5 }],
  }
  const exported = exportStructureText({ structure: molecule, format: 'mol-v2000' })
  const imported = importStructureText({ format: 'mol-v2000', text: exported.text })
  assertEqual(imported.structure.bonds?.[0].order, 1.5)
  assertEqual(imported.structure.atoms[0].properties?.formalCharge, 1)
  assertEqual(imported.structure.atoms[1].position[0], 1.4)
}

async function testMcpStrictFailureAndVerifiedApplication() {
  const importTool = listZatomMcpTools().find((tool) => tool.name === 'structure_import_text')
  assertTrue(importTool !== undefined)
  const importFormats = ((importTool?.inputSchema.properties as Record<string, { enum?: string[] }>)?.format.enum ?? [])
  assertTrue(importFormats.includes('poscar'))
  assertTrue(importFormats.includes('xdatcar'))
  const exportTool = listZatomMcpTools().find((tool) => tool.name === 'structure_export_text')
  assertTrue(exportTool !== undefined)
  const exportFormats = ((exportTool?.inputSchema.properties as Record<string, { enum?: string[] }>)?.format.enum ?? [])
  assertTrue(!exportFormats.includes('xdatcar'))

  const malformed = await callZatomMcpTool('structure_import_text', {
    format: 'xyz',
    text: '2\ntruncated\nH 0 0 0',
  })
  assertEqual(malformed.structuredContent.error?.code, 'truncated_xyz_frame')

  let active: ZatomStructure | null = null
  const imported = await callZatomMcpTool('structure_import_text', {
    format: 'xyz',
    text: '2\nhydrogen\nH 0 0 0\nH 0.74 0 0\n',
    applyToWorkspace: true,
    captureAfter: false,
  }, {
    writeStructure: (structure) => { active = structuredClone(structure) },
    readStructure: () => active,
  })
  const envelope = imported.structuredContent.data as { applicationVerified: boolean; appliedToWorkspace: boolean }
  assertTrue(imported.structuredContent.ok)
  assertTrue(envelope.appliedToWorkspace)
  assertTrue(envelope.applicationVerified)

  const exported = await callZatomMcpTool('structure_export_text', { format: 'xyz' }, { readStructure: () => active })
  assertTrue(exported.structuredContent.ok)
  assertTrue((exported.structuredContent.data as { text: string }).text.startsWith('2\n'))
  assertTrue(exported.structuredContent.checks?.some((check) => check.id === 'structure_text.export_scope') === true)
}

async function main() {
  testCifP1RoundTripAndOccupancyGate()
  testExtxyzTrajectoryIdentityAndTiming()
  testPoscarScalingSelectiveDynamicsAndRoundTrip()
  testPoscarUnknownIdentityAndTailFailClosed()
  testXdatcarFixedAndVariableCellTrajectories()
  testXdatcarFailsClosedOnMissingTimeAndIdentityDrift()
  testMolTopologyAndChargeRoundTrip()
  await testMcpStrictFailureAndVerifiedApplication()
  console.log('agent strict structure text I/O tests passed')
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
