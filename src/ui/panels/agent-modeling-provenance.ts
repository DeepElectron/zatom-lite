import { ZATOM_STRUCTURE_SCHEMA, type StructureProvenance } from '../../agent/contracts'
import { fingerprintCanonicalJson, fingerprintStructure } from '../../agent/structure-math'
import { fingerprintTrajectory } from '../../agent/trajectory'
import {
  AgentModelingRunArtifactError,
  type AgentModelingRunArtifact,
} from './agent-modeling-store'

export const ZATOM_AGENT_MODELING_DEPENDENCY_GRAPH_SCHEMA = 'zatom.agent-modeling-dependency-graph/v1'

const CHECKPOINT_SCOPE = 'No engine checkpoint was provided. A canonical continuation frame does not contain hidden integrator, thermostat, barostat, or RNG state.'
const EMPTY_STRUCTURE_FINGERPRINT = fingerprintStructure({
  schemaVersion: ZATOM_STRUCTURE_SCHEMA,
  atoms: [],
})

export type AgentModelingDependencyNodeKind =
  | 'run'
  | 'structure'
  | 'trajectory'
  | 'provider'
  | 'engine'
  | 'domain-artifact'
  | 'visual-evidence'

export type AgentModelingDependencyRelation =
  | 'workspace-context'
  | 'source'
  | 'continued-from'
  | 'executed-by'
  | 'consumed'
  | 'produced'
  | 'captured'

type DependencyScalar = string | number | boolean | null

export interface AgentModelingDependencyNode {
  id: string
  kind: AgentModelingDependencyNodeKind
  label: string
  fingerprint: string
  details?: Record<string, DependencyScalar>
}

export interface AgentModelingDependencyEdge {
  from: string
  to: string
  relation: AgentModelingDependencyRelation
  details?: Record<string, DependencyScalar>
}

export interface AgentModelingDependencyGraph {
  schemaVersion: typeof ZATOM_AGENT_MODELING_DEPENDENCY_GRAPH_SCHEMA
  fingerprint: string
  runId: number
  runFingerprint: string
  checkpointScope: typeof CHECKPOINT_SCOPE
  nodes: AgentModelingDependencyNode[]
  edges: AgentModelingDependencyEdge[]
}

interface ProviderIdentity {
  id: string
  adapterVersion: string
  capability: string
  engineName: string
  engineVersion: string
  fidelity: string
  execution: string
}

const INPUT_ARTIFACTS: ReadonlyArray<{
  field: keyof StructureProvenance
  label: string
}> = [
  { field: 'inputForceFieldPackageFingerprint', label: 'Input force-field package' },
  { field: 'inputChemicalStateEnsembleFingerprint', label: 'Input chemical-state ensemble' },
]

const OUTPUT_ARTIFACTS: ReadonlyArray<{
  field: keyof StructureProvenance
  label: string
}> = [
  { field: 'structureEnsembleFingerprint', label: 'Structure ensemble' },
  { field: 'periodicStructureEnsembleFingerprint', label: 'Periodic structure ensemble' },
  { field: 'forceFieldPackageFingerprint', label: 'Force-field package' },
  { field: 'chemicalStateEnsembleFingerprint', label: 'Chemical-state ensemble' },
  { field: 'chemicalStateStructureCatalogFingerprint', label: 'Chemical-state structure catalog' },
  { field: 'chemicalStateStructuralDistributionFingerprint', label: 'Chemical-state structural distribution' },
  { field: 'microPkaEvidenceFingerprint', label: 'Microscopic pKa evidence' },
  { field: 'microstateTransitionGraphFingerprint', label: 'Microstate transition graph' },
  { field: 'microstateStateCoverageFingerprint', label: 'Microstate state coverage' },
  { field: 'microstateEquilibriumPotentialEnsembleFingerprint', label: 'Microstate potential ensemble' },
  { field: 'microstatePotentialSampleDiagnosticsFingerprint', label: 'Potential-sample diagnostics' },
  { field: 'sqsQualityEvidenceFingerprint', label: 'SQS quality evidence' },
  { field: 'continuumDislocationEvidenceFingerprint', label: 'Continuum-dislocation evidence' },
  { field: 'periodicDislocationDipoleEvidenceFingerprint', label: 'Periodic-dislocation evidence' },
  { field: 'fixedCellRelaxationEvidenceFingerprint', label: 'Fixed-cell relaxation evidence' },
]

