/**
 * Validate request shapes for all seven pipelines against the real API.
 *
 * The free `/estimate-cost` endpoint performs full request validation. Run this script after
 * changing boltz-requests.ts to catch rejected shapes without submitting real jobs.
 *
 *   BOLTZ_API_KEY=sk_... pnpm exec tsx scripts/verify-boltz-contracts.mts
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { getPipeline, PIPELINES, type BoltzPipelineId } from '../src/services/boltz-pipelines'
import {
  buildAdmeBody,
  buildPredictionBody,
  buildProteinDesignBody,
  buildProteinScreenBody,
  buildSequenceRedesignBody,
  buildSmallMoleculeDesignBody,
  buildSmallMoleculeScreenBody,
  buildTemplateBinderDesignBody,
  checkSequenceRedesignRequest,
  checkTemplateBinderRequest,
} from '../src/services/boltz-requests'
import { BOLTZ_API_ORIGIN } from '../src/services/boltz-endpoints'
import { mmcifToPdbText } from '../src/lib/biomolecule/mmcif'
import { parseLegacyPdb } from '../src/lib/biomolecule/pdb'
import { exportTemplateMmcif, templateChainSummaries } from '../src/lib/biomolecule/mmcif-export'

const apiKey = process.env.BOLTZ_API_KEY
if (!apiKey) {
  console.error('Set BOLTZ_API_KEY to run the contract check.')
  process.exit(1)
}

const TARGET = 'MKTAYIAKQRQISFVKSHFSRQDILDLWIYHTQGYFPDWQNY'
const protein = (value: string, chain: string) =>
  ({ type: 'protein' as const, value, chain_ids: [chain] })

/**
 * Redesign requires a real CIF. The service needs `_entity_poly`, `_struct_asym`, and
 * `_pdbx_poly_seq_scheme` sequence metadata in addition to atomic coordinates; an
 * `_atom_site`-only CIF is rejected.
 *
 * This fixture is a real Boltz-designed target/binder complex with two protein chains and no
 * ligand, because redesign also rejects structures containing unknown CCD ligands.
 */
const MINIMAL_COMPLEX_CIF = readFileSync(
  fileURLToPath(new URL('./fixtures/boltz-redesign-complex.cif', import.meta.url)),
  'utf8',
)

/**
 * Build template text through the application's real mmCIF -> PDB -> parse -> export path.
 *
 * Sending the fixture directly would only prove that Boltz accepts the fixture. The round trip
 * verifies that exportTemplateMmcif produces an accepted combination of `_entity_poly_seq`,
 * `_struct_asym`, and `_atom_site` records.
 */
const TEMPLATE_STRUCTURE = parseLegacyPdb(mmcifToPdbText(MINIMAL_COMPLEX_CIF))
const TEMPLATE_CHAINS = templateChainSummaries(TEMPLATE_STRUCTURE)
const TEMPLATE_CIF = exportTemplateMmcif(TEMPLATE_STRUCTURE)
const [TEMPLATE_TARGET, TEMPLATE_BINDER] = TEMPLATE_CHAINS
if (!TEMPLATE_TARGET || !TEMPLATE_BINDER) {
  throw new Error('template fixture must expose at least two polymer chains')
}

/** Shared template-binder inputs; individual cases vary only the motif or epitope. */
const templateBinderBase = {
  templateCif: TEMPLATE_CIF,
  targetChainId: TEMPLATE_TARGET.chainId,
  binderChainId: TEMPLATE_BINDER.chainId,
  numProteins: 10,
  modality: 'nanobody' as const,
  epitopeResidues: [10, 11, 12],
}

