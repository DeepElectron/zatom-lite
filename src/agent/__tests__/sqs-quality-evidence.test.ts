import { assertEqual, assertTrue } from '../../testing/assert'
import type { ZatomStructure } from '../contracts'
import { ZATOM_STRUCTURE_SCHEMA } from '../contracts'
import { callZatomMcpTool } from '../mcp-adapter'
import {
  composeZatomSqsQualityEvidence,
  fingerprintSqsQualityEvidence,
  parseZatomSqsQualityEvidence,
  type ZatomSqsQualityEvidence,
  ZatomSqsQualityEvidenceInputError,
} from '../sqs-quality-evidence'
import { ZATOM_PROVIDER_SCHEMA, type ZatomModelingProvider, ZatomProviderError } from '../provider'
import { registerZatomModelingProvider } from '../provider-tools'

function sourceStructure(): ZatomStructure {
  return {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    label: 'four-site cubic parent',
    lattice: {
      vectors: [[4, 0, 0], [0, 4, 0], [0, 0, 4]],
      periodic: [true, true, true],
    },
    atoms: [
      { id: 'site-1', element: 'Cu', position: [0, 0, 0], properties: { parentSite: 1 } },
      { id: 'site-2', element: 'Cu', position: [2, 0, 0], properties: { parentSite: 2 } },
      { id: 'site-3', element: 'Cu', position: [0, 2, 0], properties: { parentSite: 3 } },
      { id: 'site-4', element: 'Cu', position: [0, 0, 2], properties: { parentSite: 4 } },
    ],
    metadata: { fixture: 'sqs-quality-source' },
  }
}

function resultStructure(source = sourceStructure()): ZatomStructure {
  return {
    ...source,
    label: 'four-site CuAu SQS candidate',
    atoms: source.atoms.map((atom, index) => ({
      ...atom,
      element: index % 2 === 0 ? 'Au' : 'Cu',
      properties: atom.properties ? { ...atom.properties } : undefined,
      position: [...atom.position],
    })),
    metadata: { fixture: 'sqs-quality-result' },
  }
}

function composeEvidence(source = sourceStructure(), result = resultStructure(source)) {
  return composeZatomSqsQualityEvidence({
    sourceStructure: source,
    resultStructure: result,
    occupation: {
      mode: 'relabel-only',
      sublattices: [{
        id: 'A',
        atomIds: result.atoms.map((atom) => atom.id),
        allowedSpecies: ['Cu', 'Au'],
        requestedFractions: { Au: 0.5, Cu: 0.5 },
        realizedCounts: { Au: 2, Cu: 2 },
        realizedFractions: { Au: 0.5, Cu: 0.5 },
        maximumFractionError: 0,
      }],
    },
    clusterSpace: {
      basis: 'icet-orthogonal-cluster-vector',
      symmetry: {
        kind: 'space-group-orbits',
        spaceGroup: 'Pm-3m (221)',
        symprecA: 1e-5,
        positionToleranceA: 1e-5,
      },
      cutoffsA: [3],
      maximumOrder: 2,
      completeThroughDeclaredCutoffs: true,
      components: [
        {
          index: 0,
          orbitIndex: -1,
          order: 0,
          radiusA: 0,
          multiplicity: 1,
          multicomponentVector: '.',
          sublattices: ['.'],
          target: 1,
          actual: 1,
          absoluteError: 0,
        },
        {
          index: 1,
          orbitIndex: 0,
          order: 1,
          radiusA: 0,
          multiplicity: 1,
          multicomponentVector: '[0]',
          sublattices: ['A'],
          target: 0,
          actual: 0,
          absoluteError: 0,
          representativeAtomIds: ['site-1'],
        },
        {
          index: 2,
          orbitIndex: 1,
          order: 2,
          radiusA: 2,
          multiplicity: 3,
          multicomponentVector: '[0, 0]',
          sublattices: ['A', 'A'],
          target: 0,
          actual: 0.1,
          absoluteError: 0.1,
          representativeAtomIds: ['site-1', 'site-2'],
        },
      ],
    },
    objective: {
      kind: 'walle-2013-cluster-vector',
      value: 999,
      tolerance: 1e-5,
      optimalityWeight: 1,
    },
    acceptance: {
      maximumCompositionFractionError: 0,
      maximumAbsoluteClusterError: 0.11,
      maximumRmsClusterError: 0.06,
      requireCompleteThroughDeclaredCutoffs: true,
    },
    search: {
      algorithm: 'fixture-simulated-annealing',
      seed: 42,
      deterministic: true,
      exhaustive: false,
      steps: 1000,
      candidateCount: 1,
      selectedCandidateIndex: 0,
      scopeWarning: 'A finite seeded anneal is replayable but does not prove the global optimum.',
    },
    provenance: {
      engine: 'fixture-icet',
      engineVersion: '3.2',
      method: 'fixed-cell cluster-vector SQS fixture',
      artifacts: [],
      parameters: { cutoffsA: [3], nSteps: 1000 },
      citations: ['https://icet.materialsmodeling.org/advanced_topics/sqs_generation.html'],
      scopeWarning: 'Cluster-vector agreement does not prove a converged cluster expansion or thermodynamic representativeness.',
    },
  })
}

