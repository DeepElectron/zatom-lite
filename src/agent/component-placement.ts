/** Candidate-first placement of one finite structure component into a host structure. */

import type {
  InspectionTarget,
  StructureChangeSet,
  StructureProvenance,
  ValidationCheck,
  Vec3,
  ZatomStructure,
} from './contracts'
import { buildStructureChangeSet } from './operations'
import { applyRigidTransform, RigidTransformInputError } from './rigid-transform'
import {
  boundsOfPositions,
  createCertifiedMinimumImageCalculator,
  distance,
  fingerprintStructure,
} from './structure-math'
import { parseZatomStructure, validateStructure } from './structure-validation'

const COMPONENT_ID_PATTERN = /^[A-Za-z][A-Za-z0-9._-]{0,63}$/
const MAX_OUTPUT_ATOMS = 100_000
const MAX_PAIR_CHECKS = 5_000_000
const MAX_PERIODIC_IMAGE_CANDIDATES = 100_000_000

export class ComponentPlacementInputError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'ComponentPlacementInputError'
    this.code = code
  }
}

export interface PlaceStructureComponentOptions {
  host: ZatomStructure
  component: ZatomStructure
  componentId: string
  translationA?: Vec3
  rotationAxis?: Vec3
  rotationAngleDeg?: number
  rotationOriginA?: Vec3
  minimumHostDistanceA?: number
  hostDistanceWarningA?: number
  maxOutputAtoms?: number
  maxHostComponentPairChecks?: number
  maxPeriodicImageCandidates?: number
}

export interface ComponentPlacementCollision {
  hostAtomId: string
  componentAtomId: string
  distanceA: number
  hardThresholdA: number
}

export interface PlaceStructureComponentResult {
  structure: ZatomStructure
  validation: ReturnType<typeof validateStructure>
  checks: ValidationCheck[]
  changeSet: StructureChangeSet
  provenance: StructureProvenance
  inspectionTargets: InspectionTarget[]
  component: {
    id: string
    sourceFingerprint: string
    atomCount: number
    bondCount: number | null
    translationA: Vec3
    rotationAxis: Vec3 | null
    rotationAngleDeg: number
    rotationOriginA: Vec3
    renamedAtomIds: Array<{ sourceId: string; resultId: string }>
    renamedBondIds: Array<{ sourceId: string; resultId: string }>
    resultAtomIds: string[]
  }
  hostComponentPairCount: number
  periodicImageCandidateEvaluations: number
  observedMinimumHostDistanceA: number | null
  closestHostComponentPair: [string, string] | null
  collision: ComponentPlacementCollision | null
}

function finiteVec3(value: Vec3 | undefined, fallback: Vec3, field: string): Vec3 {
  const resolved = value ?? fallback
  if (!Array.isArray(resolved) || resolved.length !== 3 || resolved.some((item) => !Number.isFinite(item))) {
    throw new ComponentPlacementInputError('invalid_component_vector', `${field} must contain three finite numbers`)
  }
  return [resolved[0], resolved[1], resolved[2]]
}

function finiteNonNegative(value: number | undefined, fallback: number, field: string): number {
  const resolved = value ?? fallback
  if (!Number.isFinite(resolved) || resolved < 0) {
    throw new ComponentPlacementInputError('invalid_component_number', `${field} must be finite and non-negative`)
  }
  return resolved
}

function boundedInteger(value: number | undefined, fallback: number, maximum: number, field: string): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > maximum) {
    throw new ComponentPlacementInputError('invalid_component_budget', `${field} must be an integer from 1 through ${maximum}`)
  }
  return resolved
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

function allocateId(preferred: string, componentId: string, used: Set<string>): string {
  if (!used.has(preferred)) {
    used.add(preferred)
    return preferred
  }
  const namespaced = `${componentId}::${preferred}`
  if (!used.has(namespaced)) {
    used.add(namespaced)
    return namespaced
  }
  for (let suffix = 2; ; suffix++) {
    const candidate = `${namespaced}#${suffix}`
    if (!used.has(candidate)) {
      used.add(candidate)
      return candidate
    }
  }
}

function translateStructure(structure: ZatomStructure, translation: Vec3): ZatomStructure {
  return {
    ...structure,
    atoms: structure.atoms.map((atom) => ({
      ...atom,
      position: [
        atom.position[0] + translation[0],
        atom.position[1] + translation[1],
        atom.position[2] + translation[2],
      ],
    })),
  }
}

