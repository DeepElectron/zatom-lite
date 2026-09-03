/** Browser-safe specialist providers built over existing validated modeler engines. */

import {
  buildMoire,
  buildDislocation,
  burgersCircuitClosure,
  dislocationFrame,
  packMolecules,
  type PackSpecies,
} from '../lib/analysis/builders'
import { symbolToAtomicNumber } from '../chemistry/periodic-table'
import type { CubicLatticeType } from '../lib/crystal/lattice-period'
import { parseXYZ } from '../lib/crystal/xyz-parser'
import type {
  InspectionTarget,
  JsonValue,
  Mat3,
  ValidationCheck,
  Vec3,
  ZatomLattice,
  ZatomStructure,
  ZatomStructureAtom,
  ZatomStructureBond,
} from './contracts'
import { ZATOM_STRUCTURE_JSON_SCHEMA, ZATOM_STRUCTURE_SCHEMA } from './contracts'
import type {
  ZatomModelingProvider,
  ZatomProviderExecutionRequest,
  ZatomProviderOutput,
} from './provider'
import { ZATOM_PROVIDER_SCHEMA, ZatomProviderError } from './provider'
import {
  boundsOfPositions,
  cartesianToFractional,
  createDistanceCalculator,
  determinant3,
  fractionalToCartesian,
  wrapFractional,
} from './structure-math'
import { parseZatomStructure, validateStructure } from './structure-validation'
import { SMOOTH_DISPLACEMENT_FIELD_PROVIDER } from './continuous-field-provider'
import { GENERAL_2D_INTERFACE_PROVIDER } from './general-interface-provider'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function objectSchema(properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    properties,
    ...(required.length ? { required } : {}),
  }
}

const vec3Schema = { type: 'array', minItems: 3, maxItems: 3, items: { type: 'number' } }
const mat3Schema = { type: 'array', minItems: 3, maxItems: 3, items: vec3Schema }
const latticeSchema = objectSchema({
  vectors: mat3Schema,
  periodic: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'boolean' } },
}, ['vectors', 'periodic'])

function finiteNumber(
  input: Record<string, unknown>,
  name: string,
  fallback: number,
  options: { min?: number; max?: number; integer?: boolean } = {},
): number {
  const value = input[name] === undefined ? fallback : Number(input[name])
  if (!Number.isFinite(value) || (options.integer && !Number.isInteger(value))
    || (options.min !== undefined && value < options.min)
    || (options.max !== undefined && value > options.max)) {
    const bounds = `${options.min === undefined ? '' : ` >= ${options.min}`}${options.max === undefined ? '' : ` <= ${options.max}`}`
    throw new ZatomProviderError('invalid_provider_parameters', `${name} must be a finite${options.integer ? ' integer' : ''}${bounds}`)
  }
  return value
}

function finiteOptionalNumber(
  input: Record<string, unknown>,
  name: string,
  options: { min?: number; max?: number; integer?: boolean } = {},
): number | undefined {
  if (input[name] === undefined) return undefined
  return finiteNumber(input, name, 0, options)
}

function finiteVec3(value: unknown, name: string, integer = false): Vec3 {
  if (!Array.isArray(value) || value.length !== 3
    || value.some((item) => typeof item !== 'number' || !Number.isFinite(item) || (integer && !Number.isInteger(item)))) {
    throw new ZatomProviderError('invalid_provider_parameters', `${name} must contain three finite${integer ? ' integer' : ''} values`)
  }
  if (Math.hypot(value[0], value[1], value[2]) === 0) {
    throw new ZatomProviderError('invalid_provider_parameters', `${name} must not be the zero vector`)
  }
  return [value[0], value[1], value[2]]
}

function parseLattice(value: unknown, name: string): ZatomLattice {
  if (!isRecord(value) || !Array.isArray(value.vectors) || value.vectors.length !== 3
    || !Array.isArray(value.periodic) || value.periodic.length !== 3
    || value.periodic.some((item) => typeof item !== 'boolean')) {
    throw new ZatomProviderError('invalid_provider_parameters', `${name} must contain vectors[3][3] and periodic[3]`)
  }
  const vectors = value.vectors.map((row, index) => {
    if (!Array.isArray(row) || row.length !== 3 || row.some((item) => typeof item !== 'number' || !Number.isFinite(item))) {
      throw new ZatomProviderError('invalid_provider_parameters', `${name}.vectors[${index}] must contain three finite numbers`)
    }
    return [row[0], row[1], row[2]] as Vec3
  }) as Mat3
  if (Math.abs(determinant3(vectors)) < 1e-10) {
    throw new ZatomProviderError('invalid_provider_parameters', `${name}.vectors are singular`)
  }
  return { vectors, periodic: [value.periodic[0], value.periodic[1], value.periodic[2]] }
}

function parsedBuilderAtoms(xyz: string): { positions: Vec3[]; elements: string[]; lattice: Mat3 } {
  const parsed = parseXYZ(xyz)
  if (!parsed.success) throw new ZatomProviderError('builder_parse_failed', parsed.error)
  const lattice = parsed.data.latticeVectors
  if (!lattice) throw new ZatomProviderError('builder_parse_failed', 'Builder did not emit a lattice')
  return {
    positions: parsed.data.atoms.map((atom) => [...atom.cartesian] as Vec3),
    elements: parsed.data.atoms.map((atom) => atom.element),
    lattice: [[...lattice.a], [...lattice.b], [...lattice.c]],
  }
}

