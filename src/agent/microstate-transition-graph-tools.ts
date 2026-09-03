/** MCP-facing validation and equilibrium solving for canonical chemical-microstate graphs. */

import type { ZatomToolDefinition, ZatomToolResult } from './contracts'
import { ZATOM_STRUCTURE_JSON_SCHEMA } from './contracts'
import {
  parseZatomMicrostateTransitionGraph,
  solveZatomMicrostatePopulations,
  type ZatomMicrostatePopulationSolveResult,
  type ZatomMicrostateTransitionGraphValidation,
  ZatomMicrostateTransitionGraphInputError,
  ZATOM_MICROSTATE_TRANSITION_GRAPH_SCHEMA,
} from './microstate-transition-graph'
import {
  scanZatomMicrostateTitration,
  type ZatomMicrostateTitrationResult,
} from './microstate-titration'
import { ZATOM_CHEMICAL_STATE_ENSEMBLE_SCHEMA } from './chemical-state-ensemble'
import {
  parseZatomMicrostateStateCoverage,
  type ZatomMicrostateStateCoverageValidation,
  ZatomMicrostateStateCoverageInputError,
  ZATOM_MICROSTATE_STATE_COVERAGE_SCHEMA,
} from './microstate-state-coverage'
import {
  composeZatomMicrostatePotentialMixture,
  parseZatomMicrostateEquilibriumPotentialEnsemble,
  type ZatomMicrostateEquilibriumPotentialEnsembleValidation,
  type ZatomMicrostatePotentialMixtureValidation,
  ZatomMicrostateEquilibriumPotentialEnsembleInputError,
  ZATOM_MICROSTATE_EQUILIBRIUM_POTENTIAL_ENSEMBLE_SCHEMA,
} from './microstate-equilibrium-potential-ensemble'
import {
  createZatomMicrostatePotentialSampleDiagnostics,
  type ZatomMicrostatePotentialSampleDiagnosticsValidation,
  ZatomMicrostatePotentialSampleDiagnosticsInputError,
  ZATOM_MICROSTATE_POTENTIAL_SAMPLE_DIAGNOSTICS_SCHEMA,
} from './microstate-potential-sample-diagnostics'
import { parseZatomStructure, ZatomStructureInputError } from './structure-validation'

async function resolveStructure(
  input: Record<string, unknown>,
  readStructure: (() => Promise<unknown>) | undefined,
): Promise<ReturnType<typeof parseZatomStructure>> {
  const raw = input.structure !== undefined
    ? input.structure
    : input.useActiveStructure === false
      ? null
      : await readStructure?.() ?? null
  if (!raw) {
    throw new ZatomMicrostateTransitionGraphInputError(
      'microstate_selected_structure_required',
      'An explicit or active selected molecular structure is required',
    )
  }
  return parseZatomStructure(raw)
}

const graphSchema = {
  type: 'object',
  description: `Canonical ${ZATOM_MICROSTATE_TRANSITION_GRAPH_SCHEMA} artifact.`,
  required: [
    'schemaVersion',
    'chemicalStateEnsembleFingerprint',
    'conditions',
    'completeness',
    'states',
    'edges',
    'evidenceSources',
    'acceptance',
    'provenance',
  ],
  properties: { schemaVersion: { const: ZATOM_MICROSTATE_TRANSITION_GRAPH_SCHEMA } },
} as const

const ensembleSchema = {
  type: 'object',
  description: `Canonical pre-population ${ZATOM_CHEMICAL_STATE_ENSEMBLE_SCHEMA} artifact bound by the graph.`,
  required: [
    'schemaVersion',
    'selectedStructureFingerprint',
    'enumeration',
    'source',
    'normalized',
    'states',
    'selection',
    'provenance',
  ],
  properties: { schemaVersion: { const: ZATOM_CHEMICAL_STATE_ENSEMBLE_SCHEMA } },
} as const

const stateCoverageSchema = {
  type: 'object',
  description: `Canonical ${ZATOM_MICROSTATE_STATE_COVERAGE_SCHEMA} artifact bound to the exact ensemble and graph.`,
  required: [
    'schemaVersion',
    'chemicalStateEnsembleFingerprint',
    'microstateTransitionGraphFingerprint',
    'returnedStateCount',
    'pHDomain',
    'assessment',
    'provenance',
  ],
  properties: { schemaVersion: { const: ZATOM_MICROSTATE_STATE_COVERAGE_SCHEMA } },
} as const

const potentialEnsembleSchema = {
  type: 'object',
  description: `Canonical ${ZATOM_MICROSTATE_EQUILIBRIUM_POTENTIAL_ENSEMBLE_SCHEMA} artifact bound to the exact ensemble and graph.`,
  required: [
    'schemaVersion',
    'chemicalStateEnsembleFingerprint',
    'microstateTransitionGraphFingerprint',
    'referenceStateId',
    'stateIds',
    'pHDomain',
    'samples',
    'acceptance',
    'uncertaintyModel',
    'provenance',
  ],
  properties: { schemaVersion: { const: ZATOM_MICROSTATE_EQUILIBRIUM_POTENTIAL_ENSEMBLE_SCHEMA } },
} as const

