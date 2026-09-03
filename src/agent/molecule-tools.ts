/** Agent/MCP definitions for explicit molecular topology and geometry cleanup. */

import { finalizeStructureCandidate } from './candidate-tool'
import type {
  Vec3,
  ZatomToolDefinition,
  ZatomToolManifest,
} from './contracts'
import { ZATOM_STRUCTURE_JSON_SCHEMA } from './contracts'
import {
  assignOpenMmIdentity,
  BUILTIN_MOLECULE_TEMPLATES,
  createMoleculeFromTemplate,
  MoleculeInputError,
  optimizeMoleculeGeometry,
  validateMolecularTopology,
  type OpenMmResidueAssignment,
} from './molecule'
import { validateStructure } from './structure-validation'
import { numberOption, objectSchema, resolveStructure, toolError } from './tool-helpers'

const vec3Schema = { type: 'array', minItems: 3, maxItems: 3, items: { type: 'number' } }

function vec3Option(value: unknown, field: string): Vec3 | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length !== 3) throw new MoleculeInputError('invalid_vector', `${field} must contain three finite numbers`)
  const result: Vec3 = [Number(value[0]), Number(value[1]), Number(value[2])]
  if (result.some((item) => !Number.isFinite(item))) throw new MoleculeInputError('invalid_vector', `${field} must contain three finite numbers`)
  return result
}

function stringList(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new MoleculeInputError('invalid_string_list', `${field} must be an array of non-empty strings`)
  }
  return value.map((item) => item.trim())
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function openMmResidues(value: unknown): OpenMmResidueAssignment[] {
  if (!Array.isArray(value)) throw new MoleculeInputError('invalid_openmm_identity', 'residues must be an array')
  return value.map((raw, residueIndex) => {
    if (!isRecord(raw) || !Array.isArray(raw.atoms)) {
      throw new MoleculeInputError('invalid_openmm_identity', `residues[${residueIndex}] must contain atoms[]`)
    }
    return {
      chainId: typeof raw.chainId === 'string' ? raw.chainId : '',
      residueName: typeof raw.residueName === 'string' ? raw.residueName : '',
      residueId: typeof raw.residueId === 'string' ? raw.residueId : '',
      ...(raw.insertionCode === undefined ? {} : {
        insertionCode: typeof raw.insertionCode === 'string' ? raw.insertionCode : '\0',
      }),
      atoms: raw.atoms.map((entry, atomIndex) => {
        if (!isRecord(entry)) {
          throw new MoleculeInputError('invalid_openmm_identity', `residues[${residueIndex}].atoms[${atomIndex}] must be an object`)
        }
        return {
          atomId: typeof entry.atomId === 'string' ? entry.atomId : '',
          atomName: typeof entry.atomName === 'string' ? entry.atomName : '',
        }
      }),
    }
  })
}

const validateManifest: ZatomToolManifest = {
  name: 'molecule_validate_topology',
  title: 'Validate explicit molecular topology',
  version: '1.0.0',
  description: 'Validate explicit bond endpoints/orders, connected components, covalent-radius bond lengths, conservative common valence bounds, and formal-charge completeness.',
  inputSchema: objectSchema({
    structure: ZATOM_STRUCTURE_JSON_SCHEMA,
    bondLengthToleranceFraction: { type: 'number', minimum: 0, default: 0.35 },
  }),
  effects: { structure: 'read', workspace: 'read', visual: 'none' },
  tags: ['molecule', 'topology', 'bond', 'valence', 'validation', 'agent'],
}

const validateMoleculeTool: ZatomToolDefinition = {
  manifest: validateManifest,
  execute: async (input, context) => {
    try {
      const structure = await resolveStructure(input, context)
      const validation = validateStructure(structure)
      const topology = validateMolecularTopology(structure, {
        bondLengthToleranceFraction: numberOption(input, 'bondLengthToleranceFraction'),
      })
      const checks = [...validation.checks, ...topology.checks]
      return {
        ok: true,
        tool: validateManifest.name,
        summary: `${topology.formula || 'Molecule'}: ${topology.bondCount} bonds, ${topology.componentCount ?? 'unassessed'} components, ${checks.filter((check) => check.status === 'fail').length} failing checks`,
        data: { validation, topology, inspectionTargets: [...topology.inspectionTargets, ...validation.inspectionTargets] },
        checks,
      }
    } catch (error) {
      return toolError(validateManifest.name, error)
    }
  },
}

const createManifest: ZatomToolManifest = {
  name: 'molecule_create_from_template',
  title: 'Create a 3D molecule from a built-in template',
  version: '1.0.0',
  description: 'Create a deterministic Cartesian molecule with stable atom IDs, explicit bond orders, topology checks, provenance, and a visual inspection target.',
  inputSchema: objectSchema({
    template: { enum: BUILTIN_MOLECULE_TEMPLATES },
    center: vec3Schema,
    applyToWorkspace: { type: 'boolean', default: false },
    captureAfter: { type: 'boolean', description: 'Default true only when applying to the active workspace in a visual host' },
  }, ['template']),
  effects: { structure: 'create', workspace: 'write', visual: 'read' },
  tags: ['molecule', 'template', 'topology', 'structure', 'agent'],
}

const createMoleculeTool: ZatomToolDefinition = {
  manifest: createManifest,
  execute: async (input, context) => {
    try {
      const result = createMoleculeFromTemplate({
        template: typeof input.template === 'string' ? input.template : '',
        center: vec3Option(input.center, 'center'),
      })
      const requestedApply = input.applyToWorkspace === true
      const captureAfter = typeof input.captureAfter === 'boolean' ? input.captureAfter : requestedApply
      return await finalizeStructureCandidate({
        tool: createManifest.name,
        result,
        requestedApply,
        captureAfter,
        context,
        summary: (applied, blocked) => `Created ${result.template.name} (${result.topology.formula}, ${result.structure.atoms.length} atoms, ${result.structure.bonds?.length ?? 0} bonds)${applied ? ' and applied it to the active workspace' : blocked ? '; workspace application was blocked' : ''}`,
      })
    } catch (error) {
      return toolError(createManifest.name, error)
    }
  },
}

