import { assertEqual, assertTrue } from '../../testing/assert'
import type { ZatomStructure } from '../contracts'
import { ZATOM_STRUCTURE_SCHEMA } from '../contracts'
import { callZatomMcpTool } from '../mcp-adapter'
import {
  parseZatomMicroPkaEvidence,
  type ZatomMicroPkaEvidence,
  ZatomMicroPkaEvidenceInputError,
  ZATOM_MICRO_PKA_EVIDENCE_SCHEMA,
} from '../micro-pka-evidence'
import { ZATOM_PROVIDER_SCHEMA, type ZatomModelingProvider } from '../provider'
import { registerZatomModelingProvider } from '../provider-tools'
import { fingerprintStructure } from '../structure-math'

function referenceStructure(): ZatomStructure {
  return {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    label: 'explicit acetic-acid microscopic pKa reference fixture',
    atoms: [
      { id: 'c-methyl', element: 'C', position: [-1.25, 0, 0], properties: { formalCharge: 0 } },
      { id: 'c-carbonyl', element: 'C', position: [0.05, 0, 0], properties: { formalCharge: 0 } },
      { id: 'o-carbonyl', element: 'O', position: [0.75, 1.0, 0], properties: { formalCharge: 0 } },
      { id: 'o-hydroxyl', element: 'O', position: [0.75, -1.0, 0], properties: { formalCharge: 0 } },
      { id: 'h-methyl-1', element: 'H', position: [-1.7, 0.9, 0], properties: { formalCharge: 0 } },
      { id: 'h-methyl-2', element: 'H', position: [-1.7, -0.45, 0.78], properties: { formalCharge: 0 } },
      { id: 'h-methyl-3', element: 'H', position: [-1.7, -0.45, -0.78], properties: { formalCharge: 0 } },
      { id: 'h-acidic', element: 'H', position: [1.7, -0.9, 0], properties: { formalCharge: 0 } },
    ],
    bonds: [
      { id: 'b-cc', atomIds: ['c-methyl', 'c-carbonyl'], order: 1 },
      { id: 'b-co-double', atomIds: ['c-carbonyl', 'o-carbonyl'], order: 2 },
      { id: 'b-co-single', atomIds: ['c-carbonyl', 'o-hydroxyl'], order: 1 },
      { id: 'b-ch-1', atomIds: ['c-methyl', 'h-methyl-1'], order: 1 },
      { id: 'b-ch-2', atomIds: ['c-methyl', 'h-methyl-2'], order: 1 },
      { id: 'b-ch-3', atomIds: ['c-methyl', 'h-methyl-3'], order: 1 },
      { id: 'b-oh', atomIds: ['o-hydroxyl', 'h-acidic'], order: 1 },
    ],
    metadata: {
      'zatom.microPka.referenceCanonicalIsomericSmiles': 'CC(=O)O',
      'zatom.microPka.referenceFormula': 'C2H4O2',
      'zatom.microPka.referenceFormalCharge': 0,
    },
  }
}

function evidence(structure: ZatomStructure): ZatomMicroPkaEvidence {
  return {
    schemaVersion: ZATOM_MICRO_PKA_EVIDENCE_SCHEMA,
    structureFingerprint: fingerprintStructure(structure),
    reference: {
      canonicalIsomericSmiles: 'CC(=O)O',
      formula: 'C2H4O2',
      formalCharge: 0,
      atomCount: 8,
      bondCount: 7,
      heavyAtomCount: 4,
      explicitHydrogenCount: 4,
    },
    siteEnumeration: { complete: true, status: 'Fixture site classifier completed' },
    predictionContext: {
      medium: 'aqueous-like fixture context',
    },
    predictions: [
      {
        id: 'basic-carbonyl-o',
        pKa: -6,
        referenceTransformation: 'protonate-reference',
        reactionAtomId: 'o-carbonyl',
        referenceAtomIndex: 2,
        conjugate: {
          canonicalIsomericSmiles: 'CC(=[OH+])O',
          formula: 'C2H5O2+',
          formalCharge: 1,
        },
      },
      {
        id: 'acidic-hydroxyl-o',
        pKa: 4.76,
        referenceTransformation: 'deprotonate-reference',
        reactionAtomId: 'o-hydroxyl',
        referenceAtomIndex: 3,
        conjugate: {
          canonicalIsomericSmiles: 'CC(=O)[O-]',
          formula: 'C2H3O2-',
          formalCharge: -1,
        },
      },
    ],
    model: {
      name: 'fixture microscopic pKa predictor',
      version: '1.0.0',
      assets: [
        {
          id: 'fixture-pka-model',
          role: 'pKa regression checkpoint',
          bytes: 128,
          sha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        },
      ],
      calibration: {
        metrics: [
          {
            dataset: 'fixture external set',
            metric: 'rmse',
            value: 0.7,
            unit: 'pKa',
            citation: 'urn:zatom:test:micro-pka-calibration',
          },
        ],
        statement: 'Fixture aggregate benchmark metric; it is not a per-prediction error bar.',
      },
      applicability: {
        assessment: 'unknown',
        domain: 'Fixture organic molecules only.',
        reasons: ['No formal per-molecule applicability-domain estimator is available.'],
      },
    },
    provenance: {
      engine: 'fixture-micro-pka',
      engineVersion: '1.0.0',
      method: 'fixture site labels and regression values',
      parameters: { tautomerize: false },
      citations: ['urn:zatom:test:micro-pka-evidence'],
      scopeWarning: 'Fixture site pKa values do not define a complete microstate graph, macroscopic pKa, or pH populations.',
    },
  }
}