const NODE_KINDS = new Set<AgentModelingDependencyNodeKind>([
  'run', 'structure', 'trajectory', 'provider', 'engine', 'domain-artifact', 'visual-evidence',
])
const RELATIONS = new Set<AgentModelingDependencyRelation>([
  'workspace-context', 'source', 'continued-from', 'executed-by', 'consumed', 'produced', 'captured',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function exactFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...fields].sort()
  return actual.length === expected.length && actual.every((field, index) => field === expected[index])
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.length || value.length > 1_024) {
    throw new AgentModelingRunArtifactError('invalid_agent_dependency_graph', `${field} must be non-empty text`)
  }
  return value
}

function optionalFingerprint(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined
  return text(value, field)
}

function scalarDetails(value: unknown, field: string): Record<string, DependencyScalar> | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value) || Object.keys(value).length > 32) {
    throw new AgentModelingRunArtifactError('invalid_agent_dependency_graph', `${field} is invalid`)
  }
  const result: Record<string, DependencyScalar> = {}
  for (const [key, nested] of Object.entries(value)) {
    if (!key.length || key.length > 128
      || (nested !== null && !['string', 'number', 'boolean'].includes(typeof nested))
      || (typeof nested === 'number' && !Number.isFinite(nested))
      || (typeof nested === 'string' && nested.length > 1_024)) {
      throw new AgentModelingRunArtifactError('invalid_agent_dependency_graph', `${field}.${key} is invalid`)
    }
    result[key] = nested as DependencyScalar
  }
  return result
}

function resultPayload(artifact: AgentModelingRunArtifact): Record<string, unknown> | null {
  const data = isRecord(artifact.result.data) ? artifact.result.data : null
  if (!data) return null
  return isRecord(data.result) ? data.result : data
}

function structureProvenance(payload: Record<string, unknown> | null): StructureProvenance | null {
  if (!payload || !isRecord(payload.provenance)) return null
  const raw = payload.provenance
  const claimsStructureProvenance = ['engine', 'engineVersion', 'sourceFingerprint', 'resultFingerprint']
    .some((field) => field in raw)
  if (!claimsStructureProvenance) return null
  const provenance: StructureProvenance = {
    engine: text(raw.engine, 'provenance.engine'),
    engineVersion: text(raw.engineVersion, 'provenance.engineVersion'),
    sourceFingerprint: text(raw.sourceFingerprint, 'provenance.sourceFingerprint'),
    resultFingerprint: text(raw.resultFingerprint, 'provenance.resultFingerprint'),
    parameters: isRecord(raw.parameters) ? raw.parameters as StructureProvenance['parameters'] : {},
  }
  if (!isRecord(raw.parameters)) {
    throw new AgentModelingRunArtifactError('invalid_agent_dependency_graph', 'provenance.parameters is invalid')
  }
  const optionalFields = [
    'sourceTrajectoryFingerprint', 'trajectoryFingerprint', 'structureEnsembleFingerprint',
    'periodicStructureEnsembleFingerprint', 'inputForceFieldPackageFingerprint',
    'inputChemicalStateEnsembleFingerprint', 'forceFieldPackageFingerprint',
    'chemicalStateEnsembleFingerprint', 'chemicalStateStructureCatalogFingerprint',
    'chemicalStateStructuralDistributionFingerprint', 'microPkaEvidenceFingerprint',
    'microstateTransitionGraphFingerprint', 'microstateStateCoverageFingerprint',
    'microstateEquilibriumPotentialEnsembleFingerprint',
    'microstatePotentialSampleDiagnosticsFingerprint', 'sqsQualityEvidenceFingerprint',
    'continuumDislocationEvidenceFingerprint', 'periodicDislocationDipoleEvidenceFingerprint',
    'fixedCellRelaxationEvidenceFingerprint',
  ] as const
  for (const field of optionalFields) {
    const fingerprint = optionalFingerprint(raw[field], `provenance.${field}`)
    if (fingerprint) Object.assign(provenance, { [field]: fingerprint })
  }
  if (raw.sourceTrajectoryFrameIndex !== undefined) {
    if (!Number.isSafeInteger(raw.sourceTrajectoryFrameIndex) || Number(raw.sourceTrajectoryFrameIndex) < 0) {
      throw new AgentModelingRunArtifactError(
        'invalid_agent_dependency_graph',
        'provenance.sourceTrajectoryFrameIndex is invalid',
      )
    }
    provenance.sourceTrajectoryFrameIndex = Number(raw.sourceTrajectoryFrameIndex)
  }
  if (raw.seed !== undefined) {
    if (!Number.isSafeInteger(raw.seed) || Number(raw.seed) < 0) {
      throw new AgentModelingRunArtifactError('invalid_agent_dependency_graph', 'provenance.seed is invalid')
    }
    provenance.seed = Number(raw.seed)
  }
  return provenance
}