function vectorUnit(value: Vec3): Vec3 {
  const length = Math.hypot(...value)
  return [value[0] / length, value[1] / length, value[2] / length]
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function cellCenter(vectors: Mat3): Vec3 {
  return [
    (vectors[0][0] + vectors[1][0] + vectors[2][0]) / 2,
    (vectors[0][1] + vectors[1][1] + vectors[2][1]) / 2,
    (vectors[0][2] + vectors[1][2] + vectors[2][2]) / 2,
  ]
}

function atomIdsNear(structure: ZatomStructure, center: Vec3, radius: number): string[] {
  return structure.atoms
    .filter((atom) => Math.hypot(
      atom.position[0] - center[0],
      atom.position[1] - center[1],
      atom.position[2] - center[2],
    ) <= radius)
    .slice(0, 80)
    .map((atom) => atom.id)
}

const dislocationInputSchema = objectSchema({
  burgers: { ...vec3Schema, description: 'Integer cubic Miller direction for the Burgers vector' },
  lineDirection: { ...vec3Schema, description: 'Integer cubic Miller direction for the dislocation line' },
  latticeType: { enum: ['sc', 'fcc', 'bcc', 'diamond'], default: 'fcc' },
  latticeConstant: { type: 'number', exclusiveMinimum: 0 },
  burgersScale: { type: 'number', exclusiveMinimum: 0, default: 1 },
  poissonRatio: { type: 'number', exclusiveMinimum: -1, exclusiveMaximum: 0.5, default: 0.33 },
  radius: { type: 'number', exclusiveMinimum: 0 },
  vacuum: { type: 'number', minimum: 0, default: 10 },
  coreRadius: { type: 'number', minimum: 0, default: 0 },
  minimumSeparationA: { type: 'number', minimum: 0, default: 0.35 },
}, ['burgers', 'lineDirection'])

async function executeDislocation(request: ZatomProviderExecutionRequest): Promise<ZatomProviderOutput> {
  const source = request.source
  if (!source?.lattice) throw new ZatomProviderError('periodic_source_required', 'Dislocation construction requires a periodic source lattice')
  if (!source.lattice.periodic.every(Boolean)) {
    throw new ZatomProviderError('periodic_source_required', 'Dislocation construction requires a fully periodic source crystal')
  }
  const sourceValidation = validateStructure(source, { requirePeriodic: true })
  const blocking = sourceValidation.checks.filter((check) => check.status === 'fail')
  if (blocking.length) throw new ZatomProviderError('invalid_source_structure', blocking.map((check) => check.message).join('; '))
  const input = request.parameters
  const burgers = finiteVec3(input.burgers, 'burgers', true)
  const lineDirection = finiteVec3(input.lineDirection, 'lineDirection', true)
  const latticeTypeRaw = input.latticeType ?? 'fcc'
  if (latticeTypeRaw !== 'sc' && latticeTypeRaw !== 'fcc' && latticeTypeRaw !== 'bcc' && latticeTypeRaw !== 'diamond') {
    throw new ZatomProviderError('invalid_provider_parameters', 'latticeType must be sc, fcc, bcc, or diamond')
  }
  const latticeType: CubicLatticeType = latticeTypeRaw
  const latticeConstant = finiteOptionalNumber(input, 'latticeConstant', { min: Number.EPSILON })
  const burgersScale = finiteNumber(input, 'burgersScale', 1, { min: Number.EPSILON })
  const poissonRatio = finiteNumber(input, 'poissonRatio', 0.33, { min: -0.999999, max: 0.499999 })
  const radius = finiteOptionalNumber(input, 'radius', { min: Number.EPSILON })
  const vacuum = finiteNumber(input, 'vacuum', 10, { min: 0 })
  const coreRadius = finiteNumber(input, 'coreRadius', 0, { min: 0 })
  const minimumSeparationA = finiteNumber(input, 'minimumSeparationA', 0.35, { min: 0 })
  const built = buildDislocation({
    lattice: source.lattice.vectors,
    atoms: source.atoms.map((atom) => ({ element: atom.element, cartesian: atom.position })),
    burgers,
    lineDirection,
    latticeType,
    ...(latticeConstant === undefined ? {} : { latticeConstant }),
    burgersScale,
    poissonRatio,
    ...(radius === undefined ? {} : { radius }),
    vacuum,
    coreRadius,
  })
  const parsed = parsedBuilderAtoms(built.xyz)
  const identitiesPreserved = parsed.positions.length === source.atoms.length
  const atoms: ZatomStructureAtom[] = parsed.positions.map((position, index) => ({
    id: identitiesPreserved ? source.atoms[index].id : `dislocation-atom-${index + 1}`,
    element: parsed.elements[index],
    position,
    ...(identitiesPreserved && source.atoms[index].properties ? { properties: { ...source.atoms[index].properties } } : {}),
  }))
  const periodic: [boolean, boolean, boolean] = [false, false, true]
  const structure: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    label: `${source.label ?? 'crystal'} ${built.character} dislocation`,
    atoms,
    ...(identitiesPreserved && source.bonds ? {
      bonds: source.bonds.map((bond) => ({ ...bond, atomIds: [...bond.atomIds] as [string, string] })),
    } : {}),
    lattice: { vectors: parsed.lattice, periodic },
    metadata: {
      'zatom.provider': 'zatom.isotropic-dislocation',
      'zatom.dislocation.character': built.character,
      'zatom.dislocation.burgersMagnitudeA': built.burgersMagnitude,
      'zatom.dislocation.characterAngleDeg': built.characterAngleDeg,
      'zatom.dislocation.boundary': 'free-transverse-line-periodic-cylinder',
      'zatom.dislocation.leavesStackingFault': built.leavesStackingFault,
    },
  }

  const bUnit = vectorUnit(burgers)
  const lineUnit = vectorUnit(lineDirection)
  const signedCosine = dot(bUnit, lineUnit)
  const bScrew = built.burgersMagnitude * signedCosine
  const bEdge = built.burgersMagnitude * Math.sqrt(Math.max(0, 1 - signedCosine * signedCosine))
  const frame = dislocationFrame(burgers, lineDirection)
  const closure = burgersCircuitClosure(
    [0, 0, 0],
    frame,
    bEdge,
    bScrew,
    poissonRatio,
    Math.max(5, 4 * built.burgersMagnitude),
  )
  const closureMagnitude = Math.hypot(...closure)
  const closureErrorA = Math.abs(closureMagnitude - built.burgersMagnitude)
  const checks: ValidationCheck[] = [
    {
      id: 'dislocation.burgers_circuit',
      status: closureErrorA <= Math.max(1e-7, built.burgersMagnitude * 1e-6) ? 'pass' : 'fail',
      message: `Burgers circuit closure magnitude is ${closureMagnitude.toFixed(6)} Å for requested |b| ${built.burgersMagnitude.toFixed(6)} Å`,
      metrics: { closureMagnitudeA: closureMagnitude, burgersMagnitudeA: built.burgersMagnitude, closureErrorA },
    },
    {
      id: 'dislocation.boundary_scope',
      status: 'pass',
      message: 'Cylinder declares free transverse surfaces and periodicity only along the dislocation line',
      metrics: { periodicAxes: 'false,false,true' },
    },
    {
      id: 'dislocation.minimum_separation',
      status: built.minSeparation < minimumSeparationA ? 'fail' : built.minSeparation < Math.max(0.6, minimumSeparationA) ? 'warn' : 'pass',
      message: `Builder-reported closest Cartesian atom separation is ${built.minSeparation.toFixed(4)} Å`,
      metrics: { minSeparationA: built.minSeparation, requiredMinimumA: minimumSeparationA },
    },
    {
      id: 'dislocation.elasticity_scope',
      status: 'warn',
      message: 'Seed uses isotropic linear elasticity; the core and anisotropic far field require a material-specific relaxation or Atomsk/Stroh provider',
    },
    ...(built.leavesStackingFault ? [{
      id: 'dislocation.partial_stacking_fault',
      status: 'warn' as const,
      message: 'Scaled Burgers vector is not a full lattice translation, so a stacking fault is intentionally present',
    }] : []),
    ...(!identitiesPreserved ? [{
      id: 'dislocation.atom_identity_rebuilt',
      status: 'warn' as const,
      message: 'Cylinder/core filtering changed membership; result atom IDs were deterministically rebuilt instead of claiming an uncertain source-ID mapping',
    }] : []),
    ...(source.bonds && !identitiesPreserved ? [{
      id: 'dislocation.topology_dropped',
      status: 'warn' as const,
      message: 'Source bond topology was dropped because filtering prevented a reliable endpoint mapping',
    }] : []),
  ]

  const centers: Vec3[] = [cellCenter(parsed.lattice)]
  const targetRadius = Math.max(2, 2.5 * built.burgersMagnitude)
  const inspectionTargets: InspectionTarget[] = centers.map((center) => ({
    id: 'dislocation-core',
    reason: `Inspect the ${built.character} dislocation core and nearby short contacts`,
    center,
    radius: targetRadius,
    atomIds: atomIdsNear(structure, center, targetRadius),
  }))
  return {
    structure,
    checks,
    inspectionTargets,
    summary: built.description,
    details: {
      character: built.character,
      burgersMagnitudeA: built.burgersMagnitude,
      characterAngleDeg: built.characterAngleDeg,
      minSeparationA: built.minSeparation,
      leavesStackingFault: built.leavesStackingFault,
      identitiesPreserved,
    },
    provenanceParameters: {
      burgers,
      lineDirection,
      latticeType,
      latticeConstant: latticeConstant ?? null,
      burgersScale,
      poissonRatio,
      boundary: 'free-transverse-line-periodic-cylinder',
      radius: radius ?? null,
      vacuum,
      coreRadius,
      minimumSeparationA,
    },
  }
}

