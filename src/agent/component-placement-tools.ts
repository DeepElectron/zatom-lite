/** Agent/MCP adapter for placing one finite structure component into a host. */

import { finalizeStructureCandidate, type CandidateEnvelope } from './candidate-tool'
import { placeStructureComponent, type PlaceStructureComponentResult } from './component-placement'
import type {
  Vec3,
  ZatomStructure,
  ZatomToolContext,
  ZatomToolDefinition,
  ZatomToolManifest,
} from './contracts'
import { ZATOM_STRUCTURE_JSON_SCHEMA } from './contracts'
import { parseZatomStructure, ZatomStructureInputError } from './structure-validation'
import { toolError } from './tool-helpers'

function objectSchema(properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    properties,
    ...(required.length ? { required } : {}),
  }
}

const vec3Schema = { type: 'array', minItems: 3, maxItems: 3, items: { type: 'number' } }

async function resolveHost(input: Record<string, unknown>, context: ZatomToolContext): Promise<ZatomStructure> {
  if (input.structure !== undefined) return parseZatomStructure(input.structure)
  const structure = await context.readStructure?.()
  if (!structure) {
    throw new ZatomStructureInputError('no_active_structure', 'No host structure was supplied and the active workspace is empty')
  }
  return parseZatomStructure(structure)
}

function vec3Option(value: unknown): Vec3 | undefined {
  return Array.isArray(value) ? value.map(Number) as Vec3 : undefined
}

function numberOption(input: Record<string, unknown>, name: string): number | undefined {
  return input[name] === undefined ? undefined : Number(input[name])
}

const placeComponentManifest: ZatomToolManifest = {
  name: 'structure_place_component',
  title: 'Place a finite structure component',
  version: '1.0.0',
  description: 'Rigidly rotate and translate one finite molecule, cluster, or structure into an explicit or active host. Preserve supplied internal bonds, preserve every non-conflicting ID, deterministically namespace collisions, inherit only the host lattice, and run an exact finite or certified periodic host-component collision audit before optional workspace application.',
  inputSchema: objectSchema({
    structure: ZATOM_STRUCTURE_JSON_SCHEMA,
    component: ZATOM_STRUCTURE_JSON_SCHEMA,
    componentId: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9._-]{0,63}$' },
    translationA: vec3Schema,
    rotationAxis: vec3Schema,
    rotationAngleDeg: { type: 'number', minimum: -36000, maximum: 36000 },
    rotationOriginA: vec3Schema,
    minimumHostDistanceA: { type: 'number', minimum: 0, maximum: 100, default: 0.65 },
    hostDistanceWarningA: { type: 'number', minimum: 0, maximum: 100, default: 0.9 },
    maxOutputAtoms: { type: 'integer', minimum: 1, maximum: 100000, default: 100000 },
    maxHostComponentPairChecks: { type: 'integer', minimum: 1, maximum: 5000000, default: 1000000 },
    maxPeriodicImageCandidates: { type: 'integer', minimum: 1, maximum: 100000000, default: 5000000 },
    applyToWorkspace: { type: 'boolean', default: false },
    captureAfter: { type: 'boolean', description: 'Default true only when applying in a viewport-enabled host' },
  }, ['component', 'componentId']),
  effects: { structure: 'replace', workspace: 'write', visual: 'read' },
  tags: ['structure', 'component', 'molecule', 'cluster', 'placement', 'rigid-transform', 'collision', 'validation', 'agent'],
}

type PlaceComponentToolData = CandidateEnvelope<PlaceStructureComponentResult>

const placeComponentTool: ZatomToolDefinition<PlaceComponentToolData> = {
  manifest: placeComponentManifest,
  execute: async (input, context) => {
    try {
      const result = placeStructureComponent({
        host: await resolveHost(input, context),
        component: parseZatomStructure(input.component),
        componentId: typeof input.componentId === 'string' ? input.componentId : '',
        translationA: vec3Option(input.translationA),
        rotationAxis: vec3Option(input.rotationAxis),
        rotationAngleDeg: numberOption(input, 'rotationAngleDeg'),
        rotationOriginA: vec3Option(input.rotationOriginA),
        minimumHostDistanceA: numberOption(input, 'minimumHostDistanceA'),
        hostDistanceWarningA: numberOption(input, 'hostDistanceWarningA'),
        maxOutputAtoms: numberOption(input, 'maxOutputAtoms'),
        maxHostComponentPairChecks: numberOption(input, 'maxHostComponentPairChecks'),
        maxPeriodicImageCandidates: numberOption(input, 'maxPeriodicImageCandidates'),
      })
      const requestedApply = input.applyToWorkspace === true
      const captureAfter = typeof input.captureAfter === 'boolean' ? input.captureAfter : requestedApply
      return await finalizeStructureCandidate({
        tool: placeComponentManifest.name,
        result,
        requestedApply,
        captureAfter,
        context,
        summary: (applied, blocked, verified) => (
          `Placed ${result.component.atomCount.toLocaleString()}-atom component ${result.component.id}; minimum host distance ${result.observedMinimumHostDistanceA === null ? 'unresolved' : `${result.observedMinimumHostDistanceA.toFixed(4)} Å`}`
          + `${applied ? verified === true ? ' and fingerprint-verified workspace readback' : ' and applied without verified readback' : blocked ? '; workspace application was blocked' : ''}`
        ),
      })
    } catch (error) {
      return toolError<PlaceComponentToolData>(placeComponentManifest.name, error)
    }
  },
}

export const COMPONENT_PLACEMENT_ZATOM_AGENT_TOOLS: readonly ZatomToolDefinition[] = [placeComponentTool]