function providerIdentity(payload: Record<string, unknown> | null): ProviderIdentity | null {
  if (!payload || payload.provider === undefined) return null
  if (!isRecord(payload.provider) || !isRecord(payload.provider.engine)) {
    throw new AgentModelingRunArtifactError('invalid_agent_dependency_graph', 'provider identity is invalid')
  }
  const raw = payload.provider
  const engine = raw.engine as Record<string, unknown>
  return {
    id: text(raw.id, 'provider.id'),
    adapterVersion: text(raw.adapterVersion, 'provider.adapterVersion'),
    capability: text(raw.capability, 'provider.capability'),
    engineName: text(engine.name, 'provider.engine.name'),
    engineVersion: text(engine.version, 'provider.engine.version'),
    fidelity: text(raw.fidelity, 'provider.fidelity'),
    execution: text(raw.execution, 'provider.execution'),
  }
}

function graphPayload(graph: Omit<AgentModelingDependencyGraph, 'fingerprint'>) {
  return JSON.parse(JSON.stringify(graph)) as Omit<AgentModelingDependencyGraph, 'fingerprint'>
}

/** Derive only dependency relationships proven by canonical run/provenance fields. */
export function composeAgentModelingDependencyGraph(
  artifact: AgentModelingRunArtifact,
): AgentModelingDependencyGraph {
  const nodes: AgentModelingDependencyNode[] = []
  const edges: AgentModelingDependencyEdge[] = []
  const addNode = (node: AgentModelingDependencyNode) => {
    if (nodes.some((candidate) => candidate.id === node.id)) {
      throw new AgentModelingRunArtifactError('invalid_agent_dependency_graph', `Duplicate node ${node.id}`)
    }
    nodes.push(node)
  }
  const addEdge = (edge: AgentModelingDependencyEdge) => edges.push(edge)

  addNode({
    id: 'run',
    kind: 'run',
    label: `${artifact.tool.name} · run ${artifact.runId}`,
    fingerprint: artifact.fingerprint,
    details: { toolVersion: artifact.tool.version, durationMs: artifact.durationMs },
  })
  if (artifact.origin.structureFingerprint) {
    addNode({
      id: 'workspace-structure',
      kind: 'structure',
      label: 'Workspace structure at run start',
      fingerprint: artifact.origin.structureFingerprint,
      details: { viewportId: artifact.origin.viewportId },
    })
    addEdge({ from: 'workspace-structure', to: 'run', relation: 'workspace-context' })
  }
  if (artifact.origin.trajectoryFingerprint) {
    addNode({
      id: 'workspace-trajectory',
      kind: 'trajectory',
      label: 'Workspace trajectory at run start',
      fingerprint: artifact.origin.trajectoryFingerprint,
      details: { viewportId: artifact.origin.viewportId },
    })
    addEdge({ from: 'workspace-trajectory', to: 'run', relation: 'workspace-context' })
  }
  if (artifact.workspaceRevision) {
    addNode({
      id: 'workspace-revision',
      kind: 'domain-artifact',
      label: 'Reversible workspace revision',
      fingerprint: artifact.workspaceRevision.fingerprint,
      details: {
        viewportId: artifact.workspaceRevision.before.viewportId,
        beforeStructure: artifact.workspaceRevision.before.structureFingerprint,
        beforeTrajectory: artifact.workspaceRevision.before.trajectoryFingerprint,
        afterStructure: artifact.workspaceRevision.after.structureFingerprint,
        afterTrajectory: artifact.workspaceRevision.after.trajectoryFingerprint,
      },
    })
    addEdge({ from: 'run', to: 'workspace-revision', relation: 'produced' })
  }

  const payload = resultPayload(artifact)
  const provenance = structureProvenance(payload)
  const provider = provenance ? providerIdentity(payload) : null
  if (provenance && provenance.sourceFingerprint !== EMPTY_STRUCTURE_FINGERPRINT) {
    addNode({
      id: 'source-structure',
      kind: 'structure',
      label: 'Canonical source structure',
      fingerprint: provenance.sourceFingerprint,
    })
    addEdge({ from: 'source-structure', to: 'run', relation: 'source' })
  }
  if (provenance?.sourceTrajectoryFingerprint) {
    addNode({
      id: 'source-trajectory',
      kind: 'trajectory',
      label: 'Canonical continuation trajectory',
      fingerprint: provenance.sourceTrajectoryFingerprint,
      ...(provenance.sourceTrajectoryFrameIndex === undefined ? {} : {
        details: { frameIndex: provenance.sourceTrajectoryFrameIndex },
      }),
    })
    addEdge({
      from: 'source-trajectory',
      to: 'run',
      relation: 'continued-from',
      ...(provenance.sourceTrajectoryFrameIndex === undefined ? {} : {
        details: { frameIndex: provenance.sourceTrajectoryFrameIndex },
      }),
    })
  }
  if (provider) {
    addNode({
      id: 'provider',
      kind: 'provider',
      label: `${provider.id}/${provider.capability}`,
      fingerprint: fingerprintCanonicalJson(provider),
      details: {
        adapterVersion: provider.adapterVersion,
        engine: provider.engineName,
        engineVersion: provider.engineVersion,
        fidelity: provider.fidelity,
        execution: provider.execution,
      },
    })
    addEdge({ from: 'provider', to: 'run', relation: 'executed-by' })
  } else if (provenance) {
    const engine = { engine: provenance.engine, engineVersion: provenance.engineVersion }
    addNode({
      id: 'engine',
      kind: 'engine',
      label: `${provenance.engine} ${provenance.engineVersion}`,
      fingerprint: fingerprintCanonicalJson(engine),
    })
    addEdge({ from: 'engine', to: 'run', relation: 'executed-by' })
  }

  if (artifact.candidate?.kind === 'structure') {
    const fingerprint = fingerprintStructure(artifact.candidate.structure)
    if (provenance && provenance.resultFingerprint !== fingerprint) {
      throw new AgentModelingRunArtifactError(
        'invalid_agent_dependency_graph',
        `Result structure fingerprint ${fingerprint} does not match provenance ${provenance.resultFingerprint}`,
      )
    }
    addNode({
      id: 'result-structure',
      kind: 'structure',
      label: 'Result structure',
      fingerprint,
      details: {
        atomCount: artifact.candidate.structure.atoms.length,
        applied: artifact.application?.appliedToWorkspace ?? false,
        verified: artifact.application?.applicationVerified ?? null,
      },
    })
    addEdge({ from: 'run', to: 'result-structure', relation: 'produced' })
    if (artifact.candidate.trajectory) {
      const trajectoryFingerprint = fingerprintTrajectory(artifact.candidate.trajectory)
      if (provenance?.trajectoryFingerprint && provenance.trajectoryFingerprint !== trajectoryFingerprint) {
        throw new AgentModelingRunArtifactError(
          'invalid_agent_dependency_graph',
          `Result trajectory fingerprint ${trajectoryFingerprint} does not match provenance ${provenance.trajectoryFingerprint}`,
        )
      }
      addNode({
        id: 'result-trajectory',
        kind: 'trajectory',
        label: 'Result trajectory',
        fingerprint: trajectoryFingerprint,
        details: { frameCount: artifact.candidate.trajectory.frames.length },
      })
      addEdge({ from: 'run', to: 'result-trajectory', relation: 'produced' })
    }
  } else if (artifact.candidate?.kind === 'trajectory') {
    const trajectoryFingerprint = fingerprintTrajectory(artifact.candidate.trajectory)
    if (provenance?.trajectoryFingerprint && provenance.trajectoryFingerprint !== trajectoryFingerprint) {
      throw new AgentModelingRunArtifactError(
        'invalid_agent_dependency_graph',
        `Result trajectory fingerprint ${trajectoryFingerprint} does not match provenance ${provenance.trajectoryFingerprint}`,
      )
    }
    addNode({
      id: 'result-trajectory',
      kind: 'trajectory',
      label: 'Result trajectory',
      fingerprint: trajectoryFingerprint,
      details: { frameCount: artifact.candidate.trajectory.frames.length },
    })
    addEdge({ from: 'run', to: 'result-trajectory', relation: 'produced' })
  }

  for (const item of INPUT_ARTIFACTS) {
    const fingerprint = provenance?.[item.field]
    if (typeof fingerprint !== 'string') continue
    const id = `input:${item.field}`
    addNode({ id, kind: 'domain-artifact', label: item.label, fingerprint })
    addEdge({ from: id, to: 'run', relation: 'consumed' })
  }
  for (const item of OUTPUT_ARTIFACTS) {
    const fingerprint = provenance?.[item.field]
    if (typeof fingerprint !== 'string') continue
    const id = `output:${item.field}`
    addNode({ id, kind: 'domain-artifact', label: item.label, fingerprint })
    addEdge({ from: 'run', to: id, relation: 'produced' })
  }

  artifact.targetEvidenceBundle.forEach((evidence, index) => {
    const id = `focused-evidence:${index}`
    addNode({
      id,
      kind: 'visual-evidence',
      label: `Focused evidence · ${evidence.target.id}`,
      fingerprint: fingerprintCanonicalJson(evidence),
      details: {
        structureFingerprint: evidence.structureFingerprint,
        trajectoryFingerprint: evidence.trajectoryFingerprint ?? null,
        capturedAt: evidence.capturedAt,
      },
    })
    addEdge({ from: 'run', to: id, relation: 'captured' })
  })
  if (artifact.application?.visualEvidence) {
    addNode({
      id: 'overview-evidence',
      kind: 'visual-evidence',
      label: 'Post-apply overview evidence',
      fingerprint: fingerprintCanonicalJson(artifact.application.visualEvidence),
    })
    addEdge({ from: 'run', to: 'overview-evidence', relation: 'captured' })
  }

  const payloadGraph = graphPayload({
    schemaVersion: ZATOM_AGENT_MODELING_DEPENDENCY_GRAPH_SCHEMA,
    runId: artifact.runId,
    runFingerprint: artifact.fingerprint,
    checkpointScope: CHECKPOINT_SCOPE,
    nodes,
    edges,
  })
  return { ...payloadGraph, fingerprint: fingerprintCanonicalJson(payloadGraph) }
}

