/** Canonical finite-component adapter over zatom's existing metal-cluster builder. */

import { buildMetalCluster, type ClusterGeometry } from '../lib/analysis/builders/cluster'
import { ELEMENTS } from '../lib/crystal/elements'
import { parseXYZ } from '../lib/crystal/xyz-parser'
import type {
  InspectionTarget,
  StructureChangeSet,
  StructureProvenance,
  ValidationCheck,
  Vec3,
  ZatomStructure,
} from './contracts'
import { ZATOM_STRUCTURE_SCHEMA } from './contracts'
import { buildStructureChangeSet } from './operations'
import { boundsOfPositions, fingerprintStructure } from './structure-math'
import { validateStructure } from './structure-validation'

const CLUSTER_GEOMETRIES: readonly ClusterGeometry[] = [
  'icosahedral',
  'octahedral',
  'cuboctahedral',
  'fcc',
  'hcp',
  'decahedral',
]
const MAX_ENUMERATION_SITES = 100_000
const MAX_CLUSTER_ATOMS = 50_000
const METAL_ELEMENTS = new Set([
  'Li', 'Be', 'Na', 'Mg', 'Al', 'K', 'Ca', 'Sc', 'Ti', 'V', 'Cr', 'Mn', 'Fe', 'Co', 'Ni', 'Cu', 'Zn',
  'Ga', 'Rb', 'Sr', 'Y', 'Zr', 'Nb', 'Mo', 'Ru', 'Rh', 'Pd', 'Ag', 'Cd', 'In', 'Sn', 'Cs', 'Ba', 'La',
  'Ce', 'Hf', 'W', 'Pt', 'Au', 'Pb', 'Bi', 'U',
])

export const ZATOM_METAL_CLUSTER_GEOMETRIES = [...CLUSTER_GEOMETRIES]

export class MetalClusterInputError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'MetalClusterInputError'
    this.code = code
  }
}

export interface BuildCanonicalMetalClusterOptions {
  geometry: ClusterGeometry
  element: string
  bondLengthA?: number
  shells?: number
  radiusA?: number
  maxEnumerationSites?: number
  maxAtoms?: number
}

export interface BuildCanonicalMetalClusterResult {
  structure: ZatomStructure
  validation: ReturnType<typeof validateStructure>
  checks: ValidationCheck[]
  changeSet: StructureChangeSet
  provenance: StructureProvenance
  inspectionTargets: InspectionTarget[]
  metrics: {
    geometry: ClusterGeometry
    element: string
    atomCount: number
    bondLengthA: number | null
    shells: number | null
    radiusA: number | null
    centroidA: Vec3
    enumerationSiteUpperBound: number
    outputAtomUpperBound: number
    maxEnumerationSites: number
    maxAtoms: number
  }
}

function finitePositive(value: number | undefined, fallback: number | undefined, field: string, maximum: number): number | undefined {
  const resolved = value ?? fallback
  if (resolved === undefined) return undefined
  if (!Number.isFinite(resolved) || resolved <= 0 || resolved > maximum) {
    throw new MetalClusterInputError('invalid_metal_cluster_parameter', `${field} must be finite and in (0, ${maximum}]`)
  }
  return resolved
}

function centroid(positions: readonly Vec3[]): Vec3 {
  const center: Vec3 = [0, 0, 0]
  for (const position of positions) {
    center[0] += position[0] / positions.length
    center[1] += position[1] / positions.length
    center[2] += position[2] / positions.length
  }
  return center
}

function boundedInteger(value: number | undefined, fallback: number, maximum: number, field: string): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > maximum) {
    throw new MetalClusterInputError('invalid_metal_cluster_budget', `${field} must be an integer from 1 through ${maximum}`)
  }
  return resolved
}

function boundedCube(side: number, multiplier: number): number {
  const value = multiplier * side ** 3
  return Number.isSafeInteger(value) ? value : Number.POSITIVE_INFINITY
}

function enumerationUpperBounds(
  geometry: ClusterGeometry,
  shells: number,
  radiusA: number | undefined,
  bondLengthA: number,
): { enumerationSiteUpperBound: number; outputAtomUpperBound: number } {
  if (geometry === 'icosahedral') {
    const atomCount = 1 + 10 * shells * (shells + 1) * (2 * shells + 1) / 6 + 2 * shells
    return { enumerationSiteUpperBound: atomCount, outputAtomUpperBound: atomCount }
  }
  if (geometry === 'octahedral') {
    const bound = 2 * (shells - 1)
    const candidates = boundedCube(2 * bound + 1, 1)
    return { enumerationSiteUpperBound: candidates, outputAtomUpperBound: candidates }
  }
  if (geometry === 'cuboctahedral') {
    const box = shells + 1
    const candidates = boundedCube(2 * box + 1, 4)
    return { enumerationSiteUpperBound: candidates, outputAtomUpperBound: candidates }
  }
  if (geometry === 'decahedral') {
    const span = Math.ceil(shells / Math.sqrt(2)) + 1
    const candidates = boundedCube(2 * span + 1, 4)
    return { enumerationSiteUpperBound: candidates, outputAtomUpperBound: 5 * candidates }
  }
  const radius = radiusA!
  const span = geometry === 'fcc'
    ? Math.ceil(radius / (bondLengthA * Math.sqrt(2))) + 1
    : Math.ceil(radius / bondLengthA) + 1
  const candidates = boundedCube(2 * span + 1, geometry === 'fcc' ? 4 : 2)
  return { enumerationSiteUpperBound: candidates, outputAtomUpperBound: candidates }
}

