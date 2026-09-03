/** Bounded, unweighted adsorption geometry enumeration with exact replay inputs. */

import type { InspectionTarget, JsonValue, ValidationCheck, ZatomBondOrder, ZatomStructure } from './contracts'
import {
  type AdsorptionSite,
  detectAdsorptionSites,
  placeAdsorbate,
  SurfaceInputError,
} from './surface'
import { fingerprintCanonicalJson, fingerprintStructure } from './structure-math'

export const ZATOM_ADSORPTION_CONFIGURATION_CATALOG_SCHEMA = 'zatom.adsorption-configuration-catalog/v1' as const

const MAX_CANDIDATES = 512
const MAX_CATALOG_BYTES = 8 * 1024 * 1024

export interface EnumerateAdsorptionConfigurationsOptions {
  structure: ZatomStructure
  fragment: string
  siteKinds?: Array<'top' | 'bridge' | 'hollow'>
  bondLengthsA?: number[]
  tiltAnglesDeg?: number[]
  azimuthAnglesDeg?: number[]
  surfaceBondPolicy?: 'none' | 'anchor-to-site-atoms'
  surfaceBondOrder?: ZatomBondOrder
  collisionFactor?: number
  surfaceUp?: [number, number, number]
  layerToleranceA?: number
  bondCutoffA?: number
  triangleCutoffA?: number
  maxSurfaceAtoms?: number
  maxExpandedSurfacePoints?: number
  maxCandidates?: number
}

export interface AdsorptionConfigurationParameterSet {
  siteId: string
  bondLengthA: number | null
  tiltDeg: number
  azimuthDeg: number
}

export interface AdsorptionConfigurationCandidate {
  id: string
  status: 'valid' | 'rejected'
  resultStructureFingerprint: string | null
  equivalentParameterSets: AdsorptionConfigurationParameterSet[]
  site: AdsorptionSite
  geometry: {
    anchorDistanceA: number | null
    tiltDeg: number
    azimuthDeg: number
  }
  atomCount: number | null
  bondCount: number | null
  surfaceBondCount: number | null
  collision: { addedAtomId: string; existingAtomId: string; distanceA: number; thresholdA: number } | null
  failingCheckIds: string[]
  warningCheckIds: string[]
  error: { code: string; message: string } | null
  replayInput: Record<string, JsonValue>
  inspectionTarget: InspectionTarget | null
}

export interface AdsorptionConfigurationCatalog {
  schemaVersion: typeof ZATOM_ADSORPTION_CONFIGURATION_CATALOG_SCHEMA
  sourceStructureFingerprint: string
  fragment: string
  candidates: AdsorptionConfigurationCandidate[]
  search: {
    siteKinds: Array<'top' | 'bridge' | 'hollow'>
    siteCount: number
    bondLengthsA: Array<number | null>
    tiltAnglesDeg: number[]
    azimuthAnglesDeg: number[]
    projectedCombinationCount: number
    evaluatedCombinationCount: number
    uniqueCandidateCount: number
    duplicateGeometryCount: number
    validCandidateCount: number
    rejectedCandidateCount: number
  }
  method: 'pbc-delaunay-sites-cartesian-pose-grid-no-ranking'
  scopeWarning: string
}

export interface EnumerateAdsorptionConfigurationsResult {
  catalog: AdsorptionConfigurationCatalog
  catalogFingerprint: string
  checks: ValidationCheck[]
  inspectionTargets: InspectionTarget[]
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function finiteArray(
  value: number[] | undefined,
  field: string,
  fallback: number[],
  minimum: number,
  maximum: number,
  exclusiveMaximum = false,
): number[] {
  const input = value ?? fallback
  if (!Array.isArray(input) || input.length < 1 || input.length > 32) {
    throw new SurfaceInputError('invalid_adsorption_search', `${field} must contain 1-32 values`)
  }
  const result = input.map((item) => Number(item)).sort((left, right) => left - right)
  if (result.some((item) => !Number.isFinite(item) || item < minimum
    || (exclusiveMaximum ? item >= maximum : item > maximum))) {
    throw new SurfaceInputError(
      'invalid_adsorption_search',
      `${field} values must be finite from ${minimum} through ${exclusiveMaximum ? `below ${maximum}` : maximum}`,
    )
  }
  if (new Set(result).size !== result.length) {
    throw new SurfaceInputError('invalid_adsorption_search', `${field} must not repeat values`)
  }
  return result.map((item) => Object.is(item, -0) ? 0 : item)
}

function positiveInteger(value: number | undefined, field: string, fallback: number, maximum: number): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || result < 1 || result > maximum) {
    throw new SurfaceInputError('invalid_adsorption_search', `${field} must be an integer from 1 through ${maximum}`)
  }
  return result
}

