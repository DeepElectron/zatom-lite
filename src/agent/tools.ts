/**
 * Aggregation point and registry for every built-in zatom agent tool.
 *
 * This module owns two things only: the ordered BUILTIN list that spreads each
 * module's `*_ZATOM_AGENT_TOOLS` export, and the registry that validates tool
 * names and input schemas at the boundary. Tool implementations live in their
 * own `*-tools.ts` modules; adding a module means one import plus one spread
 * here and a domain assignment in `domains.ts`.
 */

import type {
  ZatomHostWriteMode,
  ZatomToolContext,
  ZatomToolDefinition,
  ZatomToolManifest,
  ZatomToolResult,
} from './contracts'
import { LOCAL_DIRECTORY_ZATOM_AGENT_TOOLS } from './local-directory-tools'
import { LOCAL_VISUALIZATION_BUNDLE_ZATOM_AGENT_TOOLS } from './local-visualization-bundle-tools'
import { SESSION_ZATOM_AGENT_TOOLS } from './session-tools'
import { VIEWPORT_ZATOM_AGENT_TOOLS } from './viewport-tools'
import { SURFACE_ZATOM_AGENT_TOOLS } from './surface-tools'
import { SLAB_VACUUM_ZATOM_AGENT_TOOLS } from './slab-vacuum-tools'
import { INTERFACE_ZATOM_AGENT_TOOLS } from './interface-tools'
import { INTERFACE_ADHESION_EVIDENCE_ZATOM_AGENT_TOOLS } from './interface-adhesion-evidence-tools'
import { MOLECULE_ZATOM_AGENT_TOOLS } from './molecule-tools'
import { MOLECULAR_ASSEMBLY_ZATOM_AGENT_TOOLS } from './molecular-assembly-tools'
import { COMPONENT_PLACEMENT_ZATOM_AGENT_TOOLS } from './component-placement-tools'
import { SEMANTIC_POSE_ZATOM_AGENT_TOOLS } from './semantic-pose-tools'
import { METAL_CLUSTER_ZATOM_AGENT_TOOLS } from './metal-cluster-tools'
import { POLYMER_ZATOM_AGENT_TOOLS } from './polymer-tools'
import { POLYCRYSTAL_ZATOM_AGENT_TOOLS } from './polycrystal-tools'
import { POLARIZATION_DOMAIN_WALL_ZATOM_AGENT_TOOLS } from './polarization-domain-wall-tools'
import { TRAJECTORY_DIAGNOSTICS_ZATOM_AGENT_TOOLS } from './trajectory-diagnostics-tools'
import { TRAJECTORY_DENSITY_PROFILE_ZATOM_AGENT_TOOLS } from './trajectory-density-profile-tools'
import { TRAJECTORY_MSD_ZATOM_AGENT_TOOLS } from './trajectory-msd-tools'
import { TRAJECTORY_HYDROGEN_BOND_ZATOM_AGENT_TOOLS } from './trajectory-hydrogen-bond-tools'
import { TRAJECTORY_ORIENTATION_ZATOM_AGENT_TOOLS } from './trajectory-orientation-tools'
import { TRAJECTORY_RDF_ZATOM_AGENT_TOOLS } from './trajectory-rdf-tools'
import { TRAJECTORY_REPLICA_DIAGNOSTICS_ZATOM_AGENT_TOOLS } from './trajectory-replica-diagnostics-tools'
import { TRAJECTORY_STITCH_ZATOM_AGENT_TOOLS } from './trajectory-stitch-tools'
import { FORCE_FIELD_PACKAGE_ZATOM_AGENT_TOOLS } from './force-field-package-tools'
import { CHEMICAL_STATE_ENSEMBLE_ZATOM_AGENT_TOOLS } from './chemical-state-ensemble-tools'
import { CHEMICAL_STATE_STRUCTURE_CATALOG_ZATOM_AGENT_TOOLS } from './chemical-state-structure-catalog-tools'
import { CHEMICAL_STATE_STRUCTURAL_DISTRIBUTION_ZATOM_AGENT_TOOLS } from './chemical-state-structural-distribution-tools'
import { CHEMICAL_STATE_STRUCTURAL_SAMPLING_ZATOM_AGENT_TOOLS } from './chemical-state-structural-sampling-tools'
import { MICRO_PKA_EVIDENCE_ZATOM_AGENT_TOOLS } from './micro-pka-evidence-tools'
import { MICROSTATE_TRANSITION_GRAPH_ZATOM_AGENT_TOOLS } from './microstate-transition-graph-tools'
import { DEFORMATION_ZATOM_AGENT_TOOLS } from './deformation-tools'
import { PROVIDER_ZATOM_AGENT_TOOLS } from './provider-tools'
import { STRUCTURE_ENSEMBLE_ZATOM_AGENT_TOOLS } from './structure-ensemble-tools'
import { PERIODIC_STRUCTURE_ENSEMBLE_ZATOM_AGENT_TOOLS } from './periodic-structure-ensemble-tools'
import { SQS_QUALITY_EVIDENCE_ZATOM_AGENT_TOOLS } from './sqs-quality-evidence-tools'
import { CONTINUUM_DISLOCATION_EVIDENCE_ZATOM_AGENT_TOOLS } from './continuum-dislocation-evidence-tools'
import { PERIODIC_DISLOCATION_DIPOLE_EVIDENCE_ZATOM_AGENT_TOOLS } from './periodic-dislocation-dipole-evidence-tools'
import { FIXED_CELL_RELAXATION_EVIDENCE_ZATOM_AGENT_TOOLS } from './fixed-cell-relaxation-evidence-tools'
import { PERIODIC_DISLOCATION_RELAXATION_EVIDENCE_ZATOM_AGENT_TOOLS } from './periodic-dislocation-relaxation-evidence-tools'
import { PERIODIC_DISLOCATION_RELAXATION_SERIES_ZATOM_AGENT_TOOLS } from './periodic-dislocation-relaxation-series-tools'
import { PERIODIC_DISLOCATION_CORE_EVIDENCE_ZATOM_AGENT_TOOLS } from './periodic-dislocation-core-evidence-tools'
import { GEOMETRY_MEASUREMENT_ZATOM_AGENT_TOOLS } from './geometry-measurement-tools'
import { SCENE_GRID_ZATOM_AGENT_TOOLS } from './scene-grid-tools'
import { STRUCTURE_LADDER_ZATOM_AGENT_TOOLS } from './structure-ladder-tools'
import { LOCAL_ENVIRONMENT_ZATOM_AGENT_TOOLS } from './local-environment-tools'
import { STRUCTURE_TEXT_IO_ZATOM_AGENT_TOOLS } from './structure-text-io-tools'
import { PERIODIC_CRYSTAL_ZATOM_AGENT_TOOLS } from './periodic-crystal-tools'
import { MODELING_PLAN_ZATOM_AGENT_TOOLS } from './modeling-plan-tools'
import { MODELING_ROUTING_ZATOM_AGENT_TOOLS } from './modeling-routing-tools'
import {
  STRUCTURE_VALIDATE_ZATOM_AGENT_TOOLS,
  WORKSPACE_ZATOM_AGENT_TOOLS,
} from './workspace-structure-tools'
import { VIEWER_EVIDENCE_ZATOM_AGENT_TOOLS } from './viewer-evidence-tools'
import { VIEWER_STYLE_ZATOM_AGENT_TOOLS } from './viewer-style-tools'
import { CAMERA_ZATOM_AGENT_TOOLS } from './camera-tools'
import { GUIDE_ZATOM_AGENT_TOOLS } from './guide-tools'
import {
  STRUCTURE_OPERATIONS_ZATOM_AGENT_TOOLS,
  STRUCTURE_SELECTION_ZATOM_AGENT_TOOLS,
} from './structure-operation-tools'
import { STRUCTURE_SQS_ZATOM_AGENT_TOOLS } from './structure-sqs-tools'
import {
  compileZatomJsonSchema,
  formatZatomJsonSchemaErrors,
  type ZatomJsonSchemaValidator,
} from './json-schema'
import { zatomToolTier } from './domains'
import {
  describeHostPolicyDenial,
  hostWriteModeAllows,
  restrictContextToHostWriteMode,
} from './host-access-policy'