interface ParsedPackSpecies {
  name: string
  structure: ZatomStructure
  count?: number
  molFraction?: number
}

const packSpeciesSchema = objectSchema({
  name: { type: 'string' },
  structure: ZATOM_STRUCTURE_JSON_SCHEMA,
  count: { type: 'integer', minimum: 0 },
  molFraction: { type: 'number', minimum: 0, maximum: 1 },
}, ['name', 'structure'])

const packInputSchema = objectSchema({
  cell: latticeSchema,
  species: { type: 'array', minItems: 1, items: packSpeciesSchema },
  minDistanceA: { type: 'number', exclusiveMinimum: 0, default: 2 },
  minDistanceByElement: { type: 'object', additionalProperties: { type: 'number', exclusiveMinimum: 0 } },
  totalCount: { type: 'integer', minimum: 0 },
  targetDensity: { type: 'number', exclusiveMinimum: 0 },
  maxAttemptsPerMolecule: { type: 'integer', minimum: 1, maximum: 10000, default: 200 },
  randomOrientation: { type: 'boolean', default: true },
  maxOutputAtoms: { type: 'integer', minimum: 1, maximum: 100000, default: 20000 },
}, ['species'])

function connectedComponentCount(structure: ZatomStructure): number {
  if (structure.atoms.length <= 1) return structure.atoms.length
  const adjacency = new Map(structure.atoms.map((atom) => [atom.id, new Set<string>()]))
  for (const bond of structure.bonds ?? []) {
    adjacency.get(bond.atomIds[0])?.add(bond.atomIds[1])
    adjacency.get(bond.atomIds[1])?.add(bond.atomIds[0])
  }
  const seen = new Set<string>()
  let count = 0
  for (const atom of structure.atoms) {
    if (seen.has(atom.id)) continue
    count++
    const pending = [atom.id]
    seen.add(atom.id)
    while (pending.length) {
      for (const neighbor of adjacency.get(pending.pop()!) ?? []) {
        if (!seen.has(neighbor)) { seen.add(neighbor); pending.push(neighbor) }
      }
    }
  }
  return count
}

function parsePackSpecies(input: Record<string, unknown>): ParsedPackSpecies[] {
  if (!Array.isArray(input.species) || input.species.length === 0) {
    throw new ZatomProviderError('invalid_provider_parameters', 'species must be a non-empty array')
  }
  const species = input.species.map((raw, index) => {
    if (!isRecord(raw) || typeof raw.name !== 'string' || !raw.name.trim()) {
      throw new ZatomProviderError('invalid_provider_parameters', `species[${index}].name is required`)
    }
    const structure = parseZatomStructure(raw.structure)
    const validation = validateStructure(structure)
    const failures = validation.checks.filter((check) => check.status === 'fail')
    if (failures.length) {
      throw new ZatomProviderError('invalid_species_structure', `species ${raw.name}: ${failures.map((check) => check.message).join('; ')}`)
    }
    if (structure.lattice?.periodic.some(Boolean)) {
      throw new ZatomProviderError('invalid_species_structure', `species ${raw.name} must be a finite rigid molecule, not a periodic structure`)
    }
    if (structure.atoms.length > 1 && structure.bonds === undefined) {
      throw new ZatomProviderError('species_topology_required', `multi-atom species ${raw.name} requires explicit bonds`)
    }
    if (structure.atoms.length > 1 && connectedComponentCount(structure) !== 1) {
      throw new ZatomProviderError('species_not_connected', `species ${raw.name} must be one connected rigid component`)
    }
    if (raw.count !== undefined && raw.molFraction !== undefined) {
      throw new ZatomProviderError('invalid_provider_parameters', `species ${raw.name} cannot set both count and molFraction`)
    }
    const count = raw.count === undefined ? undefined : Number(raw.count)
    const molFraction = raw.molFraction === undefined ? undefined : Number(raw.molFraction)
    if (count !== undefined && (!Number.isInteger(count) || count < 0)) {
      throw new ZatomProviderError('invalid_provider_parameters', `species ${raw.name} count must be a non-negative integer`)
    }
    if (molFraction !== undefined && (!Number.isFinite(molFraction) || molFraction < 0 || molFraction > 1)) {
      throw new ZatomProviderError('invalid_provider_parameters', `species ${raw.name} molFraction must be from 0 through 1`)
    }
    return { name: raw.name, structure, ...(count === undefined ? {} : { count }), ...(molFraction === undefined ? {} : { molFraction }) }
  })
  if (new Set(species.map((item) => item.name)).size !== species.length) {
    throw new ZatomProviderError('invalid_provider_parameters', 'species names must be unique')
  }
  const exactCounts = species.every((item) => item.count !== undefined)
  const anyCount = species.some((item) => item.count !== undefined)
  if (anyCount && !exactCounts) {
    throw new ZatomProviderError('invalid_provider_parameters', 'either every species supplies count or no species supplies count')
  }
  const totalCount = input.totalCount === undefined ? undefined : Number(input.totalCount)
  const targetDensity = input.targetDensity === undefined ? undefined : Number(input.targetDensity)
  if (exactCounts && (totalCount !== undefined || targetDensity !== undefined)) {
    throw new ZatomProviderError('invalid_provider_parameters', 'exact species counts cannot combine with totalCount or targetDensity')
  }
  if (!exactCounts && (totalCount === undefined) === (targetDensity === undefined)) {
    throw new ZatomProviderError('invalid_provider_parameters', 'fractional species require exactly one of totalCount or targetDensity')
  }
  return species
}