const potentialSampleDiagnosticsSchema = {
  type: 'object',
  description: `Canonical ${ZATOM_MICROSTATE_POTENTIAL_SAMPLE_DIAGNOSTICS_SCHEMA} artifact bound to the exact potential ensemble.`,
  required: [
    'schemaVersion',
    'equilibriumPotentialEnsembleFingerprint',
    'sampleIds',
    'design',
    'acceptance',
    'stateDiagnostics',
    'overallPassed',
    'provenance',
  ],
  properties: { schemaVersion: { const: ZATOM_MICROSTATE_POTENTIAL_SAMPLE_DIAGNOSTICS_SCHEMA } },
} as const

interface ValidateMicrostateStateCoverageResult {
  graphValidation: ZatomMicrostateTransitionGraphValidation
  coverageValidation: ZatomMicrostateStateCoverageValidation
  checks: ZatomMicrostateTransitionGraphValidation['checks']
  inspectionTargets: ZatomMicrostateTransitionGraphValidation['inspectionTargets']
}

interface ValidateMicrostatePotentialEnsembleResult {
  graphValidation: ZatomMicrostateTransitionGraphValidation
  potentialEnsembleValidation: ZatomMicrostateEquilibriumPotentialEnsembleValidation
  checks: ZatomMicrostateTransitionGraphValidation['checks']
  inspectionTargets: ZatomMicrostateTransitionGraphValidation['inspectionTargets']
}

interface ComposeMicrostatePotentialMixtureResult {
  graphValidation: ZatomMicrostateTransitionGraphValidation
  mixtureValidation: ZatomMicrostatePotentialMixtureValidation
  checks: ZatomMicrostateTransitionGraphValidation['checks']
  inspectionTargets: ZatomMicrostateTransitionGraphValidation['inspectionTargets']
}

interface DiagnoseMicrostatePotentialSamplesResult {
  graphValidation: ZatomMicrostateTransitionGraphValidation
  potentialEnsembleValidation: ZatomMicrostateEquilibriumPotentialEnsembleValidation
  sampleDiagnosticsValidation: ZatomMicrostatePotentialSampleDiagnosticsValidation
  checks: ZatomMicrostateTransitionGraphValidation['checks']
  inspectionTargets: ZatomMicrostateTransitionGraphValidation['inspectionTargets']
}

const validateMicrostateGraphTool: ZatomToolDefinition<ZatomMicrostateTransitionGraphValidation> = {
  manifest: {
    name: 'microstate_validate_transition_graph',
    title: 'Validate a canonical microstate transition graph',
    version: '1.0.0',
    description: 'Bind a protonation/tautomer transition graph to an exact chemical-state ensemble and selected structure; audit proton/charge ladders, edge stoichiometry/evidence, graph connectivity, state/transition completeness, fundamental-cycle thermodynamic closure, uncertainty coverage, applicability, provenance, and visual localization without yet claiming populations.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['graph', 'chemicalStateEnsemble'],
      properties: {
        graph: graphSchema,
        chemicalStateEnsemble: ensembleSchema,
        structure: ZATOM_STRUCTURE_JSON_SCHEMA,
        useActiveStructure: {
          type: 'boolean',
          default: true,
          description: 'Read the exact selected-state structure from the active workspace when omitted.',
        },
      },
    },
    effects: { structure: 'read', workspace: 'read', visual: 'none' },
    tags: [
      'molecule',
      'chemical-state',
      'microstate',
      'protonation',
      'tautomer',
      'pka',
      'free-energy',
      'thermodynamic-cycle',
      'validation',
      'fingerprint',
      'visual-validation',
    ],
  },
  execute: async (input, context): Promise<ZatomToolResult<ZatomMicrostateTransitionGraphValidation>> => {
    try {
      const structure = await resolveStructure(input, context.readStructure as (() => Promise<unknown>) | undefined)
      const result = parseZatomMicrostateTransitionGraph(input.graph, {
        structure,
        chemicalStateEnsemble: input.chemicalStateEnsemble as never,
      })
      return {
        ok: true,
        tool: 'microstate_validate_transition_graph',
        summary: `Validated ${result.graph.schemaVersion} ${result.fingerprint}: ${result.graph.states.length} states, ${result.graph.edges.length} edges, ${result.thermodynamicAudit.cycleRank} independent cycle(s)`,
        data: result,
        checks: result.checks,
      }
    } catch (error) {
      if (error instanceof ZatomMicrostateTransitionGraphInputError || error instanceof ZatomStructureInputError) {
        return {
          ok: false,
          tool: 'microstate_validate_transition_graph',
          summary: error.message,
          error: { code: error.code, message: error.message },
        }
      }
      const message = error instanceof Error ? error.message : String(error)
      return {
        ok: false,
        tool: 'microstate_validate_transition_graph',
        summary: message,
        error: { code: 'microstate_transition_graph_validation_failed', message },
      }
    }
  },
}