function parseNode(value: unknown, index: number): AgentModelingDependencyNode {
  if (!isRecord(value) || !exactFields(value, [
    'id', 'kind', 'label', 'fingerprint', ...(value.details === undefined ? [] : ['details']),
  ])) {
    throw new AgentModelingRunArtifactError('invalid_agent_dependency_graph', `nodes[${index}] is invalid`)
  }
  const kind = text(value.kind, `nodes[${index}].kind`) as AgentModelingDependencyNodeKind
  if (!NODE_KINDS.has(kind)) {
    throw new AgentModelingRunArtifactError('invalid_agent_dependency_graph', `nodes[${index}].kind is invalid`)
  }
  const details = scalarDetails(value.details, `nodes[${index}].details`)
  return {
    id: text(value.id, `nodes[${index}].id`),
    kind,
    label: text(value.label, `nodes[${index}].label`),
    fingerprint: text(value.fingerprint, `nodes[${index}].fingerprint`),
    ...(details ? { details } : {}),
  }
}

function parseEdge(value: unknown, index: number): AgentModelingDependencyEdge {
  if (!isRecord(value) || !exactFields(value, [
    'from', 'to', 'relation', ...(value.details === undefined ? [] : ['details']),
  ])) {
    throw new AgentModelingRunArtifactError('invalid_agent_dependency_graph', `edges[${index}] is invalid`)
  }
  const relation = text(value.relation, `edges[${index}].relation`) as AgentModelingDependencyRelation
  if (!RELATIONS.has(relation)) {
    throw new AgentModelingRunArtifactError('invalid_agent_dependency_graph', `edges[${index}].relation is invalid`)
  }
  const details = scalarDetails(value.details, `edges[${index}].details`)
  return {
    from: text(value.from, `edges[${index}].from`),
    to: text(value.to, `edges[${index}].to`),
    relation,
    ...(details ? { details } : {}),
  }
}