function testCanonicalEvidenceAndDriftRejection(): void {
  const source = sourceStructure()
  const result = resultStructure(source)
  const validation = composeEvidence(source, result)
  assertEqual(validation.evidence.clusterSpace.componentCount, 3)
  assertEqual(validation.evidence.metrics.maximumAbsoluteClusterError, 0.1)
  assertTrue(Math.abs(validation.evidence.metrics.rmsClusterError - Math.sqrt(0.01 / 3)) < 1e-12)
  assertEqual(validation.evidence.objective.value, 0.1)
  assertEqual(validation.evidence.metrics.longestPerfectPairRadiusA, 0)
  assertTrue(validation.checks.some((check) => check.id === 'sqs_quality_evidence.correlation_error' && check.status === 'pass'))
  assertTrue(validation.checks.some((check) => check.id === 'sqs_quality_evidence.search_scope' && check.status === 'warn'))
  assertTrue(validation.inspectionTargets.some((target) => target.id === 'sqs-quality-worst-component'))
  const replay = parseZatomSqsQualityEvidence(validation.evidence, {
    sourceStructure: source,
    resultStructure: result,
  })
  assertEqual(replay.fingerprint, validation.fingerprint)
  assertEqual(fingerprintSqsQualityEvidence(replay.evidence), validation.fingerprint)

  const strict = structuredClone(validation.evidence)
  strict.acceptance.maximumAbsoluteClusterError = 0.01
  const strictValidation = parseZatomSqsQualityEvidence(strict, {
    sourceStructure: source,
    resultStructure: result,
  })
  assertTrue(strictValidation.checks.some((check) => check.id === 'sqs_quality_evidence.correlation_error' && check.status === 'fail'))

  const componentDrift = structuredClone(validation.evidence)
  componentDrift.clusterSpace.components[2].actual = 0.2
  let componentError: unknown
  try {
    parseZatomSqsQualityEvidence(componentDrift, { sourceStructure: source, resultStructure: result })
  } catch (error) {
    componentError = error
  }
  assertTrue(componentError instanceof ZatomSqsQualityEvidenceInputError)
  assertEqual((componentError as ZatomSqsQualityEvidenceInputError).code, 'sqs_quality_component_mismatch')

  const movedResult = structuredClone(result)
  movedResult.atoms[0].position[0] += 1e-3
  let geometryError: unknown
  try {
    parseZatomSqsQualityEvidence(validation.evidence, {
      sourceStructure: source,
      resultStructure: movedResult,
    })
  } catch (error) {
    geometryError = error
  }
  assertTrue(geometryError instanceof ZatomSqsQualityEvidenceInputError)
  assertEqual((geometryError as ZatomSqsQualityEvidenceInputError).code, 'sqs_quality_structure_mismatch')

  let budgetError: unknown
  try {
    parseZatomSqsQualityEvidence(validation.evidence, {
      sourceStructure: source,
      resultStructure: result,
      maxComponents: 2,
    })
  } catch (error) {
    budgetError = error
  }
  assertTrue(budgetError instanceof ZatomSqsQualityEvidenceInputError)
  assertEqual((budgetError as ZatomSqsQualityEvidenceInputError).code, 'sqs_quality_budget_exceeded')
}