const validateMicrostateStateCoverageTool: ZatomToolDefinition<ValidateMicrostateStateCoverageResult> = {
  manifest: {
    name: 'microstate_validate_state_coverage',
    title: 'Validate microstate state-universe coverage',
    version: '1.0.0',
    description: 'Bind a canonical state-coverage assessment to an exact pre-population chemical-state ensemble and transition graph. Distinguish a complete state universe, a pointwise total omitted-population bound, and unknown total censoring without inferring a total bound from a per-state display threshold.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['stateCoverage', 'graph', 'chemicalStateEnsemble'],
      properties: {
        stateCoverage: stateCoverageSchema,
        graph: graphSchema,
        chemicalStateEnsemble: ensembleSchema,
        structure: ZATOM_STRUCTURE_JSON_SCHEMA,
        useActiveStructure: {
          type: 'boolean',
          default: true,
          description: 'Read the exact selected-state structure from the active workspace when omitted.',
        },
      },
    },
    effects: { structure: 'read', workspace: 'read', visual: 'none' },
    tags: [
      'molecule',
      'chemical-state',
      'microstate',
      'population',
      'state-coverage',
      'censoring',
      'uncertainty',
      'validation',
      'fingerprint',
    ],
  },
  execute: async (input, context): Promise<ZatomToolResult<ValidateMicrostateStateCoverageResult>> => {
    try {
      const structure = await resolveStructure(input, context.readStructure as (() => Promise<unknown>) | undefined)
      const graphValidation = parseZatomMicrostateTransitionGraph(input.graph, {
        structure,
        chemicalStateEnsemble: input.chemicalStateEnsemble as never,
      })
      const coverageValidation = parseZatomMicrostateStateCoverage(input.stateCoverage, {
        chemicalStateEnsembleFingerprint: graphValidation.graph.chemicalStateEnsembleFingerprint,
        microstateTransitionGraphFingerprint: graphValidation.fingerprint,
        stateEnumerationComplete: graphValidation.chemicalStateEnsemble.enumeration.complete,
        returnedStateCount: graphValidation.graph.states.length,
      })
      const result: ValidateMicrostateStateCoverageResult = {
        graphValidation,
        coverageValidation,
        checks: [...graphValidation.checks, ...coverageValidation.checks],
        inspectionTargets: graphValidation.inspectionTargets,
      }
      return {
        ok: true,
        tool: 'microstate_validate_state_coverage',
        summary: `Validated ${coverageValidation.coverage.assessment.kind} coverage ${coverageValidation.fingerprint} for ${coverageValidation.coverage.returnedStateCount} returned state(s)`,
        data: result,
        checks: result.checks,
      }
    } catch (error) {
      if (error instanceof ZatomMicrostateTransitionGraphInputError
        || error instanceof ZatomMicrostateStateCoverageInputError
        || error instanceof ZatomStructureInputError) {
        return {
          ok: false,
          tool: 'microstate_validate_state_coverage',
          summary: error.message,
          error: { code: error.code, message: error.message },
        }
      }
      const message = error instanceof Error ? error.message : String(error)
      return {
        ok: false,
        tool: 'microstate_validate_state_coverage',
        summary: message,
        error: { code: 'microstate_state_coverage_validation_failed', message },
      }
    }
  },
}

