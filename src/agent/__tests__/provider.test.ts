import { assertDeepEqual, assertEqual, assertTrue } from '../../testing/assert'
import { callZatomMcpTool } from '../mcp-adapter'
import { createMoleculeFromTemplate } from '../molecule'
import { registerZatomModelingProvider } from '../provider-tools'
import type { Mat3, ZatomStructure, ZatomToolContext } from '../contracts'
import { ZATOM_STRUCTURE_SCHEMA } from '../contracts'
import { ZATOM_PROVIDER_SCHEMA, type ZatomModelingProvider } from '../provider'
import { fingerprintStructure } from '../structure-math'

const triclinicCell: Mat3 = [[15, 0, 0], [5, 14, 0], [2, 3, 13]]

async function testProviderDiscoveryExposesRoutingContracts() {
  const response = await callZatomMcpTool('modeling_list_providers', { includeSchemas: true })
  assertTrue(response.structuredContent.ok)
  const data = response.structuredContent.data as {
    providers: Array<{
      id: string
      capabilities: Array<{
        id: string
        fingerprint: string
        tags: string[]
        inputSchema: Record<string, unknown>
      }>
    }>
  }
  assertDeepEqual(data.providers.map((provider) => provider.id), [
    'zatom.isotropic-dislocation',
    'zatom.rigid-molecule-packing',
    'zatom.commensurate-moire',
    'zatom.smooth-displacement-fields',
    'zatom.general-2d-interface',
  ])
  assertTrue(data.providers.some((provider) => provider.capabilities.some((capability) => (
    capability.id === 'molecule.pack.rigid' && capability.inputSchema.type === 'object'
  ))))
  assertTrue(data.providers.every((provider) => provider.capabilities.every((capability) => (
    /^fnv1a64:[0-9a-f]{16}$/.test(capability.fingerprint)
  ))))
}

async function runWaterPacking(
  applyToWorkspace = false,
  context: ZatomToolContext = {},
  identity?: { fingerprint: string; requiredTags: string[] },
) {
  const water = createMoleculeFromTemplate({ template: 'water' }).structure
  return callZatomMcpTool('modeling_run_provider', {
    providerId: 'zatom.rigid-molecule-packing',
    capability: 'molecule.pack.rigid',
    ...(identity ? {
      expectedProviderCapabilityFingerprint: identity.fingerprint,
      requiredProviderCapabilityTags: identity.requiredTags,
    } : {}),
    parameters: {
      cell: { vectors: triclinicCell, periodic: [true, true, true] },
      species: [{ name: 'water', structure: water, count: 8 }],
      minDistanceA: 1.8,
      maxAttemptsPerMolecule: 3000,
    },
    seed: 2026,
    applyToWorkspace,
    captureAfter: applyToWorkspace,
  }, context)
}

async function testDiscoveredProviderIdentityAndCoverageAreRechecked() {
  const discovered = await callZatomMcpTool('modeling_list_providers', {
    providerId: 'zatom.rigid-molecule-packing',
    capability: 'molecule.pack.rigid',
    tags: ['packing'],
    includeSchemas: true,
  })
  assertTrue(discovered.structuredContent.ok)
  const capability = (discovered.structuredContent.data as {
    providers: Array<{ capabilities: Array<{ fingerprint: string }> }>
  }).providers[0].capabilities[0]

  const admitted = await runWaterPacking(false, {}, {
    fingerprint: capability.fingerprint,
    requiredTags: ['packing'],
  })
  assertTrue(admitted.structuredContent.ok, admitted.structuredContent.summary)

  const driftedFingerprint = `${capability.fingerprint.slice(0, -1)}${capability.fingerprint.endsWith('0') ? '1' : '0'}`
  const drifted = await runWaterPacking(false, {}, {
    fingerprint: driftedFingerprint,
    requiredTags: ['packing'],
  })
  assertEqual(drifted.structuredContent.ok, false)
  assertEqual(drifted.structuredContent.error?.code, 'provider_capability_identity_mismatch')

  const wrongCoverage = await runWaterPacking(false, {}, {
    fingerprint: capability.fingerprint,
    requiredTags: ['relaxation'],
  })
  assertEqual(wrongCoverage.structuredContent.ok, false)
  assertEqual(wrongCoverage.structuredContent.error?.code, 'provider_capability_coverage_mismatch')
}