async function testManifestAndBrokerFailureModes(): Promise<void> {
  const source = sourceStructure()
  const result = resultStructure(source)
  const evidence = composeEvidence(source, result).evidence
  const capability = {
    id: 'alloy.sqs.failure-fixture',
    title: 'Failure fixture SQS',
    description: 'Exercise SQS artifact failure modes.',
    fidelity: 'statistical' as const,
    source: 'required' as const,
    deterministic: true,
    inputSchema: { type: 'object', additionalProperties: false },
    outputArtifacts: ['sqs-quality-evidence' as const],
    requiredCheckIds: ['fixture.sqs'],
    tags: ['sqs', 'fixture'],
  }
  const invalidManifest: ZatomModelingProvider = {
    manifest: {
      schemaVersion: ZATOM_PROVIDER_SCHEMA,
      id: 'test.sqs-invalid-manifest',
      title: 'Invalid SQS manifest',
      description: 'Invalid source-free SQS artifact declaration.',
      adapterVersion: '1.0.0',
      engine: { name: 'fixture', version: '1' },
      execution: 'browser',
      capabilities: [{ ...capability, source: 'none' }],
    },
    execute: () => ({ structure: result, sqsQualityEvidence: evidence, checks: [] }),
  }
  let manifestError: unknown
  try {
    registerZatomModelingProvider(invalidManifest)
  } catch (error) {
    manifestError = error
  }
  assertTrue(manifestError instanceof ZatomProviderError)
  assertEqual((manifestError as ZatomProviderError).code, 'invalid_provider_manifest')

  const cases: Array<{
    id: string
    outputArtifacts?: Array<'sqs-quality-evidence'>
    artifact: ZatomSqsQualityEvidence | undefined
  }> = [
    { id: 'test.sqs-missing-artifact', outputArtifacts: ['sqs-quality-evidence'], artifact: undefined },
    { id: 'test.sqs-undeclared-artifact', artifact: evidence },
    {
      id: 'test.sqs-fingerprint-drift',
      outputArtifacts: ['sqs-quality-evidence'],
      artifact: { ...evidence, clusterSpaceFingerprint: 'fnv1a64:0000000000000000' },
    },
  ]
  for (const item of cases) {
    const provider: ZatomModelingProvider = {
      manifest: {
        schemaVersion: ZATOM_PROVIDER_SCHEMA,
        id: item.id,
        title: 'SQS broker failure fixture',
        description: 'Exercise one broker artifact failure.',
        adapterVersion: '1.0.0',
        engine: { name: 'fixture', version: '1' },
        execution: 'browser',
        capabilities: [{
          ...capability,
          ...(item.outputArtifacts ? { outputArtifacts: item.outputArtifacts } : { outputArtifacts: undefined }),
        }],
      },
      execute: () => ({
        structure: result,
        ...(item.artifact ? { sqsQualityEvidence: item.artifact } : {}),
        checks: [{ id: 'fixture.sqs', status: 'pass', message: 'Fixture ran' }],
      }),
    }
    const unregister = registerZatomModelingProvider(provider)
    try {
      const response = await callZatomMcpTool('modeling_run_provider', {
        providerId: item.id,
        capability: capability.id,
        structure: source,
        useActiveStructure: false,
        parameters: {},
        applyToWorkspace: false,
      })
      assertEqual(response.structuredContent.ok, false)
      assertEqual(response.structuredContent.error?.code, 'invalid_provider_result')
    } finally {
      unregister()
    }
  }
}