function assertAcyclic(nodes: readonly AgentModelingDependencyNode[], edges: readonly AgentModelingDependencyEdge[]): void {
  const indegree = new Map(nodes.map((node) => [node.id, 0]))
  const outgoing = new Map(nodes.map((node) => [node.id, [] as string[]]))
  for (const edge of edges) {
    if (!indegree.has(edge.from) || !indegree.has(edge.to) || edge.from === edge.to) {
      throw new AgentModelingRunArtifactError('invalid_agent_dependency_graph', 'Dependency edge endpoints are invalid')
    }
    indegree.set(edge.to, indegree.get(edge.to)! + 1)
    outgoing.get(edge.from)!.push(edge.to)
  }
  const queue = [...indegree.entries()].filter(([, degree]) => degree === 0).map(([id]) => id)
  let visited = 0
  while (queue.length) {
    const id = queue.shift()!
    visited++
    for (const target of outgoing.get(id)!) {
      const next = indegree.get(target)! - 1
      indegree.set(target, next)
      if (next === 0) queue.push(target)
    }
  }
  if (visited !== nodes.length) {
    throw new AgentModelingRunArtifactError('invalid_agent_dependency_graph', 'Dependency graph contains a cycle')
  }
}

/** Parse an untrusted persisted graph and independently recheck its DAG invariants. */
export function parseAgentModelingDependencyGraph(value: unknown): AgentModelingDependencyGraph {
  if (!isRecord(value) || !exactFields(value, [
    'schemaVersion', 'fingerprint', 'runId', 'runFingerprint', 'checkpointScope', 'nodes', 'edges',
  ]) || value.schemaVersion !== ZATOM_AGENT_MODELING_DEPENDENCY_GRAPH_SCHEMA
    || typeof value.fingerprint !== 'string') {
    throw new AgentModelingRunArtifactError(
      'invalid_agent_dependency_graph',
      `Dependency graph must use ${ZATOM_AGENT_MODELING_DEPENDENCY_GRAPH_SCHEMA}`,
    )
  }
  const { fingerprint, ...rawPayload } = value
  const expectedFingerprint = fingerprintCanonicalJson(rawPayload)
  if (fingerprint !== expectedFingerprint) {
    throw new AgentModelingRunArtifactError(
      'agent_dependency_graph_fingerprint_mismatch',
      `Dependency graph fingerprint ${fingerprint} does not match ${expectedFingerprint}`,
    )
  }
  if (!Number.isSafeInteger(value.runId) || Number(value.runId) < 1
    || value.checkpointScope !== CHECKPOINT_SCOPE
    || !Array.isArray(value.nodes) || value.nodes.length < 1 || value.nodes.length > 512
    || !Array.isArray(value.edges) || value.edges.length > 1_024) {
    throw new AgentModelingRunArtifactError('invalid_agent_dependency_graph', 'Dependency graph metadata is invalid')
  }
  const nodes = value.nodes.map(parseNode)
  const edges = value.edges.map(parseEdge)
  const nodeIds = nodes.map((node) => node.id)
  if (new Set(nodeIds).size !== nodeIds.length) {
    throw new AgentModelingRunArtifactError('invalid_agent_dependency_graph', 'Dependency graph node IDs are duplicated')
  }
  const runNode = nodes.filter((node) => node.id === 'run' && node.kind === 'run')
  if (runNode.length !== 1 || runNode[0].fingerprint !== value.runFingerprint) {
    throw new AgentModelingRunArtifactError('invalid_agent_dependency_graph', 'Dependency graph run root is invalid')
  }
  const edgeKeys = edges.map((edge) => fingerprintCanonicalJson(edge))
  if (new Set(edgeKeys).size !== edgeKeys.length) {
    throw new AgentModelingRunArtifactError('invalid_agent_dependency_graph', 'Dependency graph edges are duplicated')
  }
  assertAcyclic(nodes, edges)
  const connected = new Set(edges.flatMap((edge) => [edge.from, edge.to]))
  if (nodes.some((node) => node.id !== 'run' && !connected.has(node.id))) {
    throw new AgentModelingRunArtifactError('invalid_agent_dependency_graph', 'Dependency graph contains an orphan node')
  }
  return {
    schemaVersion: ZATOM_AGENT_MODELING_DEPENDENCY_GRAPH_SCHEMA,
    fingerprint,
    runId: Number(value.runId),
    runFingerprint: text(value.runFingerprint, 'runFingerprint'),
    checkpointScope: CHECKPOINT_SCOPE,
    nodes,
    edges,
  }
}
