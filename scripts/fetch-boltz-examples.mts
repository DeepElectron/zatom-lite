/**
 * Run the seven BOLTZ_EXAMPLES cases and store viewable results under public/boltz-examples/.
 *
 *   # Estimate only (free and validates the request shape)
 *   BOLTZ_API_KEY=sk_... pnpm exec tsx scripts/fetch-boltz-examples.mts
 *
 *   # Submit real jobs. --budget prevents all submissions when the estimate exceeds the limit.
 *   BOLTZ_API_KEY=sk_... pnpm exec tsx scripts/fetch-boltz-examples.mts --run --budget 5
 *
 *   # Run a selected subset
 *   ... --run --only kras-sotorasib,drug-adme-panel
 *
 * Design constraints:
 *
 * 1. **Estimate everything before submitting anything.** Every request must validate and the
 *    combined estimate must fit the budget before the first job is submitted.
 * 2. **Only viewer inputs are published.** The public bundle keeps complete structures plus a
 *    stable ranking score and path in the manifest. Runtime metadata and auxiliary artifacts
 *    remain local. Signed artifact URLs expire, so required structures are downloaded immediately.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { BOLTZ_EXAMPLES, type BoltzExample } from '../src/services/boltz-examples'
import { getPipeline } from '../src/services/boltz-pipelines'
import {
  buildAdmeBody,
  buildPredictionBody,
  buildProteinDesignBody,
  buildProteinScreenBody,
  buildSequenceRedesignBody,
  buildSmallMoleculeDesignBody,
  buildSmallMoleculeScreenBody,
} from '../src/services/boltz-requests'
import { BOLTZ_API_ORIGIN } from '../src/services/boltz-endpoints'

const argv = process.argv.slice(2)
/**
 * --dry-run assembles and prints requests locally without a network call or API key. It catches
 * missing fields, incorrect chains, and residue conversion errors before submission.
 */
const DRY_RUN = argv.includes('--dry-run')

const apiKey = process.env.BOLTZ_API_KEY
if (!apiKey && !DRY_RUN) {
  console.error('需要 BOLTZ_API_KEY（或加 --dry-run 只做本地装配自检）。')
  process.exit(1)
}

const RUN = argv.includes('--run')
/** Resume polling jobs from the local ledger without submitting them again. */
const RESUME = argv.includes('--resume')
const BUDGET = Number(argv[argv.indexOf('--budget') + 1] ?? '5')
const ONLY = argv.includes('--only')
  ? new Set((argv[argv.indexOf('--only') + 1] ?? '').split(',').filter(Boolean))
  : null

const OUT_DIR = fileURLToPath(new URL('../public/boltz-examples/', import.meta.url))
const STATE_DIR = fileURLToPath(new URL('../.zatom/boltz-examples/', import.meta.url))

/** Keep target chain A and protein candidate/binder chain B in sync with panel requests. */
const TARGET_CHAIN = 'A'
const PARTNER_CHAIN = 'B'
/**
 * Small-molecule design requires the designed ligand to use chain L. The service rejects B or X
 * because this chain name is part of the pocket-constraint contract.
 */
const DESIGNED_LIGAND_CHAIN = 'L'

const protein = (value: string) => ({ type: 'protein' as const, value, chain_ids: [TARGET_CHAIN] })

/** Convert a human-readable residue list such as "1, 2, 3" into numbers. */
function residues(text: string | undefined): number[] {
  if (!text) return []
  return text.split(/[,\s]+/).filter(Boolean).map(Number).filter((n) => Number.isFinite(n))
}

/** Split multiline SMILES or sequence libraries into non-empty rows. */
function lines(text: string | undefined): string[] {
  if (!text) return []
  return text.split('\n').map((line) => line.trim()).filter(Boolean)
}

function readAsset(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(`../public/${relativePath}`, import.meta.url)), 'utf8')
}

/**
 * Assemble an example form into its request body.
 *
 * Pass one-based residues to builders, which perform wire-level zero-based conversion. Converting
 * here as well would silently target the preceding residue.
 */
