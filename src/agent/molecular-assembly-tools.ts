/** Agent/MCP tool for deterministic canonical molecular-system assembly. */

import { finalizeStructureCandidate } from './candidate-tool'
import type {
  JsonValue,
  Mat3,
  Vec3,
  ZatomLattice,
  ZatomStructure,
  ZatomToolContext,
  ZatomToolDefinition,
  ZatomToolManifest,
} from './contracts'
import { ZATOM_STRUCTURE_JSON_SCHEMA } from './contracts'
import {
  assembleMolecularSystem,
  MolecularAssemblyInputError,
  type MolecularAssemblyComponent,
  type MolecularAssemblyExternalBond,
} from './molecular-assembly'
import { parseZatomStructure } from './structure-validation'
import { objectSchema, toolError } from './tool-helpers'

const vec3Schema = { type: 'array', minItems: 3, maxItems: 3, items: { type: 'number' } }

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function finiteVec3(value: unknown, field: string): Vec3 | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length !== 3) {
    throw new MolecularAssemblyInputError('invalid_assembly_vector', `${field} must contain three finite numbers`)
  }
  const result: Vec3 = [Number(value[0]), Number(value[1]), Number(value[2])]
  if (result.some((item) => !Number.isFinite(item))) {
    throw new MolecularAssemblyInputError('invalid_assembly_vector', `${field} must contain three finite numbers`)
  }
  return result
}

function finiteNumber(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined
  const result = Number(value)
  if (!Number.isFinite(result)) throw new MolecularAssemblyInputError('invalid_assembly_number', `${field} must be finite`)
  return result
}

function parseLattice(value: unknown): ZatomLattice | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value) || !Array.isArray(value.vectors) || value.vectors.length !== 3
    || !Array.isArray(value.periodic) || value.periodic.length !== 3
    || value.periodic.some((entry) => typeof entry !== 'boolean')) {
    throw new MolecularAssemblyInputError('invalid_assembly_lattice', 'lattice requires three row vectors and three periodic booleans')
  }
  const vectors = value.vectors.map((row, index) => finiteVec3(row, `lattice.vectors[${index}]`)) as Mat3
  return { vectors, periodic: [value.periodic[0], value.periodic[1], value.periodic[2]] }
}

async function parseComponents(value: unknown, context: ZatomToolContext): Promise<MolecularAssemblyComponent[]> {
  if (!Array.isArray(value)) throw new MolecularAssemblyInputError('invalid_components', 'components must be an array')
  let activeStructure: ZatomStructure | null | undefined
  let activeUseCount = 0
  const components: MolecularAssemblyComponent[] = []
  for (let index = 0; index < value.length; index++) {
    const raw = value[index]
    if (!isRecord(raw)) throw new MolecularAssemblyInputError('invalid_component', `components[${index}] must be an object`)
    const hasStructure = raw.structure !== undefined
    const usesActive = raw.useActiveStructure === true
    if (hasStructure === usesActive) {
      throw new MolecularAssemblyInputError('invalid_component_source', `components[${index}] must provide exactly one of structure or useActiveStructure:true`)
    }
    let structure: ZatomStructure
    if (usesActive) {
      activeUseCount++
      if (activeUseCount > 1) throw new MolecularAssemblyInputError('duplicate_active_component', 'Only one component may use the active workspace structure')
      if (activeStructure === undefined) activeStructure = await context.readStructure?.() ?? null
      if (!activeStructure) throw new MolecularAssemblyInputError('no_active_structure', 'A component requested the active workspace, but it is empty or unavailable')
      structure = parseZatomStructure(activeStructure)
    } else {
      structure = parseZatomStructure(raw.structure)
    }
    const translationA = finiteVec3(raw.translationA, `components[${index}].translationA`)
    const rotationAxis = finiteVec3(raw.rotationAxis, `components[${index}].rotationAxis`)
    const rotationAngleDeg = finiteNumber(raw.rotationAngleDeg, `components[${index}].rotationAngleDeg`)
    const rotationOriginA = finiteVec3(raw.rotationOriginA, `components[${index}].rotationOriginA`)
    components.push({
      id: typeof raw.id === 'string' ? raw.id : '',
      structure,
      ...(translationA ? { translationA } : {}),
      ...(rotationAxis ? { rotationAxis } : {}),
      ...(rotationAngleDeg === undefined ? {} : { rotationAngleDeg }),
      ...(rotationOriginA ? { rotationOriginA } : {}),
    })
  }
  return components
}

function parseAtomRef(value: unknown, field: string): { componentId: string; atomId: string } {
  if (!isRecord(value) || typeof value.componentId !== 'string' || typeof value.atomId !== 'string') {
    throw new MolecularAssemblyInputError('invalid_external_bond', `${field} requires componentId and atomId strings`)
  }
  return { componentId: value.componentId, atomId: value.atomId }
}

