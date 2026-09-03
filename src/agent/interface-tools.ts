/** Agent/MCP tools for in-plane interface matching and validated stacking. */

import { finalizeStructureCandidate } from './candidate-tool'
import type {
  ZatomStructure,
  ZatomToolContext,
  ZatomToolDefinition,
  ZatomToolManifest,
} from './contracts'
import { ZATOM_STRUCTURE_JSON_SCHEMA } from './contracts'
import { partitionInterfaceReferenceSet } from './interface-reference-set'
import { enumerateInterfaceRegistryConfigurations } from './interface-registry-search'
import {
  buildMatchedInterface,
  findDiagonalInterfaceMatches,
  InterfaceInputError,
  type InPlaneRepeat,
} from './interface'
import { parseZatomStructure, ZatomStructureInputError } from './structure-validation'
import { fingerprintStructure } from './structure-math'
import { numberOption, objectSchema, toolError } from './tool-helpers'

const repeatSchema = { type: 'array', minItems: 2, maxItems: 2, items: { type: 'integer', minimum: 1, maximum: 64 } }
const offsetSchema = { type: 'array', minItems: 2, maxItems: 2, items: { type: 'number' } }

async function resolveBottom(input: Record<string, unknown>, context: ZatomToolContext): Promise<ZatomStructure> {
  if (input.bottom !== undefined) return parseZatomStructure(input.bottom)
  const structure = await context.readStructure?.()
  if (!structure) throw new ZatomStructureInputError('no_active_structure', 'No bottom structure was supplied and the active workspace is empty')
  return parseZatomStructure(structure)
}

function requiredTop(input: Record<string, unknown>): ZatomStructure {
  if (input.top === undefined) throw new ZatomStructureInputError('missing_top_structure', 'top is required')
  return parseZatomStructure(input.top)
}

async function resolveInterface(input: Record<string, unknown>, context: ZatomToolContext): Promise<ZatomStructure> {
  if (input.interfaceStructure !== undefined) return parseZatomStructure(input.interfaceStructure)
  const structure = await context.readStructure?.()
  if (!structure) {
    throw new ZatomStructureInputError(
      'no_active_structure',
      'No interfaceStructure was supplied and the active workspace is empty',
    )
  }
  return parseZatomStructure(structure)
}

function pairOption(value: unknown, field: string): [number, number] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length !== 2) throw new InterfaceInputError('invalid_pair', `${field} must contain two finite numbers`)
  const result: [number, number] = [Number(value[0]), Number(value[1])]
  if (result.some((item) => !Number.isFinite(item))) throw new InterfaceInputError('invalid_pair', `${field} must contain two finite numbers`)
  return result
}

function pairArrayOption(value: unknown, field: string): Array<[number, number]> | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || !value.length) throw new InterfaceInputError('invalid_pairs', `${field} must be a non-empty pair array`)
  return value.map((pair, index) => {
    const parsed = pairOption(pair, `${field}[${index}]`)
    if (!parsed) throw new InterfaceInputError('invalid_pairs', `${field}[${index}] is required`)
    return parsed
  })
}

function numberArrayOption(value: unknown, field: string): number[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || !value.length) throw new InterfaceInputError('invalid_array', `${field} must be a non-empty number array`)
  const result = value.map(Number)
  if (result.some((item) => !Number.isFinite(item))) throw new InterfaceInputError('invalid_array', `${field} must contain finite numbers`)
  return result
}

const findManifest: ZatomToolManifest = {
  name: 'interface_find_diagonal_matches',
  title: 'Find diagonal in-plane interface matches',
  version: '1.0.0',
  description: 'Search bounded integer repeats along a and b, rank Pareto in-plane matches, and report the homogeneous top-layer strain, angle mismatch, and resulting atom count.',
  inputSchema: objectSchema({
    bottom: ZATOM_STRUCTURE_JSON_SCHEMA,
    top: ZATOM_STRUCTURE_JSON_SCHEMA,
    maxRepeat: { type: 'integer', minimum: 1, maximum: 16, default: 8 },
    maxOutputAtoms: { type: 'integer', minimum: 2, maximum: 100000, default: 20000 },
    maxStrain: { type: 'number', minimum: 0, default: 0.05 },
    maxAngleMismatchDeg: { type: 'number', minimum: 0, default: 1 },
    limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
  }, ['top']),
  effects: { structure: 'read', workspace: 'read', visual: 'none' },
  tags: ['interface', 'heterostructure', 'match', 'strain', 'agent'],
}