export function buildCanonicalMetalCluster(
  options: BuildCanonicalMetalClusterOptions,
): BuildCanonicalMetalClusterResult {
  if (!CLUSTER_GEOMETRIES.includes(options.geometry)) {
    throw new MetalClusterInputError('invalid_metal_cluster_geometry', `Unsupported metal-cluster geometry ${String(options.geometry)}`)
  }
  if (typeof options.element !== 'string' || !options.element.trim()) {
    throw new MetalClusterInputError('invalid_metal_cluster_element', 'element must be a non-empty element symbol')
  }
  const elementText = options.element.trim()
  const element = elementText[0].toUpperCase() + elementText.slice(1).toLowerCase()
  const elementData = ELEMENTS[element]
  if (!elementData) {
    throw new MetalClusterInputError('invalid_metal_cluster_element', `Unknown element ${JSON.stringify(element)}`)
  }
  if (!METAL_ELEMENTS.has(element)) {
    throw new MetalClusterInputError(
      'non_metal_cluster_element',
      `${element} is not supported by the close-packed metal-cluster contract`,
    )
  }
  const shellBased = options.geometry !== 'fcc' && options.geometry !== 'hcp'
  if (shellBased && options.radiusA !== undefined) {
    throw new MetalClusterInputError(
      'unsupported_metal_cluster_parameter',
      `radiusA is only supported for fcc and hcp clusters; ${options.geometry} uses shells`,
    )
  }
  if (!shellBased && options.shells !== undefined) {
    throw new MetalClusterInputError(
      'unsupported_metal_cluster_parameter',
      `shells is not supported for ${options.geometry}; use radiusA`,
    )
  }
  const shellsRaw = shellBased ? options.shells ?? 2 : undefined
  if (shellsRaw !== undefined && (!Number.isSafeInteger(shellsRaw) || shellsRaw < 1 || shellsRaw > 6)) {
    throw new MetalClusterInputError('invalid_metal_cluster_parameter', 'shells must be an integer from 1 through 6')
  }
  const radiusA = shellBased ? undefined : finitePositive(options.radiusA, 6, 'radiusA', 100)
  const bondLengthA = finitePositive(options.bondLengthA, elementData.radius * 2, 'bondLengthA', 100)!
  const maxEnumerationSites = boundedInteger(
    options.maxEnumerationSites,
    50_000,
    MAX_ENUMERATION_SITES,
    'maxEnumerationSites',
  )
  const maxAtoms = boundedInteger(options.maxAtoms, 25_000, MAX_CLUSTER_ATOMS, 'maxAtoms')
  const projectedBounds = enumerationUpperBounds(options.geometry, shellsRaw ?? 2, radiusA, bondLengthA)
  if (projectedBounds.enumerationSiteUpperBound > maxEnumerationSites) {
    throw new MetalClusterInputError(
      'metal_cluster_enumeration_budget_exceeded',
      `${options.geometry} requires at most ${projectedBounds.enumerationSiteUpperBound.toLocaleString()} lattice-site visits above maxEnumerationSites=${maxEnumerationSites.toLocaleString()}`,
    )
  }
  if (projectedBounds.outputAtomUpperBound > maxAtoms) {
    throw new MetalClusterInputError(
      'metal_cluster_atom_budget_exceeded',
      `${options.geometry} can emit at most ${projectedBounds.outputAtomUpperBound.toLocaleString()} atoms above maxAtoms=${maxAtoms.toLocaleString()}`,
    )
  }
  let built: ReturnType<typeof buildMetalCluster>
  try {
    built = buildMetalCluster({
      geometry: options.geometry,
      element,
      bond_length: bondLengthA,
      ...(shellsRaw === undefined ? {} : { shells: shellsRaw }),
      ...(radiusA === undefined ? {} : { radius_angstrom: radiusA }),
    })
  } catch (error) {
    throw new MetalClusterInputError(
      'metal_cluster_builder_failed',
      error instanceof Error ? error.message : String(error),
    )
  }
  if (built.n_atoms > maxAtoms) {
    throw new MetalClusterInputError(
      'metal_cluster_atom_budget_exceeded',
      `Cluster builder emitted ${built.n_atoms.toLocaleString()} atoms above maxAtoms=${maxAtoms.toLocaleString()}`,
    )
  }
  const parsed = parseXYZ(built.xyz)
  if (!parsed.success || parsed.data.atoms.length !== built.n_atoms) {
    throw new MetalClusterInputError(
      'metal_cluster_parse_failed',
      parsed.success
        ? `Cluster builder declared ${built.n_atoms} atoms but emitted ${parsed.data.atoms.length}`
        : parsed.error,
    )
  }
  const rawPositions = parsed.data.atoms.map((atom) => [...atom.cartesian] as Vec3)
  const originalCentroid = centroid(rawPositions)
  const atoms = parsed.data.atoms.map((atom, index) => ({
    id: `cluster-atom-${index + 1}`,
    element: atom.element,
    position: [
      atom.cartesian[0] - originalCentroid[0],
      atom.cartesian[1] - originalCentroid[1],
      atom.cartesian[2] - originalCentroid[2],
    ] as Vec3,
    properties: {
      'zatom.cluster.geometry': options.geometry,
      'zatom.cluster.sourceIndex': index,
    },
  }))
  const centered = centroid(atoms.map((atom) => atom.position))
  const structure: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    label: `${options.geometry} ${element} cluster`,
    atoms,
    metadata: {
      'zatom.cluster': {
        geometry: options.geometry,
        element,
        atomCount: atoms.length,
        bondLengthA,
        shells: shellsRaw ?? null,
        radiusA: radiusA ?? null,
        finiteComponent: true,
      },
    },
  }
  const validation = validateStructure(structure)
  const centroidErrorA = Math.hypot(...centered)
  const checks: ValidationCheck[] = [
    {
      id: 'metal_cluster.atom_count',
      status: atoms.length === built.n_atoms ? 'pass' : 'fail',
      message: `Existing cluster builder emitted ${atoms.length} ${element} atoms for ${options.geometry}`,
      metrics: {
        atomCount: atoms.length,
        enumerationSiteUpperBound: projectedBounds.enumerationSiteUpperBound,
        outputAtomUpperBound: projectedBounds.outputAtomUpperBound,
        maxEnumerationSites,
        maxAtoms,
      },
    },
    {
      id: 'metal_cluster.finite_component',
      status: structure.lattice === undefined ? 'pass' : 'fail',
      message: 'Removed builder-only vacuum padding and returned a lattice-free finite component',
    },
    {
      id: 'metal_cluster.centered',
      status: centroidErrorA <= 1e-10 ? 'pass' : 'fail',
      message: `Finite component centroid is within ${centroidErrorA.toExponential(3)} Å of the origin`,
      metrics: { centroidErrorA },
    },
    {
      id: 'metal_cluster.model_scope',
      status: 'warn',
      message: 'Closed-form cluster geometry is an unrelaxed finite seed; it does not establish bonding, reconstruction, energy, or stability',
    },
    ...validation.checks,
  ]
  const empty: ZatomStructure = { schemaVersion: ZATOM_STRUCTURE_SCHEMA, atoms: [] }
  const changeSet = buildStructureChangeSet(empty, structure)
  const spatialBounds = boundsOfPositions(atoms.map((atom) => atom.position))!
  const inspectionTargets: InspectionTarget[] = [{
    id: 'metal-cluster-overview',
    reason: `Inspect the complete ${options.geometry} ${element} cluster`,
    center: spatialBounds.center,
    radius: Math.max(1, spatialBounds.radius + 1),
    atomIds: atoms.slice(0, 80).map((atom) => atom.id),
    ...(atoms.length > 80 ? { atomIdsTruncated: true } : {}),
  }, ...validation.inspectionTargets]
  const provenance: StructureProvenance = {
    engine: 'zatom-metal-cluster-builder',
    engineVersion: '1.0.0',
    sourceFingerprint: fingerprintStructure(empty),
    resultFingerprint: fingerprintStructure(structure),
    parameters: {
      geometry: options.geometry,
      element,
      bondLengthA,
      shells: shellsRaw ?? null,
      radiusA: radiusA ?? null,
      enumerationSiteUpperBound: projectedBounds.enumerationSiteUpperBound,
      outputAtomUpperBound: projectedBounds.outputAtomUpperBound,
      maxEnumerationSites,
      maxAtoms,
      builderDescription: built.description,
    },
  }
  return {
    structure,
    validation,
    checks,
    changeSet,
    provenance,
    inspectionTargets,
    metrics: {
      geometry: options.geometry,
      element,
      atomCount: atoms.length,
      bondLengthA,
      shells: shellsRaw ?? null,
      radiusA: radiusA ?? null,
      centroidA: centered,
      enumerationSiteUpperBound: projectedBounds.enumerationSiteUpperBound,
      outputAtomUpperBound: projectedBounds.outputAtomUpperBound,
      maxEnumerationSites,
      maxAtoms,
    },
  }
}