function parseExternalBonds(value: unknown): MolecularAssemblyExternalBond[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new MolecularAssemblyInputError('invalid_external_bonds', 'externalBonds must be an array')
  return value.map((raw, index) => {
    if (!isRecord(raw)) throw new MolecularAssemblyInputError('invalid_external_bond', `externalBonds[${index}] must be an object`)
    const order = Number(raw.order)
    return {
      id: typeof raw.id === 'string' ? raw.id : '',
      atomA: parseAtomRef(raw.atomA, `externalBonds[${index}].atomA`),
      atomB: parseAtomRef(raw.atomB, `externalBonds[${index}].atomB`),
      order: order as 1 | 1.5 | 2 | 3,
      ...(isRecord(raw.properties) ? { properties: raw.properties as Record<string, JsonValue> } : {}),
    }
  })
}

const atomRefSchema = objectSchema({
  componentId: { type: 'string', minLength: 1, maxLength: 64 },
  atomId: { type: 'string', minLength: 1 },
}, ['componentId', 'atomId'])

const assembleManifest: ZatomToolManifest = {
  name: 'molecule_assemble_system',
  title: 'Assemble explicit molecular components',
  version: '1.0.0',
  description: 'Rigidly transform and merge finite canonical molecular components with namespaced identity, preserved properties/topology, optional explicit cross-component bonds, exact contact budgets, and visual targets.',
  inputSchema: objectSchema({
    components: {
      type: 'array',
      minItems: 1,
      maxItems: 256,
      items: objectSchema({
        id: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9._-]{0,63}$' },
        structure: ZATOM_STRUCTURE_JSON_SCHEMA,
        useActiveStructure: { type: 'boolean', default: false },
        translationA: vec3Schema,
        rotationAxis: vec3Schema,
        rotationAngleDeg: { type: 'number', minimum: -36000, maximum: 36000 },
        rotationOriginA: vec3Schema,
      }, ['id']),
    },
    externalBonds: {
      type: 'array',
      items: objectSchema({
        id: { type: 'string', minLength: 1 },
        atomA: atomRefSchema,
        atomB: atomRefSchema,
        order: { enum: [1, 1.5, 2, 3] },
        properties: { type: 'object' },
      }, ['id', 'atomA', 'atomB', 'order']),
    },
    lattice: objectSchema({
      vectors: { type: 'array', minItems: 3, maxItems: 3, items: vec3Schema },
      periodic: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'boolean' } },
    }, ['vectors', 'periodic']),
    label: { type: 'string', maxLength: 256 },
    minimumIntercomponentDistanceA: { type: 'number', minimum: 0, default: 0.65 },
    intercomponentWarningDistanceA: { type: 'number', minimum: 0, default: 0.9 },
    maxIntercomponentPairChecks: { type: 'integer', minimum: 1, maximum: 5_000_000, default: 1_000_000 },
    applyToWorkspace: { type: 'boolean', default: false },
    captureAfter: { type: 'boolean', description: 'Default true only when applying to the active workspace in a visual host' },
  }, ['components']),
  effects: { structure: 'create', workspace: 'write', visual: 'read' },
  tags: ['molecule', 'assembly', 'system', 'topology', 'transform', 'contact', 'agent'],
}

const assembleTool: ZatomToolDefinition = {
  manifest: assembleManifest,
  execute: async (input, context) => {
    try {
      const result = assembleMolecularSystem({
        components: await parseComponents(input.components, context),
        externalBonds: parseExternalBonds(input.externalBonds),
        lattice: parseLattice(input.lattice),
        ...(typeof input.label === 'string' ? { label: input.label } : {}),
        minimumIntercomponentDistanceA: finiteNumber(input.minimumIntercomponentDistanceA, 'minimumIntercomponentDistanceA'),
        intercomponentWarningDistanceA: finiteNumber(input.intercomponentWarningDistanceA, 'intercomponentWarningDistanceA'),
        maxIntercomponentPairChecks: finiteNumber(input.maxIntercomponentPairChecks, 'maxIntercomponentPairChecks'),
      })
      const requestedApply = input.applyToWorkspace === true
      const captureAfter = typeof input.captureAfter === 'boolean' ? input.captureAfter : requestedApply
      return await finalizeStructureCandidate({
        tool: assembleManifest.name,
        result,
        requestedApply,
        captureAfter,
        context,
        summary: (applied, blocked, verified) => `Assembled ${result.components.length} component(s), ${result.structure.atoms.length} atoms, ${result.structure.bonds?.length ?? 0} bonds; closest cross-component pair ${result.minimumIntercomponentDistanceA === null ? 'n/a' : `${result.minimumIntercomponentDistanceA.toFixed(4)} Å`}${applied ? verified === true ? ' and fingerprint-verified workspace readback' : verified === false ? '; workspace readback diverged' : ' and applied without readback' : blocked ? '; workspace application was blocked' : ''}`,
      })
    } catch (error) {
      return toolError(assembleManifest.name, error)
    }
  },
}

export const MOLECULAR_ASSEMBLY_ZATOM_AGENT_TOOLS: readonly ZatomToolDefinition[] = [assembleTool]