async function testPackingIsDeterministicAndPreservesTopology() {
  const first = await runWaterPacking()
  const second = await runWaterPacking()
  assertTrue(first.structuredContent.ok)
  assertTrue(second.structuredContent.ok)
  const a = first.structuredContent.data as {
    result: { structure: ZatomStructure; checks: Array<{ id: string; status: string }>; provenance: { seed: number } }
  }
  const b = second.structuredContent.data as { result: { structure: ZatomStructure } }
  assertEqual(a.result.structure.atoms.length, 24)
  assertEqual(a.result.structure.bonds?.length, 16)
  assertEqual(a.result.provenance.seed, 2026)
  assertEqual(fingerprintStructure(a.result.structure), fingerprintStructure(b.result.structure))
  assertTrue(a.result.checks.some((check) => check.id === 'pack.completeness' && check.status === 'pass'))
  assertTrue(a.result.checks.some((check) => check.id === 'pack.minimum_inter_molecular_distance' && check.status === 'pass'))
  assertTrue(a.result.checks.some((check) => check.id === 'pack.topology_preserved' && check.status === 'pass'))
  assertTrue(a.result.structure.atoms.every((atom) => atom.properties?.['zatom.pack.species'] === 'water'))
}

async function testProviderApplyIsReReadAndCaptured() {
  let active: ZatomStructure | null = null
  const response = await runWaterPacking(true, {
    writeStructure: (structure) => { active = structure },
    readStructure: () => active,
    captureViewport: () => ({ imageBase64: 'cHJvdmlkZXI=', mimeType: 'image/png', width: 256, height: 192 }),
  })
  assertTrue(response.structuredContent.ok)
  const data = response.structuredContent.data as {
    appliedToWorkspace: boolean
    applicationBlocked: boolean
    applicationVerified: boolean | null
    result: { checks: Array<{ id: string; status: string }> }
  }
  assertEqual(data.appliedToWorkspace, true)
  assertEqual(data.applicationBlocked, false)
  assertEqual(data.applicationVerified, true)
  assertTrue(data.result.checks.some((check) => check.id === 'candidate.readback_identity' && check.status === 'pass'))
  assertEqual(response.content.filter((block) => block.type === 'image').length, 1)
}

async function testHostWriteAndReadbackFailuresRemainAuditable() {
  const rejected = await runWaterPacking(true, {
    writeStructure: () => { throw new Error('mixed PBC unsupported by this test host') },
  })
  assertTrue(rejected.structuredContent.ok)
  const rejectedData = rejected.structuredContent.data as {
    appliedToWorkspace: boolean
    applicationBlocked: boolean
    applicationVerified: boolean | null
    result: { checks: Array<{ id: string; status: string }> }
  }
  assertEqual(rejectedData.appliedToWorkspace, false)
  assertEqual(rejectedData.applicationBlocked, true)
  assertEqual(rejectedData.applicationVerified, null)
  assertTrue(rejectedData.result.checks.some((check) => check.id === 'candidate.workspace_write' && check.status === 'fail'))

  const wrongReadback = createMoleculeFromTemplate({ template: 'h2' }).structure
  const mismatched = await runWaterPacking(true, {
    writeStructure: () => undefined,
    readStructure: () => wrongReadback,
  })
  const mismatchedData = mismatched.structuredContent.data as {
    appliedToWorkspace: boolean
    applicationVerified: boolean | null
    result: { checks: Array<{ id: string; status: string }> }
  }
  assertEqual(mismatchedData.appliedToWorkspace, true)
  assertEqual(mismatchedData.applicationVerified, false)
  assertTrue(mismatchedData.result.checks.some((check) => check.id === 'candidate.readback_identity' && check.status === 'fail'))
}

function simpleCubicBlock(size = 6, spacing = 3): ZatomStructure {
  const atoms: ZatomStructure['atoms'] = []
  for (let i = 0; i < size; i++) for (let j = 0; j < size; j++) for (let k = 0; k < size; k++) {
    atoms.push({ id: `sc-${i}-${j}-${k}`, element: 'W', position: [i * spacing, j * spacing, k * spacing] })
  }
  return {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    label: 'simple cubic block',
    atoms,
    lattice: {
      vectors: [[size * spacing, 0, 0], [0, size * spacing, 0], [0, 0, size * spacing]],
      periodic: [true, true, true],
    },
  }
}