function siteKinds(value: EnumerateAdsorptionConfigurationsOptions['siteKinds']): Array<'top' | 'bridge' | 'hollow'> {
  const input = value ?? ['top', 'bridge', 'hollow']
  if (!Array.isArray(input) || input.length < 1 || input.length > 3
    || input.some((kind) => kind !== 'top' && kind !== 'bridge' && kind !== 'hollow')) {
    throw new SurfaceInputError('invalid_adsorption_search', 'siteKinds must contain top, bridge, and/or hollow')
  }
  if (new Set(input).size !== input.length) {
    throw new SurfaceInputError('invalid_adsorption_search', 'siteKinds must not repeat values')
  }
  const order = { top: 0, bridge: 1, hollow: 2 }
  return [...input].sort((left, right) => order[left] - order[right])
}

function replayInput(options: {
  sourceFingerprint: string
  resultFingerprint: string | null
  fragment: string
  siteId: string
  surfaceUp: [number, number, number]
  layerToleranceA: number
  bondCutoffA: number
  triangleCutoffA: number
  maxSurfaceAtoms: number
  maxExpandedSurfacePoints: number
  collisionFactor: number
  surfaceBondPolicy: 'none' | 'anchor-to-site-atoms'
  surfaceBondOrder: ZatomBondOrder
  parameterSet: AdsorptionConfigurationParameterSet
}): Record<string, JsonValue> {
  return {
    expectedSourceFingerprint: options.sourceFingerprint,
    ...(options.resultFingerprint ? { expectedResultFingerprint: options.resultFingerprint } : {}),
    fragment: options.fragment,
    siteId: options.siteId,
    surfaceUp: [...options.surfaceUp],
    layerToleranceA: options.layerToleranceA,
    bondCutoffA: options.bondCutoffA,
    triangleCutoffA: options.triangleCutoffA,
    maxSurfaceAtoms: options.maxSurfaceAtoms,
    maxExpandedSurfacePoints: options.maxExpandedSurfacePoints,
    collisionFactor: options.collisionFactor,
    surfaceBondPolicy: options.surfaceBondPolicy,
    surfaceBondOrder: options.surfaceBondOrder,
    ...(options.parameterSet.bondLengthA === null ? {} : { bondLengthA: options.parameterSet.bondLengthA }),
    tiltDeg: options.parameterSet.tiltDeg,
    azimuthDeg: options.parameterSet.azimuthDeg,
    applyToWorkspace: false,
    captureAfter: false,
  }
}

