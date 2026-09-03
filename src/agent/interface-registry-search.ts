/** Bounded, unweighted interface registry/gap enumeration with exact replay bindings. */

import type { InspectionTarget, JsonValue, ValidationCheck, ZatomStructure } from './contracts'
import {
  buildMatchedInterface,
  findDiagonalInterfaceMatches,
  InterfaceInputError,
  type InPlaneRepeat,
} from './interface'
import { fingerprintCanonicalJson, fingerprintStructure } from './structure-math'

export const ZATOM_INTERFACE_REGISTRY_CATALOG_SCHEMA = 'zatom.interface-registry-catalog/v1' as const

const MAX_CANDIDATES = 512
const MAX_CATALOG_BYTES = 8 * 1024 * 1024

export interface EnumerateInterfaceRegistryOptions {
  bottom: ZatomStructure
  top: ZatomStructure
  bottomRepeat?: InPlaneRepeat
  topRepeat?: InPlaneRepeat
  registryGrid?: InPlaneRepeat
  registryOffsetsFractional?: Array<[number, number]>
  gapsA?: number[]
  maxRepeat?: number
  maxOutputAtoms?: number
  maxStrain?: number
  maxAngleMismatchDeg?: number
  vacuumA?: number
  collisionDistanceA?: number
  maxCrossPairs?: number
  maxCandidates?: number
}

export interface InterfaceRegistryParameterSet {
  registryOffsetFractional: [number, number]
  gapA: number
}

export interface InterfaceRegistryCandidate {
  id: string
  status: 'valid' | 'rejected'
  resultStructureFingerprint: string
  equivalentParameterSets: InterfaceRegistryParameterSet[]
  registryOffsetFractional: [number, number]
  gapA: number
  bottomRepeat: InPlaneRepeat
  topRepeat: InPlaneRepeat
  maxAbsLinearStrain: number
  angleMismatchDeg: number
  minimumCrossInterfaceDistanceA: number | null
  bottomReferenceFingerprint: string
  topReferenceFingerprint: string
  failingCheckIds: string[]
  warningCheckIds: string[]
  replayInput: Record<string, JsonValue>
  inspectionTarget: InspectionTarget | null
}

export interface InterfaceRegistryCatalog {
  schemaVersion: typeof ZATOM_INTERFACE_REGISTRY_CATALOG_SCHEMA
  bottomSourceFingerprint: string
  topSourceFingerprint: string
  candidates: InterfaceRegistryCandidate[]
  search: {
    bottomRepeat: InPlaneRepeat
    topRepeat: InPlaneRepeat
    registryOffsetsFractional: Array<[number, number]>
    gapsA: number[]
    projectedCombinationCount: number
    evaluatedCombinationCount: number
    uniqueCandidateCount: number
    duplicateGeometryCount: number
    validCandidateCount: number
    rejectedCandidateCount: number
  }
  method: 'explicit-registry-gap-grid-no-ranking'
  scopeWarning: string
}

export interface EnumerateInterfaceRegistryResult {
  catalog: InterfaceRegistryCatalog
  catalogFingerprint: string
  checks: ValidationCheck[]
  inspectionTargets: InspectionTarget[]
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function positiveInteger(value: number | undefined, field: string, fallback: number, maximum: number): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || result < 1 || result > maximum) {
    throw new InterfaceInputError('invalid_interface_registry_search', `${field} must be an integer from 1 through ${maximum}`)
  }
  return result
}

function finite(value: number | undefined, field: string, fallback: number, minimum: number, maximum: number): number {
  const result = value ?? fallback
  if (!Number.isFinite(result) || result < minimum || result > maximum) {
    throw new InterfaceInputError('invalid_interface_registry_search', `${field} must be finite from ${minimum} through ${maximum}`)
  }
  return Object.is(result, -0) ? 0 : result
}

function repeat(value: InPlaneRepeat | undefined, field: string): InPlaneRepeat | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length !== 2
    || value.some((item) => !Number.isSafeInteger(item) || item < 1 || item > 64)) {
    throw new InterfaceInputError('invalid_interface_registry_search', `${field} must contain two integers from 1 through 64`)
  }
  return [value[0], value[1]]
}

