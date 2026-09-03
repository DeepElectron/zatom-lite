import { assertDeepEqual, assertEqual, assertTrue } from '../../testing/assert'
import {
  composeZatomContinuumDislocationEvidence,
  fingerprintContinuumDislocationEvidence,
  parseZatomContinuumDislocationEvidence,
  type ZatomContinuumDislocationEvidence,
  ZatomContinuumDislocationEvidenceInputError,
  ZATOM_ATOMSK_STRESS_PROPERTIES,
} from '../continuum-dislocation-evidence'
import type { ZatomStructure } from '../contracts'
import { ZATOM_PROVIDER_SCHEMA, type ZatomModelingProvider } from '../provider'
import { callZatomMcpTool } from '../mcp-adapter'
import { registerZatomModelingProvider } from '../provider-tools'

const stiffness = [
  [243, 145, 145, 0, 0, 0],
  [145, 243, 145, 0, 0, 0],
  [145, 145, 243, 0, 0, 0],
  [0, 0, 0, 119, 0, 0],
  [0, 0, 0, 0, 119, 0],
  [0, 0, 0, 0, 0, 119],
] as const

function sourceStructure(): ZatomStructure {
  return {
    schemaVersion: 'zatom.structure/v1',
    label: 'continuum source',
    atoms: [
      { id: 'a', element: 'Fe', position: [1, 1, 1], properties: { site: 0 } },
      { id: 'b', element: 'Fe', position: [8, 1, 3], properties: { site: 1 } },
      { id: 'c', element: 'Fe', position: [1, 8, 6], properties: { site: 2 } },
      { id: 'd', element: 'Fe', position: [8, 8, 8], properties: { site: 3 } },
    ],
    bonds: [],
    lattice: { vectors: [[10, 0, 0], [0, 10, 0], [0, 0, 10]], periodic: [true, true, true] },
    metadata: { fixture: 'continuum-dislocation' },
  }
}

function resultStructure(source: ZatomStructure): ZatomStructure {
  const stressValues = [1, 2, 3, 4]
  return {
    ...structuredClone(source),
    label: 'continuum result',
    atoms: source.atoms.map((atom, index) => ({
      ...structuredClone(atom),
      position: [atom.position[0] + 0.1 * (index + 1), atom.position[1], atom.position[2] + 0.02 * index],
      properties: {
        ...(structuredClone(atom.properties) ?? {}),
        [ZATOM_ATOMSK_STRESS_PROPERTIES.xx]: { kind: 'scalar', value: stressValues[index] },
        [ZATOM_ATOMSK_STRESS_PROPERTIES.yy]: { kind: 'scalar', value: stressValues[index] / 2 },
        [ZATOM_ATOMSK_STRESS_PROPERTIES.zz]: { kind: 'scalar', value: -stressValues[index] / 4 },
        [ZATOM_ATOMSK_STRESS_PROPERTIES.yz]: { kind: 'scalar', value: 0.1 * index },
        [ZATOM_ATOMSK_STRESS_PROPERTIES.xz]: { kind: 'scalar', value: 0.2 * index },
        [ZATOM_ATOMSK_STRESS_PROPERTIES.xy]: { kind: 'scalar', value: 0.3 * index },
      },
    })),
    lattice: { ...structuredClone(source.lattice!), periodic: [false, false, false] },
    metadata: { fixture: 'continuum-dislocation-result' },
  }
}

function compose(source = sourceStructure(), result = resultStructure(source)) {
  return composeZatomContinuumDislocationEvidence({
    sourceStructure: source,
    resultStructure: result,
    elasticity: {
      model: 'anisotropic-linear-elasticity',
      coordinateFrame: 'source-cartesian',
      voigtOrder: ['xx', 'yy', 'zz', 'yz', 'xz', 'xy'],
      stiffnessMatrixGPa: stiffness.map((row) => [...row]) as ZatomContinuumDislocationEvidence['elasticity']['stiffnessMatrixGPa'],
    },
    defect: {
      kind: 'straight',
      lineAxis: 'z',
      glidePlaneNormalAxis: 'y',
      corePositionA: [5.1, 5.2, 5],
      burgersVectorA: [0.5, 0, 1],
    },
    mapping: { mode: 'source-index-auxiliary-readback' },
    boundary: { mode: 'finite' },
    acceptance: {
      maximumCellOffAxisA: 1e-10,
      maximumTensorSymmetryResidualGPa: 1e-10,
      minimumStiffnessEigenvalueGPa: 1,
      maximumStiffnessConditionNumber: 100,
      maximumGlidePlaneResidualA: 1e-10,
      minimumTransverseExtentPerBurgers: 3,
      minimumCoreClearanceA: 0.1,
      maximumDisplacementA: 2,
      minimumPairDistanceA: 0.5,
      maximumAbsoluteStressGPa: 100,
    },
    provenance: {
      engine: 'Atomsk',
      engineVersion: 'Beta 0.13.1',
      method: 'fixture anisotropic straight dislocation',
      executable: {
        realPath: '/opt/pinned/atomsk',
        sha256: `sha256:${'a'.repeat(64)}`,
      },
      artifacts: [{ id: 'atomsk.executable', role: 'scientific-runtime-identity', fingerprint: `sha256:${'a'.repeat(64)}` }],
      parameters: { fixture: true },
      citations: ['https://atomsk.univ-lille.fr/doc/en/option_disloc.html'],
      scopeWarning: 'Fixture continuum field is unrelaxed and does not prove a stable core.',
    },
    metadata: { fixture: true },
  })
}