async function testDislocationProviderReportsDefinitionLevelChecks() {
  const response = await callZatomMcpTool('modeling_run_provider', {
    providerId: 'zatom.isotropic-dislocation',
    capability: 'defect.dislocation.isotropic',
    structure: simpleCubicBlock(),
    parameters: {
      burgers: [1, 0, 0],
      lineDirection: [0, 0, 1],
      latticeType: 'sc',
      latticeConstant: 3,
      radius: 6,
      coreRadius: 0.8,
      minimumSeparationA: 0.1,
    },
    applyToWorkspace: false,
  })
  assertTrue(response.structuredContent.ok)
  const data = response.structuredContent.data as {
    result: {
      structure: ZatomStructure
      checks: Array<{ id: string; status: string }>
      inspectionTargets: Array<{ id: string; atomIds: string[] }>
    }
  }
  assertDeepEqual(data.result.structure.lattice?.periodic, [false, false, true])
  assertTrue(data.result.checks.some((check) => check.id === 'dislocation.burgers_circuit' && check.status === 'pass'))
  assertTrue(data.result.checks.some((check) => check.id === 'dislocation.boundary_scope' && check.status === 'pass'))
  assertTrue(data.result.inspectionTargets.some((target) => target.id === 'dislocation-core'))
}

async function testObsoleteIsotropicDipoleInputIsRejected(): Promise<void> {
  const response = await callZatomMcpTool('modeling_run_provider', {
    providerId: 'zatom.isotropic-dislocation',
    capability: 'defect.dislocation.isotropic',
    structure: simpleCubicBlock(),
    parameters: {
      burgers: [1, 0, 0],
      lineDirection: [0, 0, 1],
      latticeType: 'sc',
      latticeConstant: 3,
      arrangement: 'dipole',
    },
    applyToWorkspace: false,
  })
  assertEqual(response.structuredContent.ok, false)
  assertEqual(response.structuredContent.error?.code, 'invalid_provider_parameters')
}

async function testCommensurateMoireProviderReportsExactCellMetrics() {
  const response = await callZatomMcpTool('modeling_run_provider', {
    providerId: 'zatom.commensurate-moire',
    capability: 'interface.moire.hexagonal',
    parameters: {
      targetTwistDeg: 21.786789,
      elementA: 'B',
      elementB: 'N',
      maxAtoms: 28,
      maxTwistErrorDeg: 1e-5,
    },
    applyToWorkspace: false,
  })
  assertTrue(response.structuredContent.ok)
  const data = response.structuredContent.data as {
    result: {
      structure: ZatomStructure
      checks: Array<{ id: string; status: string }>
      inspectionTargets: Array<{ id: string; atomIds: string[] }>
      details: {
        commensuratePair: number[]
        layerAtomCounts: number[]
        periodicSeamResidualA: number
        signedTopLayerRotationDeg: number
      }
    }
  }
  assertEqual(data.result.structure.atoms.length, 28)
  assertDeepEqual(data.result.details.commensuratePair, [2, 1])
  assertDeepEqual(data.result.details.layerAtomCounts, [14, 14])
  assertTrue(data.result.details.periodicSeamResidualA < 1e-10)
  assertTrue(data.result.details.signedTopLayerRotationDeg < 0)
  assertDeepEqual(data.result.structure.lattice?.periodic, [true, true, true])
  assertEqual(data.result.structure.atoms.filter((atom) => atom.properties?.['zatom.moire.layer'] === 0).length, 14)
  assertEqual(data.result.structure.atoms.filter((atom) => atom.properties?.['zatom.moire.layer'] === 1).length, 14)
  assertTrue(data.result.checks.some((check) => check.id === 'moire.commensurate_count' && check.status === 'pass'))
  assertTrue(data.result.checks.some((check) => check.id === 'moire.twist_error' && check.status === 'pass'))
  assertTrue(data.result.checks.some((check) => check.id === 'moire.periodic_seam' && check.status === 'pass'))
  assertTrue(data.result.checks.some((check) => check.id === 'moire.binary_orientation' && check.status === 'pass'))
  assertTrue(data.result.inspectionTargets.some((target) => target.id === 'moire-aa-periodic-origin' && target.atomIds.length > 0))
}