function uniqueGeneratedId(base: string, used: Set<string>): string {
  let id = base
  let suffix = 2
  while (used.has(id)) id = `${base}-${suffix++}`
  used.add(id)
  return id
}

function closestIntergroupPair(
  structure: ZatomStructure,
  groupIds: number[],
  minimumDistanceA: number,
  minimumByElement?: Record<string, number>,
  maxAtoms = 2500,
): { distanceA: number; requiredDistanceA: number; clearanceA: number; atomIds: [string, string]; center: Vec3 } | null {
  if (structure.atoms.length > maxAtoms) return null
  const distanceBetween = createDistanceCalculator(structure.lattice)
  let bestClearance = Infinity
  let distanceA = Infinity
  let requiredDistanceA = minimumDistanceA
  let atomIds: [string, string] | null = null
  let center: Vec3 = [0, 0, 0]
  const pairCenter = (a: Vec3, b: Vec3): Vec3 => {
    if (!structure.lattice?.periodic.some(Boolean)) {
      return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]
    }
    const fa = cartesianToFractional(a, structure.lattice.vectors)
    const fb = cartesianToFractional(b, structure.lattice.vectors)
    if (!fa || !fb) return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]
    const base: Vec3 = [fb[0] - fa[0], fb[1] - fa[1], fb[2] - fa[2]]
    for (let axis = 0; axis < 3; axis++) if (structure.lattice.periodic[axis]) base[axis] -= Math.round(base[axis])
    const shifts = structure.lattice.periodic.map((periodic) => periodic ? [-1, 0, 1] : [0])
    let bestVector: Vec3 = fractionalToCartesian(base, structure.lattice.vectors)
    let bestLength = Math.hypot(...bestVector)
    for (const ia of shifts[0]) for (const ib of shifts[1]) for (const ic of shifts[2]) {
      const vector = fractionalToCartesian([base[0] + ia, base[1] + ib, base[2] + ic], structure.lattice.vectors)
      const length = Math.hypot(...vector)
      if (length < bestLength) { bestLength = length; bestVector = vector }
    }
    const midpoint: Vec3 = [a[0] + bestVector[0] / 2, a[1] + bestVector[1] / 2, a[2] + bestVector[2] / 2]
    const fractionalMidpoint = cartesianToFractional(midpoint, structure.lattice.vectors)
    return fractionalMidpoint
      ? fractionalToCartesian(wrapFractional(fractionalMidpoint, structure.lattice.periodic), structure.lattice.vectors)
      : midpoint
  }
  for (let i = 0; i < structure.atoms.length; i++) {
    for (let j = i + 1; j < structure.atoms.length; j++) {
      if (groupIds[i] === groupIds[j]) continue
      const value = distanceBetween(structure.atoms[i].position, structure.atoms[j].position)
      const required = Math.max(
        minimumDistanceA,
        minimumByElement?.[structure.atoms[i].element] ?? minimumDistanceA,
        minimumByElement?.[structure.atoms[j].element] ?? minimumDistanceA,
      )
      const clearance = value - required
      if (clearance < bestClearance) {
        bestClearance = clearance
        distanceA = value
        requiredDistanceA = required
        atomIds = [structure.atoms[i].id, structure.atoms[j].id]
        center = pairCenter(structure.atoms[i].position, structure.atoms[j].position)
      }
    }
  }
  return atomIds ? { distanceA, requiredDistanceA, clearanceA: bestClearance, atomIds, center } : null
}

