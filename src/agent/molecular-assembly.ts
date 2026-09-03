/** Deterministic, topology-preserving assembly of canonical molecular components. */

import type {
  InspectionTarget,
  JsonValue,
  StructureChangeSet,
  StructureProvenance,
  ValidationCheck,
  Vec3,
  ZatomLattice,
  ZatomStructure,
  ZatomStructureBond,
} from './contracts'
import { ZATOM_STRUCTURE_SCHEMA } from './contracts'
import { ZATOM_BIOMOLECULAR_IDENTITY_PROPERTIES } from './biomolecular-identity'
import { buildStructureChangeSet } from './operations'
import {
  applyMatrix3,
  boundsOfPositions,
  createDistanceCalculator,
  fingerprintStructure,
  rotationMatrixAroundAxis,
} from './structure-math'
import { validateStructure } from './structure-validation'

const MAX_COMPONENTS = 256
const MAX_TOTAL_ATOMS = 100_000
const MAX_PAIR_CHECKS = 5_000_000
const MAX_COMPONENT_TARGETS = 24
const ROUND_TRIP_TOLERANCE_A = 1e-8
const RESERVED_COMPONENT_ID = /^[A-Za-z][A-Za-z0-9._-]{0,63}$/

export class MolecularAssemblyInputError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'MolecularAssemblyInputError'
    this.code = code
  }
}

export interface MolecularAssemblyComponent {
  id: string
  structure: ZatomStructure
  translationA?: Vec3
  rotationAxis?: Vec3
  rotationAngleDeg?: number
  rotationOriginA?: Vec3
}

export interface MolecularAssemblyAtomRef {
  componentId: string
  atomId: string
}

export interface MolecularAssemblyExternalBond {
  id: string
  atomA: MolecularAssemblyAtomRef
  atomB: MolecularAssemblyAtomRef
  order: 1 | 1.5 | 2 | 3
  properties?: Record<string, JsonValue>
}

export interface AssembleMolecularSystemOptions {
  components: MolecularAssemblyComponent[]
  externalBonds?: MolecularAssemblyExternalBond[]
  lattice?: ZatomLattice
  label?: string
  minimumIntercomponentDistanceA?: number
  intercomponentWarningDistanceA?: number
  maxIntercomponentPairChecks?: number
}

export interface MolecularAssemblyComponentManifest {
  id: string
  label?: string
  sourceFingerprint: string
  atomCount: number
  internalBondCount: number
  translationA: Vec3
  rotationAxis: Vec3 | null
  rotationAngleDeg: number
  rotationOriginA: Vec3
  outputAtomIds: string[]
  outputAtomIdsTruncated: boolean
  bounds: { min: Vec3; max: Vec3; center: Vec3; radius: number }
}

export interface AssembleMolecularSystemResult {
  structure: ZatomStructure
  checks: ValidationCheck[]
  validation: ReturnType<typeof validateStructure>
  changeSet: StructureChangeSet
  provenance: StructureProvenance
  inspectionTargets: InspectionTarget[]
  components: MolecularAssemblyComponentManifest[]
  externalBondCount: number
  intercomponentPairCount: number
  minimumIntercomponentDistanceA: number | null
  closestIntercomponentPair: [string, string] | null
  formalCharge: number | null
}

function finiteVec3(value: Vec3 | undefined, fallback: Vec3, field: string): Vec3 {
  if (value === undefined) return [...fallback] as Vec3
  if (!Array.isArray(value) || value.length !== 3 || value.some((item) => !Number.isFinite(item))) {
    throw new MolecularAssemblyInputError('invalid_assembly_vector', `${field} must contain three finite numbers`)
  }
  return [value[0], value[1], value[2]]
}

function finiteNonNegative(value: number | undefined, fallback: number, field: string): number {
  const resolved = value ?? fallback
  if (!Number.isFinite(resolved) || resolved < 0) {
    throw new MolecularAssemblyInputError('invalid_assembly_number', `${field} must be finite and non-negative`)
  }
  return resolved
}

function cloneJsonValue(value: JsonValue): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.map(cloneJsonValue)
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneJsonValue(item)]))
}

function cloneJsonRecord(value: Record<string, JsonValue> | undefined): Record<string, JsonValue> | undefined {
  if (!value) return undefined
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneJsonValue(item)]))
}