function gaps(value: number[] | undefined): number[] {
  const input = value ?? [3]
  if (!Array.isArray(input) || input.length < 1 || input.length > 32) {
    throw new InterfaceInputError('invalid_interface_registry_search', 'gapsA must contain 1-32 values')
  }
  const result = input.map(Number).sort((left, right) => left - right)
  if (result.some((item) => !Number.isFinite(item) || item <= 0 || item > 100)) {
    throw new InterfaceInputError('invalid_interface_registry_search', 'gapsA values must be finite, positive, and at most 100 Å')
  }
  if (new Set(result).size !== result.length) {
    throw new InterfaceInputError('invalid_interface_registry_search', 'gapsA must not repeat values')
  }
  return result
}

function offsets(options: EnumerateInterfaceRegistryOptions): Array<[number, number]> {
  if (options.registryGrid && options.registryOffsetsFractional) {
    throw new InterfaceInputError(
      'invalid_interface_registry_search',
      'Provide registryGrid or registryOffsetsFractional, not both',
    )
  }
  if (options.registryOffsetsFractional) {
    if (options.registryOffsetsFractional.length < 1 || options.registryOffsetsFractional.length > 256) {
      throw new InterfaceInputError('invalid_interface_registry_search', 'registryOffsetsFractional must contain 1-256 pairs')
    }
    return options.registryOffsetsFractional.map((pair, index) => {
      if (!Array.isArray(pair) || pair.length !== 2 || pair.some((item) => !Number.isFinite(item))) {
        throw new InterfaceInputError('invalid_interface_registry_search', `registryOffsetsFractional[${index}] must contain two finite values`)
      }
      return [pair[0], pair[1]]
    })
  }
  const grid = repeat(options.registryGrid ?? [2, 2], 'registryGrid')!
  const result: Array<[number, number]> = []
  for (let first = 0; first < grid[0]; first++) for (let second = 0; second < grid[1]; second++) {
    result.push([first / grid[0], second / grid[1]])
  }
  return result
}

function replayInput(options: {
  bottomFingerprint: string
  topFingerprint: string
  resultFingerprint: string
  bottomRepeat: InPlaneRepeat
  topRepeat: InPlaneRepeat
  parameterSet: InterfaceRegistryParameterSet
  maxOutputAtoms: number
  maxStrain: number
  maxAngleMismatchDeg: number
  vacuumA: number
  collisionDistanceA: number
  maxCrossPairs: number
}): Record<string, JsonValue> {
  return {
    expectedBottomFingerprint: options.bottomFingerprint,
    expectedTopFingerprint: options.topFingerprint,
    expectedResultFingerprint: options.resultFingerprint,
    bottomRepeat: [...options.bottomRepeat],
    topRepeat: [...options.topRepeat],
    registryOffsetFractional: [...options.parameterSet.registryOffsetFractional],
    gapA: options.parameterSet.gapA,
    maxOutputAtoms: options.maxOutputAtoms,
    maxStrain: options.maxStrain,
    maxAngleMismatchDeg: options.maxAngleMismatchDeg,
    vacuumA: options.vacuumA,
    collisionDistanceA: options.collisionDistanceA,
    maxCrossPairs: options.maxCrossPairs,
    applyToWorkspace: false,
    captureAfter: false,
  }
}