const optimizeManifest: ZatomToolManifest = {
  name: 'molecule_optimize_geometry',
  title: 'Run deterministic empirical molecule cleanup',
  version: '1.0.0',
  description: 'Run bounded spring/angle/repulsion cleanup while preserving explicit topology and fixed atoms; reports clashes and warns that this is not an energetic optimization.',
  inputSchema: objectSchema({
    structure: ZATOM_STRUCTURE_JSON_SCHEMA,
    fixedAtomIds: { type: 'array', items: { type: 'string' } },
    maxIters: { type: 'integer', minimum: 1, maximum: 2000, default: 300 },
    bondLengthToleranceFraction: { type: 'number', minimum: 0, default: 0.35 },
    applyToWorkspace: { type: 'boolean', default: false },
    captureAfter: { type: 'boolean', description: 'Default true only when applying to the active workspace in a visual host' },
  }),
  effects: { structure: 'replace', workspace: 'write', visual: 'read' },
  tags: ['molecule', 'geometry', 'cleanup', 'topology', 'validation', 'agent'],
}

const optimizeMoleculeTool: ZatomToolDefinition = {
  manifest: optimizeManifest,
  execute: async (input, context) => {
    try {
      const structure = await resolveStructure(input, context)
      const result = optimizeMoleculeGeometry({
        structure,
        fixedAtomIds: stringList(input.fixedAtomIds, 'fixedAtomIds'),
        maxIters: numberOption(input, 'maxIters'),
        bondLengthToleranceFraction: numberOption(input, 'bondLengthToleranceFraction'),
      })
      const requestedApply = input.applyToWorkspace === true
      const captureAfter = typeof input.captureAfter === 'boolean' ? input.captureAfter : requestedApply
      return await finalizeStructureCandidate({
        tool: optimizeManifest.name,
        result,
        requestedApply,
        captureAfter,
        context,
        summary: (applied, blocked) => `Empirical cleanup ran ${result.stats.iters} iterations; clashes ${result.stats.clashesBefore}→${result.stats.clashesAfter}, max displacement ${result.changeSet.maxPositionDisplacementA.toFixed(4)} Å${applied ? ' and applied it to the active workspace' : blocked ? '; workspace application was blocked' : ''}`,
      })
    } catch (error) {
      return toolError(optimizeManifest.name, error)
    }
  },
}

const assignOpenMmIdentityManifest: ZatomToolManifest = {
  name: 'molecule_assign_openmm_identity',
  title: 'Assign explicit OpenMM chain/residue/atom identity',
  version: '1.0.0',
  description: 'Attach a complete ordered OpenMM identity map to an explicit molecular topology without guessing templates or changing coordinates/bonds; produces property-aware provenance and workspace readback evidence.',
  inputSchema: objectSchema({
    structure: ZATOM_STRUCTURE_JSON_SCHEMA,
    residues: {
      type: 'array',
      minItems: 1,
      items: objectSchema({
        chainId: { type: 'string', minLength: 1, maxLength: 32 },
        residueName: { type: 'string', minLength: 1, maxLength: 32 },
        residueId: { type: 'string', minLength: 1, maxLength: 32 },
        insertionCode: { type: 'string', maxLength: 8 },
        atoms: {
          type: 'array',
          minItems: 1,
          items: objectSchema({
            atomId: { type: 'string', minLength: 1, maxLength: 512 },
            atomName: { type: 'string', minLength: 1, maxLength: 32 },
          }, ['atomId', 'atomName']),
        },
      }, ['chainId', 'residueName', 'residueId', 'atoms']),
    },
    applyToWorkspace: { type: 'boolean', default: false },
    captureAfter: { type: 'boolean', description: 'Default true only when applying to the active workspace in a visual host' },
  }, ['residues']),
  effects: { structure: 'replace', workspace: 'write', visual: 'read' },
  tags: ['molecule', 'openmm', 'biomolecule', 'residue', 'topology', 'identity', 'agent'],
}

const assignOpenMmIdentityTool: ZatomToolDefinition = {
  manifest: assignOpenMmIdentityManifest,
  execute: async (input, context) => {
    try {
      const structure = await resolveStructure(input, context)
      const result = assignOpenMmIdentity({
        structure,
        residues: openMmResidues(input.residues),
      })
      const requestedApply = input.applyToWorkspace === true
      const captureAfter = typeof input.captureAfter === 'boolean' ? input.captureAfter : requestedApply
      return await finalizeStructureCandidate({
        tool: assignOpenMmIdentityManifest.name,
        result,
        requestedApply,
        captureAfter,
        context,
        summary: (applied, blocked, verified) => `Assigned ${result.structure.atoms.length} atoms to ${result.residues.length} ordered OpenMM residue block(s) across ${new Set(result.residues.map((residue) => residue.chainId)).size} chain(s)${applied ? verified === true ? ' and property-fingerprint-verified the workspace readback' : verified === false ? '; viewport property readback diverged' : ' and applied it without readback' : blocked ? '; workspace application was blocked' : ''}`,
      })
    } catch (error) {
      return toolError(assignOpenMmIdentityManifest.name, error)
    }
  },
}

export const MOLECULE_ZATOM_AGENT_TOOLS: readonly ZatomToolDefinition[] = [
  validateMoleculeTool,
  createMoleculeTool,
  optimizeMoleculeTool,
  assignOpenMmIdentityTool,
]