const findInterfaceMatchesTool: ZatomToolDefinition = {
  manifest: findManifest,
  execute: async (input, context) => {
    try {
      const bottom = await resolveBottom(input, context)
      const top = requiredTop(input)
      const result = findDiagonalInterfaceMatches({
        bottom,
        top,
        maxRepeat: numberOption(input, 'maxRepeat'),
        maxOutputAtoms: numberOption(input, 'maxOutputAtoms'),
        maxStrain: numberOption(input, 'maxStrain'),
        maxAngleMismatchDeg: numberOption(input, 'maxAngleMismatchDeg'),
        limit: numberOption(input, 'limit'),
      })
      return {
        ok: true,
        tool: findManifest.name,
        summary: `Recommended ${result.recommended.id}: ${(100 * result.recommended.maxAbsLinearStrain).toFixed(3)}% max linear strain, ${result.recommended.angleMismatchDeg.toFixed(3)}° angle mismatch, ${result.recommended.totalAtomCount} atoms`,
        data: result,
        checks: result.checks,
      }
    } catch (error) {
      return toolError(findManifest.name, error)
    }
  },
}

const registrySearchManifest: ZatomToolManifest = {
  name: 'interface_enumerate_registry_configurations',
  title: 'Enumerate interface registries and gaps',
  version: '1.0.0',
  description: 'Resolve one diagonal in-plane match, exhaustively build a bounded explicit/uniform registry-offset × gap grid, retain collision and validation failures, collapse exact structure duplicates, and return an unweighted catalog with bottom/top/result-bound structure_build_interface replay inputs and matched isolated references. This does not rank adhesion, reconstruction, or stability.',
  inputSchema: objectSchema({
    bottom: ZATOM_STRUCTURE_JSON_SCHEMA,
    top: ZATOM_STRUCTURE_JSON_SCHEMA,
    bottomRepeat: repeatSchema,
    topRepeat: repeatSchema,
    registryGrid: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'integer', minimum: 1, maximum: 64 } },
    registryOffsetsFractional: { type: 'array', minItems: 1, maxItems: 256, items: offsetSchema },
    gapsA: { type: 'array', minItems: 1, maxItems: 32, uniqueItems: true, items: { type: 'number', exclusiveMinimum: 0, maximum: 100 } },
    maxRepeat: { type: 'integer', minimum: 1, maximum: 16, default: 8 },
    maxOutputAtoms: { type: 'integer', minimum: 2, maximum: 100000, default: 20000 },
    maxStrain: { type: 'number', minimum: 0, maximum: 1, default: 0.05 },
    maxAngleMismatchDeg: { type: 'number', minimum: 0, maximum: 180, default: 1 },
    vacuumA: { type: 'number', minimum: 0, maximum: 10000, default: 12 },
    collisionDistanceA: { type: 'number', exclusiveMinimum: 0, maximum: 100, default: 0.6 },
    maxCrossPairs: { type: 'integer', minimum: 1, maximum: 100000000, default: 2000000 },
    maxCandidates: { type: 'integer', minimum: 1, maximum: 512, default: 128 },
  }, ['top']),
  effects: { structure: 'read', workspace: 'read', visual: 'none' },
  tags: ['interface', 'registry', 'gap', 'configuration-search', 'catalog', 'geometry', 'agent'],
}

