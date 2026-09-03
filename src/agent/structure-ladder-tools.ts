/**
 * Agent entry point for navigating the biomolecular structure ladder.
 *
 * This tool reads `bioStructure`; it must not use the crystal/molecule-only
 * `ZatomStructure`, which lacks chain and secondary-structure levels. It returns
 * inspection targets and delegates camera motion and visibility verification to
 * the shared context so agent and manual navigation use the same behavior.
 */
import type {
  InspectionTarget,
  ValidationCheck,
  ZatomToolDefinition,
  ZatomToolManifest,
} from './contracts'
import { getActiveViewportStoreApi } from '../orchestration/ViewportContext'
import {
  buildStructureLadder,
  ladderNode,
  ladderNodeAtomIds,
  ladderPath,
  type LadderLevel,
  type LadderNode,
} from '../lib/biomolecule/structure-ladder'

/** Limit children per response so long chains cannot exhaust model context. */
const MAX_CHILDREN = 60

interface LadderNodeSummary {
  id: string
  level: LadderLevel
  label: string
  detail: string | null
  atomCount: number
  childCount: number
  /** Distinguishes a C-alpha geometry estimate from authoritative DSSP/PDB annotation. */
  secondaryStructureSource?: string
}

export interface LadderDrillToolData {
  structureTitle: string
  /** Ancestor path from the assembly to the current node. */
  path: LadderNodeSummary[]
  node: LadderNodeSummary
  children: LadderNodeSummary[]
  childrenTruncated: boolean
  inspectionTargets: InspectionTarget[]
  /** Whether a requested focus actually framed the target. */
  focused?: boolean
}

function summarize(node: LadderNode): LadderNodeSummary {
  return {
    id: node.id,
    level: node.level,
    label: node.label,
    detail: node.detail,
    atomCount: node.atomIndices.length,
    childCount: node.childIds.length,
    ...(node.secondaryStructureSource
      ? { secondaryStructureSource: node.secondaryStructureSource }
      : {}),
  }
}

const manifest: ZatomToolManifest = {
  name: 'bio_ladder_drill',
  title: 'Drill through the biomolecular structure ladder',
  version: '1.0.0',
  description:
    'Walk the loaded biomolecule as a strict containment ladder: assembly → chain → secondary-structure element → residue → atom. '
    + 'Return the requested node, its ancestor path, and its immediate children with atom counts, plus a focusable inspection target. '
    + 'Omit nodeId to start at the assembly root. Set focus=true to fly the active camera to the node and verify it landed inside the framing. '
    + 'Secondary-structure nodes carrying secondaryStructureSource="geometry-estimate" come from Cα geometry, not a DSSP or PDB HELIX/SHEET assignment.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      nodeId: {
        type: 'string',
        description: 'Ladder node id such as "assembly", "chain:A", "element:A:helix:12", "residue:A:1756", or "atom:1042". Omit for the assembly root.',
      },
      focus: {
        type: 'boolean',
        default: false,
        description: 'Fly the active viewport camera to this node and verify the whole node stayed inside the framing.',
      },
    },
    required: [],
  },
  effects: { structure: 'read', workspace: 'read', visual: 'none' },
  tags: ['biomolecule', 'ladder', 'navigation', 'inspection', 'agent'],
}

const bioLadderDrillTool: ZatomToolDefinition<LadderDrillToolData> = {
  manifest,
  execute: async (input, context) => {
    try {
      const structure = getActiveViewportStoreApi().getState().bioStructure
      if (!structure) {
        throw new Error(
          'No biomolecule is loaded in the active viewport. The ladder needs chain and '
          + 'secondary-structure levels, which a crystal/molecule structure does not carry.',
        )
      }

      const ladder = buildStructureLadder(structure)
      const requestedId = typeof input.nodeId === 'string' && input.nodeId.length
        ? input.nodeId
        : ladder.rootId
      // Atom-level nodes are synthesized on demand and therefore require `ladderNode`.
      const node = ladderNode(structure, ladder, requestedId)
      if (!node) {
        // Include valid root IDs so the model can recover without guessing.
        const roots = ladder.nodes.get(ladder.rootId)?.childIds.slice(0, 12) ?? []
        throw new Error(
          `Unknown ladder node "${requestedId}". Available next ids from the root: ${roots.join(', ') || '(none)'}`,
        )
      }

      const children = node.childIds
        .slice(0, MAX_CHILDREN)
        .map((id) => ladderNode(structure, ladder, id))
        .filter((child): child is LadderNode => child !== null)
      const atomIds = ladderNodeAtomIds(structure, node)

      const target: InspectionTarget = {
        id: `ladder-${node.id}`,
        reason: `Inspect ${node.level} ${node.label}${node.detail ? ` (${node.detail})` : ''}`,
        // Copy the readonly biomolecule vector into a mutable inspection target so
        // downstream writes cannot mutate ladder geometry.
        center: [node.center[0], node.center[1], node.center[2]],
        radius: Math.max(1, node.radius),
        atomIds: atomIds.slice(0, 80),
        ...(atomIds.length > 80 ? { atomIdsTruncated: true } : {}),
      }

      let focused: boolean | undefined
      if (input.focus === true && context.focusInspectionTarget) {
        const placement = await context.focusInspectionTarget(target)
        focused = placement === null
          ? false
          : placement.centerVisible && placement.regionVisible
      }

      const checks: ValidationCheck[] = [{
        id: 'ladder.node_resolved',
        status: 'pass',
        message: `Resolved ${node.level} ${node.label} with ${node.atomIndices.length.toLocaleString()} atoms and ${node.childIds.length.toLocaleString()} children`,
        metrics: { atomCount: node.atomIndices.length, childCount: node.childIds.length },
        atomIds: atomIds.slice(0, 80),
      }]
      if (node.secondaryStructureSource === 'geometry-estimate') {
        checks.push({
          id: 'ladder.secondary_structure_provenance',
          status: 'warn',
          message: 'This element came from Cα geometry estimation, not a DSSP or PDB HELIX/SHEET assignment. Do not report it as an authoritative annotation.',
          metrics: {},
        })
      }

      return {
        ok: true,
        tool: manifest.name,
        summary: `${node.level} ${node.label}${node.detail ? ` · ${node.detail}` : ''} · ${node.childIds.length.toLocaleString()} children`,
        data: {
          structureTitle: structure.title || 'Untitled assembly',
          path: ladderPath(structure, ladder, node.id).map(summarize),
          node: summarize(node),
          children: children.map(summarize),
          childrenTruncated: node.childIds.length > MAX_CHILDREN,
          inspectionTargets: [target],
          ...(focused === undefined ? {} : { focused }),
        },
        checks,
      }
    } catch (error) {
      return {
        ok: false,
        tool: manifest.name,
        summary: error instanceof Error ? error.message : 'Ladder drill failed',
        error: {
          code: 'ladder_drill_failed',
          message: error instanceof Error ? error.message : String(error),
        },
      }
    }
  },
}

export const STRUCTURE_LADDER_ZATOM_AGENT_TOOLS: ZatomToolDefinition<LadderDrillToolData>[] = [
  bioLadderDrillTool,
]