async function testCanonicalReplayAndAdversarialDrift(): Promise<void> {
  const source = sourceStructure()
  const result = resultStructure(source)
  const validation = compose(source, result)
  assertEqual(validation.evidence.defect.character, 'mixed')
  assertEqual(validation.evidence.defect.transverseAxis, 'x')
  assertEqual(validation.evidence.defect.glidePlaneResidualA, 0)
  assertEqual(validation.evidence.mapping.atomCount, 4)
  assertEqual(validation.evidence.metrics.pairEvaluationCount, 6)
  assertEqual(validation.evidence.metrics.acceptancePassed, true)
  assertTrue(validation.evidence.metrics.minimumStiffnessEigenvalueGPa > 0)
  assertTrue(validation.checks.some((check) => check.id === 'continuum_dislocation.model_scope' && check.status === 'warn'))
  assertTrue(validation.inspectionTargets.some((target) => target.id === 'continuum-dislocation-core'))
  assertTrue(validation.inspectionTargets.some((target) => target.id === 'continuum-dislocation-maximum-stress'))
  const replay = parseZatomContinuumDislocationEvidence(validation.evidence, {
    sourceStructure: source,
    resultStructure: result,
  })
  assertEqual(replay.fingerprint, validation.fingerprint)
  assertEqual(fingerprintContinuumDislocationEvidence(replay.evidence), validation.fingerprint)

  const derivedDrift = structuredClone(validation.evidence)
  derivedDrift.metrics.maximumDisplacementA += 1
  let derivedError: unknown
  try {
    parseZatomContinuumDislocationEvidence(derivedDrift, { sourceStructure: source, resultStructure: result })
  } catch (error) {
    derivedError = error
  }
  assertTrue(derivedError instanceof ZatomContinuumDislocationEvidenceInputError)
  assertEqual((derivedError as ZatomContinuumDislocationEvidenceInputError).code, 'continuum_dislocation_derived_mismatch')

  const geometryDrift = structuredClone(result)
  geometryDrift.atoms[0].position[0] += 0.2
  let geometryError: unknown
  try {
    parseZatomContinuumDislocationEvidence(validation.evidence, {
      sourceStructure: source,
      resultStructure: geometryDrift,
    })
  } catch (error) {
    geometryError = error
  }
  assertTrue(geometryError instanceof ZatomContinuumDislocationEvidenceInputError)

  const stressDrift = structuredClone(result)
  delete stressDrift.atoms[0].properties![ZATOM_ATOMSK_STRESS_PROPERTIES.xx]
  let stressError: unknown
  try {
    compose(source, stressDrift)
  } catch (error) {
    stressError = error
  }
  assertTrue(stressError instanceof ZatomContinuumDislocationEvidenceInputError)
  assertEqual((stressError as ZatomContinuumDislocationEvidenceInputError).code, 'continuum_dislocation_stress_field_mismatch')

  const lineAxisCoreOutsideCell = structuredClone(validation.evidence)
  lineAxisCoreOutsideCell.defect.corePositionA[2] = 10
  let coreError: unknown
  try {
    parseZatomContinuumDislocationEvidence(lineAxisCoreOutsideCell, {
      sourceStructure: source,
      resultStructure: result,
    })
  } catch (error) {
    coreError = error
  }
  assertTrue(coreError instanceof ZatomContinuumDislocationEvidenceInputError)
  assertEqual((coreError as ZatomContinuumDislocationEvidenceInputError).code, 'continuum_dislocation_geometry_mismatch')

  let budgetError: unknown
  try {
    parseZatomContinuumDislocationEvidence(validation.evidence, {
      sourceStructure: source,
      resultStructure: result,
      maxPairEvaluations: 5,
    })
  } catch (error) {
    budgetError = error
  }
  assertTrue(budgetError instanceof ZatomContinuumDislocationEvidenceInputError)
  assertEqual((budgetError as ZatomContinuumDislocationEvidenceInputError).code, 'continuum_dislocation_budget_exceeded')

  const standalone = await callZatomMcpTool('continuum_dislocation_validate_evidence', {
    evidence: validation.evidence,
    sourceStructure: source,
    resultStructure: result,
    useActiveResult: false,
  })
  assertEqual(standalone.structuredContent.ok, true)
}