async function testMoireTwistGateBlocksAnUnderResolvedCell() {
  let writes = 0
  const response = await callZatomMcpTool('modeling_run_provider', {
    providerId: 'zatom.commensurate-moire',
    capability: 'interface.moire.hexagonal',
    parameters: {
      targetTwistDeg: 10,
      maxAtoms: 28,
      maxTwistErrorDeg: 0.1,
    },
    applyToWorkspace: true,
  }, { writeStructure: () => { writes++ } })
  assertTrue(response.structuredContent.ok)
  const data = response.structuredContent.data as {
    applicationBlocked: boolean
    result: { checks: Array<{ id: string; status: string }> }
  }
  assertEqual(data.applicationBlocked, true)
  assertEqual(writes, 0)
  assertTrue(data.result.checks.some((check) => check.id === 'moire.twist_error' && check.status === 'fail'))
  assertTrue(data.result.checks.some((check) => check.id === 'candidate.application_gate' && check.status === 'fail'))
}

async function testMoireCandidateCanBeAppliedFocusedAndCaptured() {
  let active: ZatomStructure | null = null
  let focused: [number, number, number] | null = null
  const context: ZatomToolContext = {
    readStructure: () => active,
    writeStructure: (structure) => { active = structure },
    focusInspectionTarget: (target) => { focused = target.center; return null },
    captureViewport: () => ({ imageBase64: 'bW9pcmUtdmlzdWFs', mimeType: 'image/jpeg', width: 512, height: 384 }),
  }
  const built = await callZatomMcpTool('modeling_run_provider', {
    providerId: 'zatom.commensurate-moire',
    capability: 'interface.moire.hexagonal',
    parameters: { targetTwistDeg: 21.786789, maxAtoms: 28, maxTwistErrorDeg: 1e-5 },
    applyToWorkspace: true,
    captureAfter: false,
  }, context)
  assertTrue(built.structuredContent.ok)
  const builtData = built.structuredContent.data as {
    applicationVerified: boolean | null
    result: { inspectionTargets: Array<{ id: string; reason: string; center: [number, number, number]; radius: number; atomIds: string[] }> }
  }
  assertEqual(builtData.applicationVerified, true)
  const target = builtData.result.inspectionTargets.find((item) => item.id === 'moire-aa-periodic-origin')
  assertTrue(!!target)
  const focusedResult = await callZatomMcpTool('viewer_focus_target', {
    inspectionTarget: target!,
    expectedStructureFingerprint: fingerprintStructure(active!),
    captureAfter: true,
  }, context)
  assertTrue(focusedResult.structuredContent.ok)
  assertDeepEqual(focused, target!.center)
  assertEqual(focusedResult.content.filter((block) => block.type === 'image').length, 1)
  assertTrue(focusedResult.structuredContent.checks?.some((check) => check.id === 'visual.target_position_resolved' && check.status === 'pass') === true)
  assertTrue(focusedResult.structuredContent.checks?.some((check) => check.id === 'visual.viewport_capture' && check.status === 'pass') === true)
}

