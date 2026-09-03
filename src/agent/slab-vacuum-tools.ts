/** Native WebMCP tool for candidate-first slab-vacuum repair. */

import { MIN_VACUUM_A } from '../lib/analysis/builders/adsorbate'
import { finalizeStructureCandidate, type CandidateEnvelope } from './candidate-tool'
import type { ZatomToolDefinition, ZatomToolManifest } from './contracts'
import { ZATOM_STRUCTURE_JSON_SCHEMA } from './contracts'
import {
  ensureSlabVacuum,
  SlabVacuumInputError,
  type EnsureSlabVacuumResult,
  type SlabVacuumAxis,
} from './slab-vacuum'
import { fingerprintStructure } from './structure-math'
import { numberOption, objectSchema, resolveStructure, toolError } from './tool-helpers'

const manifest: ZatomToolManifest = {
  name: 'structure_ensure_slab_vacuum',
  title: 'Ensure slab vacuum',
  version: '1.0.0',
  description:
    'Ensure a minimum slab vacuum without shrinking an existing gap. Auto uses one declared open axis or a unique vacuum gap and refuses ambiguous bulk/boxed systems. Only perpendicular cell spacing grows; shear, geometry, bonds, metadata, and periodicity flags stay intact. Returns a candidate by default; applyToWorkspace requests a write or a ghost proposal under Propose only.',
  inputSchema: objectSchema({
    structure: ZATOM_STRUCTURE_JSON_SCHEMA,
    minimumVacuumA: {
      type: 'number',
      minimum: MIN_VACUUM_A,
      maximum: 10_000,
      default: 12,
      description: `Minimum empty spacing in Å; must be at least the ${MIN_VACUUM_A} Å surface-detection threshold.`,
    },
    axis: {
      enum: ['auto', 'a', 'b', 'c'],
      default: 'auto',
      description: 'Use auto after scene_observe; pass a/b/c only when the intended surface-normal axis is known.',
    },
    expectedFingerprint: {
      type: 'string',
      description: 'Previously observed active-structure fingerprint; stale state fails closed.',
    },
    applyToWorkspace: { type: 'boolean', default: false, description: 'Explicitly request application; Propose-only publishes a ghost.' },
    captureAfter: { type: 'boolean', description: 'Capture the directly applied, verified result.' },
  }),
  effects: { structure: 'replace', workspace: 'write', visual: 'read' },
  tags: ['structure', 'surface', 'slab', 'vacuum', 'lattice', 'candidate', 'validation', 'agent'],
}

type ToolData = CandidateEnvelope<EnsureSlabVacuumResult>

const tool: ZatomToolDefinition<ToolData> = {
  manifest,
  execute: async (input, context) => {
    try {
      const structure = await resolveStructure(input, context)
      if (typeof input.expectedFingerprint === 'string' && input.structure === undefined) {
        const actual = fingerprintStructure(structure)
        if (actual !== input.expectedFingerprint) {
          throw new SlabVacuumInputError(
            'stale_fingerprint',
            `Active structure fingerprint is ${actual}, not ${input.expectedFingerprint}. Re-observe before changing its cell.`,
          )
        }
      }
      const axis = typeof input.axis === 'string' ? input.axis as SlabVacuumAxis : undefined
      const result = ensureSlabVacuum({
        structure,
        minimumVacuumA: numberOption(input, 'minimumVacuumA'),
        axis,
      })
      const requestedApply = input.applyToWorkspace === true
      // An ensure operation that is already satisfied must be a real no-op: do
      // not create an empty proposal, history entry, revision, or review card.
      const applyChangedCandidate = requestedApply && result.changed
      const captureAfter = result.changed
        && (typeof input.captureAfter === 'boolean' ? input.captureAfter : requestedApply)
      return await finalizeStructureCandidate({
        tool: manifest.name,
        result,
        requestedApply: applyChangedCandidate,
        captureAfter,
        context,
        summary: (applied, blocked, verified) => result.changed
          ? `Ensured ${result.metrics.achievedVacuumA.toFixed(3)} Å vacuum along ${result.metrics.axis} (+${result.metrics.addedVacuumA.toFixed(3)} Å perpendicular cell spacing)${applied ? verified === true ? ' and fingerprint-verified the active workspace' : verified === false ? '; workspace readback did not match the candidate' : ' and updated the active workspace without readback' : blocked ? '; workspace application was blocked' : '; returned a candidate without changing the workspace'}`
          : `Existing ${result.metrics.sourceVacuumA.toFixed(3)} Å vacuum along ${result.metrics.axis} already meets the ${result.metrics.requestedMinimumVacuumA.toFixed(3)} Å minimum; no proposal, write, revision, or review was created.`,
      })
    } catch (error) {
      return toolError<ToolData>(manifest.name, error)
    }
  },
}

export const SLAB_VACUUM_ZATOM_AGENT_TOOLS: readonly ZatomToolDefinition[] = [tool]