function buildBody(example: BoltzExample): unknown {
  const { form } = example
  switch (example.pipelineId) {
    case 'structure-and-binding':
      return buildPredictionBody({
        entities: [
          protein(form.sequence!),
          { type: 'ligand_smiles', value: form.ligand!, chain_ids: [PARTNER_CHAIN] },
        ],
        binderChainId: PARTNER_CHAIN,
        numSamples: form.predictionSamples ?? 1,
      })

    case 'adme':
      return buildAdmeBody({ smiles: lines(form.library) })

    case 'small-molecule-design':
      return buildSmallMoleculeDesignBody({
        targetEntities: [protein(form.sequence!)],
        numMolecules: form.units ?? 10,
        pocketResidues: { [TARGET_CHAIN]: residues(form.pocket) },
        designedChainId: DESIGNED_LIGAND_CHAIN,
      })

    case 'small-molecule-library-screen':
      return buildSmallMoleculeScreenBody({
        targetEntities: [protein(form.sequence!)],
        smiles: lines(form.library),
        ligandChainId: PARTNER_CHAIN,
      })

    case 'protein-design':
      return buildProteinDesignBody({
        targetEntities: [protein(form.sequence!)],
        numProteins: form.units ?? 10,
        epitopeResidues: { [TARGET_CHAIN]: residues(form.epitope) },
        binderLengthRange: form.binderLength ?? '55..75',
        binderChainId: PARTNER_CHAIN,
      })

    case 'protein-library-screen':
      return buildProteinScreenBody({
        targetEntities: [protein(form.sequence!)],
        sequences: lines(form.library),
        candidateChainId: PARTNER_CHAIN,
      })

    case 'protein-sequence-redesign': {
      const cif = readAsset(form.structureAsset!)
      const designed = form.redesignChain ?? PARTNER_CHAIN
      // Redesign requires every chain: mark the edited chain as binder and all others as target.
      const chains = redesignChainIds(cif).map((chainId) =>
        chainId === designed
          ? { chainId, role: 'binder' as const, residues: residues(form.redesignResidues) }
          : { chainId, role: 'target' as const },
      )
      return buildSequenceRedesignBody({
        structureCif: cif,
        numProteins: form.units ?? 10,
        chains,
        mode: form.redesignMode ?? 'binder',
      })
    }
  }
}

/**
 * Read polymer label_asym_id values from mmCIF.
 *
 * The service uses label rather than author chain ids; for example, 2PTC labels A/B correspond to
 * author ids E/I. Read ATOM records only because water and ion chains do not participate in redesign.
 */
function redesignChainIds(cif: string): string[] {
  const rows = cif.split('\n')
  const header: string[] = []
  let start = -1
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!
    if (row.startsWith('_atom_site.')) header.push(row.trim().split('.')[1]!)
    else if (header.length > 0) { start = index; break }
  }
  const asymColumn = header.indexOf('label_asym_id')
  const groupColumn = header.indexOf('group_PDB')
  const found: string[] = []
  for (let index = start; index < rows.length; index += 1) {
    const row = rows[index]!
    if (row.startsWith('#') || row.trim() === '') break
    const parts = row.split(/\s+/).filter(Boolean)
    if (parts.length < header.length) continue
    if (parts[groupColumn] !== 'ATOM') continue
    const asym = parts[asymColumn]!
    if (!found.includes(asym)) found.push(asym)
  }
  return found
}

async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${BOLTZ_API_ORIGIN}/compute/v1${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'x-api-key': apiKey!,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`HTTP ${response.status} ${path}\n${text.slice(0, 900)}`)
  return JSON.parse(text) as T
}

const selected = BOLTZ_EXAMPLES.filter((example) => !ONLY || ONLY.has(example.id))

// Step 0: assemble requests locally and catch missing fields or incorrect chains.

