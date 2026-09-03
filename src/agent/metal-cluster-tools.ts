/** Agent/MCP candidate adapter for the existing finite metal-cluster builder. */

import { finalizeStructureCandidate, type CandidateEnvelope } from './candidate-tool'
import type { ZatomToolDefinition, ZatomToolManifest } from './contracts'
import {
  buildCanonicalMetalCluster,
  ZATOM_METAL_CLUSTER_GEOMETRIES,
  type BuildCanonicalMetalClusterResult,
} from './metal-cluster'
import { toolError } from './tool-helpers'

function objectSchema(properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    properties,
    ...(required.length ? { required } : {}),
  }
}

function numberOption(input: Record<string, unknown>, name: string): number | undefined {
  return input[name] === undefined ? undefined : Number(input[name])
}

const metalClusterManifest: ZatomToolManifest = {
  name: 'structure_build_metal_cluster',
  title: 'Build a finite metal cluster component',
  version: '1.0.0',
  description: 'Build an icosahedral, octahedral, cuboctahedral, FCC, HCP, or decahedral single-element metal cluster with the existing bounded zatom builder, remove its builder-only vacuum cell, center it as a finite canonical candidate, and return a structure directly accepted by structure_place_component.',
  inputSchema: objectSchema({
    geometry: { enum: ZATOM_METAL_CLUSTER_GEOMETRIES },
    element: { type: 'string', minLength: 1, maxLength: 3, description: 'A supported metallic element symbol' },
    bondLengthA: { type: 'number', minimum: 0.1, maximum: 100 },
    shells: { type: 'integer', minimum: 1, maximum: 6, description: 'Only for icosahedral, octahedral, cuboctahedral, and decahedral geometry; omitted defaults to 2' },
    radiusA: { type: 'number', exclusiveMinimum: 0, maximum: 100, description: 'Only for FCC and HCP sphere-cut geometry; omitted defaults to 6 Å' },
    maxEnumerationSites: { type: 'integer', minimum: 1, maximum: 100000, default: 50000 },
    maxAtoms: { type: 'integer', minimum: 1, maximum: 50000, default: 25000 },
    applyToWorkspace: { type: 'boolean', default: false },
    captureAfter: { type: 'boolean', description: 'Default true only when applying in a viewport-enabled host' },
  }, ['geometry', 'element']),
  effects: { structure: 'create', workspace: 'write', visual: 'read' },
  tags: ['structure', 'cluster', 'metal', 'nanoparticle', 'component', 'builder', 'validation', 'agent'],
}

type MetalClusterToolData = CandidateEnvelope<BuildCanonicalMetalClusterResult>

const metalClusterTool: ZatomToolDefinition<MetalClusterToolData> = {
  manifest: metalClusterManifest,
  execute: async (input, context) => {
    try {
      const result = buildCanonicalMetalCluster({
        geometry: input.geometry as Parameters<typeof buildCanonicalMetalCluster>[0]['geometry'],
        element: typeof input.element === 'string' ? input.element : '',
        bondLengthA: numberOption(input, 'bondLengthA'),
        shells: numberOption(input, 'shells'),
        radiusA: numberOption(input, 'radiusA'),
        maxEnumerationSites: numberOption(input, 'maxEnumerationSites'),
        maxAtoms: numberOption(input, 'maxAtoms'),
      })
      const requestedApply = input.applyToWorkspace === true
      const captureAfter = typeof input.captureAfter === 'boolean' ? input.captureAfter : requestedApply
      return await finalizeStructureCandidate({
        tool: metalClusterManifest.name,
        result,
        requestedApply,
        captureAfter,
        context,
        summary: (applied, blocked, verified) => (
          `Built finite ${result.metrics.geometry} ${result.metrics.element} cluster with ${result.metrics.atomCount.toLocaleString()} atoms`
          + `${applied ? verified === true ? ' and fingerprint-verified workspace readback' : ' and applied without verified readback' : blocked ? '; workspace application was blocked' : ''}`
        ),
      })
    } catch (error) {
      return toolError<MetalClusterToolData>(metalClusterManifest.name, error)
    }
  },
}

export const METAL_CLUSTER_ZATOM_AGENT_TOOLS: readonly ZatomToolDefinition[] = [metalClusterTool]