const composeMicrostatePotentialMixtureTool: ZatomToolDefinition<ComposeMicrostatePotentialMixtureResult> = {
  manifest: {
    name: 'microstate_compose_potential_mixture',
    title: 'Compose model-family microstate potential samples',
    version: '1.0.0',
    description: 'Compose two or more exact graph-bound joint-potential ensembles into one canonical calibrated model mixture. Multiply explicit component and within-component sample weights, bind every component fingerprint and model-weight calibration artifact, gate component and flattened Kish effective counts, preserve pH/gauge/applicability, and report within-versus-between-component variance for every state. This tool does not infer model weights, prove family completeness, or diagnose sampler convergence.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: [
        'components',
        'acceptance',
        'uncertaintyModel',
        'provenance',
        'graph',
        'chemicalStateEnsemble',
      ],
      properties: {
        components: {
          type: 'array',
          minItems: 2,
          maxItems: 32,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'weight', 'potentialEnsemble'],
            properties: {
              id: { type: 'string', minLength: 1, maxLength: 128 },
              weight: { type: 'number', exclusiveMinimum: 0, maximum: 1 },
              potentialEnsemble: potentialEnsembleSchema,
            },
          },
        },
        acceptance: {
          type: 'object',
          additionalProperties: false,
          required: [
            'minimumComponentWeightEffectiveCount',
            'minimumWeightEffectiveSampleSize',
          ],
          properties: {
            minimumComponentWeightEffectiveCount: { type: 'number', minimum: 1 },
            minimumWeightEffectiveSampleSize: { type: 'number', minimum: 1 },
          },
        },
        uncertaintyModel: {
          type: 'object',
          additionalProperties: false,
          required: ['method', 'assumptions', 'applicability', 'scopeWarning'],
          properties: {
            method: { type: 'string', minLength: 1, maxLength: 4096 },
            assumptions: {
              type: 'array', minItems: 1, maxItems: 64,
              items: { type: 'string', minLength: 1, maxLength: 4096 },
            },
            applicability: {
              type: 'object',
              additionalProperties: false,
              required: ['assessment', 'domain', 'reasons'],
              properties: {
                assessment: { enum: ['in-domain', 'out-of-domain', 'unknown'] },
                domain: { type: 'string', minLength: 1, maxLength: 4096 },
                reasons: {
                  type: 'array', minItems: 1, maxItems: 64,
                  items: { type: 'string', minLength: 1, maxLength: 4096 },
                },
              },
            },
            scopeWarning: { type: 'string', minLength: 1, maxLength: 8192 },
          },
        },
        provenance: {
          type: 'object',
          additionalProperties: false,
          required: [
            'engine',
            'engineVersion',
            'method',
            'calibrationArtifacts',
            'parameters',
            'citations',
            'scopeWarning',
          ],
          properties: {
            engine: { type: 'string', minLength: 1, maxLength: 256 },
            engineVersion: { type: 'string', minLength: 1, maxLength: 256 },
            method: { type: 'string', minLength: 1, maxLength: 4096 },
            calibrationArtifacts: {
              type: 'array',
              minItems: 1,
              maxItems: 62,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['id', 'role', 'fingerprint'],
                properties: {
                  id: { type: 'string', minLength: 1, maxLength: 128 },
                  role: { type: 'string', minLength: 1, maxLength: 1024 },
                  fingerprint: { type: 'string', minLength: 1, maxLength: 256 },
                },
              },
            },
            parameters: { type: 'object' },
            citations: {
              type: 'array', minItems: 1, maxItems: 32,
              items: { type: 'string', minLength: 1, maxLength: 4096 },
            },
            scopeWarning: { type: 'string', minLength: 1, maxLength: 8192 },
          },
        },
        metadata: { type: 'object' },
        graph: graphSchema,
        chemicalStateEnsemble: ensembleSchema,
        structure: ZATOM_STRUCTURE_JSON_SCHEMA,
        useActiveStructure: {
          type: 'boolean',
          default: true,
          description: 'Read the exact selected-state structure from the active workspace when omitted.',
        },
      },
    },
    effects: { structure: 'read', workspace: 'read', visual: 'none' },
    tags: [
      'molecule',
      'chemical-state',
      'microstate',
      'population',
      'uncertainty',
      'model-mixture',
      'correlation-model',
      'variance-decomposition',
      'joint-samples',
      'fingerprint',
    ],
  },
  execute: async (input, context): Promise<ZatomToolResult<ComposeMicrostatePotentialMixtureResult>> => {
    try {
      const structure = await resolveStructure(input, context.readStructure as (() => Promise<unknown>) | undefined)
      const graphValidation = parseZatomMicrostateTransitionGraph(input.graph, {
        structure,
        chemicalStateEnsemble: input.chemicalStateEnsemble as never,
      })
      const mixtureValidation = composeZatomMicrostatePotentialMixture({
        components: input.components,
        acceptance: input.acceptance,
        uncertaintyModel: input.uncertaintyModel,
        provenance: input.provenance,
        ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
      }, {
        chemicalStateEnsembleFingerprint: graphValidation.graph.chemicalStateEnsembleFingerprint,
        microstateTransitionGraphFingerprint: graphValidation.fingerprint,
        canonicalStateIds: graphValidation.graph.states.map((state) => state.stateId),
        referenceStateId: graphValidation.graph.states[0].stateId,
      })
      const checks = [
        ...graphValidation.checks,
        ...mixtureValidation.componentValidations.flatMap(({ validation }) => validation.checks),
        ...mixtureValidation.potentialEnsembleValidation.checks,
        ...mixtureValidation.checks,
      ]
      const result: ComposeMicrostatePotentialMixtureResult = {
        graphValidation,
        mixtureValidation,
        checks,
        inspectionTargets: graphValidation.inspectionTargets,
      }
      return {
        ok: true,
        tool: 'microstate_compose_potential_mixture',
        summary: `Composed ${mixtureValidation.components.length} model/correlation-family ensembles into ${mixtureValidation.potentialEnsembleValidation.ensemble.samples.length} joint samples with component effective count ${mixtureValidation.componentWeightEffectiveCount.toFixed(3)} and flattened Kish ESS ${mixtureValidation.potentialEnsembleValidation.weightEffectiveSampleSize.toFixed(3)}`,
        data: result,
        checks,
      }
    } catch (error) {
      if (error instanceof ZatomMicrostateTransitionGraphInputError
        || error instanceof ZatomMicrostateEquilibriumPotentialEnsembleInputError
        || error instanceof ZatomStructureInputError) {
        return {
          ok: false,
          tool: 'microstate_compose_potential_mixture',
          summary: error.message,
          error: { code: error.code, message: error.message },
        }
      }
      const message = error instanceof Error ? error.message : String(error)
      return {
        ok: false,
        tool: 'microstate_compose_potential_mixture',
        summary: message,
        error: { code: 'microstate_potential_mixture_composition_failed', message },
      }
    }
  },
}