function centroid(structure: ZatomStructure): Vec3 {
  const center: Vec3 = [0, 0, 0]
  for (const atom of structure.atoms) {
    center[0] += atom.position[0] / structure.atoms.length
    center[1] += atom.position[1] / structure.atoms.length
    center[2] += atom.position[2] / structure.atoms.length
  }
  return center
}

function normalizeAxis(axis: Vec3, field: string): Vec3 {
  const length = Math.hypot(axis[0], axis[1], axis[2])
  if (!Number.isFinite(length) || length < 1e-12) {
    throw new MolecularAssemblyInputError('invalid_rotation_axis', `${field} must have non-zero length`)
  }
  return [axis[0] / length, axis[1] / length, axis[2] / length]
}

function rotateAround(position: Vec3, origin: Vec3, axis: Vec3, angleRad: number): Vec3 {
  const rotated = applyMatrix3(rotationMatrixAroundAxis(axis, angleRad), [
    position[0] - origin[0],
    position[1] - origin[1],
    position[2] - origin[2],
  ])
  return [
    origin[0] + rotated[0],
    origin[1] + rotated[1],
    origin[2] + rotated[2],
  ]
}

function transformedPosition(position: Vec3, origin: Vec3, axis: Vec3 | null, angleRad: number, translation: Vec3): Vec3 {
  const rotated = axis ? rotateAround(position, origin, axis, angleRad) : [...position] as Vec3
  return [rotated[0] + translation[0], rotated[1] + translation[1], rotated[2] + translation[2]]
}

function inverseTransformedPosition(position: Vec3, origin: Vec3, axis: Vec3 | null, angleRad: number, translation: Vec3): Vec3 {
  const untranslated: Vec3 = [position[0] - translation[0], position[1] - translation[1], position[2] - translation[2]]
  return axis ? rotateAround(untranslated, origin, axis, -angleRad) : untranslated
}

function outputAtomId(componentId: string, sourceAtomId: string): string {
  return `${componentId}::${sourceAtomId}`
}

function outputBondId(componentId: string, sourceBondId: string): string {
  return `${componentId}::${sourceBondId}`
}

function connectedComponentCount(structure: ZatomStructure): number {
  const adjacency = new Map(structure.atoms.map((atom) => [atom.id, new Set<string>()]))
  for (const bond of structure.bonds ?? []) {
    adjacency.get(bond.atomIds[0])?.add(bond.atomIds[1])
    adjacency.get(bond.atomIds[1])?.add(bond.atomIds[0])
  }
  const visited = new Set<string>()
  let count = 0
  for (const atom of structure.atoms) {
    if (visited.has(atom.id)) continue
    count++
    const stack = [atom.id]
    visited.add(atom.id)
    while (stack.length) {
      for (const neighbor of adjacency.get(stack.pop()!) ?? []) {
        if (visited.has(neighbor)) continue
        visited.add(neighbor)
        stack.push(neighbor)
      }
    }
  }
  return count
}

function completeFormalCharge(structure: ZatomStructure): { any: boolean; complete: boolean; total: number | null } {
  const values = structure.atoms.map((atom) => atom.properties?.formalCharge)
  const any = values.some((value) => value !== undefined)
  const complete = values.every((value) => Number.isInteger(value))
  return {
    any,
    complete,
    total: complete ? (values as number[]).reduce((sum, value) => sum + value, 0) : null,
  }
}

function validateComponent(component: MolecularAssemblyComponent, index: number): void {
  if (!RESERVED_COMPONENT_ID.test(component.id)) {
    throw new MolecularAssemblyInputError(
      'invalid_component_id',
      `components[${index}].id must start with a letter and use at most 64 ASCII letters, digits, dots, underscores, or hyphens`,
    )
  }
  if (component.structure.lattice) {
    throw new MolecularAssemblyInputError('component_lattice_unsupported', `Component ${component.id} must be finite; set the assembled system lattice at the top level`)
  }
  if (component.structure.schemaVersion !== ZATOM_STRUCTURE_SCHEMA || !Array.isArray(component.structure.atoms) || !component.structure.atoms.length) {
    throw new MolecularAssemblyInputError('invalid_component_structure', `Component ${component.id} must be a non-empty ${ZATOM_STRUCTURE_SCHEMA} artifact`)
  }
  if (component.structure.bonds === undefined) {
    throw new MolecularAssemblyInputError('component_topology_required', `Component ${component.id} requires explicit bonds, including [] for a monatomic species`)
  }
  const validation = validateStructure(component.structure)
  const failures = validation.checks.filter((check) => check.status === 'fail')
  if (failures.length) {
    throw new MolecularAssemblyInputError('invalid_component_structure', `Component ${component.id} failed validation: ${failures.map((check) => check.message).join('; ')}`)
  }
  const connected = connectedComponentCount(component.structure)
  if (connected !== 1) {
    throw new MolecularAssemblyInputError('disconnected_component', `Component ${component.id} contains ${connected} disconnected molecular pieces; supply each piece as its own component`)
  }
}

