/** MCP-facing replay validation for canonical fully periodic dislocation-dipole evidence. */

import type { ZatomToolDefinition } from './contracts'
import { ZATOM_STRUCTURE_JSON_SCHEMA } from './contracts'
import {
  parseZatomPeriodicDislocationDipoleEvidence,
  type ZatomPeriodicDislocationDipoleEvidenceValidation,
  ZatomPeriodicDislocationDipoleEvidenceInputError,
  ZATOM_PERIODIC_DISLOCATION_DIPOLE_EVIDENCE_SCHEMA,
} from './periodic-dislocation-dipole-evidence'
import { parseZatomStructure } from './structure-validation'
import { toolError } from './tool-helpers'

const TOOL_NAME = 'periodic_dislocation_validate_dipole_evidence'

const validatePeriodicDislocationDipoleEvidenceTool:
ZatomToolDefinition<ZatomPeriodicDislocationDipoleEvidenceValidation> = {
  manifest: {
    name: TOOL_NAME,
    title: 'Validate canonical fully periodic screw-dipole evidence',
    version: '1.0.0',
    description: `Validate and canonicalize ${ZATOM_PERIODIC_DISLOCATION_DIPOLE_EVIDENCE_SCHEMA} against exact source/result structures and its embedded perfect reference. Recompute full-lattice screw crystallography, tensor definiteness, generated identity, exact balancing shear, core geometry, certified skew-cell minimum-image contacts, nonaffine displacement, canonical periodic seam probes, image-replica convergence, fingerprints, LAMMPS-handoff gates, and visual targets. This audits producer evidence; it does not independently solve the Stroh field or prove relaxation, stability, potential consistency, or infinite-size convergence.`,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['evidence', 'sourceStructure'],
      properties: {
        evidence: {
          type: 'object',
          required: [
            'schemaVersion', 'sourceStructureFingerprint', 'referenceStructureFingerprint',
            'resultStructureFingerprint', 'referenceStructure', 'elasticity', 'crystallography',
            'construction', 'mapping', 'boundary', 'periodicityProbes', 'imageConvergence',
            'acceptance', 'metrics', 'diagnostics', 'provenance',
          ],
          properties: { schemaVersion: { const: ZATOM_PERIODIC_DISLOCATION_DIPOLE_EVIDENCE_SCHEMA } },
        },
        sourceStructure: ZATOM_STRUCTURE_JSON_SCHEMA,
        resultStructure: { ...ZATOM_STRUCTURE_JSON_SCHEMA, description: 'Exact periodic dipole result; defaults to the active workspace.' },
        useActiveResult: { type: 'boolean', default: true },
      },
    },
    effects: { structure: 'read', workspace: 'read', visual: 'none' },
    tags: ['dislocation', 'screw', 'anisotropic-elasticity', 'periodic-dipole', 'quality-evidence', 'validation', 'lammps-handoff'],
  },
  execute: async (input, context) => {
    try {
      const rawResult = input.resultStructure !== undefined
        ? input.resultStructure
        : input.useActiveResult === false
          ? null
          : await context.readStructure?.() ?? null
      if (!rawResult) {
        throw new ZatomPeriodicDislocationDipoleEvidenceInputError(
          'periodic_dislocation_result_required',
          'An explicit or active periodic-dislocation result structure is required',
        )
      }
      const result = parseZatomPeriodicDislocationDipoleEvidence(input.evidence, {
        sourceStructure: parseZatomStructure(input.sourceStructure),
        resultStructure: parseZatomStructure(rawResult),
      })
      return {
        ok: true,
        tool: TOOL_NAME,
        summary: `Validated ${result.evidence.schemaVersion} ${result.fingerprint}: |b|=${result.evidence.crystallography.burgersMagnitudeA.toPrecision(6)} Å, seam=${result.evidence.metrics.maximumPeriodicSeamResidualA.toPrecision(5)} Å, pair=${result.evidence.metrics.minimumPairDistanceA.toPrecision(6)} Å`,
        data: result,
        checks: result.checks,
      }
    } catch (error) {
      return toolError(TOOL_NAME, error)
    }
  },
}

export const PERIODIC_DISLOCATION_DIPOLE_EVIDENCE_ZATOM_AGENT_TOOLS:
readonly ZatomToolDefinition[] = [validatePeriodicDislocationDipoleEvidenceTool]