function expectInputError(run: () => unknown, code: string): void {
  let observed: unknown
  try {
    run()
  } catch (error) {
    observed = error
  }
  assertTrue(observed instanceof ZatomMicroPkaEvidenceInputError)
  assertEqual((observed as ZatomMicroPkaEvidenceInputError).code, code)
}

async function testCanonicalValidationToolAndBroker(): Promise<void> {
  const structure = referenceStructure()
  const artifact = evidence(structure)
  const parsed = parseZatomMicroPkaEvidence(artifact, { structure })
  assertEqual(parsed.evidence.predictions.length, 2)
  assertEqual(parsed.evidence.predictions[0].id, 'acidic-hydroxyl-o')
  assertTrue(parsed.fingerprint.startsWith('fnv1a64:'))
  assertTrue(parsed.checks.some((check) => check.id === 'micro_pka_evidence.site_mapping' && check.status === 'pass'))
  assertTrue(parsed.checks.some((check) => check.id === 'micro_pka_evidence.prediction_uncertainty' && check.status === 'warn'))
  assertTrue(parsed.checks.some((check) => check.id === 'micro_pka_evidence.population_scope' && check.status === 'skipped'))
  assertTrue(parsed.inspectionTargets.some((target) => target.id === 'micro-pka-reaction-sites'))
  assertTrue(parsed.inspectionTargets.every((target) => target.atomIds.every((id) => structure.atoms.some((atom) => atom.id === id))))

  const reordered = { ...artifact, predictions: [...artifact.predictions].reverse() }
  assertEqual(parseZatomMicroPkaEvidence(reordered, { structure }).fingerprint, parsed.fingerprint)

  const tool = await callZatomMcpTool('micro_pka_validate_evidence', {
    structure,
    evidence: artifact,
    useActiveStructure: false,
  })
  assertTrue(tool.structuredContent.ok, tool.structuredContent.summary)

  const provider: ZatomModelingProvider = {
    manifest: {
      schemaVersion: ZATOM_PROVIDER_SCHEMA,
      id: 'test.micro-pka-output',
      title: 'Microscopic pKa output fixture',
      description: 'Exercise broker validation of canonical microscopic pKa evidence.',
      adapterVersion: '1.0.0',
      engine: { name: 'fixture-micro-pka', version: '1.0.0' },
      execution: 'browser',
      capabilities: [{
        id: 'molecule.predict.fixture-micro-pka',
        title: 'Predict fixture microscopic pKa sites',
        description: 'Return one exact structure plus canonical site evidence.',
        fidelity: 'empirical',
        source: 'none',
        deterministic: true,
        inputSchema: { type: 'object', additionalProperties: false },
        requiredCheckIds: ['fixture.micro_pka'],
        outputArtifacts: ['micro-pka-evidence'],
        tags: ['micro-pka'],
      }],
    },
    execute: () => ({
      structure,
      microPkaEvidence: artifact,
      checks: [{ id: 'fixture.micro_pka', status: 'pass', message: 'Fixture site predictions completed' }],
    }),
  }
  const unregister = registerZatomModelingProvider(provider)
  try {
    const result = await callZatomMcpTool('modeling_run_provider', {
      providerId: provider.manifest.id,
      capability: 'molecule.predict.fixture-micro-pka',
      parameters: {},
      applyToWorkspace: false,
    })
    assertTrue(result.structuredContent.ok, result.structuredContent.summary)
    const data = result.structuredContent.data as {
      result: {
        microPkaEvidence: ZatomMicroPkaEvidence
        provenance: { microPkaEvidenceFingerprint: string }
        checks: Array<{ id: string; status: string }>
      }
    }
    assertEqual(data.result.microPkaEvidence.predictions[0].id, 'acidic-hydroxyl-o')
    assertTrue(data.result.provenance.microPkaEvidenceFingerprint.startsWith('fnv1a64:'))
    assertTrue(data.result.checks.some((check) => (
      check.id === 'provider.micro_pka_evidence_contract' && check.status === 'pass'
    )))
  } finally {
    unregister()
  }
}