export const BUILTIN_ZATOM_AGENT_TOOLS: readonly ZatomToolDefinition[] = [
  ...MODELING_ROUTING_ZATOM_AGENT_TOOLS,
  ...MODELING_PLAN_ZATOM_AGENT_TOOLS,
  ...WORKSPACE_ZATOM_AGENT_TOOLS,
  ...STRUCTURE_TEXT_IO_ZATOM_AGENT_TOOLS,
  ...STRUCTURE_VALIDATE_ZATOM_AGENT_TOOLS,
  ...PERIODIC_CRYSTAL_ZATOM_AGENT_TOOLS,
  ...STRUCTURE_ENSEMBLE_ZATOM_AGENT_TOOLS,
  ...PERIODIC_STRUCTURE_ENSEMBLE_ZATOM_AGENT_TOOLS,
  ...SQS_QUALITY_EVIDENCE_ZATOM_AGENT_TOOLS,
  ...CONTINUUM_DISLOCATION_EVIDENCE_ZATOM_AGENT_TOOLS,
  ...PERIODIC_DISLOCATION_DIPOLE_EVIDENCE_ZATOM_AGENT_TOOLS,
  ...FIXED_CELL_RELAXATION_EVIDENCE_ZATOM_AGENT_TOOLS,
  ...PERIODIC_DISLOCATION_RELAXATION_EVIDENCE_ZATOM_AGENT_TOOLS,
  ...PERIODIC_DISLOCATION_RELAXATION_SERIES_ZATOM_AGENT_TOOLS,
  ...PERIODIC_DISLOCATION_CORE_EVIDENCE_ZATOM_AGENT_TOOLS,
  ...STRUCTURE_SELECTION_ZATOM_AGENT_TOOLS,
  ...STRUCTURE_LADDER_ZATOM_AGENT_TOOLS,
  ...GEOMETRY_MEASUREMENT_ZATOM_AGENT_TOOLS,
  ...SCENE_GRID_ZATOM_AGENT_TOOLS,
  ...LOCAL_ENVIRONMENT_ZATOM_AGENT_TOOLS,
  ...STRUCTURE_OPERATIONS_ZATOM_AGENT_TOOLS,
  ...STRUCTURE_SQS_ZATOM_AGENT_TOOLS,
  ...SESSION_ZATOM_AGENT_TOOLS,
  ...VIEWPORT_ZATOM_AGENT_TOOLS,
  ...LOCAL_DIRECTORY_ZATOM_AGENT_TOOLS,
  ...LOCAL_VISUALIZATION_BUNDLE_ZATOM_AGENT_TOOLS,
  ...SURFACE_ZATOM_AGENT_TOOLS,
  ...SLAB_VACUUM_ZATOM_AGENT_TOOLS,
  ...INTERFACE_ZATOM_AGENT_TOOLS,
  ...INTERFACE_ADHESION_EVIDENCE_ZATOM_AGENT_TOOLS,
  ...MOLECULE_ZATOM_AGENT_TOOLS,
  ...METAL_CLUSTER_ZATOM_AGENT_TOOLS,
  ...COMPONENT_PLACEMENT_ZATOM_AGENT_TOOLS,
  ...SEMANTIC_POSE_ZATOM_AGENT_TOOLS,
  ...MOLECULAR_ASSEMBLY_ZATOM_AGENT_TOOLS,
  ...POLYMER_ZATOM_AGENT_TOOLS,
  ...POLYCRYSTAL_ZATOM_AGENT_TOOLS,
  ...POLARIZATION_DOMAIN_WALL_ZATOM_AGENT_TOOLS,
  ...DEFORMATION_ZATOM_AGENT_TOOLS,
  ...PROVIDER_ZATOM_AGENT_TOOLS,
  ...FORCE_FIELD_PACKAGE_ZATOM_AGENT_TOOLS,
  ...CHEMICAL_STATE_ENSEMBLE_ZATOM_AGENT_TOOLS,
  ...CHEMICAL_STATE_STRUCTURE_CATALOG_ZATOM_AGENT_TOOLS,
  ...CHEMICAL_STATE_STRUCTURAL_DISTRIBUTION_ZATOM_AGENT_TOOLS,
  ...CHEMICAL_STATE_STRUCTURAL_SAMPLING_ZATOM_AGENT_TOOLS,
  ...MICRO_PKA_EVIDENCE_ZATOM_AGENT_TOOLS,
  ...MICROSTATE_TRANSITION_GRAPH_ZATOM_AGENT_TOOLS,
  ...TRAJECTORY_STITCH_ZATOM_AGENT_TOOLS,
  ...TRAJECTORY_REPLICA_DIAGNOSTICS_ZATOM_AGENT_TOOLS,
  ...TRAJECTORY_RDF_ZATOM_AGENT_TOOLS,
  ...TRAJECTORY_DENSITY_PROFILE_ZATOM_AGENT_TOOLS,
  ...TRAJECTORY_HYDROGEN_BOND_ZATOM_AGENT_TOOLS,
  ...TRAJECTORY_ORIENTATION_ZATOM_AGENT_TOOLS,
  ...TRAJECTORY_MSD_ZATOM_AGENT_TOOLS,
  ...TRAJECTORY_DIAGNOSTICS_ZATOM_AGENT_TOOLS,
  ...VIEWER_EVIDENCE_ZATOM_AGENT_TOOLS,
  ...VIEWER_STYLE_ZATOM_AGENT_TOOLS,
  ...CAMERA_ZATOM_AGENT_TOOLS,
  ...GUIDE_ZATOM_AGENT_TOOLS,
]