/**
 * Assemble finite, explicitly bonded molecular components with stable namespaced
 * identity. This operation performs geometry/topology bookkeeping only; it does
 * not parameterize, protonate, relax, or infer chemistry.
 */
export function assembleMolecularSystem(options: AssembleMolecularSystemOptions): AssembleMolecularSystemResult {
  if (!Array.isArray(options.components) || !options.components.length || options.components.length > MAX_COMPONENTS) {
    throw new MolecularAssemblyInputError('invalid_components', `components must contain 1-${MAX_COMPONENTS} records`)
  }
  const componentIds = new Set<string>()
  let totalAtoms = 0
  options.components.forEach((component, index) => {
    validateComponent(component, index)
    if (componentIds.has(component.id)) throw new MolecularAssemblyInputError('duplicate_component_id', `Component ID ${component.id} is repeated`)
    componentIds.add(component.id)
    totalAtoms += component.structure.atoms.length
  })
  if (totalAtoms > MAX_TOTAL_ATOMS) {
    throw new MolecularAssemblyInputError('assembly_atom_budget_exceeded', `Assembly contains ${totalAtoms} atoms; hard limit is ${MAX_TOTAL_ATOMS}`)
  }

  const minimumDistanceA = finiteNonNegative(options.minimumIntercomponentDistanceA, 0.65, 'minimumIntercomponentDistanceA')
  const warningDistanceA = finiteNonNegative(options.intercomponentWarningDistanceA, Math.max(0.9, minimumDistanceA), 'intercomponentWarningDistanceA')
  if (warningDistanceA < minimumDistanceA) {
    throw new MolecularAssemblyInputError('invalid_distance_thresholds', 'intercomponentWarningDistanceA must be at least minimumIntercomponentDistanceA')
  }
  const pairBudget = finiteNonNegative(options.maxIntercomponentPairChecks, 1_000_000, 'maxIntercomponentPairChecks')
  if (!Number.isSafeInteger(pairBudget) || pairBudget < 1 || pairBudget > MAX_PAIR_CHECKS) {
    throw new MolecularAssemblyInputError('invalid_pair_budget', `maxIntercomponentPairChecks must be an integer from 1 to ${MAX_PAIR_CHECKS}`)
  }

  const atoms: ZatomStructure['atoms'] = []
  const bonds: ZatomStructureBond[] = []
  const componentAtomIds = new Map<string, Map<string, string>>()
  const outputAtomsByComponent = new Map<string, ZatomStructure['atoms']>()
  const manifests: MolecularAssemblyComponentManifest[] = []
  let maxRoundTripErrorA = 0
  let overwrittenAssemblyPropertyCount = 0

  for (const component of options.components) {
    const translation = finiteVec3(component.translationA, [0, 0, 0], `${component.id}.translationA`)
    const hasAxis = component.rotationAxis !== undefined
    const hasAngle = component.rotationAngleDeg !== undefined
    if (hasAxis !== hasAngle) {
      throw new MolecularAssemblyInputError('incomplete_rotation', `Component ${component.id} must provide rotationAxis and rotationAngleDeg together`)
    }
    const angleDeg = component.rotationAngleDeg ?? 0
    if (!Number.isFinite(angleDeg) || Math.abs(angleDeg) > 36_000) {
      throw new MolecularAssemblyInputError('invalid_rotation_angle', `Component ${component.id} rotationAngleDeg must be finite and within ±36000`)
    }
    const axis = hasAxis ? normalizeAxis(finiteVec3(component.rotationAxis, [0, 0, 1], `${component.id}.rotationAxis`), `${component.id}.rotationAxis`) : null
    const origin = finiteVec3(component.rotationOriginA, centroid(component.structure), `${component.id}.rotationOriginA`)
    const angleRad = angleDeg * Math.PI / 180
    const idMap = new Map<string, string>()
    componentAtomIds.set(component.id, idMap)
    const transformedAtoms = component.structure.atoms.map((atom) => {
      if (atom.properties?.['zatom.assembly.componentId'] !== undefined
        || atom.properties?.['zatom.assembly.sourceAtomId'] !== undefined) {
        overwrittenAssemblyPropertyCount++
      }
      const id = outputAtomId(component.id, atom.id)
      idMap.set(atom.id, id)
      const position = transformedPosition(atom.position, origin, axis, angleRad, translation)
      const roundTrip = inverseTransformedPosition(position, origin, axis, angleRad, translation)
      maxRoundTripErrorA = Math.max(maxRoundTripErrorA, Math.hypot(
        roundTrip[0] - atom.position[0],
        roundTrip[1] - atom.position[1],
        roundTrip[2] - atom.position[2],
      ))
      return {
        id,
        element: atom.element,
        position,
        properties: {
          ...(cloneJsonRecord(atom.properties) ?? {}),
          'zatom.assembly.componentId': component.id,
          'zatom.assembly.sourceAtomId': atom.id,
        },
      }
    })
    atoms.push(...transformedAtoms)
    outputAtomsByComponent.set(component.id, transformedAtoms)
    for (const bond of component.structure.bonds!) {
      bonds.push({
        id: outputBondId(component.id, bond.id),
        atomIds: [idMap.get(bond.atomIds[0])!, idMap.get(bond.atomIds[1])!],
        order: bond.order,
        ...(bond.properties ? { properties: cloneJsonRecord(bond.properties) } : {}),
      })
    }
    const bounds = boundsOfPositions(transformedAtoms.map((atom) => atom.position))!
    manifests.push({
      id: component.id,
      ...(component.structure.label ? { label: component.structure.label } : {}),
      sourceFingerprint: fingerprintStructure(component.structure),
      atomCount: component.structure.atoms.length,
      internalBondCount: component.structure.bonds!.length,
      translationA: translation,
      rotationAxis: axis,
      rotationAngleDeg: angleDeg,
      rotationOriginA: origin,
      outputAtomIds: transformedAtoms.slice(0, 80).map((atom) => atom.id),
      outputAtomIdsTruncated: transformedAtoms.length > 80,
      bounds,
    })
  }

  const externalBonds = options.externalBonds ?? []
  const externalIds = new Set<string>()
  const externalPairs = new Set<string>()
  for (let index = 0; index < externalBonds.length; index++) {
    const bond = externalBonds[index]
    if (!bond || typeof bond.id !== 'string' || !bond.id.trim()) {
      throw new MolecularAssemblyInputError('invalid_external_bond', `externalBonds[${index}].id must be non-empty`)
    }
    if (externalIds.has(bond.id) || bonds.some((existing) => existing.id === bond.id)) {
      throw new MolecularAssemblyInputError('duplicate_external_bond_id', `External bond ID ${bond.id} collides with another bond`)
    }
    externalIds.add(bond.id)
    if (bond.atomA.componentId === bond.atomB.componentId) {
      throw new MolecularAssemblyInputError('invalid_external_bond', `External bond ${bond.id} must join two different components`)
    }
    const atomA = componentAtomIds.get(bond.atomA.componentId)?.get(bond.atomA.atomId)
    const atomB = componentAtomIds.get(bond.atomB.componentId)?.get(bond.atomB.atomId)
    if (!atomA || !atomB) {
      throw new MolecularAssemblyInputError('external_bond_atom_missing', `External bond ${bond.id} references an absent component/source atom`)
    }
    if (bond.order !== 1 && bond.order !== 1.5 && bond.order !== 2 && bond.order !== 3) {
      throw new MolecularAssemblyInputError('invalid_external_bond_order', `External bond ${bond.id} order must be 1, 1.5, 2, or 3`)
    }
    const pair = [atomA, atomB].sort().join('\0')
    if (externalPairs.has(pair)) throw new MolecularAssemblyInputError('duplicate_external_bond_pair', `External bond ${bond.id} duplicates an atom pair`)
    externalPairs.add(pair)
    bonds.push({
      id: bond.id,
      atomIds: [atomA, atomB],
      order: bond.order,
      ...(bond.properties ? { properties: cloneJsonRecord(bond.properties) } : {}),
    })
  }

  let intercomponentPairCount = 0
  for (let left = 0; left < options.components.length; left++) {
    for (let right = left + 1; right < options.components.length; right++) {
      intercomponentPairCount += options.components[left].structure.atoms.length * options.components[right].structure.atoms.length
    }
  }
  const pairBudgetSufficient = intercomponentPairCount <= pairBudget
  let closestIntercomponentPair: [string, string] | null = null
  let observedMinimumDistanceA = Number.POSITIVE_INFINITY
  if (pairBudgetSufficient) {
    const distanceBetween = createDistanceCalculator(options.lattice)
    for (let left = 0; left < options.components.length; left++) {
      const leftAtoms = outputAtomsByComponent.get(options.components[left].id)!
      for (let right = left + 1; right < options.components.length; right++) {
        const rightAtoms = outputAtomsByComponent.get(options.components[right].id)!
        for (const atomA of leftAtoms) for (const atomB of rightAtoms) {
          const measured = distanceBetween(atomA.position, atomB.position)
          if (measured < observedMinimumDistanceA) {
            observedMinimumDistanceA = measured
            closestIntercomponentPair = [atomA.id, atomB.id]
          }
        }
      }
    }
  }
  const resolvedMinimumDistanceA = Number.isFinite(observedMinimumDistanceA) ? observedMinimumDistanceA : null

  const chargeStates = options.components.map((component) => completeFormalCharge(component.structure))
  const anyFormalCharge = chargeStates.some((state) => state.any)
  const completeFormalCharges = chargeStates.every((state) => state.complete)
  const formalCharge = completeFormalCharges
    ? chargeStates.reduce((sum, state) => sum + (state.total ?? 0), 0)
    : null

  const duplicatedBiomolecularResidues = new Map<string, string[]>()
  for (const component of options.components) {
    const keys = new Set(component.structure.atoms.flatMap((atom) => {
      const chain = atom.properties?.[ZATOM_BIOMOLECULAR_IDENTITY_PROPERTIES.chainId]
      const residue = atom.properties?.[ZATOM_BIOMOLECULAR_IDENTITY_PROPERTIES.residueId]
      const insertion = atom.properties?.[ZATOM_BIOMOLECULAR_IDENTITY_PROPERTIES.insertionCode] ?? ''
      return typeof chain === 'string' && typeof residue === 'string' ? [`${chain}\0${residue}\0${String(insertion)}`] : []
    }))
    for (const key of keys) {
      const owners = duplicatedBiomolecularResidues.get(key) ?? []
      owners.push(component.id)
      duplicatedBiomolecularResidues.set(key, owners)
    }
  }
  const conflictingResidueKeys = [...duplicatedBiomolecularResidues.values()].filter((owners) => owners.length > 1)

  const provenanceComponents = manifests.map((component) => ({
    id: component.id,
    sourceFingerprint: component.sourceFingerprint,
    atomCount: component.atomCount,
    internalBondCount: component.internalBondCount,
    translationA: component.translationA,
    rotationAxis: component.rotationAxis,
    rotationAngleDeg: component.rotationAngleDeg,
    rotationOriginA: component.rotationOriginA,
  }))
  const structure: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    label: options.label?.trim() || `Assembled molecular system (${options.components.length} components)`,
    atoms,
    bonds,
    ...(options.lattice ? {
      lattice: {
        vectors: options.lattice.vectors.map((row) => [...row] as Vec3) as ZatomLattice['vectors'],
        periodic: [...options.lattice.periodic] as [boolean, boolean, boolean],
      },
    } : {}),
    metadata: {
      'zatom.assembly': {
        schemaVersion: 'zatom.molecular-assembly/v1',
        componentCount: options.components.length,
        externalBondCount: externalBonds.length,
        components: provenanceComponents,
      },
    },
  }
  const validation = validateStructure(structure)
  const checks: ValidationCheck[] = [
    {
      id: 'assembly.component_contract',
      status: 'pass',
      message: `Accepted ${options.components.length} finite, connected, explicitly bonded component(s) containing ${totalAtoms} atoms`,
      metrics: { componentCount: options.components.length, atomCount: totalAtoms },
    },
    {
      id: 'assembly.identity_mapping',
      status: new Set(atoms.map((atom) => atom.id)).size === atoms.length ? 'pass' : 'fail',
      message: `Namespaced ${atoms.length} atom IDs and ${bonds.length} bond IDs by stable component identity`,
      metrics: { atomCount: atoms.length, bondCount: bonds.length },
    },
    {
      id: 'assembly.internal_topology_preserved',
      status: bonds.length - externalBonds.length === options.components.reduce((sum, component) => sum + component.structure.bonds!.length, 0) ? 'pass' : 'fail',
      message: `Preserved all ${bonds.length - externalBonds.length} internal bonds and added ${externalBonds.length} explicit cross-component bond(s)`,
      metrics: { internalBondCount: bonds.length - externalBonds.length, externalBondCount: externalBonds.length },
    },
    {
      id: 'assembly.transform_round_trip',
      status: maxRoundTripErrorA <= ROUND_TRIP_TOLERANCE_A ? 'pass' : 'fail',
      message: `Maximum inverse rigid-transform round-trip error is ${maxRoundTripErrorA.toExponential(3)} Å`,
      metrics: { maxRoundTripErrorA, toleranceA: ROUND_TRIP_TOLERANCE_A },
    },
    {
      id: 'assembly.intercomponent_pair_budget',
      status: pairBudgetSufficient ? 'pass' : 'fail',
      message: pairBudgetSufficient
        ? `Resolved all ${intercomponentPairCount} cross-component atom pairs within the ${pairBudget} check budget`
        : `${intercomponentPairCount} cross-component atom pairs exceed the explicit ${pairBudget} check budget`,
      metrics: { intercomponentPairCount, maxIntercomponentPairChecks: pairBudget },
    },
    {
      id: 'assembly.minimum_intercomponent_distance',
      status: !pairBudgetSufficient
        ? 'skipped'
        : resolvedMinimumDistanceA === null
          ? 'skipped'
          : resolvedMinimumDistanceA < minimumDistanceA
            ? 'fail'
            : resolvedMinimumDistanceA < warningDistanceA ? 'warn' : 'pass',
      message: !pairBudgetSufficient
        ? 'Intercomponent distance is unresolved because the exact pair budget was exceeded'
        : resolvedMinimumDistanceA === null
          ? 'Only one component is present; no intercomponent distance exists'
          : `Minimum intercomponent distance is ${resolvedMinimumDistanceA.toFixed(4)} Å (hard ${minimumDistanceA.toFixed(4)} Å, warning ${warningDistanceA.toFixed(4)} Å)`,
      metrics: { minimumDistanceA: resolvedMinimumDistanceA, hardThresholdA: minimumDistanceA, warningThresholdA: warningDistanceA },
      ...(closestIntercomponentPair ? { atomIds: closestIntercomponentPair } : {}),
    },
    {
      id: 'assembly.formal_charge_coverage',
      status: completeFormalCharges ? 'pass' : anyFormalCharge ? 'fail' : 'skipped',
      message: completeFormalCharges
        ? `Complete integer atom formal charges sum to ${formalCharge}`
        : anyFormalCharge
          ? 'Formal charge annotations are partial or non-integer across assembled components'
          : 'No complete atom formal-charge map was supplied; total charge remains unassessed',
      metrics: { formalCharge },
    },
    {
      id: 'assembly.openmm_identity_scope',
      status: conflictingResidueKeys.length ? 'warn' : 'pass',
      message: conflictingResidueKeys.length
        ? `${conflictingResidueKeys.length} OpenMM chain/residue key(s) are reused across components; call molecule_assign_openmm_identity on the assembled atom order before an OpenMM run`
        : 'No cross-component biomolecular residue-key conflict was detected; downstream template matching is still required',
      metrics: { conflictingResidueKeyCount: conflictingResidueKeys.length },
    },
    {
      id: 'assembly.source_annotation_scope',
      status: overwrittenAssemblyPropertyCount ? 'warn' : 'pass',
      message: overwrittenAssemblyPropertyCount
        ? `Replaced prior zatom assembly-source annotations on ${overwrittenAssemblyPropertyCount} atom(s); their complete parent artifacts remain anchored by component source fingerprints`
        : 'No prior zatom assembly-source annotation needed replacement',
      metrics: { overwrittenAssemblyPropertyCount },
    },
    {
      id: 'assembly.model_scope',
      status: 'warn',
      message: 'Rigid component assembly preserves declared geometry/topology only; it does not infer bonds, choose chemical state, parameterize a force field, solvate statistically, relax contacts, or establish physical stability',
    },
    ...validation.checks,
  ]

  const overviewBounds = boundsOfPositions(atoms.map((atom) => atom.position))
  const inspectionTargets: InspectionTarget[] = [
    ...(overviewBounds ? [{
      id: 'assembly-overview',
      reason: 'Inspect the complete assembled molecular system and component placement',
      center: overviewBounds.center,
      radius: Math.max(1.5, overviewBounds.radius + 0.5),
      atomIds: atoms.slice(0, 80).map((atom) => atom.id),
      atomIdsTruncated: atoms.length > 80,
    }] : []),
    ...manifests.slice(0, MAX_COMPONENT_TARGETS).map((component) => ({
      id: `assembly-component-${component.id}`,
      reason: `Inspect assembled component ${component.id}${component.label ? ` (${component.label})` : ''}`,
      center: component.bounds.center,
      radius: Math.max(1.5, component.bounds.radius + 0.5),
      atomIds: component.outputAtomIds,
      atomIdsTruncated: component.outputAtomIdsTruncated,
    })),
    ...(closestIntercomponentPair && resolvedMinimumDistanceA !== null ? (() => {
      const atomById = new Map(atoms.map((atom) => [atom.id, atom]))
      const first = atomById.get(closestIntercomponentPair[0])!
      const second = atomById.get(closestIntercomponentPair[1])!
      return [{
        id: 'assembly-closest-intercomponent-pair',
        reason: `Inspect closest cross-component pair at ${resolvedMinimumDistanceA.toFixed(4)} Å`,
        center: [
          (first.position[0] + second.position[0]) / 2,
          (first.position[1] + second.position[1]) / 2,
          (first.position[2] + second.position[2]) / 2,
        ] as Vec3,
        radius: Math.max(1.5, resolvedMinimumDistanceA + 0.75),
        atomIds: closestIntercomponentPair,
      }]
    })() : []),
  ]
  if (manifests.length > MAX_COMPONENT_TARGETS) {
    checks.push({
      id: 'assembly.component_target_coverage',
      status: 'warn',
      message: `Returned individual visual targets for the first ${MAX_COMPONENT_TARGETS} of ${manifests.length} components; use atom IDs/component properties to inspect the remainder`,
      metrics: { targetCount: MAX_COMPONENT_TARGETS, componentCount: manifests.length },
    })
  }

  const source: ZatomStructure = { schemaVersion: ZATOM_STRUCTURE_SCHEMA, atoms: [] }
  const changeSet = buildStructureChangeSet(source, structure)
  const provenance: StructureProvenance = {
    engine: 'zatom-molecular-assembly',
    engineVersion: '1.0.0',
    sourceFingerprint: fingerprintStructure(source),
    resultFingerprint: fingerprintStructure(structure),
    parameters: {
      components: provenanceComponents,
      externalBonds: externalBonds.map((bond) => ({
        id: bond.id,
        atomA: { componentId: bond.atomA.componentId, atomId: bond.atomA.atomId },
        atomB: { componentId: bond.atomB.componentId, atomId: bond.atomB.atomId },
        order: bond.order,
      })),
      lattice: options.lattice ? {
        vectors: options.lattice.vectors.map((row) => [...row]),
        periodic: [...options.lattice.periodic],
      } : null,
      minimumIntercomponentDistanceA: minimumDistanceA,
      intercomponentWarningDistanceA: warningDistanceA,
      maxIntercomponentPairChecks: pairBudget,
    },
  }
  return {
    structure,
    checks,
    validation,
    changeSet,
    provenance,
    inspectionTargets,
    components: manifests,
    externalBondCount: externalBonds.length,
    intercomponentPairCount,
    minimumIntercomponentDistanceA: resolvedMinimumDistanceA,
    closestIntercomponentPair,
    formalCharge,
  }
}