export function placeStructureComponent(options: PlaceStructureComponentOptions): PlaceStructureComponentResult {
  const host = parseZatomStructure(options.host)
  const componentSource = parseZatomStructure(options.component)
  const hostValidation = validateStructure(host)
  if (hostValidation.verdict === 'fail') {
    throw new ComponentPlacementInputError('invalid_host_structure', 'Host structure failed numeric validation')
  }
  if (componentSource.lattice) {
    throw new ComponentPlacementInputError(
      'component_lattice_unsupported',
      'The placed component must be finite and must not carry a lattice; only the host lattice is inherited',
    )
  }
  const componentValidation = validateStructure(componentSource)
  if (componentValidation.verdict === 'fail') {
    throw new ComponentPlacementInputError('invalid_component_structure', 'Placed component failed numeric validation')
  }
  if (!COMPONENT_ID_PATTERN.test(options.componentId)) {
    throw new ComponentPlacementInputError(
      'invalid_component_id',
      'componentId must start with a letter and use at most 64 ASCII letters, digits, dots, underscores, or hyphens',
    )
  }

  const translationA = finiteVec3(options.translationA, [0, 0, 0], 'translationA')
  const hasRotationAxis = options.rotationAxis !== undefined
  const hasRotationAngle = options.rotationAngleDeg !== undefined
  if (hasRotationAxis !== hasRotationAngle) {
    throw new ComponentPlacementInputError(
      'incomplete_component_rotation',
      'rotationAxis and rotationAngleDeg must be supplied together',
    )
  }
  if (!hasRotationAxis && options.rotationOriginA !== undefined) {
    throw new ComponentPlacementInputError(
      'unused_component_rotation_origin',
      'rotationOriginA requires rotationAxis and rotationAngleDeg',
    )
  }
  const rotationOriginA = finiteVec3(options.rotationOriginA, centroid(componentSource), 'rotationOriginA')
  let rotationAxis: Vec3 | null = null
  let rotationAngleDeg = 0
  let transformed = componentSource
  let rotationChecks: ValidationCheck[] = [{
    id: 'component.rigid_rotation',
    status: 'skipped',
    message: 'No component rotation was requested',
  }]
  if (hasRotationAxis && hasRotationAngle) {
    rotationAxis = finiteVec3(options.rotationAxis, [0, 0, 1], 'rotationAxis')
    if (Math.hypot(...rotationAxis) < 1e-12) {
      throw new ComponentPlacementInputError('invalid_component_rotation_axis', 'rotationAxis must have non-zero length')
    }
    rotationAngleDeg = Number(options.rotationAngleDeg)
    if (!Number.isFinite(rotationAngleDeg) || Math.abs(rotationAngleDeg) > 36_000) {
      throw new ComponentPlacementInputError('invalid_component_rotation_angle', 'rotationAngleDeg must be finite and within ±36000')
    }
    try {
      const rotated = applyRigidTransform({
        structure: componentSource,
        selectedAtomIndices: componentSource.atoms.map((_, index) => index),
        selectionAll: true,
        operation: {
          op: 'rotate',
          axis: rotationAxis,
          angleDeg: rotationAngleDeg,
          origin: rotationOriginA,
          rotateLattice: false,
        },
        operationIndex: 1,
      })
      transformed = rotated.structure
      rotationChecks = rotated.checks.map((check) => ({
        ...check,
        id: check.id.replace(/^operation\.1\./, 'component.'),
      }))
    } catch (error) {
      if (error instanceof RigidTransformInputError) {
        throw new ComponentPlacementInputError(error.code, error.message)
      }
      throw error
    }
  }
  transformed = translateStructure(transformed, translationA)

  const maxOutputAtoms = boundedInteger(options.maxOutputAtoms, MAX_OUTPUT_ATOMS, MAX_OUTPUT_ATOMS, 'maxOutputAtoms')
  if (host.atoms.length + transformed.atoms.length > maxOutputAtoms) {
    throw new ComponentPlacementInputError(
      'component_output_too_large',
      `Placed structure would contain ${host.atoms.length + transformed.atoms.length} atoms above maxOutputAtoms=${maxOutputAtoms}`,
    )
  }

  const usedAtomIds = new Set(host.atoms.map((atom) => atom.id))
  const atomIdMap = new Map<string, string>()
  const renamedAtomIds: Array<{ sourceId: string; resultId: string }> = []
  const componentAtoms = transformed.atoms.map((atom) => {
    const id = allocateId(atom.id, options.componentId, usedAtomIds)
    atomIdMap.set(atom.id, id)
    if (id !== atom.id) renamedAtomIds.push({ sourceId: atom.id, resultId: id })
    return { ...atom, id, position: [...atom.position] as Vec3 }
  })
  const usedBondIds = new Set((host.bonds ?? []).map((bond) => bond.id))
  const renamedBondIds: Array<{ sourceId: string; resultId: string }> = []
  const componentBonds = componentSource.bonds?.map((bond) => {
    const id = allocateId(bond.id, options.componentId, usedBondIds)
    if (id !== bond.id) renamedBondIds.push({ sourceId: bond.id, resultId: id })
    return {
      ...bond,
      id,
      atomIds: [atomIdMap.get(bond.atomIds[0])!, atomIdMap.get(bond.atomIds[1])!] as [string, string],
    }
  })
  const structure: ZatomStructure = {
    ...host,
    label: `${host.label ?? 'structure'} + ${componentSource.label ?? options.componentId}`,
    atoms: [...host.atoms, ...componentAtoms],
    ...((host.bonds !== undefined || componentBonds !== undefined) ? {
      bonds: [...(host.bonds ?? []), ...(componentBonds ?? [])],
    } : {}),
  }

  const minimumHostDistanceA = finiteNonNegative(options.minimumHostDistanceA, 0.65, 'minimumHostDistanceA')
  const hostDistanceWarningA = finiteNonNegative(
    options.hostDistanceWarningA,
    Math.max(0.9, minimumHostDistanceA),
    'hostDistanceWarningA',
  )
  if (hostDistanceWarningA < minimumHostDistanceA) {
    throw new ComponentPlacementInputError(
      'invalid_component_distance_thresholds',
      'hostDistanceWarningA must be at least minimumHostDistanceA',
    )
  }
  const maxPairChecks = boundedInteger(
    options.maxHostComponentPairChecks,
    1_000_000,
    MAX_PAIR_CHECKS,
    'maxHostComponentPairChecks',
  )
  const maxPeriodicImageCandidates = boundedInteger(
    options.maxPeriodicImageCandidates,
    5_000_000,
    MAX_PERIODIC_IMAGE_CANDIDATES,
    'maxPeriodicImageCandidates',
  )
  const hostComponentPairCount = host.atoms.length * componentAtoms.length
  const pairBudgetSufficient = Number.isSafeInteger(hostComponentPairCount) && hostComponentPairCount <= maxPairChecks
  let periodicImageCandidateEvaluations = 0
  let observedMinimumHostDistanceA = Number.POSITIVE_INFINITY
  let closestHostComponentPair: [string, string] | null = null
  if (pairBudgetSufficient) {
    const periodicCalculator = host.lattice?.periodic.some(Boolean)
      ? createCertifiedMinimumImageCalculator(host.lattice)
      : null
    for (const hostAtom of host.atoms) {
      for (const componentAtom of componentAtoms) {
        let measured: number
        if (periodicCalculator) {
          const remainingCandidates = maxPeriodicImageCandidates - periodicImageCandidateEvaluations
          if (remainingCandidates < 1) {
            throw new ComponentPlacementInputError(
              'component_periodic_image_budget_exceeded',
              `Periodic collision audit exhausted maxPeriodicImageCandidates=${maxPeriodicImageCandidates}`,
            )
          }
          try {
            const exact = periodicCalculator([
              componentAtom.position[0] - hostAtom.position[0],
              componentAtom.position[1] - hostAtom.position[1],
              componentAtom.position[2] - hostAtom.position[2],
            ], remainingCandidates)
            periodicImageCandidateEvaluations += exact.candidateEvaluations
            measured = exact.distance
          } catch (error) {
            throw new ComponentPlacementInputError(
              'component_periodic_image_budget_exceeded',
              error instanceof Error ? error.message : String(error),
            )
          }
        } else {
          measured = distance(hostAtom.position, componentAtom.position)
        }
        if (measured < observedMinimumHostDistanceA) {
          observedMinimumHostDistanceA = measured
          closestHostComponentPair = [hostAtom.id, componentAtom.id]
        }
      }
    }
  }
  const resolvedMinimumDistanceA = Number.isFinite(observedMinimumHostDistanceA)
    ? observedMinimumHostDistanceA
    : null
  const collision: ComponentPlacementCollision | null = pairBudgetSufficient
    && resolvedMinimumDistanceA !== null
    && resolvedMinimumDistanceA < minimumHostDistanceA
    && closestHostComponentPair
    ? {
        hostAtomId: closestHostComponentPair[0],
        componentAtomId: closestHostComponentPair[1],
        distanceA: resolvedMinimumDistanceA,
        hardThresholdA: minimumHostDistanceA,
      }
    : null

  const validation = validateStructure(structure)
  const checks: ValidationCheck[] = [
    {
      id: 'component.finite_source',
      status: 'pass',
      message: `Accepted a finite ${componentSource.atoms.length}-atom component; only the host lattice is present in the result`,
      metrics: { componentAtomCount: componentSource.atoms.length },
    },
    {
      id: 'component.identity',
      status: 'pass',
      message: `Preserved non-conflicting IDs and deterministically renamed ${renamedAtomIds.length} atom IDs plus ${renamedBondIds.length} bond IDs`,
      metrics: {
        renamedAtomCount: renamedAtomIds.length,
        renamedBondCount: renamedBondIds.length,
      },
      atomIds: componentAtoms.slice(0, 80).map((atom) => atom.id),
    },
    ...rotationChecks,
    {
      id: 'component.host_pair_budget',
      status: pairBudgetSufficient ? 'pass' : 'fail',
      message: pairBudgetSufficient
        ? `Audited all ${hostComponentPairCount.toLocaleString()} host-component atom pairs`
        : `${hostComponentPairCount.toLocaleString()} host-component pairs exceed maxHostComponentPairChecks=${maxPairChecks.toLocaleString()}`,
      metrics: { hostComponentPairCount, maxHostComponentPairChecks: maxPairChecks },
    },
    {
      id: 'component.host_collision',
      status: !pairBudgetSufficient
        ? 'skipped'
        : collision
          ? 'fail'
          : resolvedMinimumDistanceA !== null && resolvedMinimumDistanceA < hostDistanceWarningA ? 'warn' : 'pass',
      message: !pairBudgetSufficient
        ? 'Host-component collision is unresolved because the exact pair budget was exceeded'
        : resolvedMinimumDistanceA === null
          ? 'No host-component atom pair was available for collision auditing'
          : `Exact${host.lattice?.periodic.some(Boolean) ? ' periodic' : ''} minimum host-component distance is ${resolvedMinimumDistanceA.toFixed(6)} Å (hard ${minimumHostDistanceA.toFixed(6)} Å, warning ${hostDistanceWarningA.toFixed(6)} Å)`,
      metrics: {
        minimumHostDistanceA: resolvedMinimumDistanceA,
        hardThresholdA: minimumHostDistanceA,
        warningThresholdA: hostDistanceWarningA,
        periodicImageCandidateEvaluations,
      },
      ...(closestHostComponentPair ? { atomIds: closestHostComponentPair } : {}),
    },
    {
      id: 'component.model_scope',
      status: 'warn',
      message: 'Rigid placement preserves supplied component geometry and internal bonds but does not infer host-component bonds, relaxation, energy, or stability',
    },
    ...validation.checks,
  ]
  const changeSet = buildStructureChangeSet(host, structure)
  const componentBounds = boundsOfPositions(componentAtoms.map((atom) => atom.position))!
  const inspectionTargets: InspectionTarget[] = [{
    id: 'placed-component',
    reason: `Inspect rigidly placed component ${options.componentId}`,
    center: componentBounds.center,
    radius: Math.max(1, componentBounds.radius + 1),
    atomIds: componentAtoms.slice(0, 80).map((atom) => atom.id),
    ...(componentAtoms.length > 80 ? { atomIdsTruncated: true } : {}),
  }]
  if (collision && closestHostComponentPair) {
    const pairAtoms = closestHostComponentPair.map((id) => structure.atoms.find((atom) => atom.id === id)!)
    const pairBounds = boundsOfPositions(pairAtoms.map((atom) => atom.position))!
    inspectionTargets.push({
      id: 'placed-component-collision',
      reason: `Inspect host-component collision at ${collision.distanceA.toFixed(6)} Å`,
      center: pairBounds.center,
      radius: Math.max(1, pairBounds.radius + 1),
      atomIds: closestHostComponentPair,
    })
  }
  inspectionTargets.push(...validation.inspectionTargets)
  const provenance: StructureProvenance = {
    engine: 'zatom-component-placement',
    engineVersion: '1.0.0',
    sourceFingerprint: fingerprintStructure(host),
    resultFingerprint: fingerprintStructure(structure),
    parameters: {
      componentId: options.componentId,
      componentFingerprint: fingerprintStructure(componentSource),
      translationA,
      rotationAxis,
      rotationAngleDeg,
      rotationOriginA,
      minimumHostDistanceA,
      hostDistanceWarningA,
      maxOutputAtoms,
      maxHostComponentPairChecks: maxPairChecks,
      maxPeriodicImageCandidates,
    },
  }
  return {
    structure,
    validation,
    checks,
    changeSet,
    provenance,
    inspectionTargets,
    component: {
      id: options.componentId,
      sourceFingerprint: fingerprintStructure(componentSource),
      atomCount: componentSource.atoms.length,
      bondCount: componentSource.bonds?.length ?? null,
      translationA,
      rotationAxis,
      rotationAngleDeg,
      rotationOriginA,
      renamedAtomIds,
      renamedBondIds,
      resultAtomIds: componentAtoms.map((atom) => atom.id),
    },
    hostComponentPairCount,
    periodicImageCandidateEvaluations,
    observedMinimumHostDistanceA: resolvedMinimumDistanceA,
    closestHostComponentPair,
    collision,
  }
}