const validateMicrostatePotentialEnsembleTool: ZatomToolDefinition<ValidateMicrostatePotentialEnsembleResult> = {
  manifest: {
    name: 'microstate_validate_potential_ensemble',
    title: 'Validate joint microstate potential samples',
    version: '1.0.0',
    description: 'Bind weighted joint samples of every gauge-fixed pH-zero state potential to an exact canonical ensemble and graph. Canonicalize state/sample order and verify gauge, weight normalization, Kish weight effective size, applicability, provenance, and bounded evidence without imposing Gaussian or independence assumptions. Weight ESS is not presented as an autocorrelation-adjusted sampling ESS.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['potentialEnsemble', 'graph', 'chemicalStateEnsemble'],
      properties: {
        potentialEnsemble: potentialEnsembleSchema,
        graph: graphSchema,
        chemicalStateEnsemble: ensembleSchema,
        structure: ZATOM_STRUCTURE_JSON_SCHEMA,
        useActiveStructure: {
          type: 'boolean',
          default: true,
          description: 'Read the exact selected-state structure from the active workspace when omitted.',
        },
      },
    },
    effects: { structure: 'read', workspace: 'read', visual: 'none' },
    tags: [
      'molecule',
      'chemical-state',
      'microstate',
      'population',
      'uncertainty',
      'non-gaussian',
      'joint-samples',
      'validation',
      'fingerprint',
    ],
  },
  execute: async (input, context): Promise<ZatomToolResult<ValidateMicrostatePotentialEnsembleResult>> => {
    try {
      const structure = await resolveStructure(input, context.readStructure as (() => Promise<unknown>) | undefined)
      const graphValidation = parseZatomMicrostateTransitionGraph(input.graph, {
        structure,
        chemicalStateEnsemble: input.chemicalStateEnsemble as never,
      })
      const potentialEnsembleValidation = parseZatomMicrostateEquilibriumPotentialEnsemble(
        input.potentialEnsemble,
        {
          chemicalStateEnsembleFingerprint: graphValidation.graph.chemicalStateEnsembleFingerprint,
          microstateTransitionGraphFingerprint: graphValidation.fingerprint,
          canonicalStateIds: graphValidation.graph.states.map((state) => state.stateId),
          referenceStateId: graphValidation.graph.states[0].stateId,
        },
      )
      const result: ValidateMicrostatePotentialEnsembleResult = {
        graphValidation,
        potentialEnsembleValidation,
        checks: [...graphValidation.checks, ...potentialEnsembleValidation.checks],
        inspectionTargets: graphValidation.inspectionTargets,
      }
      return {
        ok: true,
        tool: 'microstate_validate_potential_ensemble',
        summary: `Validated ${potentialEnsembleValidation.ensemble.samples.length} weighted joint potential samples with Kish weight effective size ${potentialEnsembleValidation.weightEffectiveSampleSize}`,
        data: result,
        checks: result.checks,
      }
    } catch (error) {
      if (error instanceof ZatomMicrostateTransitionGraphInputError
        || error instanceof ZatomMicrostateEquilibriumPotentialEnsembleInputError
        || error instanceof ZatomStructureInputError) {
        return {
          ok: false,
          tool: 'microstate_validate_potential_ensemble',
          summary: error.message,
          error: { code: error.code, message: error.message },
        }
      }
      const message = error instanceof Error ? error.message : String(error)
      return {
        ok: false,
        tool: 'microstate_validate_potential_ensemble',
        summary: message,
        error: { code: 'microstate_potential_ensemble_validation_failed', message },
      }
    }
  },
}

const diagnoseMicrostatePotentialSamplesTool: ZatomToolDefinition<DiagnoseMicrostatePotentialSamplesResult> = {
  manifest: {
    name: 'microstate_diagnose_potential_samples',
    title: 'Diagnose ordered microstate-potential MCMC chains',
    version: '1.0.0',
    description: 'Bind explicit ordered, equal-length, equal-weight MCMC chains to an exact joint potential ensemble. Independently compute rank-normalized and folded split-R-hat plus per-chain initial-positive-sequence autocorrelation ESS for every non-gauge state. Passing gates are necessary finite-chain screens, not convergence proof.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: [
        'potentialEnsemble',
        'graph',
        'chemicalStateEnsemble',
        'design',
        'acceptance',
        'provenance',
      ],
      properties: {
        potentialEnsemble: potentialEnsembleSchema,
        graph: graphSchema,
        chemicalStateEnsemble: ensembleSchema,
        design: {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'chains', 'method', 'assumptions', 'scopeWarning'],
          properties: {
            kind: { const: 'mcmc-chains' },
            chains: {
              type: 'array',
              minItems: 2,
              maxItems: 16,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['id', 'sampleIds'],
                properties: {
                  id: { type: 'string', minLength: 1, maxLength: 128 },
                  sampleIds: {
                    type: 'array',
                    minItems: 8,
                    maxItems: 4096,
                    items: { type: 'string', minLength: 1, maxLength: 128 },
                  },
                },
              },
            },
            method: { type: 'string', minLength: 1, maxLength: 4096 },
            assumptions: {
              type: 'array', minItems: 1, maxItems: 64,
              items: { type: 'string', minLength: 1, maxLength: 4096 },
            },
            scopeWarning: { type: 'string', minLength: 1, maxLength: 8192 },
          },
        },
        acceptance: {
          type: 'object',
          additionalProperties: false,
          required: [
            'maximumSplitRhat',
            'minimumCombinedEffectiveSamples',
            'maximumAutocorrelationLag',
          ],
          properties: {
            maximumSplitRhat: { type: 'number', minimum: 1, maximum: 10 },
            minimumCombinedEffectiveSamples: { type: 'number', minimum: 1 },
            maximumAutocorrelationLag: { type: 'integer', minimum: 1, maximum: 1000 },
          },
        },
        provenance: {
          type: 'object',
          description: 'Identity and immutable evidence for the sampler, retained chains, warmup policy, and diagnostic construction.',
          required: [
            'engine', 'engineVersion', 'method', 'artifacts', 'parameters', 'citations', 'scopeWarning',
          ],
        },
        metadata: { type: 'object' },
        structure: ZATOM_STRUCTURE_JSON_SCHEMA,
        useActiveStructure: {
          type: 'boolean',
          default: true,
          description: 'Read the exact selected-state structure from the active workspace when omitted.',
        },
      },
    },
    effects: { structure: 'read', workspace: 'read', visual: 'none' },
    tags: [
      'molecule',
      'microstate',
      'uncertainty',
      'mcmc',
      'split-rhat',
      'effective-sample-size',
      'convergence-diagnostics',
      'validation',
      'fingerprint',
    ],
  },
  execute: async (input, context): Promise<ZatomToolResult<DiagnoseMicrostatePotentialSamplesResult>> => {
    try {
      const structure = await resolveStructure(input, context.readStructure as (() => Promise<unknown>) | undefined)
      const graphValidation = parseZatomMicrostateTransitionGraph(input.graph, {
        structure,
        chemicalStateEnsemble: input.chemicalStateEnsemble as never,
      })
      const potentialEnsembleValidation = parseZatomMicrostateEquilibriumPotentialEnsemble(
        input.potentialEnsemble,
        {
          chemicalStateEnsembleFingerprint: graphValidation.graph.chemicalStateEnsembleFingerprint,
          microstateTransitionGraphFingerprint: graphValidation.fingerprint,
          canonicalStateIds: graphValidation.graph.states.map((state) => state.stateId),
          referenceStateId: graphValidation.graph.states[0].stateId,
        },
      )
      const sampleDiagnosticsValidation = createZatomMicrostatePotentialSampleDiagnostics({
        schemaVersion: ZATOM_MICROSTATE_POTENTIAL_SAMPLE_DIAGNOSTICS_SCHEMA,
        equilibriumPotentialEnsembleFingerprint: potentialEnsembleValidation.fingerprint,
        sampleIds: potentialEnsembleValidation.ensemble.samples.map((sample) => sample.id),
        design: input.design as never,
        acceptance: input.acceptance as never,
        provenance: input.provenance as never,
        ...(input.metadata === undefined ? {} : { metadata: input.metadata as never }),
      }, { potentialEnsembleValidation })
      const result: DiagnoseMicrostatePotentialSamplesResult = {
        graphValidation,
        potentialEnsembleValidation,
        sampleDiagnosticsValidation,
        checks: [
          ...graphValidation.checks,
          ...potentialEnsembleValidation.checks,
          ...sampleDiagnosticsValidation.checks,
        ],
        inspectionTargets: graphValidation.inspectionTargets,
      }
      return {
        ok: true,
        tool: 'microstate_diagnose_potential_samples',
        summary: `Computed ${sampleDiagnosticsValidation.diagnostics.stateDiagnostics.length} state diagnostic rows across ${sampleDiagnosticsValidation.diagnostics.design.chains.length} chains; overallPassed=${sampleDiagnosticsValidation.diagnostics.overallPassed}`,
        data: result,
        checks: result.checks,
      }
    } catch (error) {
      if (error instanceof ZatomMicrostateTransitionGraphInputError
        || error instanceof ZatomMicrostateEquilibriumPotentialEnsembleInputError
        || error instanceof ZatomMicrostatePotentialSampleDiagnosticsInputError
        || error instanceof ZatomStructureInputError) {
        return {
          ok: false,
          tool: 'microstate_diagnose_potential_samples',
          summary: error.message,
          error: { code: error.code, message: error.message },
        }
      }
      const message = error instanceof Error ? error.message : String(error)
      return {
        ok: false,
        tool: 'microstate_diagnose_potential_samples',
        summary: message,
        error: { code: 'microstate_potential_sample_diagnostics_failed', message },
      }
    }
  },
}