async function executePacking(request: ZatomProviderExecutionRequest): Promise<ZatomProviderOutput> {
  const input = request.parameters
  const species = parsePackSpecies(input)
  const cell = input.cell === undefined
    ? request.source?.lattice
    : parseLattice(input.cell, 'cell')
  if (!cell) throw new ZatomProviderError('packing_cell_required', 'Provide cell or a source structure with a lattice')
  if (request.source) {
    const sourceValidation = validateStructure(request.source)
    const sourceFailures = sourceValidation.checks.filter((check) => check.status === 'fail')
    if (sourceFailures.length) {
      throw new ZatomProviderError('invalid_source_structure', `Packing solute is invalid: ${sourceFailures.map((check) => check.message).join('; ')}`)
    }
    const outsideNonperiodic = request.source.atoms.filter((atom) => {
      const fractional = cartesianToFractional(atom.position, cell.vectors)
      return !fractional || fractional.some((value, axis) => !cell.periodic[axis] && (value < -1e-10 || value >= 1 - 1e-10))
    })
    if (outsideNonperiodic.length) {
      throw new ZatomProviderError(
        'solute_outside_nonperiodic_cell',
        `${outsideNonperiodic.length} solute atoms lie outside a non-periodic cell boundary; first translate or resize the source`,
      )
    }
  }
  const minDistanceA = finiteNumber(input, 'minDistanceA', 2, { min: Number.EPSILON })
  let minDistanceByElement: Record<string, number> | undefined
  if (input.minDistanceByElement !== undefined) {
    if (!isRecord(input.minDistanceByElement)) {
      throw new ZatomProviderError('invalid_provider_parameters', 'minDistanceByElement must be an object')
    }
    minDistanceByElement = {}
    for (const [element, raw] of Object.entries(input.minDistanceByElement)) {
      const value = Number(raw)
      if (!Number.isFinite(value) || value <= 0) {
        throw new ZatomProviderError('invalid_provider_parameters', `minDistanceByElement.${element} must be positive`)
      }
      minDistanceByElement[element] = value
    }
  }
  const totalCount = finiteOptionalNumber(input, 'totalCount', { min: 0, integer: true })
  const targetDensity = finiteOptionalNumber(input, 'targetDensity', { min: Number.EPSILON })
  const maxAttemptsPerMolecule = finiteNumber(input, 'maxAttemptsPerMolecule', 200, { min: 1, max: 10000, integer: true })
  const maxOutputAtoms = finiteNumber(input, 'maxOutputAtoms', 20000, { min: 1, max: 100000, integer: true })
  const randomOrientation = input.randomOrientation !== false
  const packSpecies: PackSpecies[] = species.map((item) => ({
    name: item.name,
    atoms: item.structure.atoms.map((atom) => ({ element: atom.element, position: atom.position })),
    ...(item.count === undefined ? {} : { count: item.count }),
    ...(item.molFraction === undefined ? {} : { molFraction: item.molFraction }),
  }))
  const result = packMolecules({
    lattice: cell.vectors,
    species: packSpecies,
    soluteAtoms: request.source?.atoms.map((atom) => ({ element: atom.element, cartesian: atom.position })),
    minDistance: minDistanceA,
    ...(minDistanceByElement ? { minDistanceByElement } : {}),
    ...(totalCount === undefined ? {} : { totalCount }),
    ...(targetDensity === undefined ? {} : { targetDensity }),
    pbc: cell.periodic,
    maxAttemptsPerMolecule,
    seed: request.seed,
    randomOrientation,
  })
  if (result.n_atoms > maxOutputAtoms) {
    throw new ZatomProviderError('output_too_large', `Packed result has ${result.n_atoms} atoms, above maxOutputAtoms ${maxOutputAtoms}`)
  }
  const parsed = parsedBuilderAtoms(result.xyz)
  if (parsed.positions.length !== result.moleculeIndex.length) {
    throw new ZatomProviderError('builder_contract_failed', 'Packing atom and molecule-index counts disagree')
  }
  const atoms: ZatomStructureAtom[] = []
  const bonds: ZatomStructureBond[] = []
  const groupIds: number[] = []
  const usedIds = new Set<string>()
  let cursor = 0
  for (const atom of request.source?.atoms ?? []) {
    usedIds.add(atom.id)
    atoms.push({ ...atom, position: parsed.positions[cursor], ...(atom.properties ? { properties: { ...atom.properties } } : {}) })
    groupIds.push(-1)
    cursor++
  }
  for (const bond of request.source?.bonds ?? []) bonds.push({ ...bond, atomIds: [...bond.atomIds] as [string, string] })
  let globalMoleculeIndex = 0
  for (let speciesIndex = 0; speciesIndex < species.length; speciesIndex++) {
    const item = species[speciesIndex]
    const copies = result.placed[item.name] ?? 0
    for (let copyIndex = 0; copyIndex < copies; copyIndex++) {
      const idMap = new Map<string, string>()
      for (const sourceAtom of item.structure.atoms) {
        const id = uniqueGeneratedId(`pack-s${speciesIndex + 1}-m${copyIndex + 1}-${sourceAtom.id}`, usedIds)
        idMap.set(sourceAtom.id, id)
        atoms.push({
          id,
          element: sourceAtom.element,
          position: parsed.positions[cursor],
          properties: {
            ...(sourceAtom.properties ?? {}),
            'zatom.pack.species': item.name,
            'zatom.pack.copyIndex': copyIndex,
            'zatom.parentAtomId': sourceAtom.id,
          },
        })
        groupIds.push(globalMoleculeIndex)
        if (result.moleculeIndex[cursor] !== globalMoleculeIndex) {
          throw new ZatomProviderError('builder_contract_failed', `Packing molecule order diverged at atom ${cursor}`)
        }
        cursor++
      }
      for (const sourceBond of item.structure.bonds ?? []) {
        bonds.push({
          ...sourceBond,
          id: `pack-s${speciesIndex + 1}-m${copyIndex + 1}-${sourceBond.id}`,
          atomIds: [idMap.get(sourceBond.atomIds[0])!, idMap.get(sourceBond.atomIds[1])!],
          ...(sourceBond.properties ? { properties: { ...sourceBond.properties } } : {}),
        })
      }
      globalMoleculeIndex++
    }
  }
  if (cursor !== parsed.positions.length) {
    throw new ZatomProviderError('builder_contract_failed', `Mapped ${cursor} packed atoms but builder emitted ${parsed.positions.length}`)
  }
  const sourceTopologyKnown = !request.source || request.source.bonds !== undefined || request.source.atoms.length <= 1
  const structure: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    label: `Packed ${species.map((item) => item.name).join(' + ')}`,
    atoms,
    bonds,
    lattice: { vectors: parsed.lattice, periodic: [...cell.periodic] as [boolean, boolean, boolean] },
    metadata: {
      'zatom.provider': 'zatom.rigid-molecule-packing',
      'zatom.pack.seed': request.seed,
      'zatom.pack.topologyCompleteness': sourceTopologyKnown ? 'complete' : 'packed-molecules-only',
      'zatom.pack.placed': result.placed,
      'zatom.pack.requested': result.requested,
      'zatom.pack.densityGcm3': result.density,
    },
  }
  const expectedBonds = (request.source?.bonds?.length ?? 0) + species.reduce(
    (sum, item) => sum + (result.placed[item.name] ?? 0) * (item.structure.bonds?.length ?? 0),
    0,
  )
  const hasIntergroupPair = new Set(groupIds).size > 1
  const closest = closestIntergroupPair(structure, groupIds, minDistanceA, minDistanceByElement)
  const separationStatus = !hasIntergroupPair
    ? 'skipped'
    : closest
      ? closest.clearanceA >= -1e-8 ? 'pass' : 'fail'
      : minDistanceByElement
        ? 'warn'
        : result.minSeparation + 1e-8 >= minDistanceA ? 'pass' : 'fail'
  const densityRelativeError = targetDensity === undefined
    ? null
    : Math.abs(result.density - targetDensity) / targetDensity
  const checks: ValidationCheck[] = [
    {
      id: 'pack.completeness',
      status: result.incomplete ? 'fail' : 'pass',
      message: result.incomplete
        ? `Packing was incomplete: ${Object.keys(result.requested).map((name) => `${name} ${result.placed[name]}/${result.requested[name]}`).join(', ')}`
        : `Placed every requested molecule (${Object.values(result.placed).reduce((sum, value) => sum + value, 0)} total)`,
      metrics: { incomplete: result.incomplete, totalAttempts: result.totalAttempts },
    },
    {
      id: 'pack.minimum_inter_molecular_distance',
      status: separationStatus,
      message: hasIntergroupPair
        ? closest
          ? `Worst intermolecular/solute clearance is ${closest.clearanceA.toFixed(4)} Å (${closest.distanceA.toFixed(4)} Å contact; ${closest.requiredDistanceA.toFixed(4)} Å pair floor)`
          : minDistanceByElement
            ? `All-atom result exceeds the ${2500}-atom independent per-element recheck budget; builder reports global minimum ${result.minSeparation.toFixed(4)} Å`
            : `Achieved minimum intermolecular/solute contact ${result.minSeparation.toFixed(4)} Å against floor ${minDistanceA.toFixed(4)} Å`
        : 'Only one molecular/solute group exists, so no intermolecular distance is defined',
      metrics: {
        minSeparationA: result.minSeparation,
        requestedMinimumA: minDistanceA,
        worstPairDistanceA: closest?.distanceA ?? null,
        worstPairRequiredA: closest?.requiredDistanceA ?? null,
        worstClearanceA: closest?.clearanceA ?? null,
      },
    },
    {
      id: 'pack.topology_preserved',
      status: bonds.length === expectedBonds ? 'pass' : 'fail',
      message: `Replicated ${bonds.length}/${expectedBonds} expected explicit bonds with stable molecule-instance IDs`,
      metrics: { bondCount: bonds.length, expectedBondCount: expectedBonds },
    },
    {
      id: 'pack.achieved_density',
      status: densityRelativeError === null ? 'skipped' : densityRelativeError <= 0.05 ? 'pass' : 'warn',
      message: targetDensity === undefined
        ? `Achieved packed-molecule density is ${result.density.toFixed(4)} g/cm³; no density target was supplied`
        : `Achieved ${result.density.toFixed(4)} g/cm³ for target ${targetDensity.toFixed(4)} g/cm³`,
      metrics: { achievedDensityGcm3: result.density, targetDensityGcm3: targetDensity ?? null, relativeError: densityRelativeError },
    },
    {
      id: 'pack.physical_scope',
      status: 'warn',
      message: 'Rigid random insertion validates geometry and topology only; equilibrate with an appropriate force-field or electronic-structure provider before physical claims',
    },
    ...(!sourceTopologyKnown ? [{
      id: 'pack.solute_topology_unknown',
      status: 'warn' as const,
      message: 'Packed molecule topology is explicit, but the supplied multi-atom solute had no explicit bond topology',
    }] : []),
  ]
  const overview = boundsOfPositions(structure.atoms.map((atom) => atom.position))
  const inspectionTargets: InspectionTarget[] = [
    ...(closest ? [{
      id: 'pack-closest-contact',
      reason: 'Inspect the independently resolved closest intermolecular/solute contact',
      center: closest.center,
      radius: Math.max(1.5, closest.distanceA),
      atomIds: closest.atomIds,
    }] : []),
    ...(overview ? [{
      id: 'pack-overview',
      reason: result.incomplete ? 'Inspect the incomplete packing and remaining void space' : 'Inspect packed composition and spatial coverage',
      center: overview.center,
      radius: Math.max(2, overview.radius),
      atomIds: structure.atoms.slice(0, 80).map((atom) => atom.id),
      atomIdsTruncated: structure.atoms.length > 80,
    }] : []),
  ]
  return {
    structure,
    checks,
    inspectionTargets,
    summary: result.description,
    details: {
      placed: result.placed,
      requested: result.requested,
      densityGcm3: result.density,
      minSeparationA: result.minSeparation,
      totalAttempts: result.totalAttempts,
      incomplete: result.incomplete,
      topologyCompleteness: sourceTopologyKnown ? 'complete' : 'packed-molecules-only',
    },
    provenanceParameters: {
      species: species.map((item) => ({
        name: item.name,
        sourceAtomCount: item.structure.atoms.length,
        sourceBondCount: item.structure.bonds?.length ?? null,
        count: item.count ?? null,
        molFraction: item.molFraction ?? null,
      })) as unknown as JsonValue,
      cell: { vectors: cell.vectors, periodic: cell.periodic },
      minDistanceA,
      minDistanceByElement: minDistanceByElement ?? {},
      totalCount: totalCount ?? null,
      targetDensity: targetDensity ?? null,
      maxAttemptsPerMolecule,
      randomOrientation,
      maxOutputAtoms,
    },
  }
}