async function testSmoothFieldProviderAppliesAuditsFocusesAndCaptures() {
  let active: ZatomStructure | null = simpleCubicBlock(3, 2)
  let focused: [number, number, number] | null = null
  const context: ZatomToolContext = {
    readStructure: () => active,
    writeStructure: (structure) => { active = structure },
    focusInspectionTarget: (target) => { focused = target.center; return null },
    captureViewport: () => ({ imageBase64: 'ZmllbGQtdmlzdWFs', mimeType: 'image/jpeg', width: 480, height: 360 }),
  }
  const response = await callZatomMcpTool('modeling_run_provider', {
    providerId: 'zatom.smooth-displacement-fields',
    capability: 'deformation.field.smooth',
    parameters: {
      fields: [{
        kind: 'sinusoidal',
        origin: [0, 0, 0],
        propagation: [1, 0, 0],
        direction: [0, 0, 1],
        amplitudeA: 0.1,
        wavelengthA: 12,
      }],
      dropLattice: true,
      maxPrincipalStrain: 0.1,
      minimumPairDistanceA: 0.5,
    },
    applyToWorkspace: true,
    captureAfter: false,
  }, context)
  assertTrue(response.structuredContent.ok)
  const data = response.structuredContent.data as {
    applicationBlocked: boolean
    applicationVerified: boolean | null
    result: {
      structure: ZatomStructure
      checks: Array<{ id: string; status: string }>
      details: { selectedAtomCount: number; auditedAtomCount: number; maxAbsPrincipalStrain: number }
      inspectionTargets: Array<{ id: string; reason: string; center: [number, number, number]; radius: number; atomIds: string[] }>
    }
  }
  assertEqual(data.applicationBlocked, false)
  assertEqual(data.applicationVerified, true)
  assertEqual(data.result.structure.atoms.length, 27)
  assertEqual(data.result.structure.lattice, undefined)
  assertEqual(data.result.details.selectedAtomCount, 27)
  assertEqual(data.result.details.auditedAtomCount, 27)
  assertTrue(data.result.details.maxAbsPrincipalStrain > 0 && data.result.details.maxAbsPrincipalStrain < 0.1)
  assertTrue(data.result.checks.some((check) => check.id === 'field.jacobian_orientation' && check.status === 'pass'))
  assertTrue(data.result.checks.some((check) => check.id === 'field.principal_strain' && check.status === 'pass'))
  assertTrue(data.result.checks.some((check) => check.id === 'field.periodicity_truthful' && check.status === 'warn'))
  const target = data.result.inspectionTargets.find((item) => item.id === 'field-maximum-displacement')
  assertTrue(!!target && target.atomIds.length === 1)
  const focus = await callZatomMcpTool('viewer_focus_target', {
    inspectionTarget: target!,
    expectedStructureFingerprint: fingerprintStructure(data.result.structure),
    captureAfter: true,
  }, context)
  assertTrue(focus.structuredContent.ok)
  assertDeepEqual(focused, target!.center)
  assertEqual(focus.content.filter((block) => block.type === 'image').length, 1)
}

async function testSmoothFieldFoldoverCannotReachTheViewport() {
  const source: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    atoms: [
      { id: 'left', element: 'C', position: [-2, 0, 0] },
      { id: 'center', element: 'C', position: [0, 0, 0] },
      { id: 'right', element: 'C', position: [2, 0, 0] },
    ],
  }
  let writes = 0
  const response = await callZatomMcpTool('modeling_run_provider', {
    providerId: 'zatom.smooth-displacement-fields',
    capability: 'deformation.field.smooth',
    structure: source,
    parameters: {
      fields: [{
        kind: 'smooth-step',
        origin: [0, 0, 0],
        normal: [1, 0, 0],
        direction: [-1, 0, 0],
        amplitudeA: 4,
        widthA: 1,
      }],
      maxPrincipalStrain: 2,
      minJacobianDeterminant: 0.1,
      minimumPairDistanceA: 0,
    },
    applyToWorkspace: true,
  }, { writeStructure: () => { writes++ } })
  assertTrue(response.structuredContent.ok)
  const data = response.structuredContent.data as {
    applicationBlocked: boolean
    result: { checks: Array<{ id: string; status: string }> }
  }
  assertEqual(data.applicationBlocked, true)
  assertEqual(writes, 0)
  assertTrue(data.result.checks.some((check) => check.id === 'field.jacobian_orientation' && check.status === 'fail'))
  assertTrue(data.result.checks.some((check) => check.id === 'candidate.application_gate' && check.status === 'fail'))
}

function generalInterfaceMonolayer(
  label: string,
  a: [number, number, number],
  b: [number, number, number],
  element: string,
): ZatomStructure {
  return {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    label,
    lattice: { vectors: [a, b, [0, 0, 10]], periodic: [true, true, true] },
    atoms: [{ id: `${label}-1`, element, position: [0, 0, 2] }],
  }
}

