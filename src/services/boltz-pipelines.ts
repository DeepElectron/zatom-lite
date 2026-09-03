/**
 * Registry for the seven Boltz compute pipelines.
 *
 * Every request shape below has returned HTTP 200 from `/estimate-cost`. The deployed API differs
 * materially from its documentation:
 *
 * - `protein/design` has mutually exclusive shapes selected by top-level `templates`. Without it,
 *   only legacy `{target, binder_specification}` de novo input works. With it, the documented
 *   `{type:'binder', target, binder}` union is enabled and the binder must be `from_template`.
 * - `predictions` uses `input.binding.binder_chain_id` and `input.num_samples`, not the documented
 *   `properties.affinity` and `model_options.diffusion_samples` locations.
 * - `protein/sequence-redesign` requires CIF input as `{type:'base64', data, media_type}` and at
 *   least five redesigned residues in binder mode.
 *
 * Adding a pipeline requires one PIPELINES record; generic submission, polling, cancellation,
 * estimation, and artifact decoding follow this registry.
 */

/** Stable pipeline id persisted with jobs; renaming one would orphan existing records. */
export type BoltzPipelineId =
  | 'structure-and-binding'
  | 'adme'
  | 'small-molecule-design'
  | 'small-molecule-library-screen'
  | 'protein-design'
  | 'protein-library-screen'
  | 'protein-sequence-redesign'

/**
 * Result retrieval mode:
 * - `single`: the job object carries output for predictions and ADME.
 * - `paged`: designs, screens, and redesigns expose candidates incrementally through `/results`.
 */
export type BoltzResultShape = 'single' | 'paged'

export interface BoltzPipeline {
  id: BoltzPipelineId
  /** REST segment appended to `/compute/v1/`. */
  path: string
  label: string
  /** One sentence describing what the pipeline determines. */
  summary: string
  resultShape: BoltzResultShape
  /** Request field containing billable unit count for local scale previews. */
  unitField?: 'num_samples' | 'num_molecules' | 'num_proteins'
  /**
   * Server minimum for the unit field; absence means one unit is accepted.
 *
   * `/estimate-cost` checks in 2026-08 showed a minimum of 10 for small-molecule/design and
   * protein/design, while protein/sequence-redesign accepts one. This applies only to generating
   * new molecules or backbones, not redesigning an existing structure.
   */
  minUnits?: number
  /** Whether the long-running pipeline supports stop. */
  stoppable: boolean
}

export const PIPELINES: readonly BoltzPipeline[] = [
  {
    id: 'structure-and-binding',
    path: 'predictions/structure-and-binding',
    label: 'Structure & binding',
    summary: 'Fold a complex and score how well a chosen chain binds it.',
    resultShape: 'single',
    unitField: 'num_samples',
    stoppable: false,
  },
  {
    id: 'adme',
    path: 'predictions/adme',
    label: 'ADME properties',
    summary: 'Predict absorption, distribution, metabolism and excretion for small molecules.',
    resultShape: 'single',
    stoppable: false,
  },
  {
    id: 'small-molecule-design',
    path: 'small-molecule/design',
    label: 'Small-molecule design',
    summary: 'Generate new ligands against a protein target.',
    resultShape: 'paged',
    unitField: 'num_molecules',
    minUnits: 10,
    stoppable: true,
  },
  {
    id: 'small-molecule-library-screen',
    path: 'small-molecule/library-screen',
    label: 'Small-molecule screen',
    summary: 'Score an existing ligand library against one target.',
    resultShape: 'paged',
    stoppable: true,
  },
  {
    id: 'protein-design',
    path: 'protein/design',
    label: 'Protein binder design',
    summary: 'Design de novo protein binders against an epitope.',
    resultShape: 'paged',
    unitField: 'num_proteins',
    minUnits: 10,
    stoppable: true,
  },
  {
    id: 'protein-library-screen',
    path: 'protein/library-screen',
    label: 'Protein screen',
    summary: 'Score a set of candidate proteins against one target.',
    resultShape: 'paged',
    stoppable: true,
  },
  {
    id: 'protein-sequence-redesign',
    path: 'protein/sequence-redesign',
    label: 'Sequence redesign',
    summary: 'Redesign chosen residues on a structure you already have.',
    resultShape: 'paged',
    unitField: 'num_proteins',
    stoppable: true,
  },
]

const BY_ID = new Map(PIPELINES.map((pipeline) => [pipeline.id, pipeline]))

export function getPipeline(id: BoltzPipelineId): BoltzPipeline {
  const pipeline = BY_ID.get(id)
  if (!pipeline) throw new Error(`Unknown Boltz pipeline: ${id}`)
  return pipeline
}

/**
 * Narrow an arbitrary persisted value to a registered pipeline id before polling begins.
 */
export function isPipelineId(value: unknown): value is BoltzPipelineId {
  return typeof value === 'string' && BY_ID.has(value as BoltzPipelineId)
}

/** Job state; user-requested stops remain distinct from failures. */
export type BoltzJobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'stopped'

export function isTerminalStatus(status: BoltzJobStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'stopped'
}

/**
 * Normalize service status variants. Treat unknown values as running: one extra poll is safer than
 * permanently abandoning an active job.
 */
export function normalizeStatus(raw: unknown): BoltzJobStatus {
  const text = typeof raw === 'string' ? raw.toLowerCase() : ''
  if (text === 'completed' || text === 'succeeded' || text === 'success') return 'completed'
  if (text === 'failed' || text === 'error' || text === 'errored') return 'failed'
  if (text === 'stopped' || text === 'canceled' || text === 'cancelled') return 'stopped'
  if (text === 'pending' || text === 'queued' || text === 'created') return 'pending'
  return 'running'
}
