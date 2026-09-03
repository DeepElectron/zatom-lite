/** MCP-facing finite polycrystal construction. */

import type { ZatomToolDefinition, ZatomToolManifest } from './contracts'
import { ZATOM_STRUCTURE_JSON_SCHEMA } from './contracts'
import { finalizeStructureCandidate, type CandidateEnvelope } from './candidate-tool'
import {
  buildZatomPolycrystal,
  type BuildZatomPolycrystalResult,
  ZatomPolycrystalInputError,
} from './polycrystal'
import { resolveStructure, toolError } from './tool-helpers'

const TOOL_NAME = 'structure_build_polycrystal'

function numberValue(input: Record<string, unknown>, field: string, fallback: number): number {
  if (input[field] === undefined) return fallback
  if (typeof input[field] !== 'number' || !Number.isFinite(input[field])) {
    throw new ZatomPolycrystalInputError('invalid_polycrystal_input', `${field} must be a finite number`)
  }
  return Number(input[field])
}

const manifest: ZatomToolManifest = {
  name: TOOL_NAME,
  title: 'Build a finite Voronoi polycrystal',
  version: '1.0.0',
  description: 'Fill a bounded cubic box with deterministic Euclidean Voronoi grains of any fully periodic parent cell, assign Shoemake-uniform SO(3) orientations, remove cross-grain overlaps, preserve source-site identity and atom properties, and return grain/rotation/contact evidence plus visual targets. This creates a finite unrelaxed geometry seed, not a periodic or energetic grain-boundary model.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['boxSizeA', 'grainCount'],
    properties: {
      structure: ZATOM_STRUCTURE_JSON_SCHEMA,
      boxSizeA: { type: 'number', minimum: 1, maximum: 1000, description: 'Finite cubic box edge in Å' },
      grainCount: { type: 'integer', minimum: 1, maximum: 256 },
      minSeedDistanceA: { type: 'number', minimum: 0, maximum: 1000, default: 0 },
      overlapDistanceA: {
        type: 'number', minimum: 0, maximum: 20, default: 1.5,
        description: 'Delete the higher-index atom in cross-grain pairs closer than this distance; zero explicitly disables pruning',
      },
      maxAtoms: { type: 'integer', minimum: 1, maximum: 500_000, default: 100_000 },
      seed: { type: 'integer', minimum: 0, maximum: 0xffffffff, default: 2024 },
      label: { type: 'string', minLength: 1, maxLength: 512 },
      applyToWorkspace: { type: 'boolean', default: false, description: 'Apply only when explicitly true and every numeric construction gate passes' },
      captureAfter: { type: 'boolean', description: 'Default true only when applying in a viewport-enabled host' },
    },
  },
  effects: { structure: 'create', workspace: 'write', visual: 'read' },
  tags: ['structure', 'polycrystal', 'grain', 'grain-boundary', 'voronoi', 'mesoscale', 'defect', 'visual-validation'],
}

type ToolData = CandidateEnvelope<BuildZatomPolycrystalResult>

const tool: ZatomToolDefinition<ToolData> = {
  manifest,
  execute: async (input, context) => {
    try {
      const source = await resolveStructure(input, context)
      const result = buildZatomPolycrystal({
        source,
        boxSizeA: numberValue(input, 'boxSizeA', Number.NaN),
        grainCount: numberValue(input, 'grainCount', Number.NaN),
        minSeedDistanceA: numberValue(input, 'minSeedDistanceA', 0),
        overlapDistanceA: numberValue(input, 'overlapDistanceA', 1.5),
        maxAtoms: numberValue(input, 'maxAtoms', 100_000),
        seed: numberValue(input, 'seed', 2024),
        ...(typeof input.label === 'string' ? { label: input.label } : {}),
      })
      const requestedApply = input.applyToWorkspace === true
      const captureAfter = typeof input.captureAfter === 'boolean' ? input.captureAfter : requestedApply
      return await finalizeStructureCandidate({
        tool: TOOL_NAME,
        result,
        requestedApply,
        captureAfter,
        context,
        summary: (applied, blocked, verified) => (
          `Built a ${result.metrics.atomCount.toLocaleString()}-atom finite polycrystal with ${result.metrics.realizedGrainCount}/${result.metrics.grainCount} realized grains`
          + `${applied ? verified === true ? ' and fingerprint-verified workspace readback' : ' and applied it without verified readback' : blocked ? '; workspace application was blocked' : ''}`
        ),
      })
    } catch (error) {
      return toolError<ToolData>(TOOL_NAME, error)
    }
  },
}

export const POLYCRYSTAL_ZATOM_AGENT_TOOLS: readonly ZatomToolDefinition[] = [tool]