function testFailureModes(): void {
  const structure = referenceStructure()
  const artifact = evidence(structure)
  expectInputError(
    () => parseZatomMicroPkaEvidence({ ...artifact, structureFingerprint: 'changed' }, { structure }),
    'micro_pka_structure_mismatch',
  )
  expectInputError(
    () => parseZatomMicroPkaEvidence({
      ...artifact,
      predictions: artifact.predictions.map((prediction) => prediction.id === 'acidic-hydroxyl-o'
        ? { ...prediction, referenceAtomIndex: 2 }
        : prediction),
    }, { structure }),
    'micro_pka_site_mapping_mismatch',
  )
  expectInputError(
    () => parseZatomMicroPkaEvidence({
      ...artifact,
      predictions: artifact.predictions.map((prediction) => prediction.id === 'acidic-hydroxyl-o'
        ? { ...prediction, reactionAtomId: 'o-carbonyl', referenceAtomIndex: 2 }
        : prediction),
    }, { structure }),
    'micro_pka_site_mapping_mismatch',
  )
  expectInputError(
    () => parseZatomMicroPkaEvidence({
      ...artifact,
      predictions: artifact.predictions.map((prediction) => prediction.id === 'acidic-hydroxyl-o'
        ? { ...prediction, conjugate: { ...prediction.conjugate, formula: 'C2H4O2-' } }
        : prediction),
    }, { structure }),
    'micro_pka_conjugate_mismatch',
  )
  expectInputError(
    () => parseZatomMicroPkaEvidence({
      ...artifact,
      predictions: [artifact.predictions[0], { ...artifact.predictions[0], id: 'duplicate-site' }],
    }, { structure }),
    'invalid_micro_pka_evidence',
  )
  expectInputError(
    () => parseZatomMicroPkaEvidence({
      ...artifact,
      model: {
        ...artifact.model,
        calibration: {
          ...artifact.model.calibration,
          metrics: [{ ...artifact.model.calibration.metrics[0], unit: 'dimensionless' }],
        },
      },
    }, { structure }),
    'invalid_micro_pka_evidence',
  )
  expectInputError(
    () => parseZatomMicroPkaEvidence({
      ...artifact,
      model: {
        ...artifact.model,
        calibration: {
          ...artifact.model.calibration,
          metrics: [{ ...artifact.model.calibration.metrics[0], value: -0.1 }],
        },
      },
    }, { structure }),
    'invalid_micro_pka_evidence',
  )
  expectInputError(
    () => parseZatomMicroPkaEvidence({
      ...artifact,
      model: {
        ...artifact.model,
        calibration: {
          ...artifact.model.calibration,
          metrics: [{
            ...artifact.model.calibration.metrics[0],
            metric: 'r2',
            value: 1.01,
            unit: 'dimensionless',
          }],
        },
      },
    }, { structure }),
    'invalid_micro_pka_evidence',
  )
  const metadataMismatch = {
    ...structure,
    metadata: { ...structure.metadata, 'zatom.microPka.referenceFormula': 'C2H3O2-' },
  }
  expectInputError(
    () => parseZatomMicroPkaEvidence({ ...artifact, structureFingerprint: fingerprintStructure(metadataMismatch) }, {
      structure: metadataMismatch,
    }),
    'micro_pka_reference_structure_mismatch',
  )
}

async function main(): Promise<void> {
  await testCanonicalValidationToolAndBroker()
  testFailureModes()
  console.log('agent microscopic pKa evidence tests passed')
}

void main()