export function enumerateInterfaceRegistryConfigurations(
  options: EnumerateInterfaceRegistryOptions,
): EnumerateInterfaceRegistryResult {
  const bottomFingerprint = fingerprintStructure(options.bottom)
  const topFingerprint = fingerprintStructure(options.top)
  const requestedBottomRepeat = repeat(options.bottomRepeat, 'bottomRepeat')
  const requestedTopRepeat = repeat(options.topRepeat, 'topRepeat')
  if (!!requestedBottomRepeat !== !!requestedTopRepeat) {
    throw new InterfaceInputError('invalid_interface_registry_search', 'Provide both bottomRepeat and topRepeat, or neither')
  }
  const maxRepeat = positiveInteger(options.maxRepeat, 'maxRepeat', 8, 16)
  const maxOutputAtoms = positiveInteger(options.maxOutputAtoms, 'maxOutputAtoms', 20_000, 100_000)
  const maxStrain = finite(options.maxStrain, 'maxStrain', 0.05, 0, 1)
  const maxAngleMismatchDeg = finite(options.maxAngleMismatchDeg, 'maxAngleMismatchDeg', 1, 0, 180)
  const vacuumA = finite(options.vacuumA, 'vacuumA', 12, 0, 10_000)
  const collisionDistanceA = finite(options.collisionDistanceA, 'collisionDistanceA', 0.6, 1e-8, 100)
  const maxCrossPairs = positiveInteger(options.maxCrossPairs, 'maxCrossPairs', 2_000_000, 100_000_000)
  const maxCandidates = positiveInteger(options.maxCandidates, 'maxCandidates', 128, MAX_CANDIDATES)
  let bottomRepeat: InPlaneRepeat
  let topRepeat: InPlaneRepeat
  if (requestedBottomRepeat && requestedTopRepeat) {
    bottomRepeat = requestedBottomRepeat
    topRepeat = requestedTopRepeat
  } else {
    const match = findDiagonalInterfaceMatches({
      bottom: options.bottom,
      top: options.top,
      maxRepeat,
      maxOutputAtoms,
      maxStrain,
      maxAngleMismatchDeg,
      limit: 1,
    }).recommended
    bottomRepeat = match.bottomRepeat
    topRepeat = match.topRepeat
  }
  const registryOffsets = offsets(options)
  const gapsA = gaps(options.gapsA)
  const projectedCombinationCount = registryOffsets.length * gapsA.length
  if (!Number.isSafeInteger(projectedCombinationCount) || projectedCombinationCount > maxCandidates) {
    throw new InterfaceInputError(
      'interface_registry_search_budget_exceeded',
      `Search projects ${projectedCombinationCount.toLocaleString()} configurations above maxCandidates=${maxCandidates.toLocaleString()}`,
    )
  }
  interface Draft extends Omit<InterfaceRegistryCandidate, 'id' | 'equivalentParameterSets'> {
    parameterSets: InterfaceRegistryParameterSet[]
  }
  const byFingerprint = new Map<string, Draft>()
  let evaluatedCombinationCount = 0
  for (const registryOffsetFractional of registryOffsets) for (const gapA of gapsA) {
    evaluatedCombinationCount += 1
    const built = buildMatchedInterface({
      bottom: options.bottom,
      top: options.top,
      bottomRepeat,
      topRepeat,
      maxOutputAtoms,
      maxStrain,
      maxAngleMismatchDeg,
      gapA,
      vacuumA,
      registryOffsetFractional,
      collisionDistanceA,
      maxCrossPairs,
    })
    const resultFingerprint = fingerprintStructure(built.structure)
    const canonicalOffset = (built.provenance.parameters.registryOffsetFractional as number[]) ?? registryOffsetFractional
    const parameterSet: InterfaceRegistryParameterSet = {
      registryOffsetFractional: [Number(canonicalOffset[0]), Number(canonicalOffset[1])],
      gapA,
    }
    const prior = byFingerprint.get(resultFingerprint)
    if (prior) {
      prior.parameterSets.push(parameterSet)
      continue
    }
    const failingCheckIds = built.checks.filter((check) => check.status === 'fail').map((check) => check.id)
    const warningCheckIds = built.checks.filter((check) => check.status === 'warn').map((check) => check.id)
    byFingerprint.set(resultFingerprint, {
      status: failingCheckIds.length ? 'rejected' : 'valid',
      resultStructureFingerprint: resultFingerprint,
      parameterSets: [parameterSet],
      registryOffsetFractional: parameterSet.registryOffsetFractional,
      gapA,
      bottomRepeat: built.match.bottomRepeat,
      topRepeat: built.match.topRepeat,
      maxAbsLinearStrain: built.match.maxAbsLinearStrain,
      angleMismatchDeg: built.match.angleMismatchDeg,
      minimumCrossInterfaceDistanceA: built.metrics.minimumCrossInterfaceDistanceA,
      bottomReferenceFingerprint: built.referenceFingerprints.bottom,
      topReferenceFingerprint: built.referenceFingerprints.top,
      failingCheckIds,
      warningCheckIds,
      replayInput: replayInput({
        bottomFingerprint,
        topFingerprint,
        resultFingerprint,
        bottomRepeat,
        topRepeat,
        parameterSet,
        maxOutputAtoms,
        maxStrain,
        maxAngleMismatchDeg,
        vacuumA,
        collisionDistanceA,
        maxCrossPairs,
      }),
      inspectionTarget: built.inspectionTargets.find((target) => target.id === 'stacked-interface') ?? null,
    })
  }
  const drafts = [...byFingerprint.values()].sort((left, right) => (
    left.registryOffsetFractional[0] - right.registryOffsetFractional[0]
    || left.registryOffsetFractional[1] - right.registryOffsetFractional[1]
    || left.gapA - right.gapA
    || compareText(left.resultStructureFingerprint, right.resultStructureFingerprint)
  ))
  const candidates = drafts.map((draft, index): InterfaceRegistryCandidate => ({
    id: `interface-registry-${String(index + 1).padStart(4, '0')}-${draft.resultStructureFingerprint.replace(/^fnv1a64:/, '')}`,
    status: draft.status,
    resultStructureFingerprint: draft.resultStructureFingerprint,
    equivalentParameterSets: draft.parameterSets,
    registryOffsetFractional: draft.registryOffsetFractional,
    gapA: draft.gapA,
    bottomRepeat: draft.bottomRepeat,
    topRepeat: draft.topRepeat,
    maxAbsLinearStrain: draft.maxAbsLinearStrain,
    angleMismatchDeg: draft.angleMismatchDeg,
    minimumCrossInterfaceDistanceA: draft.minimumCrossInterfaceDistanceA,
    bottomReferenceFingerprint: draft.bottomReferenceFingerprint,
    topReferenceFingerprint: draft.topReferenceFingerprint,
    failingCheckIds: draft.failingCheckIds,
    warningCheckIds: draft.warningCheckIds,
    replayInput: draft.replayInput,
    inspectionTarget: draft.inspectionTarget,
  }))
  const validCandidateCount = candidates.filter((candidate) => candidate.status === 'valid').length
  const rejectedCandidateCount = candidates.length - validCandidateCount
  const duplicateGeometryCount = evaluatedCombinationCount - candidates.length
  const scopeWarning = 'Registry/gap candidates are unrelaxed geometric hypotheses with no energetic weights or ranking. Cross-interface distance only rejects overlaps; it is not adhesion, reconstruction, bond formation, or stability evidence.'
  const catalog: InterfaceRegistryCatalog = {
    schemaVersion: ZATOM_INTERFACE_REGISTRY_CATALOG_SCHEMA,
    bottomSourceFingerprint: bottomFingerprint,
    topSourceFingerprint: topFingerprint,
    candidates,
    search: {
      bottomRepeat,
      topRepeat,
      registryOffsetsFractional: registryOffsets,
      gapsA,
      projectedCombinationCount,
      evaluatedCombinationCount,
      uniqueCandidateCount: candidates.length,
      duplicateGeometryCount,
      validCandidateCount,
      rejectedCandidateCount,
    },
    method: 'explicit-registry-gap-grid-no-ranking',
    scopeWarning,
  }
  const catalogBytes = new TextEncoder().encode(JSON.stringify(catalog)).length
  if (catalogBytes > MAX_CATALOG_BYTES) {
    throw new InterfaceInputError(
      'interface_registry_catalog_too_large',
      `Catalog occupies ${catalogBytes.toLocaleString()} bytes above the fixed ${MAX_CATALOG_BYTES.toLocaleString()}-byte limit`,
    )
  }
  const checks: ValidationCheck[] = [
    {
      id: 'interface_registry_search.space',
      status: 'pass',
      message: `Evaluated all ${evaluatedCombinationCount} requested registry/gap combinations`,
      metrics: { projectedCombinationCount, evaluatedCombinationCount, maxCandidates },
    },
    {
      id: 'interface_registry_search.deduplication',
      status: 'pass',
      message: `${candidates.length} unique interface structures remain after collapsing ${duplicateGeometryCount} exact duplicate(s)`,
      metrics: { uniqueCandidateCount: candidates.length, duplicateGeometryCount },
    },
    {
      id: 'interface_registry_search.valid_candidates',
      status: validCandidateCount ? (rejectedCandidateCount ? 'warn' : 'pass') : 'fail',
      message: `${validCandidateCount} valid and ${rejectedCandidateCount} rejected unique candidate(s)`,
      metrics: { validCandidateCount, rejectedCandidateCount },
    },
    {
      id: 'interface_registry_search.model_scope',
      status: 'warn',
      message: scopeWarning,
    },
  ]
  return {
    catalog,
    catalogFingerprint: fingerprintCanonicalJson(catalog),
    checks,
    inspectionTargets: candidates.flatMap((candidate) => candidate.inspectionTarget ? [candidate.inspectionTarget] : []).slice(0, 64),
  }
}