export interface ZatomAgentToolRegistry {
  list(): ZatomToolManifest[]
  execute(name: string, input?: Record<string, unknown>, context?: ZatomToolContext): Promise<ZatomToolResult>
  register(tool: ZatomToolDefinition, options?: { replace?: boolean }): () => void
}

interface RegisteredTool {
  tool: ZatomToolDefinition
  validateInput: ZatomJsonSchemaValidator
}

/**
 * Create an isolated registry for an MCP server, test, or engine bundle.
 * External providers can add tools or intentionally replace a built-in while
 * retaining the same JSON-safe contracts and MCP adapter.
 */
export function createZatomAgentToolRegistry(
  initial: readonly ZatomToolDefinition[] = [],
): ZatomAgentToolRegistry {
  const byName = new Map<string, RegisteredTool>()
  const register = (tool: ZatomToolDefinition, options: { replace?: boolean } = {}): (() => void) => {
    const name = tool.manifest.name
    if (!/^[a-z][a-z0-9_]{1,63}$/.test(name)) {
      throw new Error(`Invalid zatom tool name "${name}"; use 2-64 lowercase letters, digits, or underscores`)
    }
    if (byName.has(name) && !options.replace) {
      throw new Error(`Zatom tool "${name}" is already registered`)
    }
    let validateInput: ZatomJsonSchemaValidator
    try {
      validateInput = compileZatomJsonSchema(tool.manifest.inputSchema)
    } catch (error) {
      throw new Error(`Zatom tool "${name}" has an invalid inputSchema: ${error instanceof Error ? error.message : String(error)}`)
    }
    const previous = byName.get(name)
    const registration = { tool, validateInput }
    byName.set(name, registration)
    return () => {
      if (byName.get(name) !== registration) return
      if (previous) byName.set(name, previous)
      else byName.delete(name)
    }
  }
  for (const tool of initial) register(tool)
  return {
    list: () => [...byName.values()].map(({ tool }) => tool.manifest),
    execute: async (name, input = {}, context = {}) => {
      const registration = byName.get(name)
      if (!registration) {
        return { ok: false, tool: name, summary: `Unknown zatom tool "${name}"`, error: { code: 'unknown_tool', message: `Unknown zatom tool "${name}"` } }
      }
      const { tool, validateInput } = registration
      const validation = validateInput(input)
      if (!validation.valid) {
        const message = `Input for ${name} does not match its inputSchema: ${formatZatomJsonSchemaErrors(validation.errors)}`
        return { ok: false, tool: name, summary: message, error: { code: 'invalid_tool_input', message } }
      }
      if (context.signal?.aborted) {
        return { ok: false, tool: name, summary: 'Tool execution was cancelled', error: { code: 'tool_execution_aborted', message: 'Tool execution was cancelled' } }
      }
      // Host write policy. Read-tier tools are allowed in every mode, so the
      // host is only asked for its mode when the tool could change something;
      // cross-process hosts then pay no round trip on observations.
      let effectiveContext: ZatomToolContext = context
      const tier = zatomToolTier(name, input)
      if (context.access && tier !== 'read') {
        let mode: ZatomHostWriteMode
        try {
          mode = await context.access.mode(input)
        } catch (error) {
          // Fail closed, but say why: the page may be unbound, or several
          // pages may be connected and the call did not name one.
          const reason = error instanceof Error ? error.message : String(error)
          return {
            ok: false,
            tool: name,
            summary: `${name} was not run: the ${context.access.host} host's write mode could not be read. ${reason}`,
            error: { code: 'host_policy_unavailable', message: `${name} was not run: the host's write mode could not be read. ${reason}` },
          }
        }
        if (!hostWriteModeAllows(mode, tier)) {
          return describeHostPolicyDenial(name, context.access.host, mode, tier)
        }
        effectiveContext = restrictContextToHostWriteMode(context, mode)
      }
      const result = await tool.execute(input, {
        ...effectiveContext,
        listTools: () => [...byName.values()].map(({ tool: currentTool }) => currentTool.manifest),
      })
      if (context.signal?.aborted) {
        return { ok: false, tool: name, summary: 'Tool execution was cancelled', error: { code: 'tool_execution_aborted', message: 'Tool execution was cancelled' } }
      }
      return result
    },
    register,
  }
}

export const defaultZatomAgentToolRegistry = createZatomAgentToolRegistry(BUILTIN_ZATOM_AGENT_TOOLS)

/** Register an engine/provider tool in the process-wide registry used by MCP helpers. */
export function registerZatomAgentTool(
  tool: ZatomToolDefinition,
  options?: { replace?: boolean },
): () => void {
  return defaultZatomAgentToolRegistry.register(tool, options)
}

export function listZatomAgentTools(): ZatomToolManifest[] {
  return defaultZatomAgentToolRegistry.list()
}

export async function executeZatomAgentTool(
  name: string,
  input: Record<string, unknown> = {},
  context: ZatomToolContext = {},
): Promise<ZatomToolResult> {
  return defaultZatomAgentToolRegistry.execute(name, input, context)
}