async function testGeneralInterfaceProviderFindsOffDiagonalMatchAndFocuses() {
  const bottom = generalInterfaceMonolayer('square-bottom', [1, 0, 0], [0, 1, 0], 'C')
  const top = generalInterfaceMonolayer('oblique-top', [1, 0, 0], [0.5, 0.5, 0], 'Si')
  let active: ZatomStructure | null = bottom
  let focused: [number, number, number] | null = null
  const context: ZatomToolContext = {
    readStructure: () => active,
    writeStructure: (structure) => { active = structure },
    focusInspectionTarget: (target) => { focused = target.center; return null },
    captureViewport: () => ({ imageBase64: 'aG5mLWludGVyZmFjZQ==', mimeType: 'image/jpeg', width: 640, height: 400 }),
  }
  const response = await callZatomMcpTool('modeling_run_provider', {
    providerId: 'zatom.general-2d-interface',
    capability: 'interface.build.hnf2d',
    parameters: {
      top,
      maxAreaMultiple: 2,
      maxPrincipalStrain: 1e-10,
      maxOutputAtoms: 20,
      gapA: 3,
      vacuumA: 10,
    },
    applyToWorkspace: true,
    captureAfter: false,
  }, context)
  assertTrue(response.structuredContent.ok)
  const data = response.structuredContent.data as {
    applicationBlocked: boolean
    applicationVerified: boolean | null
    result: {
      structure: ZatomStructure
      checks: Array<{ id: string; status: string }>
      details: {
        match: { bottomMatrix: number[][]; topMatrix: number[][]; maxAbsPrincipalStrain: number }
        metrics: { measuredGapA: number; measuredVacuumA: number }
      }
      inspectionTargets: Array<{ id: string; reason: string; center: [number, number, number]; radius: number; atomIds: string[] }>
    }
  }
  assertEqual(data.applicationBlocked, false)
  assertEqual(data.applicationVerified, true)
  assertEqual(data.result.structure.atoms.length, 3)
  assertDeepEqual(data.result.details.match.bottomMatrix, [[1, 0], [0, 1]])
  assertDeepEqual(data.result.details.match.topMatrix, [[1, 0], [-1, 2]])
  assertTrue(data.result.details.match.maxAbsPrincipalStrain < 1e-12)
  assertTrue(Math.abs(data.result.details.metrics.measuredGapA - 3) < 1e-10)
  assertTrue(Math.abs(data.result.details.metrics.measuredVacuumA - 10) < 1e-10)
  assertTrue(data.result.checks.some((check) => check.id === 'general_interface.supercell_counts' && check.status === 'pass'))
  assertTrue(data.result.checks.some((check) => check.id === 'general_interface.inplane_strain' && check.status === 'pass'))
  const target = data.result.inspectionTargets.find((item) => item.id === 'general-interface-contact')
  assertTrue(!!target && target.atomIds.length === 3)
  const focus = await callZatomMcpTool('viewer_focus_target', {
    inspectionTarget: target!,
    expectedStructureFingerprint: fingerprintStructure(data.result.structure),
    captureAfter: true,
  }, context)
  assertTrue(focus.structuredContent.ok)
  assertDeepEqual(focused, target!.center)
  assertEqual(focus.content.filter((block) => block.type === 'image').length, 1)
}

async function testGeneralInterfaceStrainGateBlocksBadExplicitMatrices() {
  const bottom = generalInterfaceMonolayer('square-bottom-bad', [1, 0, 0], [0, 1, 0], 'C')
  const top = generalInterfaceMonolayer('oblique-top-bad', [1, 0, 0], [0.5, 0.5, 0], 'Si')
  let writes = 0
  const response = await callZatomMcpTool('modeling_run_provider', {
    providerId: 'zatom.general-2d-interface',
    capability: 'interface.build.hnf2d',
    structure: bottom,
    parameters: {
      top,
      bottomMatrix: [[1, 0], [0, 1]],
      topMatrix: [[1, 0], [0, 1]],
      maxAreaMultiple: 2,
      maxPrincipalStrain: 0.01,
    },
    applyToWorkspace: true,
  }, { writeStructure: () => { writes++ } })
  assertTrue(response.structuredContent.ok)
  const data = response.structuredContent.data as {
    applicationBlocked: boolean
    result: { checks: Array<{ id: string; status: string }> }
  }
  assertEqual(data.applicationBlocked, true)
  assertEqual(writes, 0)
  assertTrue(data.result.checks.some((check) => check.id === 'general_interface.inplane_strain' && check.status === 'fail'))
  assertTrue(data.result.checks.some((check) => check.id === 'candidate.application_gate' && check.status === 'fail'))
}