export function enumerateAdsorptionConfigurations(
  options: EnumerateAdsorptionConfigurationsOptions,
): EnumerateAdsorptionConfigurationsResult {
  const sourceFingerprint = fingerprintStructure(options.structure)
  const selectedKinds = siteKinds(options.siteKinds)
  const bondLengthsA = options.bondLengthsA === undefined
    ? [null]
    : finiteArray(options.bondLengthsA, 'bondLengthsA', [], 1e-6, 20)
  const tiltAnglesDeg = finiteArray(options.tiltAnglesDeg, 'tiltAnglesDeg', [0], 0, 180)
  const azimuthAnglesDeg = finiteArray(options.azimuthAnglesDeg, 'azimuthAnglesDeg', [0], 0, 360, true)
  const maxCandidates = positiveInteger(options.maxCandidates, 'maxCandidates', 128, MAX_CANDIDATES)
  const maxSurfaceAtoms = positiveInteger(options.maxSurfaceAtoms, 'maxSurfaceAtoms', 200, 1000)
  const maxExpandedSurfacePoints = positiveInteger(
    options.maxExpandedSurfacePoints,
    'maxExpandedSurfacePoints',
    50_000,
    100_000,
  )
  const layerToleranceA = options.layerToleranceA ?? 0.5
  const bondCutoffA = options.bondCutoffA ?? 3.5
  const triangleCutoffA = options.triangleCutoffA ?? 3.5
  const collisionFactor = options.collisionFactor ?? 0.8
  const surfaceBondPolicy = options.surfaceBondPolicy ?? 'none'
  const surfaceBondOrder = options.surfaceBondOrder ?? 1
  const detection = detectAdsorptionSites({
    structure: options.structure,
    ...(options.surfaceUp ? { surfaceUp: options.surfaceUp } : {}),
    layerToleranceA,
    bondCutoffA,
    triangleCutoffA,
    maxSurfaceAtoms,
    maxExpandedSurfacePoints,
  })
  // Detection owns surface-frame inference. Reusing its normal keeps catalog
  // replay consistent for slabs whose vacuum axis is a/b or oblique.
  const surfaceUp = detection.normal
  const sites = detection.sites.filter((site) => selectedKinds.includes(site.kind))
  if (!sites.length) {
    throw new SurfaceInputError('adsorption_search_no_sites', 'No detected adsorption site matches siteKinds')
  }
  const projectedCombinationCount = sites.length * bondLengthsA.length * tiltAnglesDeg.length * azimuthAnglesDeg.length
  if (!Number.isSafeInteger(projectedCombinationCount) || projectedCombinationCount > maxCandidates) {
    throw new SurfaceInputError(
      'adsorption_search_budget_exceeded',
      `Search projects ${projectedCombinationCount.toLocaleString()} configurations above maxCandidates=${maxCandidates.toLocaleString()}; narrow sites or pose grids`,
    )
  }
  interface Draft extends Omit<AdsorptionConfigurationCandidate, 'id' | 'equivalentParameterSets'> {
    parameterSets: AdsorptionConfigurationParameterSet[]
    identity: string
  }
  const byIdentity = new Map<string, Draft>()
  let evaluatedCombinationCount = 0
  for (const site of sites) for (const bondLengthA of bondLengthsA) {
    for (const tiltDeg of tiltAnglesDeg) for (const azimuthDeg of azimuthAnglesDeg) {
      evaluatedCombinationCount += 1
      const parameterSet: AdsorptionConfigurationParameterSet = { siteId: site.id, bondLengthA, tiltDeg, azimuthDeg }
      try {
        const placed = placeAdsorbate({
          structure: options.structure,
          fragment: options.fragment,
          resolvedSite: site,
          ...(bondLengthA === null ? {} : { bondLengthA }),
          tiltDeg,
          azimuthDeg,
          collisionFactor,
          surfaceBondPolicy,
          surfaceBondOrder,
          surfaceUp,
          layerToleranceA,
          bondCutoffA,
          triangleCutoffA,
          maxSurfaceAtoms,
          maxExpandedSurfacePoints,
        })
        const resultFingerprint = fingerprintStructure(placed.structure)
        const failingCheckIds = placed.checks.filter((check) => check.status === 'fail').map((check) => check.id)
        const warningCheckIds = placed.checks.filter((check) => check.status === 'warn').map((check) => check.id)
        const prior = byIdentity.get(resultFingerprint)
        if (prior) {
          prior.parameterSets.push(parameterSet)
          continue
        }
        byIdentity.set(resultFingerprint, {
          identity: resultFingerprint,
          parameterSets: [parameterSet],
          status: failingCheckIds.length ? 'rejected' : 'valid',
          resultStructureFingerprint: resultFingerprint,
          site,
          geometry: { anchorDistanceA: placed.anchorDistanceA, tiltDeg, azimuthDeg },
          atomCount: placed.structure.atoms.length,
          bondCount: placed.structure.bonds?.length ?? null,
          surfaceBondCount: placed.surfaceBondIds.length,
          collision: placed.collision,
          failingCheckIds,
          warningCheckIds,
          error: null,
          replayInput: replayInput({
            sourceFingerprint,
            resultFingerprint,
            fragment: options.fragment,
            siteId: site.id,
            surfaceUp,
            layerToleranceA,
            bondCutoffA,
            triangleCutoffA,
            maxSurfaceAtoms,
            maxExpandedSurfacePoints,
            collisionFactor,
            surfaceBondPolicy,
            surfaceBondOrder,
            parameterSet,
          }),
          inspectionTarget: placed.inspectionTargets.find((target) => target.id === 'placed-adsorbate') ?? null,
        })
      } catch (error) {
        const code = error instanceof SurfaceInputError ? error.code : 'adsorption_candidate_failed'
        const message = error instanceof Error ? error.message : String(error)
        const identity = fingerprintCanonicalJson({ sourceFingerprint, fragment: options.fragment, parameterSet, code, message })
        const prior = byIdentity.get(identity)
        if (prior) {
          prior.parameterSets.push(parameterSet)
          continue
        }
        byIdentity.set(identity, {
          identity,
          parameterSets: [parameterSet],
          status: 'rejected',
          resultStructureFingerprint: null,
          site,
          geometry: { anchorDistanceA: null, tiltDeg, azimuthDeg },
          atomCount: null,
          bondCount: null,
          surfaceBondCount: null,
          collision: null,
          failingCheckIds: [],
          warningCheckIds: [],
          error: { code, message },
          replayInput: replayInput({
            sourceFingerprint,
            resultFingerprint: null,
            fragment: options.fragment,
            siteId: site.id,
            surfaceUp,
            layerToleranceA,
            bondCutoffA,
            triangleCutoffA,
            maxSurfaceAtoms,
            maxExpandedSurfacePoints,
            collisionFactor,
            surfaceBondPolicy,
            surfaceBondOrder,
            parameterSet,
          }),
          inspectionTarget: null,
        })
      }
    }
  }
  const orderedDrafts = [...byIdentity.values()].sort((left, right) => {
    const a = left.parameterSets[0]
    const b = right.parameterSets[0]
    return compareText(a.siteId, b.siteId)
      || (a.bondLengthA ?? -1) - (b.bondLengthA ?? -1)
      || a.tiltDeg - b.tiltDeg
      || a.azimuthDeg - b.azimuthDeg
      || compareText(left.identity, right.identity)
  })
  const candidates = orderedDrafts.map((draft, index): AdsorptionConfigurationCandidate => ({
    id: `adsorption-${String(index + 1).padStart(4, '0')}-${draft.identity.replace(/^fnv1a64:/, '')}`,
    status: draft.status,
    resultStructureFingerprint: draft.resultStructureFingerprint,
    equivalentParameterSets: draft.parameterSets,
    site: draft.site,
    geometry: draft.geometry,
    atomCount: draft.atomCount,
    bondCount: draft.bondCount,
    surfaceBondCount: draft.surfaceBondCount,
    collision: draft.collision,
    failingCheckIds: draft.failingCheckIds,
    warningCheckIds: draft.warningCheckIds,
    error: draft.error,
    replayInput: draft.replayInput,
    inspectionTarget: draft.inspectionTarget,
  }))
  const validCandidateCount = candidates.filter((candidate) => candidate.status === 'valid').length
  const rejectedCandidateCount = candidates.length - validCandidateCount
  const duplicateGeometryCount = evaluatedCombinationCount - candidates.length
  const scopeWarning = 'Candidates are deterministic unrelaxed site/height/tilt/azimuth hypotheses with no physical weights or ranking. Collision clearance is not adsorption energy, and optional surface bonds are declared topology rather than inferred bond formation.'
  const catalog: AdsorptionConfigurationCatalog = {
    schemaVersion: ZATOM_ADSORPTION_CONFIGURATION_CATALOG_SCHEMA,
    sourceStructureFingerprint: sourceFingerprint,
    fragment: options.fragment,
    candidates,
    search: {
      siteKinds: selectedKinds,
      siteCount: sites.length,
      bondLengthsA,
      tiltAnglesDeg,
      azimuthAnglesDeg,
      projectedCombinationCount,
      evaluatedCombinationCount,
      uniqueCandidateCount: candidates.length,
      duplicateGeometryCount,
      validCandidateCount,
      rejectedCandidateCount,
    },
    method: 'pbc-delaunay-sites-cartesian-pose-grid-no-ranking',
    scopeWarning,
  }
  const catalogBytes = new TextEncoder().encode(JSON.stringify(catalog)).length
  if (catalogBytes > MAX_CATALOG_BYTES) {
    throw new SurfaceInputError(
      'adsorption_search_catalog_too_large',
      `Catalog occupies ${catalogBytes.toLocaleString()} bytes above the fixed ${MAX_CATALOG_BYTES.toLocaleString()}-byte limit`,
    )
  }
  const checks: ValidationCheck[] = [
    ...detection.checks,
    {
      id: 'adsorption_search.space',
      status: 'pass',
      message: `Evaluated all ${evaluatedCombinationCount} requested site/height/tilt/azimuth combinations within maxCandidates=${maxCandidates}`,
      metrics: { projectedCombinationCount, evaluatedCombinationCount, maxCandidates },
    },
    {
      id: 'adsorption_search.deduplication',
      status: 'pass',
      message: `${candidates.length} unique result/error identities remain after collapsing ${duplicateGeometryCount} exact geometry duplicate(s)`,
      metrics: { uniqueCandidateCount: candidates.length, duplicateGeometryCount },
    },
    {
      id: 'adsorption_search.valid_candidates',
      status: validCandidateCount ? (rejectedCandidateCount ? 'warn' : 'pass') : 'fail',
      message: `${validCandidateCount} valid and ${rejectedCandidateCount} rejected unique candidate(s)`,
      metrics: { validCandidateCount, rejectedCandidateCount },
    },
    {
      id: 'adsorption_search.model_scope',
      status: 'warn',
      message: scopeWarning,
    },
  ]
  return {
    catalog,
    catalogFingerprint: fingerprintCanonicalJson(catalog),
    checks,
    inspectionTargets: detection.inspectionTargets,
  }
}