const moireInputSchema = objectSchema({
  targetTwistDeg: { type: 'number', minimum: 0, maximum: 60, default: 21.786789 },
  m: { type: 'integer', minimum: 1, description: 'Optional exact reduced commensurate pair; supply n as well' },
  n: { type: 'integer', minimum: 0, description: 'Optional exact reduced commensurate pair; supply m as well' },
  elementA: { type: 'string', default: 'C', description: 'Honeycomb sublattice A element' },
  elementB: { type: 'string', default: 'C', description: 'Honeycomb sublattice B element' },
  bondLengthA: { type: 'number', exclusiveMinimum: 0, default: 1.42 },
  interlayerA: { type: 'number', exclusiveMinimum: 0, default: 3.35 },
  vacuumA: { type: 'number', minimum: 0, default: 12 },
  maxAtoms: { type: 'integer', minimum: 4, maximum: 100000, default: 6000 },
  maxTwistErrorDeg: { type: 'number', minimum: 0, maximum: 60, default: 0.1 },
  maxPeriodicSeamResidualA: { type: 'number', minimum: 0, default: 1e-6 },
  minimumVacuumA: { type: 'number', minimum: 0, default: 6 },
})

function canonicalProviderElement(value: unknown, name: string, fallback: string): string {
  const raw = value === undefined ? fallback : value
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new ZatomProviderError('invalid_provider_parameters', `${name} must be an element symbol`)
  }
  const normalized = raw.trim()[0].toUpperCase() + raw.trim().slice(1).toLowerCase()
  if (symbolToAtomicNumber(normalized) <= 0) {
    throw new ZatomProviderError('invalid_provider_parameters', `${name} uses unknown element ${JSON.stringify(raw)}`)
  }
  return normalized
}