const enumerateInterfaceRegistryTool: ZatomToolDefinition = {
  manifest: registrySearchManifest,
  execute: async (input, context) => {
    try {
      const bottom = await resolveBottom(input, context)
      const top = requiredTop(input)
      const result = enumerateInterfaceRegistryConfigurations({
        bottom,
        top,
        bottomRepeat: pairOption(input.bottomRepeat, 'bottomRepeat') as InPlaneRepeat | undefined,
        topRepeat: pairOption(input.topRepeat, 'topRepeat') as InPlaneRepeat | undefined,
        registryGrid: pairOption(input.registryGrid, 'registryGrid') as InPlaneRepeat | undefined,
        registryOffsetsFractional: pairArrayOption(input.registryOffsetsFractional, 'registryOffsetsFractional'),
        gapsA: numberArrayOption(input.gapsA, 'gapsA'),
        maxRepeat: numberOption(input, 'maxRepeat'),
        maxOutputAtoms: numberOption(input, 'maxOutputAtoms'),
        maxStrain: numberOption(input, 'maxStrain'),
        maxAngleMismatchDeg: numberOption(input, 'maxAngleMismatchDeg'),
        vacuumA: numberOption(input, 'vacuumA'),
        collisionDistanceA: numberOption(input, 'collisionDistanceA'),
        maxCrossPairs: numberOption(input, 'maxCrossPairs'),
        maxCandidates: numberOption(input, 'maxCandidates'),
      })
      return {
        ok: true,
        tool: registrySearchManifest.name,
        summary: `Enumerated ${result.catalog.search.evaluatedCombinationCount} registry/gap configurations into ${result.catalog.search.uniqueCandidateCount} unique interfaces (${result.catalog.search.validCandidateCount} valid, ${result.catalog.search.rejectedCandidateCount} rejected); no energetic ranking was assigned`,
        data: result,
        checks: result.checks,
      }
    } catch (error) {
      return toolError(registrySearchManifest.name, error)
    }
  },
}

const buildManifest: ZatomToolManifest = {
  name: 'structure_build_interface',
  title: 'Build a matched stacked interface',
  version: '1.0.0',
  description: 'Repeat two periodic slabs in-plane, map the top supercell onto the bottom cell, stack at an exact outer-plane gap, add vacuum, and enforce strain and cross-interface distance gates.',
  inputSchema: objectSchema({
    bottom: ZATOM_STRUCTURE_JSON_SCHEMA,
    top: ZATOM_STRUCTURE_JSON_SCHEMA,
    expectedBottomFingerprint: { type: 'string', minLength: 1, maxLength: 128 },
    expectedTopFingerprint: { type: 'string', minLength: 1, maxLength: 128 },
    expectedResultFingerprint: { type: 'string', minLength: 1, maxLength: 128 },
    bottomRepeat: repeatSchema,
    topRepeat: repeatSchema,
    maxRepeat: { type: 'integer', minimum: 1, maximum: 16, default: 8 },
    maxOutputAtoms: { type: 'integer', minimum: 2, maximum: 100000, default: 20000 },
    maxStrain: { type: 'number', minimum: 0, default: 0.05 },
    maxAngleMismatchDeg: { type: 'number', minimum: 0, default: 1 },
    gapA: { type: 'number', exclusiveMinimum: 0, default: 3 },
    vacuumA: { type: 'number', minimum: 0, default: 12 },
    registryOffsetFractional: offsetSchema,
    collisionDistanceA: { type: 'number', exclusiveMinimum: 0, default: 0.6 },
    maxCrossPairs: { type: 'integer', minimum: 1, maximum: 100000000, default: 2000000 },
    applyToWorkspace: { type: 'boolean', default: false },
    captureAfter: { type: 'boolean', description: 'Default true only when applying to the active workspace in a visual host' },
  }, ['top']),
  effects: { structure: 'create', workspace: 'write', visual: 'read' },
  tags: ['structure', 'interface', 'heterostructure', 'contact', 'strain', 'validation', 'agent'],
}