function fixtureProvider(
  id: string,
  _source: ZatomStructure,
  result: ZatomStructure,
  evidence: ZatomContinuumDislocationEvidence,
  declared = true,
  omitted = false,
): ZatomModelingProvider {
  return {
    manifest: {
      schemaVersion: ZATOM_PROVIDER_SCHEMA,
      id,
      title: id,
      description: 'continuum-dislocation broker fixture',
      adapterVersion: '1.0.0',
      engine: { name: 'Atomsk', version: 'Beta 0.13.1' },
      execution: 'browser',
      capabilities: [{
        id: 'defect.dislocation.fixture',
        title: 'fixture',
        description: 'fixture',
        fidelity: 'continuum',
        source: 'required',
        deterministic: true,
        inputSchema: { type: 'object' },
        ...(declared ? { outputArtifacts: ['continuum-dislocation-evidence' as const] } : {}),
        requiredCheckIds: [],
        tags: ['fixture'],
      }],
    },
    execute: () => ({
      structure: result,
      ...(!omitted ? { continuumDislocationEvidence: evidence } : {}),
      checks: [],
    }),
  }
}

async function testBrokerContract(): Promise<void> {
  const source = sourceStructure()
  const result = resultStructure(source)
  const validation = compose(source, result)
  const provider = fixtureProvider('test.continuum-dislocation', source, result, validation.evidence)
  const unregister = registerZatomModelingProvider(provider)
  try {
    let active = source
    let writes = 0
    let captures = 0
    const response = await callZatomMcpTool('modeling_run_provider', {
      providerId: provider.manifest.id,
      capability: 'defect.dislocation.fixture',
      structure: source,
      useActiveStructure: false,
      parameters: {},
      seed: 11,
      applyToWorkspace: true,
      captureAfter: true,
    }, {
      readStructure: () => active,
      writeStructure: (structure) => { active = structuredClone(structure); writes++ },
      captureViewport: () => {
        captures++
        return { imageBase64: 'YXRvbXNr', mimeType: 'image/png', width: 320, height: 240 }
      },
    })
    assertEqual(response.structuredContent.ok, true)
    const data = response.structuredContent.data as {
      applicationBlocked: boolean
      result: {
        continuumDislocationEvidence: ZatomContinuumDislocationEvidence
        checks: Array<{ id: string; status: string }>
        provenance: { continuumDislocationEvidenceFingerprint: string }
        inspectionTargets: Array<{ id: string }>
      }
    }
    assertEqual(data.applicationBlocked, false)
    assertEqual(writes, 1)
    assertEqual(captures, 1)
    assertEqual(
      data.result.provenance.continuumDislocationEvidenceFingerprint,
      fingerprintContinuumDislocationEvidence(data.result.continuumDislocationEvidence),
    )
    assertTrue(data.result.checks.some((check) => check.id === 'provider.continuum_dislocation_evidence_contract' && check.status === 'pass'))
    assertTrue(data.result.inspectionTargets.some((target) => target.id === 'continuum-dislocation-core'))
    assertDeepEqual(active.lattice?.periodic, [false, false, false])
  } finally {
    unregister()
  }

  const missing = fixtureProvider('test.continuum-dislocation-missing', source, result, validation.evidence, true, true)
  const unregisterMissing = registerZatomModelingProvider(missing)
  try {
    const response = await callZatomMcpTool('modeling_run_provider', {
      providerId: missing.manifest.id,
      capability: 'defect.dislocation.fixture',
      structure: source,
      useActiveStructure: false,
      parameters: {},
    })
    assertEqual(response.structuredContent.ok, false)
    assertEqual(response.structuredContent.error?.code, 'invalid_provider_result')
  } finally {
    unregisterMissing()
  }

  const undeclared = fixtureProvider('test.continuum-dislocation-undeclared', source, result, validation.evidence, false, false)
  const unregisterUndeclared = registerZatomModelingProvider(undeclared)
  try {
    const response = await callZatomMcpTool('modeling_run_provider', {
      providerId: undeclared.manifest.id,
      capability: 'defect.dislocation.fixture',
      structure: source,
      useActiveStructure: false,
      parameters: {},
    })
    assertEqual(response.structuredContent.ok, false)
    assertEqual(response.structuredContent.error?.code, 'invalid_provider_result')
  } finally {
    unregisterUndeclared()
  }
}

async function main(): Promise<void> {
  await testCanonicalReplayAndAdversarialDrift()
  await testBrokerContract()
  console.log('agent continuum-dislocation evidence tests passed')
}

void main()