async function executeCommensurateMoire(request: ZatomProviderExecutionRequest): Promise<ZatomProviderOutput> {
  const input = request.parameters
  const targetTwistDeg = finiteNumber(input, 'targetTwistDeg', 21.786789, { min: 0, max: 60 })
  const m = finiteOptionalNumber(input, 'm', { min: 1, integer: true })
  const n = finiteOptionalNumber(input, 'n', { min: 0, integer: true })
  if ((m === undefined) !== (n === undefined)) {
    throw new ZatomProviderError('invalid_provider_parameters', 'm and n must be supplied together for an exact commensurate pair')
  }
  const elementA = canonicalProviderElement(input.elementA, 'elementA', 'C')
  const elementB = canonicalProviderElement(input.elementB, 'elementB', 'C')
  const bondLengthA = finiteNumber(input, 'bondLengthA', 1.42, { min: Number.EPSILON })
  const interlayerA = finiteNumber(input, 'interlayerA', 3.35, { min: Number.EPSILON })
  const vacuumA = finiteNumber(input, 'vacuumA', 12, { min: 0 })
  const maxAtoms = finiteNumber(input, 'maxAtoms', 6000, { min: 4, max: 100000, integer: true })
  const maxTwistErrorDeg = finiteNumber(input, 'maxTwistErrorDeg', 0.1, { min: 0, max: 60 })
  const maxPeriodicSeamResidualA = finiteNumber(input, 'maxPeriodicSeamResidualA', 1e-6, { min: 0 })
  const minimumVacuumA = finiteNumber(input, 'minimumVacuumA', 6, { min: 0 })
  let built
  try {
    built = buildMoire({
      twist_angle_deg: targetTwistDeg,
      elements: [elementA, elementB],
      bond_length: bondLengthA,
      interlayer: interlayerA,
      vacuum: vacuumA,
      maxAtoms,
      ...(m === undefined || n === undefined ? {} : { commensurate: { m, n } }),
    })
  } catch (error) {
    throw new ZatomProviderError('moire_construction_failed', error instanceof Error ? error.message : String(error))
  }
  const parsed = parsedBuilderAtoms(built.xyz)
  if (parsed.positions.length !== built.layerIndices.length || parsed.positions.length !== built.sublatticeIndices.length) {
    throw new ZatomProviderError('builder_contract_failed', 'Moiré atom, layer, and sublattice counts disagree')
  }
  const layerSerial = [0, 0]
  const atoms: ZatomStructureAtom[] = parsed.positions.map((position, index) => {
    const layer = built.layerIndices[index]
    const sublattice = built.sublatticeIndices[index]
    layerSerial[layer]++
    return {
      id: `moire-layer-${layer + 1}-atom-${layerSerial[layer]}`,
      element: parsed.elements[index],
      position,
      properties: {
        'zatom.moire.layer': layer,
        'zatom.moire.sublattice': sublattice,
        'zatom.moire.signedLayerRotationDeg': layer === 0 ? 0 : -built.realizedTwistDeg,
      },
    }
  })
  const structure: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    label: `${elementA}${elementB} commensurate Moiré (${built.m},${built.n})`,
    atoms,
    lattice: { vectors: parsed.lattice, periodic: [true, true, true] },
    metadata: {
      'zatom.provider': 'zatom.commensurate-moire',
      'zatom.moire.m': built.m,
      'zatom.moire.n': built.n,
      'zatom.moire.targetTwistDeg': built.targetTwistDeg,
      'zatom.moire.realizedTwistDeg': built.realizedTwistDeg,
      'zatom.moire.signedTopLayerRotationDeg': -built.realizedTwistDeg,
      'zatom.moire.twistErrorDeg': built.twistErrorDeg,
      'zatom.moire.periodicSeamResidualA': built.periodicSeamResidualA,
      'zatom.moire.geometricState': 'unrelaxed',
    },
  }
  const equalLayerCount = built.layerAtomCounts[0] === built.layerAtomCounts[1]
  const countPass = built.n_atoms === built.expectedAtomCount
    && built.n_atoms === atoms.length
    && equalLayerCount
  const checks: ValidationCheck[] = [
    {
      id: 'moire.commensurate_count',
      status: countPass ? 'pass' : 'fail',
      message: `Generated ${atoms.length}/${built.expectedAtomCount} exact-cell atoms with layer counts ${built.layerAtomCounts.join(' + ')}`,
      metrics: {
        atomCount: atoms.length,
        expectedAtomCount: built.expectedAtomCount,
        bottomLayerAtoms: built.layerAtomCounts[0],
        topLayerAtoms: built.layerAtomCounts[1],
      },
    },
    {
      id: 'moire.twist_error',
      status: built.twistErrorDeg <= maxTwistErrorDeg + 1e-12 ? 'pass' : 'fail',
      message: `Nearest allowed cell realizes ${built.realizedTwistDeg.toFixed(8)}° for target ${targetTwistDeg.toFixed(8)}° (error ${built.twistErrorDeg.toFixed(8)}°)`,
      metrics: {
        targetTwistDeg,
        realizedTwistDeg: built.realizedTwistDeg,
        twistErrorDeg: built.twistErrorDeg,
        maxTwistErrorDeg,
      },
    },
    {
      id: 'moire.periodic_seam',
      status: built.periodicSeamResidualA <= maxPeriodicSeamResidualA + 1e-12 ? 'pass' : 'fail',
      message: `Both layer primitive translations close across the shared cell within ${built.periodicSeamResidualA.toExponential(3)} Å`,
      metrics: {
        periodicSeamResidualA: built.periodicSeamResidualA,
        maxPeriodicSeamResidualA,
        cellAngleDeg: built.cellAngleDeg,
        cellAreaA2: built.cellAreaA2,
      },
    },
    {
      id: 'moire.layer_spacing',
      status: built.interlayerA > 0 ? 'pass' : 'fail',
      message: `Geometric layer separation is ${built.interlayerA.toFixed(6)} Å`,
      metrics: { interlayerA: built.interlayerA },
    },
    {
      id: 'moire.vacuum',
      status: built.vacuumA + 1e-12 >= minimumVacuumA ? 'pass' : 'fail',
      message: `Periodic z cell leaves ${built.vacuumA.toFixed(4)} Å vacuum against required minimum ${minimumVacuumA.toFixed(4)} Å`,
      metrics: { vacuumA: built.vacuumA, minimumVacuumA },
    },
    {
      id: 'moire.geometry_scope',
      status: 'warn',
      message: 'This capability builds an unrelaxed, equal-lattice-constant honeycomb bilayer; relax corrugation/strain with a material-specific force-field or electronic-structure provider',
    },
    ...(elementA !== elementB ? [{
      id: 'moire.binary_orientation',
      status: 'pass' as const,
      message: 'Binary sublattices retain the full 0–60° orientation instead of folding 60−θ onto θ',
    }] : []),
  ]
  const overviewCenter = cellCenter(parsed.lattice)
  const registryCenter: Vec3 = [0, 0, vacuumA / 2 + interlayerA / 2]
  const registryRadius = Math.max(2, Math.min(8, built.moireLatticeLengthA * 0.18))
  const registryAtomIds = atomIdsNear(structure, registryCenter, registryRadius)
  const inspectionTargets: InspectionTarget[] = [
    {
      id: 'moire-aa-periodic-origin',
      reason: 'Inspect coincident registry and the periodic seam at the shared-cell origin',
      center: registryCenter,
      radius: registryRadius,
      atomIds: registryAtomIds,
      ...(registryAtomIds.length >= 80 ? { atomIdsTruncated: true } : {}),
    },
    {
      id: 'moire-cell-overview',
      reason: 'Inspect both layers, the rhombic commensurate cell, and vacuum placement',
      center: overviewCenter,
      radius: Math.max(2, built.moireLatticeLengthA * 0.72),
      atomIds: atoms.slice(0, 80).map((atom) => atom.id),
      ...(atoms.length > 80 ? { atomIdsTruncated: true } : {}),
    },
  ]
  return {
    structure,
    checks,
    inspectionTargets,
    summary: built.description,
    details: {
      commensuratePair: [built.m, built.n],
      targetTwistDeg,
      realizedTwistDeg: built.realizedTwistDeg,
      signedTopLayerRotationDeg: -built.realizedTwistDeg,
      twistErrorDeg: built.twistErrorDeg,
      expectedAtomCount: built.expectedAtomCount,
      layerAtomCounts: built.layerAtomCounts,
      bondLengthA: built.bondLengthA,
      latticeConstantA: built.latticeConstantA,
      interlayerA: built.interlayerA,
      vacuumA: built.vacuumA,
      moireLatticeLengthA: built.moireLatticeLengthA,
      cellAreaA2: built.cellAreaA2,
      cellAngleDeg: built.cellAngleDeg,
      periodicSeamResidualA: built.periodicSeamResidualA,
      geometricState: 'unrelaxed',
    },
    provenanceParameters: {
      targetTwistDeg,
      exactCommensuratePair: m === undefined || n === undefined ? null : [m, n],
      elementA,
      elementB,
      bondLengthA,
      interlayerA,
      vacuumA,
      maxAtoms,
      maxTwistErrorDeg,
      maxPeriodicSeamResidualA,
      minimumVacuumA,
    },
  }
}