if (DRY_RUN) {
  let bad = 0
  console.log(`本地装配自检 ${selected.length} 个案例（不联网）\n`)
  for (const example of selected) {
    const pipeline = getPipeline(example.pipelineId)
    try {
      const body = buildBody(example) as Record<string, unknown>
      const size = JSON.stringify(body).length
      console.log(
        `  OK   ${example.id.padEnd(24)} ${String(size).padStart(7)}B  ${Object.keys(body).join(',')}`,
      )
    } catch (error) {
      bad += 1
      console.log(`  FAIL ${example.id.padEnd(24)} ${(error as Error).message}`)
    }
    void pipeline
  }
  console.log(bad === 0 ? '\n全部装配通过。' : `\n${bad} 个装配失败。`)
  process.exit(bad === 0 ? 0 : 1)
}

// Step 1: estimate every request for free, validating its shape at the same time.

interface Priced { example: BoltzExample; body: unknown; usd: number }

const priced: Priced[] = []
let failures = 0

console.log(`估价 ${selected.length} 个案例（免费）\n`)
for (const example of selected) {
  const pipeline = getPipeline(example.pipelineId)
  try {
    const body = buildBody(example)
    const raw = await api<Record<string, unknown>>(`/${pipeline.path}/estimate-cost`, body)
    const usd = Number(raw.estimated_cost_usd ?? 0)
    priced.push({ example, body, usd })
    console.log(`  OK    $${usd.toFixed(4).padStart(8)}  ${example.id}  (${pipeline.label})`)
  } catch (error) {
    failures += 1
    console.log(`  FAIL            ${example.id}  (${pipeline.label})`)
    console.log(`        ${(error as Error).message.split('\n').join('\n        ')}`)
  }
}

const total = priced.reduce((sum, item) => sum + item.usd, 0)
console.log(`\n估价总额：$${total.toFixed(4)}   预算：$${BUDGET.toFixed(2)}`)

if (failures > 0) {
  console.error(`\n有 ${failures} 个案例形状不被接受，整批中止 —— 先修请求体，别花钱。`)
  process.exit(1)
}
if (!RUN) {
  console.log('\n（未加 --run，到此结束，未产生费用。）')
  process.exit(0)
}
if (total > BUDGET) {
  console.error(`\n总额超预算，一个都不提交。加大 --budget 或用 --only 缩小范围。`)
  process.exit(1)
}

// Step 2: submit and poll.

interface JobRef { example: BoltzExample; jobId: string }

const jobs: JobRef[] = []

/**
 * The local job ledger is runtime state, not a public example asset. Keep it under
 * the gitignored .zatom directory so remote job identifiers can never be deployed.
 */
const LEDGER = `${STATE_DIR}jobs.json`

type LedgerEntry = {
  exampleId: string
  pipelineId: string
  jobId: string
  /** Earlier jobs retained so an interrupted or repeated run remains recoverable. */
  supersededJobIds?: string[]
}

function saveLedger(): void {
  mkdirSync(STATE_DIR, { recursive: true })

  // Merge with unselected entries so a partial run does not discard recoverable jobs.
  const entries = new Map<string, LedgerEntry>()
  if (existsSync(LEDGER)) {
    const previous = JSON.parse(readFileSync(LEDGER, 'utf8')) as { jobs?: LedgerEntry[] }
    for (const entry of previous.jobs ?? []) entries.set(entry.exampleId, entry)
  }
  for (const job of jobs) {
    // Preserve an earlier identifier when the same example is submitted again.
    const previous = entries.get(job.example.id)
    const superseded = [...(previous?.supersededJobIds ?? [])]
    if (previous && previous.jobId !== job.jobId && !superseded.includes(previous.jobId)) {
      superseded.push(previous.jobId)
    }

    entries.set(job.example.id, {
      exampleId: job.example.id,
      pipelineId: job.example.pipelineId,
      jobId: job.jobId,
      ...(superseded.length > 0 ? { supersededJobIds: superseded } : {}),
    })
  }

  writeFileSync(
    LEDGER,
    `${JSON.stringify({ jobs: [...entries.values()] }, null, 2)}\n`,
  )
}

/**
 * Resume selected jobs from the local ledger without submitting them again. Respect --only so
 * unrelated historical jobs do not join the polling batch.
 */