const solveMicrostatePopulationsTool: ZatomToolDefinition<ZatomMicrostatePopulationSolveResult> = {
  manifest: {
    name: 'microstate_solve_populations',
    title: 'Solve pH-conditioned microstate populations',
    version: '1.2.0',
    description: 'Solve normalized equilibrium populations from a connected canonical microstate graph using log-equilibrium least squares, correlation-aware generalized least squares, or direct nonlinear propagation of a validated weighted joint state-potential ensemble. Require explicit completeness, cycle-closure, applicability, and uncertainty policies; optionally bind a canonical state-coverage artifact so omitted-state censoring remains separate from parameter uncertainty. Return a fingerprinted solution and revalidated chemical-state ensemble population model without changing the selected structure.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: [
        'graph',
        'chemicalStateEnsemble',
        'pH',
        'maximumCycleClosureResidualLog10',
        'requireCompleteGraph',
        'allowUnknownApplicability',
        'uncertaintyMode',
      ],
      properties: {
        graph: graphSchema,
        chemicalStateEnsemble: ensembleSchema,
        pH: { type: 'number', minimum: 0, maximum: 14 },
        maximumCycleClosureResidualLog10: {
          type: 'number',
          minimum: 0,
          maximum: 10,
          description: 'Consumer acceptance threshold; it may only tighten the graph artifact threshold.',
        },
        requireCompleteGraph: {
          type: 'boolean',
          description: 'When true, reject incomplete state or transition enumeration.',
        },
        allowUnknownApplicability: {
          type: 'boolean',
          description: 'Explicitly accept unknown evidence applicability. Out-of-domain evidence is always rejected.',
        },
        uncertaintyMode: {
          type: 'string',
          enum: [
            'none',
            'independent-gaussian-delta-method',
            'correlated-gaussian-delta-method',
            'equilibrium-potential-sample-ensemble',
          ],
          description: 'Gaussian modes require every native edge SD; correlated mode additionally requires the graph full correlation matrix. Sample mode requires a complete graph-bound joint potential ensemble plus explicit quantile, Kish weight-ESS, and sample-diagnostics policies.',
        },
        stateCoverage: stateCoverageSchema,
        equilibriumPotentialEnsemble: potentialEnsembleSchema,
        sampleIntervalProbability: {
          type: 'number',
          minimum: 0.5,
          maximum: 0.999999,
          description: 'Central probability mass for weighted equal-tail sample intervals; required only in sample-ensemble mode.',
        },
        minimumSampleWeightEffectiveSize: {
          type: 'number',
          minimum: 1,
          description: 'Consumer Kish weight-ESS gate; required only in sample-ensemble mode and may only tighten the artifact threshold. It is not an autocorrelation-adjusted sampling ESS.',
        },
        sampleDiagnosticsPolicy: {
          type: 'string',
          enum: ['require-pass', 'allow-missing'],
          description: 'Explicit sample-dependence policy required in sample mode. A supplied failing diagnostics artifact is always rejected.',
        },
        potentialSampleDiagnostics: potentialSampleDiagnosticsSchema,
        structure: ZATOM_STRUCTURE_JSON_SCHEMA,
        useActiveStructure: {
          type: 'boolean',
          default: true,
          description: 'Read the exact selected-state structure from the active workspace when omitted.',
        },
      },
    },
    effects: { structure: 'read', workspace: 'read', visual: 'none' },
    tags: [
      'molecule',
      'chemical-state',
      'microstate',
      'protonation',
      'pka',
      'population',
      'equilibrium',
      'uncertainty-propagation',
      'thermodynamic-cycle',
      'fingerprint',
      'visual-validation',
    ],
  },
  execute: async (input, context): Promise<ZatomToolResult<ZatomMicrostatePopulationSolveResult>> => {
    try {
      const structure = await resolveStructure(input, context.readStructure as (() => Promise<unknown>) | undefined)
      const result = solveZatomMicrostatePopulations(input.graph, {
        structure,
        chemicalStateEnsemble: input.chemicalStateEnsemble as never,
        pH: input.pH as number,
        maximumCycleClosureResidualLog10: input.maximumCycleClosureResidualLog10 as number,
        requireCompleteGraph: input.requireCompleteGraph as boolean,
        allowUnknownApplicability: input.allowUnknownApplicability as boolean,
        uncertaintyMode: input.uncertaintyMode as never,
        ...(input.stateCoverage === undefined ? {} : { stateCoverage: input.stateCoverage as never }),
        ...(input.equilibriumPotentialEnsemble === undefined ? {} : {
          equilibriumPotentialEnsemble: input.equilibriumPotentialEnsemble as never,
        }),
        ...(input.sampleIntervalProbability === undefined ? {} : {
          sampleIntervalProbability: input.sampleIntervalProbability as number,
        }),
        ...(input.minimumSampleWeightEffectiveSize === undefined ? {} : {
          minimumSampleWeightEffectiveSize: input.minimumSampleWeightEffectiveSize as number,
        }),
        ...(input.sampleDiagnosticsPolicy === undefined ? {} : {
          sampleDiagnosticsPolicy: input.sampleDiagnosticsPolicy as never,
        }),
        ...(input.potentialSampleDiagnostics === undefined ? {} : {
          potentialSampleDiagnostics: input.potentialSampleDiagnostics as never,
        }),
      })
      return {
        ok: true,
        tool: 'microstate_solve_populations',
        summary: `Solved ${result.solution.populations.length} normalized microstate populations at pH ${result.solution.conditions.pH}; maximum state(s): ${result.solution.maximumPopulationStateIds.join(', ')}`,
        data: result,
        checks: result.checks,
      }
    } catch (error) {
      if (error instanceof ZatomMicrostateTransitionGraphInputError
        || error instanceof ZatomMicrostateStateCoverageInputError
        || error instanceof ZatomMicrostateEquilibriumPotentialEnsembleInputError
        || error instanceof ZatomMicrostatePotentialSampleDiagnosticsInputError
        || error instanceof ZatomStructureInputError) {
        return {
          ok: false,
          tool: 'microstate_solve_populations',
          summary: error.message,
          error: { code: error.code, message: error.message },
        }
      }
      const message = error instanceof Error ? error.message : String(error)
      return {
        ok: false,
        tool: 'microstate_solve_populations',
        summary: message,
        error: { code: 'microstate_population_solve_failed', message },
      }
    }
  },
}