const buildInterfaceTool: ZatomToolDefinition = {
  manifest: buildManifest,
  execute: async (input, context) => {
    try {
      const bottom = await resolveBottom(input, context)
      const top = requiredTop(input)
      if (typeof input.expectedBottomFingerprint === 'string'
        && fingerprintStructure(bottom) !== input.expectedBottomFingerprint) {
        throw new InterfaceInputError('stale_interface_bottom', 'Bottom structure does not match the registry-catalog fingerprint binding')
      }
      if (typeof input.expectedTopFingerprint === 'string'
        && fingerprintStructure(top) !== input.expectedTopFingerprint) {
        throw new InterfaceInputError('stale_interface_top', 'Top structure does not match the registry-catalog fingerprint binding')
      }
      const bottomRepeat = pairOption(input.bottomRepeat, 'bottomRepeat') as InPlaneRepeat | undefined
      const topRepeat = pairOption(input.topRepeat, 'topRepeat') as InPlaneRepeat | undefined
      const result = buildMatchedInterface({
        bottom,
        top,
        bottomRepeat,
        topRepeat,
        maxRepeat: numberOption(input, 'maxRepeat'),
        maxOutputAtoms: numberOption(input, 'maxOutputAtoms'),
        maxStrain: numberOption(input, 'maxStrain'),
        maxAngleMismatchDeg: numberOption(input, 'maxAngleMismatchDeg'),
        gapA: numberOption(input, 'gapA'),
        vacuumA: numberOption(input, 'vacuumA'),
        registryOffsetFractional: pairOption(input.registryOffsetFractional, 'registryOffsetFractional'),
        collisionDistanceA: numberOption(input, 'collisionDistanceA'),
        maxCrossPairs: numberOption(input, 'maxCrossPairs'),
      })
      if (typeof input.expectedResultFingerprint === 'string'
        && fingerprintStructure(result.structure) !== input.expectedResultFingerprint) {
        throw new InterfaceInputError('interface_registry_replay_mismatch', 'Rebuilt interface does not match the registry-catalog result fingerprint')
      }
      const requestedApply = input.applyToWorkspace === true
      const captureAfter = typeof input.captureAfter === 'boolean' ? input.captureAfter : requestedApply
      return await finalizeStructureCandidate({
        tool: buildManifest.name,
        result,
        requestedApply,
        captureAfter,
        context,
        summary: (applied, blocked) => `Built ${result.structure.atoms.length}-atom interface at ${result.metrics.measuredGapA.toFixed(3)} Å gap with ${(100 * result.match.maxAbsLinearStrain).toFixed(3)}% max top strain${applied ? ' and applied it to the active workspace' : blocked ? '; workspace application was blocked' : ''}`,
      })
    } catch (error) {
      return toolError(buildManifest.name, error)
    }
  },
}

const partitionReferencesManifest: ZatomToolManifest = {
  name: 'interface_partition_reference_structures',
  title: 'Partition interface reference structures',
  version: '1.0.0',
  description: 'Partition a built or explicitly reconstructed zatom.interface/v1 hypothesis by required per-atom zatom.interfaceLayer labels into exact same-cell bottom/top references; preserve every layer-internal bond, omit cross-interface bonds, and bind the returned interface/reference set with one fingerprint. This does not infer reconstruction, relaxation, adhesion, or stability.',
  inputSchema: objectSchema({
    interfaceStructure: ZATOM_STRUCTURE_JSON_SCHEMA,
    applyToWorkspace: { type: 'boolean', default: false },
    captureAfter: { type: 'boolean', description: 'Default true only when applying to the active workspace in a visual host' },
  }),
  effects: { structure: 'create', workspace: 'write', visual: 'read' },
  tags: ['interface', 'reconstruction', 'reference', 'partition', 'topology', 'provenance', 'agent'],
}

const partitionInterfaceReferencesTool: ZatomToolDefinition = {
  manifest: partitionReferencesManifest,
  execute: async (input, context) => {
    try {
      const interfaceStructure = await resolveInterface(input, context)
      const result = partitionInterfaceReferenceSet({ interfaceStructure })
      const requestedApply = input.applyToWorkspace === true
      const captureAfter = typeof input.captureAfter === 'boolean' ? input.captureAfter : requestedApply
      return await finalizeStructureCandidate({
        tool: partitionReferencesManifest.name,
        result,
        requestedApply,
        captureAfter,
        context,
        summary: (applied, blocked) => `Partitioned reference set ${result.referenceSetFingerprint}: ${result.metrics.bottomAtomCount}+${result.metrics.topAtomCount} atoms, ${result.metrics.omittedCrossInterfaceBondCount} cross-interface bonds omitted from isolated references${applied ? ' and applied the bound interface metadata to the active workspace' : blocked ? '; workspace application was blocked' : ''}`,
      })
    } catch (error) {
      return toolError(partitionReferencesManifest.name, error)
    }
  },
}

export const INTERFACE_ZATOM_AGENT_TOOLS: readonly ZatomToolDefinition[] = [
  findInterfaceMatchesTool,
  enumerateInterfaceRegistryTool,
  buildInterfaceTool,
  partitionInterfaceReferencesTool,
]