if (RESUME && existsSync(LEDGER)) {
  const saved = JSON.parse(readFileSync(LEDGER, 'utf8')) as {
    jobs: { exampleId: string; jobId: string }[]
  }
  for (const entry of saved.jobs) {
    const example = selected.find((candidate) => candidate.id === entry.exampleId)
    if (example) jobs.push({ example, jobId: entry.jobId })
  }
  console.log(`\n从台账恢复 ${jobs.length} 个已提交作业（不重复计费）`)
}

/**
 * Submit selected examples absent from the ledger, allowing resumed runs to add newly selected cases.
 */
const restored = new Set(jobs.map((job) => job.example.id))
const toSubmit = priced.filter((item) => !restored.has(item.example.id))

if (toSubmit.length > 0) {
  console.log('\n提交作业')
  for (const item of toSubmit) {
    const pipeline = getPipeline(item.example.pipelineId)
    const raw = await api<{ id: string }>(`/${pipeline.path}`, item.body)
    jobs.push({ example: item.example, jobId: raw.id })
    saveLedger() // Flush each submission so a later failure cannot orphan earlier jobs.
    console.log(`  ${item.example.id} → ${raw.id}`)
  }
}

const TERMINAL = new Set(['completed', 'succeeded', 'success', 'failed', 'error', 'errored', 'stopped', 'canceled', 'cancelled'])
const done = new Map<string, Record<string, unknown>>()
const started = Date.now()

/**
 * Polling deadline after which completed jobs are still published.
 *
 * One slow job must not block completed results. Unfinished identifiers remain in the ledger and
 * can be recovered later with --resume.
 */
const POLL_LIMIT_MS = Number(process.env.BOLTZ_POLL_MINUTES ?? 45) * 60_000

console.log(`\n轮询（设计类通常要几十分钟，上限 ${(POLL_LIMIT_MS / 60_000).toFixed(0)} 分钟）`)
while (done.size < jobs.length) {
  if (Date.now() - started > POLL_LIMIT_MS) {
    const stuck = jobs.filter((job) => !done.has(job.example.id)).map((job) => job.example.id)
    console.log(`\n  [超过轮询上限] 仍未完成：${stuck.join(', ')}`)
    console.log('  先落地已完成的部分；稍后用 --resume 接回未完成的作业（不会重复计费）。')
    break
  }
  await new Promise((resolve) => setTimeout(resolve, 20_000))
  for (const job of jobs) {
    if (done.has(job.example.id)) continue
    const pipeline = getPipeline(job.example.pipelineId)
    let raw: Record<string, unknown>
    try {
      raw = await api<Record<string, unknown>>(`/${pipeline.path}/${job.jobId}`)
    } catch (error) {
      console.log(`  [轮询失败，稍后重试] ${job.example.id}: ${(error as Error).message.split('\n')[0]}`)
      continue
    }
    const status = String(raw.status ?? '').toLowerCase()
    if (TERMINAL.has(status)) {
      done.set(job.example.id, raw)
      const minutes = ((Date.now() - started) / 60_000).toFixed(1)
      console.log(`  ${status.toUpperCase().padEnd(10)} ${job.example.id}  (${minutes} 分钟)`)
    }
  }
  const elapsed = ((Date.now() - started) / 60_000).toFixed(0)
  if (done.size < jobs.length) console.log(`  …${done.size}/${jobs.length} 完成，已 ${elapsed} 分钟`)
}

// Step 3: retrieve candidates and download viewable structures.

interface StoredCandidate {
  score: number
  structure: string
}