async function testMcpAndProviderBrokerIntegration(): Promise<void> {
  const source = sourceStructure()
  const result = resultStructure(source)
  const validation = composeEvidence(source, result)
  const standalone = await callZatomMcpTool('sqs_validate_quality_evidence', {
    evidence: validation.evidence,
    sourceStructure: source,
    resultStructure: result,
    useActiveResult: false,
  })
  assertTrue(standalone.structuredContent.ok, standalone.structuredContent.summary)

  const provider: ZatomModelingProvider = {
    manifest: {
      schemaVersion: ZATOM_PROVIDER_SCHEMA,
      id: 'test.sqs-quality-evidence',
      title: 'SQS quality evidence fixture',
      description: 'Returns canonical structure-bound SQS quality evidence.',
      adapterVersion: '1.0.0',
      engine: { name: 'fixture-icet', version: '3.2' },
      execution: 'browser',
      capabilities: [{
        id: 'alloy.sqs.fixture',
        title: 'Fixture SQS',
        description: 'Exercise broker-bound SQS evidence.',
        fidelity: 'statistical',
        source: 'required',
        deterministic: true,
        inputSchema: { type: 'object', additionalProperties: false },
        outputArtifacts: ['sqs-quality-evidence'],
        requiredCheckIds: ['fixture.sqs'],
        tags: ['sqs', 'fixture'],
      }],
    },
    execute: (request) => {
      const exactSource = request.source!
      const exactResult = resultStructure(exactSource)
      return {
        structure: exactResult,
        sqsQualityEvidence: composeEvidence(exactSource, exactResult).evidence,
        checks: [{ id: 'fixture.sqs', status: 'pass', message: 'Fixture generated an SQS candidate' }],
      }
    },
  }
  const unregister = registerZatomModelingProvider(provider)
  try {
    let writes = 0
    let captures = 0
    let active = source
    const response = await callZatomMcpTool('modeling_run_provider', {
      providerId: provider.manifest.id,
      capability: 'alloy.sqs.fixture',
      parameters: {},
      seed: 42,
      applyToWorkspace: true,
      captureAfter: true,
    }, {
      readStructure: () => active,
      writeStructure: (structure) => { active = structure; writes++ },
      captureViewport: () => {
        captures++
        return { imageBase64: 'fixture', mimeType: 'image/png', width: 32, height: 32 }
      },
    })
    assertTrue(response.structuredContent.ok, response.structuredContent.summary)
    const data = response.structuredContent.data as {
      result: {
        sqsQualityEvidence: ZatomSqsQualityEvidence
        checks: Array<{ id: string; status: string }>
        provenance: { sqsQualityEvidenceFingerprint: string }
      }
    }
    assertEqual(writes, 1)
    assertEqual(captures, 1)
    assertEqual(response.content.filter((block) => block.type === 'image').length, 1)
    assertEqual(
      data.result.provenance.sqsQualityEvidenceFingerprint,
      fingerprintSqsQualityEvidence(data.result.sqsQualityEvidence),
    )
    assertTrue(data.result.checks.some((check) => check.id === 'provider.sqs_quality_evidence_contract' && check.status === 'pass'))
    assertTrue(data.result.checks.some((check) => check.id === 'sqs_quality_evidence.structure_binding' && check.status === 'pass'))
  } finally {
    unregister()
  }
}

async function main(): Promise<void> {
  testCanonicalEvidenceAndDriftRejection()
  await testManifestAndBrokerFailureModes()
  await testMcpAndProviderBrokerIntegration()
  console.log('agent SQS quality evidence tests passed')
}

void main()