async function testDishonestProviderCannotBypassBrokerGate() {
  const provider: ZatomModelingProvider = {
    manifest: {
      schemaVersion: ZATOM_PROVIDER_SCHEMA,
      id: 'test.invalid-output',
      title: 'Invalid output test provider',
      description: 'Returns a structurally invalid candidate to exercise broker enforcement.',
      adapterVersion: '1.0.0',
      engine: { name: 'test-engine', version: '0.0.0' },
      execution: 'browser',
      capabilities: [{
        id: 'test.invalid-structure',
        title: 'Return invalid structure',
        description: 'Test-only capability.',
        fidelity: 'geometric',
        source: 'none',
        deterministic: true,
        inputSchema: { type: 'object' },
        requiredCheckIds: ['test.domain_check'],
        tags: ['test'],
      }],
    },
    execute: async () => ({
      structure: {
        schemaVersion: ZATOM_STRUCTURE_SCHEMA,
        atoms: [
          { id: 'duplicate', element: 'H', position: [0, 0, 0] },
          { id: 'duplicate', element: 'H', position: [0.01, 0, 0] },
        ],
      },
      checks: [],
    }),
  }
  const unregister = registerZatomModelingProvider(provider)
  let writes = 0
  try {
    const response = await callZatomMcpTool('modeling_run_provider', {
      providerId: provider.manifest.id,
      capability: 'test.invalid-structure',
      parameters: {},
      applyToWorkspace: true,
    }, { writeStructure: () => { writes++ } })
    assertTrue(response.structuredContent.ok, 'a rejected candidate remains inspectable rather than becoming a transport error')
    const data = response.structuredContent.data as {
      applicationBlocked: boolean
      result: { checks: Array<{ id: string; status: string }> }
    }
    assertEqual(data.applicationBlocked, true)
    assertEqual(writes, 0)
    assertTrue(data.result.checks.some((check) => check.id === 'provider.required_domain_checks' && check.status === 'fail'))
    assertTrue(data.result.checks.some((check) => check.id === 'structure.atom_ids_unique' && check.status === 'fail'))
    assertTrue(data.result.checks.some((check) => check.id === 'structure.minimum_distance' && check.status === 'fail'))
  } finally {
    unregister()
  }
}

async function testProviderParametersAreValidatedBeforeExecution() {
  let executions = 0
  const provider: ZatomModelingProvider = {
    manifest: {
      schemaVersion: ZATOM_PROVIDER_SCHEMA,
      id: 'test.parameter-schema',
      title: 'Parameter schema test provider',
      description: 'Rejects misspelled and out-of-range parameters before adapter execution.',
      adapterVersion: '1.0.0',
      engine: { name: 'test-engine', version: '0.0.0' },
      execution: 'browser',
      capabilities: [{
        id: 'test.parameters',
        title: 'Validate provider parameters',
        description: 'Test-only capability.',
        fidelity: 'geometric',
        source: 'none',
        deterministic: true,
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['iterations'],
          properties: { iterations: { type: 'integer', minimum: 1, maximum: 10 } },
        },
        requiredCheckIds: [],
        tags: ['test'],
      }],
    },
    execute: async () => {
      executions++
      return {
        structure: {
          schemaVersion: ZATOM_STRUCTURE_SCHEMA,
          atoms: [{ id: 'parameter-test', element: 'H', position: [0, 0, 0] }],
        },
        checks: [],
      }
    },
  }
  const unregister = registerZatomModelingProvider(provider)
  try {
    const response = await callZatomMcpTool('modeling_run_provider', {
      providerId: provider.manifest.id,
      capability: 'test.parameters',
      parameters: { iterations: 0, iteratons: 4 },
    })
    assertEqual(response.structuredContent.ok, false)
    assertEqual(response.structuredContent.error?.code, 'invalid_provider_parameters')
    assertEqual(executions, 0)
  } finally {
    unregister()
  }
}

async function main() {
  await testProviderDiscoveryExposesRoutingContracts()
  await testDiscoveredProviderIdentityAndCoverageAreRechecked()
  await testPackingIsDeterministicAndPreservesTopology()
  await testProviderApplyIsReReadAndCaptured()
  await testHostWriteAndReadbackFailuresRemainAuditable()
  await testDislocationProviderReportsDefinitionLevelChecks()
  await testObsoleteIsotropicDipoleInputIsRejected()
  await testCommensurateMoireProviderReportsExactCellMetrics()
  await testMoireTwistGateBlocksAnUnderResolvedCell()
  await testMoireCandidateCanBeAppliedFocusedAndCaptured()
  await testSmoothFieldProviderAppliesAuditsFocusesAndCaptures()
  await testSmoothFieldFoldoverCannotReachTheViewport()
  await testGeneralInterfaceProviderFindsOffDiagonalMatchAndFocuses()
  await testGeneralInterfaceStrainGateBlocksBadExplicitMatrices()
  await testProviderParametersAreValidatedBeforeExecution()
  await testDishonestProviderCannotBypassBrokerGate()
}

void main()