interface StoredExampleManifest {
  id: string
  candidates: StoredCandidate[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function download(url: string, destination: string): Promise<boolean> {
  try {
    const response = await fetch(url)
    if (!response.ok) return false
    writeFileSync(destination, Buffer.from(await response.arrayBuffer()))
    return true
  } catch {
    return false
  }
}

/** Save only the complete structure consumed by the built-in example viewer. */
async function saveStructure(
  artifact: unknown,
  directory: string,
  exampleId: string,
  candidateIndex: number,
): Promise<string | null> {
  if (!isRecord(artifact) || typeof artifact.url !== 'string') return null
  const prefix = String(candidateIndex).padStart(2, '0')
  const name = `${prefix}-structure.cif`
  return await download(artifact.url, `${directory}/${name}`)
    ? `boltz-examples/${exampleId}/${name}`
    : null
}

function scoreCandidate(row: Record<string, unknown>): number {
  const metrics: Record<string, unknown> = {}
  for (const source of [row, row.metrics, row.properties, row.adme]) {
    if (isRecord(source)) Object.assign(metrics, source)
  }
  for (const key of ['binding_confidence', 'optimization_score', 'confidence', 'plddt']) {
    const value = metrics[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return 0
}

const manifest: StoredExampleManifest[] = []

console.log('\n下载产物')
for (const job of jobs) {
  const pipeline = getPipeline(job.example.pipelineId)
  const raw = done.get(job.example.id)
  // Skip unfinished jobs rather than publishing empty cases; --resume can recover them later.
  if (!raw) {
    console.log(`  ${job.example.id}: 尚未完成，跳过（用 --resume 接回）`)
    continue
  }
  const directory = `${OUT_DIR}${job.example.id}`
  const stagingDirectory = `${STATE_DIR}assets/${job.example.id}`
  rmSync(stagingDirectory, { recursive: true, force: true })
  mkdirSync(stagingDirectory, { recursive: true })

  // Paged pipelines expose candidates through /results; single pipelines use job output.
  let rows: unknown[] = []
  if (pipeline.resultShape === 'paged') {
    try {
      const page = await api<{ data?: unknown[] }>(`/${pipeline.path}/${job.jobId}/results`)
      rows = Array.isArray(page.data) ? page.data : []
    } catch (error) {
      console.log(`  [取结果失败] ${job.example.id}: ${(error as Error).message.split('\n')[0]}`)
    }
  } else {
    const output = isRecord(raw.output) ? raw.output : {}
    const molecules = output.molecules
    const samples = output.all_sample_results
    if (Array.isArray(molecules)) rows = molecules
    else if (Array.isArray(samples)) rows = samples
    else if (isRecord(output.best_sample)) rows = [output.best_sample]

  }

  const candidates: StoredCandidate[] = []
  for (let index = 0; index < rows.length; index += 1) {
    const row = isRecord(rows[index]) ? (rows[index] as Record<string, unknown>) : {}
    const artifacts = isRecord(row.artifacts) ? row.artifacts : {}
    const structure = await saveStructure(
      isRecord(row.structure) ? row.structure : artifacts.structure,
      stagingDirectory,
      job.example.id,
      candidates.length,
    )
    if (structure) candidates.push({ score: scoreCandidate(row), structure })
  }

  if (candidates.length > 0) {
    rmSync(directory, { recursive: true, force: true })
    mkdirSync(OUT_DIR, { recursive: true })
    renameSync(stagingDirectory, directory)
    manifest.push({ id: job.example.id, candidates })
  } else {
    rmSync(stagingDirectory, { recursive: true, force: true })
  }
  console.log(`  ${job.example.id}: ${candidates.length} viewable structures`)
}

/**
 * Merge with the existing manifest so partial resumed runs retain previously published cases.
 * Entries generated in this run replace matching ids.
 */
const manifestPath = `${OUT_DIR}manifest.json`
const merged = new Map<string, StoredExampleManifest>()
if (existsSync(manifestPath)) {
  const previous = JSON.parse(readFileSync(manifestPath, 'utf8')) as StoredExampleManifest[]
  for (const entry of previous) merged.set(entry.id, entry)
}
for (const entry of manifest) merged.set(entry.id, entry)

const ordered = BOLTZ_EXAMPLES.map((example) => merged.get(example.id)).filter(Boolean)
writeFileSync(manifestPath, `${JSON.stringify(ordered, null, 2)}\n`)
console.log(`\n已写入 manifest.json（本轮 ${manifest.length} 个，累计 ${ordered.length}/${BOLTZ_EXAMPLES.length} 个案例）`)
console.log(`估价总额 $${total.toFixed(4)}`)