export const ISOTROPIC_DISLOCATION_PROVIDER: ZatomModelingProvider = {
  manifest: {
    schemaVersion: ZATOM_PROVIDER_SCHEMA,
    id: 'zatom.isotropic-dislocation',
    title: 'zatom isotropic dislocation builder',
    description: 'Construct finite-transverse-surface screw, edge, or mixed isotropic Volterra cylinder seeds with measured Burgers closure.',
    adapterVersion: '2.0.0',
    engine: { name: 'zatom-isotropic-dislocation', version: '2.0.0' },
    execution: 'browser',
    capabilities: [{
      id: 'defect.dislocation.isotropic',
      title: 'Build an isotropic-elastic dislocation seed',
      description: 'Create a free-transverse-surface, line-periodic cylinder from a fully periodic cubic source crystal. Use the pinned atomman periodic-screw-dipole provider for full PBC.',
      fidelity: 'continuum',
      source: 'required',
      deterministic: true,
      inputSchema: dislocationInputSchema,
      requiredCheckIds: ['dislocation.burgers_circuit', 'dislocation.boundary_scope', 'dislocation.minimum_separation'],
      tags: ['defect', 'dislocation', 'burgers-vector', 'elasticity'],
    }],
  },
  execute: executeDislocation,
}

export const RIGID_MOLECULE_PACKING_PROVIDER: ZatomModelingProvider = {
  manifest: {
    schemaVersion: ZATOM_PROVIDER_SCHEMA,
    id: 'zatom.rigid-molecule-packing',
    title: 'zatom rigid molecule packer',
    description: 'Pack arbitrary explicit-topology rigid molecules in orthogonal or triclinic cells with all-atom contact checks.',
    adapterVersion: '1.0.0',
    engine: { name: 'zatom-spatial-hash-packer', version: '1.1.0' },
    execution: 'browser',
    capabilities: [{
      id: 'molecule.pack.rigid',
      title: 'Pack rigid molecular mixtures',
      description: 'Create solvents, electrolytes, mixtures, or pore fills while preserving every supplied molecule bond and reporting actual density/completeness.',
      fidelity: 'geometric',
      source: 'optional',
      deterministic: true,
      inputSchema: packInputSchema,
      requiredCheckIds: ['pack.completeness', 'pack.minimum_inter_molecular_distance', 'pack.topology_preserved'],
      tags: ['molecule', 'packing', 'solvation', 'electrolyte', 'amorphous'],
    }],
  },
  execute: executePacking,
}

export const COMMENSURATE_MOIRE_PROVIDER: ZatomModelingProvider = {
  manifest: {
    schemaVersion: ZATOM_PROVIDER_SCHEMA,
    id: 'zatom.commensurate-moire',
    title: 'zatom commensurate honeycomb Moiré builder',
    description: 'Construct exact shared-cell twisted honeycomb bilayers with explicit layer identity, twist error, atom-count, and periodic-seam checks.',
    adapterVersion: '1.0.0',
    engine: { name: 'zatom-commensurate-moire', version: '2.0.0' },
    execution: 'browser',
    capabilities: [{
      id: 'interface.moire.hexagonal',
      title: 'Build a commensurate honeycomb Moiré bilayer',
      description: 'Snap a full-window 0–60° target to an exact reduced (m,n) shared cell, or use an explicit pair; suitable for graphene-like and binary honeycomb seeds.',
      fidelity: 'geometric',
      source: 'none',
      deterministic: true,
      inputSchema: moireInputSchema,
      requiredCheckIds: ['moire.commensurate_count', 'moire.twist_error', 'moire.periodic_seam', 'moire.layer_spacing', 'moire.vacuum'],
      tags: ['interface', 'moire', 'twisted-bilayer', '2d-material', 'commensurate'],
    }],
  },
  execute: executeCommensurateMoire,
}

export const BUILTIN_ZATOM_MODELING_PROVIDERS: readonly ZatomModelingProvider[] = [
  ISOTROPIC_DISLOCATION_PROVIDER,
  RIGID_MOLECULE_PACKING_PROVIDER,
  COMMENSURATE_MOIRE_PROVIDER,
  SMOOTH_DISPLACEMENT_FIELD_PROVIDER,
  GENERAL_2D_INTERFACE_PROVIDER,
]