const scanMicrostateTitrationTool: ZatomToolDefinition<ZatomMicrostateTitrationResult> = {
  manifest: {
    name: 'microstate_scan_titration',
    title: 'Scan a microstate titration series',
    version: '1.2.0',
    description: 'Solve one bounded inclusive pH grid from a connected canonical microstate graph, aggregate exact microstate fractions by relative proton count, and derive macroscopic step pKa values from adjacent protonation-level partition functions. Propagate either complete Gaussian edge uncertainties or a validated weighted joint state-potential ensemble, while keeping canonical omitted-state censoring separate. Macroscopic pKa remains returned-state-conditional whenever omitted mass can be nonzero.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: [
        'graph',
        'chemicalStateEnsemble',
        'pHMinimum',
        'pHMaximum',
        'pointCount',
        'maximumCycleClosureResidualLog10',
        'requireCompleteGraph',
        'allowUnknownApplicability',
        'uncertaintyMode',
      ],
      properties: {
        graph: graphSchema,
        chemicalStateEnsemble: ensembleSchema,
        pHMinimum: { type: 'number', minimum: 0, maximum: 14 },
        pHMaximum: { type: 'number', minimum: 0, maximum: 14 },
        pointCount: {
          type: 'integer',
          minimum: 2,
          maximum: 2001,
          description: 'Inclusive linear-grid point count; state count × point count is independently hard-bounded.',
        },
        maximumCycleClosureResidualLog10: {
          type: 'number',
          minimum: 0,
          maximum: 10,
          description: 'Consumer acceptance threshold; it may only tighten the graph artifact threshold.',
        },
        requireCompleteGraph: {
          type: 'boolean',
          description: 'When true, reject incomplete state or transition enumeration.',
        },
        allowUnknownApplicability: {
          type: 'boolean',
          description: 'Explicitly accept unknown evidence applicability. Out-of-domain evidence is always rejected.',
        },
        uncertaintyMode: {
          type: 'string',
          enum: [
            'none',
            'independent-gaussian-delta-method',
            'correlated-gaussian-delta-method',
            'equilibrium-potential-sample-ensemble',
          ],
          description: 'Gaussian modes require every native edge SD; correlated mode additionally requires the graph full correlation matrix. Sample mode requires a complete graph-bound joint potential ensemble plus explicit quantile, Kish weight-ESS, and sample-diagnostics policies.',
        },
        stateCoverage: stateCoverageSchema,
        equilibriumPotentialEnsemble: potentialEnsembleSchema,
        sampleIntervalProbability: {
          type: 'number',
          minimum: 0.5,
          maximum: 0.999999,
          description: 'Central probability mass for weighted equal-tail sample intervals; required only in sample-ensemble mode.',
        },
        minimumSampleWeightEffectiveSize: {
          type: 'number',
          minimum: 1,
          description: 'Consumer Kish weight-ESS gate; required only in sample-ensemble mode and may only tighten the artifact threshold. It is not an autocorrelation-adjusted sampling ESS.',
        },
        sampleDiagnosticsPolicy: {
          type: 'string',
          enum: ['require-pass', 'allow-missing'],
          description: 'Explicit sample-dependence policy required in sample mode. A supplied failing diagnostics artifact is always rejected.',
        },
        potentialSampleDiagnostics: potentialSampleDiagnosticsSchema,
        structure: ZATOM_STRUCTURE_JSON_SCHEMA,
        useActiveStructure: {
          type: 'boolean',
          default: true,
          description: 'Read the exact selected-state structure from the active workspace when omitted.',
        },
      },
    },
    effects: { structure: 'read', workspace: 'read', visual: 'none' },
    tags: [
      'molecule',
      'chemical-state',
      'microstate',
      'protonation',
      'pka',
      'macroscopic-pka',
      'titration',
      'population',
      'equilibrium',
      'uncertainty-propagation',
      'fingerprint',
      'visual-validation',
    ],
  },
  execute: async (input, context): Promise<ZatomToolResult<ZatomMicrostateTitrationResult>> => {
    try {
      const structure = await resolveStructure(input, context.readStructure as (() => Promise<unknown>) | undefined)
      const result = scanZatomMicrostateTitration(input.graph, {
        structure,
        chemicalStateEnsemble: input.chemicalStateEnsemble as never,
        pHMinimum: input.pHMinimum as number,
        pHMaximum: input.pHMaximum as number,
        pointCount: input.pointCount as number,
        maximumCycleClosureResidualLog10: input.maximumCycleClosureResidualLog10 as number,
        requireCompleteGraph: input.requireCompleteGraph as boolean,
        allowUnknownApplicability: input.allowUnknownApplicability as boolean,
        uncertaintyMode: input.uncertaintyMode as never,
        ...(input.stateCoverage === undefined ? {} : { stateCoverage: input.stateCoverage as never }),
        ...(input.equilibriumPotentialEnsemble === undefined ? {} : {
          equilibriumPotentialEnsemble: input.equilibriumPotentialEnsemble as never,
        }),
        ...(input.sampleIntervalProbability === undefined ? {} : {
          sampleIntervalProbability: input.sampleIntervalProbability as number,
        }),
        ...(input.minimumSampleWeightEffectiveSize === undefined ? {} : {
          minimumSampleWeightEffectiveSize: input.minimumSampleWeightEffectiveSize as number,
        }),
        ...(input.sampleDiagnosticsPolicy === undefined ? {} : {
          sampleDiagnosticsPolicy: input.sampleDiagnosticsPolicy as never,
        }),
        ...(input.potentialSampleDiagnostics === undefined ? {} : {
          potentialSampleDiagnostics: input.potentialSampleDiagnostics as never,
        }),
      })
      return {
        ok: true,
        tool: 'microstate_scan_titration',
        summary: `Solved ${result.series.points.length} pH points, ${result.series.protonationLevels.length} protonation levels, and ${result.series.macroscopicSteps.length} macroscopic pKa step(s)`,
        data: result,
        checks: result.checks,
      }
    } catch (error) {
      if (error instanceof ZatomMicrostateTransitionGraphInputError
        || error instanceof ZatomMicrostateStateCoverageInputError
        || error instanceof ZatomMicrostateEquilibriumPotentialEnsembleInputError
        || error instanceof ZatomMicrostatePotentialSampleDiagnosticsInputError
        || error instanceof ZatomStructureInputError) {
        return {
          ok: false,
          tool: 'microstate_scan_titration',
          summary: error.message,
          error: { code: error.code, message: error.message },
        }
      }
      const message = error instanceof Error ? error.message : String(error)
      return {
        ok: false,
        tool: 'microstate_scan_titration',
        summary: message,
        error: { code: 'microstate_titration_scan_failed', message },
      }
    }
  },
}

export const MICROSTATE_TRANSITION_GRAPH_ZATOM_AGENT_TOOLS: readonly ZatomToolDefinition[] = [
  validateMicrostateGraphTool,
  validateMicrostateStateCoverageTool,
  composeMicrostatePotentialMixtureTool,
  validateMicrostatePotentialEnsembleTool,
  diagnoseMicrostatePotentialSamplesTool,
  solveMicrostatePopulationsTool,
  scanMicrostateTitrationTool,
]