const cases: { id: BoltzPipelineId; label: string; body: unknown }[] = [
  {
    id: 'structure-and-binding',
    label: 'prediction + affinity + multi-sample',
    body: buildPredictionBody({
      entities: [protein('MKTAYIAKQRQISFVKSHFSRQ', 'A'), { type: 'ligand_smiles', value: 'CC(=O)Oc1ccccc1C(=O)O', chain_ids: ['B'] }],
      binderChainId: 'B',
      numSamples: 2,
    }),
  },
  { id: 'adme', label: 'adme', body: buildAdmeBody({ smiles: ['CC(=O)Oc1ccccc1C(=O)O'] }) },
  {
    id: 'small-molecule-design',
    label: 'ligand design + pocket constraint',
    body: buildSmallMoleculeDesignBody({
      targetEntities: [protein(TARGET, 'A')],
      numMolecules: 10,
      pocketResidues: { A: [10, 11, 12] },
      designedChainId: 'L',
    }),
  },
  {
    id: 'small-molecule-design',
    label: 'ligand design without pocket',
    body: buildSmallMoleculeDesignBody({ targetEntities: [protein(TARGET, 'A')], numMolecules: 10 }),
  },
  {
    id: 'small-molecule-library-screen',
    label: 'ligand screen + pocket constraint',
    body: buildSmallMoleculeScreenBody({
      targetEntities: [protein(TARGET, 'A')],
      smiles: ['CCO', 'CC(=O)Oc1ccccc1C(=O)O'],
      pocketResidues: { A: [10, 11, 12] },
    }),
  },
  {
    id: 'protein-design',
    label: 'binder design + epitope',
    body: buildProteinDesignBody({
      targetEntities: [protein(TARGET, 'A')],
      numProteins: 10,
      epitopeResidues: { A: [10, 11, 12] },
      binderLengthRange: '12..16',
      binderChainId: 'B',
    }),
  },
  {
    id: 'protein-library-screen',
    label: 'protein screen',
    body: buildProteinScreenBody({
      targetEntities: [protein(TARGET, 'A')],
      sequences: ['MKTAYIVKSHFSRQ', 'MKTAYIAKQRQIS'],
      candidateChainId: 'B',
    }),
  },
  {
    id: 'protein-sequence-redesign',
    label: 'sequence redesign (inline CIF)',
    body: buildSequenceRedesignBody({
      structureCif: MINIMAL_COMPLEX_CIF,
      numProteins: 10,
      mode: 'binder',
      chains: [
        { chainId: 'A', role: 'target' },
        { chainId: 'B', role: 'binder', residues: [1, 2, 3, 4, 5] },
      ],
    }),
  },
  {
    id: 'protein-design',
    label: 'template binder: CDR 移植 (replacement)',
    body: buildTemplateBinderDesignBody({
      ...templateBinderBase,
      motifs: [{ type: 'replacement', start: 4, end: 9, minLength: 5, maxLength: 8 }],
    }),
  },
  {
    id: 'protein-design',
    label: 'template binder: 环延长 (insertion)',
    body: buildTemplateBinderDesignBody({
      ...templateBinderBase,
      motifs: [{ type: 'insertion', after: 6, minLength: 4, maxLength: 6 }],
    }),
  },
  // These boundary cases protect the 1-based inclusive to 0-based conversion. Positions 1 and
  // chain length must both be accepted; an off-by-one error pushes one endpoint out of range.
  {
    id: 'protein-design',
    label: 'template binder: 边界 start=1',
    body: buildTemplateBinderDesignBody({
      ...templateBinderBase,
      motifs: [{ type: 'replacement', start: 1, end: 3, minLength: 3, maxLength: 5 }],
    }),
  },
  {
    id: 'protein-design',
    label: `template binder: 边界 end=${TEMPLATE_BINDER.length} 与 epitope=${TEMPLATE_TARGET.length} (=链长)`,
    body: buildTemplateBinderDesignBody({
      ...templateBinderBase,
      epitopeResidues: [TEMPLATE_TARGET.length],
      motifs: [{
        type: 'replacement',
        start: TEMPLATE_BINDER.length - 2,
        end: TEMPLATE_BINDER.length,
        minLength: 3,
        maxLength: 5,
      }],
    }),
  },
  {
    id: 'protein-sequence-redesign',
    label: 'sequence redesign generic (导出的 CIF)',
    body: buildSequenceRedesignBody({
      structureCif: TEMPLATE_CIF,
      numProteins: 10,
      mode: 'generic',
      chains: TEMPLATE_CHAINS.map((chain, index) => ({
        chainId: chain.chainId,
        ...(index === 1 ? { residues: [3, 4, 5, 6, 7] } : {}),
      })),
    }),
  },
]

/**
 * Local guards must catch known server constraints.
 *
 * They replace opaque 0-based server errors with checks aligned to the UI's 1-based positions,
 * so these assertions verify local rejection rather than merely expecting a remote failure.
 */
const guardCases: { label: string; reason: string | null }[] = [
  {
    label: 'binder 重设计残基不足 5',
    reason: checkSequenceRedesignRequest({
      structureCif: TEMPLATE_CIF,
      numProteins: 10,
      mode: 'binder',
      chains: [
        { chainId: TEMPLATE_TARGET.chainId, role: 'target' },
        { chainId: TEMPLATE_BINDER.chainId, role: 'binder', residues: [3, 4] },
      ],
    }),
  },
  {
    label: '靶点与结合体同链',
    reason: checkTemplateBinderRequest({
      ...templateBinderBase,
      binderChainId: TEMPLATE_TARGET.chainId,
      motifs: [{ type: 'replacement', start: 4, end: 9, minLength: 5, maxLength: 8 }],
    }),
  },
  { label: '模板结合体无 motif', reason: checkTemplateBinderRequest({ ...templateBinderBase, motifs: [] }) },
]

let passed = 0
const covered = new Set<BoltzPipelineId>()

for (const testCase of cases) {
  const pipeline = getPipeline(testCase.id)
  const response = await fetch(`${BOLTZ_API_ORIGIN}/compute/v1/${pipeline.path}/estimate-cost`, {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'content-type': 'application/json' },
    body: JSON.stringify(testCase.body),
  })
  const text = await response.text()
  if (response.ok) {
    passed += 1
    covered.add(testCase.id)
    const cost = (JSON.parse(text) as { estimated_cost_usd?: string }).estimated_cost_usd
    console.log(`PASS  ${testCase.label} -> $${cost}`)
  } else {
    console.log(`FAIL  ${testCase.label} [${response.status}] ${text.slice(0, 200)}`)
  }
}

let guardsPassed = 0
for (const guard of guardCases) {
  if (guard.reason) {
    guardsPassed += 1
    console.log(`PASS  guard: ${guard.label} -> ${guard.reason}`)
  } else {
    console.log(`FAIL  guard: ${guard.label} -> 未拦下，会带着 0-based 口径的 400 直达用户`)
  }
}

const missing = PIPELINES.filter((pipeline) => !covered.has(pipeline.id)).map((pipeline) => pipeline.id)
console.log(`\n${passed}/${cases.length} bodies accepted; ${guardsPassed}/${guardCases.length} guards held; ${covered.size}/${PIPELINES.length} pipelines covered`)
if (missing.length > 0) console.log(`uncovered: ${missing.join(', ')}`)
process.exit(passed === cases.length && guardsPassed === guardCases.length && missing.length === 0 ? 0 : 1)
