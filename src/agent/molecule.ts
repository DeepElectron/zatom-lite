/** Explicit molecular topology, deterministic templates, and empirical cleanup adapters. */

import { ELEMENTS } from '../lib/crystal/elements'
import { quickOptimizeGeometry, type QuickOptimizeStats } from '../lib/molecule/quick-optimize'
import { createAtomsFromMoleculeTemplate, getMoleculeTemplateKeys, MOLECULE_TEMPLATES } from '../lib/molecule/templates'
import {
  ZATOM_BIOMOLECULAR_IDENTITY_METADATA_KEY,
  ZATOM_BIOMOLECULAR_IDENTITY_PROPERTIES,
  ZATOM_BIOMOLECULAR_IDENTITY_SCHEMA,
} from './biomolecular-identity'
import type {
  InspectionTarget,
  JsonValue,
  StructureChangeSet,
  StructureProvenance,
  ValidationCheck,
  Vec3,
  ZatomBondOrder,
  ZatomStructure,
} from './contracts'
import { ZATOM_STRUCTURE_SCHEMA } from './contracts'
import { buildStructureChangeSet } from './operations'
import {
  boundsOfPositions,
  compareCanonicalText,
  createDistanceCalculator,
  fingerprintStructure,
} from './structure-math'
import { validateStructure } from './structure-validation'

export const BUILTIN_MOLECULE_TEMPLATES = getMoleculeTemplateKeys().sort()

export interface MolecularTopologyReport {
  checks: ValidationCheck[]
  bondCount: number
  componentCount: number | null
  formula: string
  formalCharge: number | null
  maxBondLengthRelativeError: number | null
  valenceSums: Record<string, number>
  inspectionTargets: InspectionTarget[]
}

export interface CreateMoleculeTemplateOptions {
  template: string
  center?: Vec3
}

export interface CreateMoleculeTemplateResult {
  structure: ZatomStructure
  validation: ReturnType<typeof validateStructure>
  topology: MolecularTopologyReport
  checks: ValidationCheck[]
  changeSet: StructureChangeSet
  provenance: StructureProvenance
  inspectionTargets: InspectionTarget[]
  template: { key: string; name: string; formula: string }
}

export interface OptimizeMoleculeOptions {
  structure: ZatomStructure
  fixedAtomIds?: string[]
  maxIters?: number
  bondLengthToleranceFraction?: number
}

export interface OptimizeMoleculeResult {
  structure: ZatomStructure
  validation: ReturnType<typeof validateStructure>
  topology: MolecularTopologyReport
  checks: ValidationCheck[]
  changeSet: StructureChangeSet
  provenance: StructureProvenance
  inspectionTargets: InspectionTarget[]
  stats: QuickOptimizeStats
}

export interface OpenMmResidueAtomAssignment {
  atomId: string
  atomName: string
}

export interface OpenMmResidueAssignment {
  chainId: string
  residueName: string
  residueId: string
  insertionCode?: string
  atoms: OpenMmResidueAtomAssignment[]
}

export interface AssignOpenMmIdentityOptions {
  structure: ZatomStructure
  residues: OpenMmResidueAssignment[]
}

export interface AssignOpenMmIdentityResult {
  structure: ZatomStructure
  validation: ReturnType<typeof validateStructure>
  checks: ValidationCheck[]
  changeSet: StructureChangeSet
  provenance: StructureProvenance
  inspectionTargets: InspectionTarget[]
  residues: OpenMmResidueAssignment[]
  externalBondCount: number
  formalCharge: number | null
}

export class MoleculeInputError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'MoleculeInputError'
    this.code = code
  }
}

function finiteVec3(value: Vec3 | undefined, field: string): Vec3 {
  const result = value ?? [0, 0, 0]
  if (!Array.isArray(result) || result.length !== 3 || result.some((item) => !Number.isFinite(item))) {
    throw new MoleculeInputError('invalid_vector', `${field} must contain three finite numbers`)
  }
  return [...result] as Vec3
}

function boundedIdentityString(value: string, field: string, maximum: number): string {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0') || value.length > maximum) {
    throw new MoleculeInputError('invalid_openmm_identity', `${field} must be a non-empty string of at most ${maximum} characters`)
  }
  return value.trim()
}

function order(type: 'single' | 'double' | 'triple'): ZatomBondOrder {
  if (type === 'double') return 2
  if (type === 'triple') return 3
  return 1
}

function orderName(value: ZatomBondOrder): 'single' | 'double' | 'triple' | 'aromatic' {
  if (value === 2) return 'double'
  if (value === 3) return 'triple'
  if (value === 1.5) return 'aromatic'
  return 'single'
}

function bondLengthFactor(value: ZatomBondOrder): number {
  if (value === 3) return 0.84
  if (value === 2) return 0.91
  if (value === 1.5) return 0.94
  return 1
}

function formulaOf(structure: ZatomStructure): string {
  const counts = new Map<string, number>()
  for (const atom of structure.atoms) counts.set(atom.element, (counts.get(atom.element) ?? 0) + 1)
  const keys = [...counts.keys()].sort((a, b) => {
    if (a === 'C') return -1
    if (b === 'C') return 1
    if (a === 'H') return b === 'C' ? 1 : -1
    if (b === 'H') return a === 'C' ? -1 : 1
    return compareCanonicalText(a, b)
  })
  return keys.map((element) => `${element}${counts.get(element) === 1 ? '' : counts.get(element)}`).join('')
}

function connectedComponents(structure: ZatomStructure): number | null {
  if (!structure.bonds) return null
  const adjacency = new Map(structure.atoms.map((atom) => [atom.id, new Set<string>()]))
  for (const bond of structure.bonds) {
    if (!adjacency.has(bond.atomIds[0]) || !adjacency.has(bond.atomIds[1])) continue
    adjacency.get(bond.atomIds[0])!.add(bond.atomIds[1])
    adjacency.get(bond.atomIds[1])!.add(bond.atomIds[0])
  }
  let components = 0
  const visited = new Set<string>()
  for (const atom of structure.atoms) {
    if (visited.has(atom.id)) continue
    components++
    const stack = [atom.id]
    visited.add(atom.id)
    while (stack.length) {
      const current = stack.pop()!
      for (const neighbor of adjacency.get(current) ?? []) {
        if (visited.has(neighbor)) continue
        visited.add(neighbor)
        stack.push(neighbor)
      }
    }
  }
  return components
}

const COMMON_MAX_VALENCE: Record<string, number> = {
  H: 1,
  B: 4,
  C: 4,
  N: 4,
  O: 3,
  F: 1,
  Si: 4,
  P: 6,
  S: 6,
  Cl: 1,
  Br: 1,
  I: 1,
}

export function validateMolecularTopology(
  structure: ZatomStructure,
  options: { bondLengthToleranceFraction?: number } = {},
): MolecularTopologyReport {
  const tolerance = options.bondLengthToleranceFraction ?? 0.35
  if (!Number.isFinite(tolerance) || tolerance < 0) {
    throw new MoleculeInputError('invalid_tolerance', 'bondLengthToleranceFraction must be finite and non-negative')
  }
  const formula = formulaOf(structure)
  const checks: ValidationCheck[] = []
  const valenceSums: Record<string, number> = Object.fromEntries(structure.atoms.map((atom) => [atom.id, 0]))
  const atomById = new Map(structure.atoms.map((atom) => [atom.id, atom]))
  const inspectionIds = new Set<string>()
  if (!structure.bonds) {
    checks.push({
      id: 'molecule.explicit_topology',
      status: 'fail',
      message: 'Molecular validation requires explicit bonds; inferred viewer sticks are not chemical topology',
    })
    return {
      checks,
      bondCount: 0,
      componentCount: null,
      formula,
      formalCharge: null,
      maxBondLengthRelativeError: null,
      valenceSums,
      inspectionTargets: [],
    }
  }

  checks.push({
    id: 'molecule.explicit_topology',
    status: 'pass',
    message: `Explicit topology contains ${structure.bonds.length} bonds`,
    metrics: { bondCount: structure.bonds.length },
  })
  const componentCount = connectedComponents(structure)
  checks.push({
    id: 'molecule.connected_components',
    status: componentCount === 1 ? 'pass' : 'fail',
    message: componentCount === 1 ? 'Molecule is one connected component' : `Molecule contains ${componentCount} disconnected components`,
    metrics: { componentCount },
  })

  const distanceBetween = createDistanceCalculator(structure.lattice)
  let maxBondLengthRelativeError = 0
  const badLengthIds: string[] = []
  for (const bond of structure.bonds) {
    const a = atomById.get(bond.atomIds[0])
    const b = atomById.get(bond.atomIds[1])
    if (!a || !b) continue
    valenceSums[a.id] += bond.order
    valenceSums[b.id] += bond.order
    const radiusA = ELEMENTS[a.element]?.radius
    const radiusB = ELEMENTS[b.element]?.radius
    if (!radiusA || !radiusB) continue
    const expectedA = (radiusA + radiusB) * bondLengthFactor(bond.order)
    const measuredA = distanceBetween(a.position, b.position)
    const relativeError = Math.abs(measuredA - expectedA) / expectedA
    maxBondLengthRelativeError = Math.max(maxBondLengthRelativeError, relativeError)
    if (relativeError > tolerance) {
      badLengthIds.push(bond.id)
      inspectionIds.add(a.id)
      inspectionIds.add(b.id)
    }
  }
  checks.push({
    id: 'molecule.bond_lengths',
    status: badLengthIds.length ? 'fail' : structure.bonds.length ? 'pass' : 'skipped',
    message: badLengthIds.length
      ? `${badLengthIds.length} explicit bonds deviate by more than ${(100 * tolerance).toFixed(1)}% from covalent-radius targets`
      : structure.bonds.length
        ? `All explicit bond lengths are within ${(100 * tolerance).toFixed(1)}% of covalent-radius targets`
        : 'No bond lengths to assess',
    metrics: { maxBondLengthRelativeError: structure.bonds.length ? maxBondLengthRelativeError : null, tolerance },
  })

  const overValent = structure.atoms.filter((atom) => {
    const maximum = COMMON_MAX_VALENCE[atom.element]
    return maximum !== undefined && valenceSums[atom.id] > maximum + 1e-8
  })
  overValent.forEach((atom) => inspectionIds.add(atom.id))
  checks.push({
    id: 'molecule.common_valence_bounds',
    status: overValent.length ? 'warn' : 'pass',
    message: overValent.length
      ? `${overValent.length} atoms exceed conservative common-valence bounds; inspect charge/coordination explicitly`
      : 'No atom exceeds conservative common-valence bounds',
    atomIds: overValent.slice(0, 80).map((atom) => atom.id),
  })

  const chargeValues = structure.atoms.map((atom) => atom.properties?.formalCharge)
  const hasCompleteCharges = chargeValues.every((value) => typeof value === 'number' && Number.isFinite(value))
  const formalCharge = hasCompleteCharges ? (chargeValues as number[]).reduce((sum, value) => sum + value, 0) : null
  checks.push({
    id: 'molecule.formal_charge',
    status: hasCompleteCharges ? 'pass' : 'skipped',
    message: hasCompleteCharges ? `Explicit atom formal charges sum to ${formalCharge}` : 'Formal charges are incomplete; total molecular charge is unassessed',
    metrics: { formalCharge },
  })

  const targetAtoms = inspectionIds.size
    ? structure.atoms.filter((atom) => inspectionIds.has(atom.id))
    : structure.atoms
  const bounds = boundsOfPositions(targetAtoms.map((atom) => atom.position))
  const inspectionTargets: InspectionTarget[] = bounds ? [{
    id: inspectionIds.size ? 'molecular-topology-findings' : 'molecule-overview',
    reason: inspectionIds.size ? 'Inspect molecular bond-length or valence findings' : 'Inspect molecular geometry and explicit topology',
    center: bounds.center,
    radius: Math.max(1.5, bounds.radius + 0.5),
    atomIds: targetAtoms.slice(0, 80).map((atom) => atom.id),
    atomIdsTruncated: targetAtoms.length > 80,
  }] : []
  return {
    checks,
    bondCount: structure.bonds.length,
    componentCount,
    formula,
    formalCharge,
    maxBondLengthRelativeError: structure.bonds.length ? maxBondLengthRelativeError : null,
    valenceSums,
    inspectionTargets,
  }
}

export function createMoleculeFromTemplate(options: CreateMoleculeTemplateOptions): CreateMoleculeTemplateResult {
  const template = MOLECULE_TEMPLATES[options.template]
  if (!template) throw new MoleculeInputError('unknown_template', `Unknown built-in molecule template "${options.template}"`)
  const center = finiteVec3(options.center, 'center')
  const templateAtoms = createAtomsFromMoleculeTemplate(options.template)
  if (templateAtoms.length === 0) throw new MoleculeInputError('invalid_template', `Built-in molecule template "${options.template}" has invalid XYZ content`)
  const centroid: Vec3 = [0, 0, 0]
  for (const atom of templateAtoms) {
    const position = atom.cartesian ?? atom.position
    for (let axis = 0; axis < 3; axis++) centroid[axis] += position[axis] / templateAtoms.length
  }
  const atoms = templateAtoms.map((atom, index) => {
    const position = atom.cartesian ?? atom.position
    return {
      id: `molecule-${options.template}-atom-${index + 1}`,
      element: atom.element,
      position: [
        position[0] - centroid[0] + center[0],
        position[1] - centroid[1] + center[1],
        position[2] - centroid[2] + center[2],
      ] as Vec3,
      properties: {
        'zatom.role': 'molecule-template-atom',
        'zatom.template': options.template,
      },
    }
  })
  const bonds = (template.bonds ?? []).map((bond, index) => ({
    id: `molecule-${options.template}-bond-${index + 1}`,
    atomIds: [atoms[bond.from].id, atoms[bond.to].id] as [string, string],
    order: order(bond.type),
  }))
  const structure: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    label: template.name,
    atoms,
    bonds,
    metadata: {
      'zatom.molecule.template': options.template,
      'zatom.molecule.formulaLabel': template.formula,
    },
  }
  const validation = validateStructure(structure)
  const topology = validateMolecularTopology(structure)
  const checks = [...validation.checks, ...topology.checks]
  const source: ZatomStructure = { schemaVersion: ZATOM_STRUCTURE_SCHEMA, atoms: [] }
  const changeSet = buildStructureChangeSet(source, structure)
  const provenance: StructureProvenance = {
    engine: 'zatom-molecule-template',
    engineVersion: '1.0.0',
    sourceFingerprint: fingerprintStructure(source),
    resultFingerprint: fingerprintStructure(structure),
    parameters: { template: options.template, center },
  }
  return {
    structure,
    validation,
    topology,
    checks,
    changeSet,
    provenance,
    inspectionTargets: [...topology.inspectionTargets, ...validation.inspectionTargets],
    template: { key: options.template, name: template.name, formula: template.formula },
  }
}

/**
 * Attach an explicit, complete OpenMM chain/residue/atom-name map without
 * guessing chemistry or changing coordinates/topology. Residue and chain blocks
 * must already follow source atom order, matching the external worker contract.
 */
export function assignOpenMmIdentity(options: AssignOpenMmIdentityOptions): AssignOpenMmIdentityResult {
  if (!options.structure.bonds) {
    throw new MoleculeInputError('topology_required', 'OpenMM identity assignment requires explicit source bonds, including [] for monatomic residues')
  }
  const sourceBonds = options.structure.bonds
  if (!Array.isArray(options.residues) || !options.residues.length || options.residues.length > options.structure.atoms.length) {
    throw new MoleculeInputError('invalid_openmm_identity', 'residues must contain 1 through source atom-count residue records')
  }
  const atomById = new Map(options.structure.atoms.map((atom) => [atom.id, atom]))
  const assignedAtomIds: string[] = []
  const assigned = new Map<string, { chainId: string; residueName: string; residueId: string; insertionCode: string; atomName: string; residueIndex: number }>()
  const residueKeys = new Set<string>()
  const closedChains = new Set<string>()
  let currentChain: string | null = null
  const normalizedResidues = options.residues.map((residue, residueIndex): OpenMmResidueAssignment => {
    if (!residue || typeof residue !== 'object') {
      throw new MoleculeInputError('invalid_openmm_identity', `residues[${residueIndex}] must be an object`)
    }
    const chainId = boundedIdentityString(residue.chainId, `residues[${residueIndex}].chainId`, 32)
    const residueName = boundedIdentityString(residue.residueName, `residues[${residueIndex}].residueName`, 32)
    const residueId = boundedIdentityString(residue.residueId, `residues[${residueIndex}].residueId`, 32)
    const insertionCode = residue.insertionCode ?? ''
    if (typeof insertionCode !== 'string' || insertionCode.includes('\0') || insertionCode.length > 8) {
      throw new MoleculeInputError('invalid_openmm_identity', `residues[${residueIndex}].insertionCode must be at most 8 characters`)
    }
    if (chainId !== currentChain) {
      if (closedChains.has(chainId)) {
        throw new MoleculeInputError('noncontiguous_openmm_chain', `Chain ${JSON.stringify(chainId)} occurs in multiple residue blocks`)
      }
      if (currentChain !== null) closedChains.add(currentChain)
      currentChain = chainId
    }
    const residueKey = `${chainId}\0${residueId}\0${insertionCode}`
    if (residueKeys.has(residueKey)) {
      throw new MoleculeInputError('duplicate_openmm_residue', `Residue ${chainId}:${residueId}${insertionCode} is repeated`)
    }
    residueKeys.add(residueKey)
    if (!Array.isArray(residue.atoms) || !residue.atoms.length) {
      throw new MoleculeInputError('invalid_openmm_identity', `residues[${residueIndex}].atoms must be non-empty`)
    }
    const atomNames = new Set<string>()
    const atoms = residue.atoms.map((entry, atomIndex): OpenMmResidueAtomAssignment => {
      if (!entry || typeof entry !== 'object') {
        throw new MoleculeInputError('invalid_openmm_identity', `residues[${residueIndex}].atoms[${atomIndex}] must be an object`)
      }
      const atomId = boundedIdentityString(entry.atomId, `residues[${residueIndex}].atoms[${atomIndex}].atomId`, 512)
      const atomName = boundedIdentityString(entry.atomName, `residues[${residueIndex}].atoms[${atomIndex}].atomName`, 32)
      if (!atomById.has(atomId)) throw new MoleculeInputError('openmm_atom_missing', `Assigned atom ID ${JSON.stringify(atomId)} is absent from the source`)
      if (assigned.has(atomId)) throw new MoleculeInputError('duplicate_openmm_atom', `Atom ${JSON.stringify(atomId)} is assigned more than once`)
      if (atomNames.has(atomName)) {
        throw new MoleculeInputError('duplicate_openmm_atom_name', `Residue ${chainId}:${residueId} repeats atom name ${JSON.stringify(atomName)}`)
      }
      atomNames.add(atomName)
      assignedAtomIds.push(atomId)
      assigned.set(atomId, { chainId, residueName, residueId, insertionCode, atomName, residueIndex })
      return { atomId, atomName }
    })
    return { chainId, residueName, residueId, ...(insertionCode ? { insertionCode } : {}), atoms }
  })
  const sourceAtomIds = options.structure.atoms.map((atom) => atom.id)
  if (assignedAtomIds.length !== sourceAtomIds.length || assignedAtomIds.some((id, index) => id !== sourceAtomIds[index])) {
    const missing = sourceAtomIds.filter((id) => !assigned.has(id))
    throw new MoleculeInputError(
      'incomplete_or_reordered_openmm_identity',
      `Residue atom assignments must cover every source atom exactly once in source order${missing.length ? `; missing ${missing.slice(0, 8).join(', ')}` : ''}`,
    )
  }

  const chargeValues = options.structure.atoms.map((atom) => atom.properties?.formalCharge)
  const hasAnyCharge = chargeValues.some((value) => value !== undefined)
  const hasCompleteIntegerCharges = chargeValues.every((value) => Number.isInteger(value))
  const formalCharge = hasCompleteIntegerCharges
    ? (chargeValues as number[]).reduce((sum, value) => sum + value, 0)
    : null
  const residueByAtom = new Map([...assigned.entries()].map(([atomId, value]) => [atomId, value.residueIndex]))
  const externalBondCount = sourceBonds.filter((bond) => (
    residueByAtom.get(bond.atomIds[0]) !== residueByAtom.get(bond.atomIds[1])
  )).length
  const structure: ZatomStructure = {
    ...options.structure,
    label: `${options.structure.label ?? 'molecular structure'} | OpenMM identity assigned`,
    atoms: options.structure.atoms.map((atom) => {
      const identity = assigned.get(atom.id)!
      return {
        ...atom,
        position: [...atom.position] as Vec3,
        properties: {
          ...(atom.properties ?? {}),
          [ZATOM_BIOMOLECULAR_IDENTITY_PROPERTIES.chainId]: identity.chainId,
          [ZATOM_BIOMOLECULAR_IDENTITY_PROPERTIES.residueName]: identity.residueName,
          [ZATOM_BIOMOLECULAR_IDENTITY_PROPERTIES.residueId]: identity.residueId,
          [ZATOM_BIOMOLECULAR_IDENTITY_PROPERTIES.atomName]: identity.atomName,
          ...(identity.insertionCode ? {
            [ZATOM_BIOMOLECULAR_IDENTITY_PROPERTIES.insertionCode]: identity.insertionCode,
          } : {}),
        },
      }
    }),
    bonds: sourceBonds.map((bond) => ({
      ...bond,
      atomIds: [...bond.atomIds] as [string, string],
      ...(bond.properties ? { properties: { ...bond.properties } } : {}),
    })),
    metadata: {
      ...(options.structure.metadata ?? {}),
      [ZATOM_BIOMOLECULAR_IDENTITY_METADATA_KEY]: {
        schemaVersion: ZATOM_BIOMOLECULAR_IDENTITY_SCHEMA,
        residueCount: normalizedResidues.length,
        chainCount: new Set(normalizedResidues.map((residue) => residue.chainId)).size,
        externalBondCount,
      },
    },
  }
  const validation = validateStructure(structure)
  const bounds = boundsOfPositions(structure.atoms.map((atom) => atom.position))
  const firstResidueIds = normalizedResidues[0].atoms.map((entry) => entry.atomId)
  const firstResidueBounds = boundsOfPositions(firstResidueIds.map((id) => atomById.get(id)!.position))
  const inspectionTargets: InspectionTarget[] = [
    ...(bounds ? [{
      id: 'openmm-identity-overview',
      reason: 'Inspect the complete structure whose explicit OpenMM residue identity was assigned',
      center: bounds.center,
      radius: Math.max(1.5, bounds.radius + 0.5),
      atomIds: structure.atoms.slice(0, 80).map((atom) => atom.id),
      atomIdsTruncated: structure.atoms.length > 80,
    }] : []),
    ...(firstResidueBounds ? [{
      id: 'openmm-first-residue',
      reason: `Inspect first assigned residue ${normalizedResidues[0].chainId}:${normalizedResidues[0].residueName}${normalizedResidues[0].residueId}`,
      center: firstResidueBounds.center,
      radius: Math.max(1.5, firstResidueBounds.radius + 0.5),
      atomIds: firstResidueIds.slice(0, 80),
      atomIdsTruncated: firstResidueIds.length > 80,
    }] : []),
  ]
  const checks: ValidationCheck[] = [
    {
      id: 'openmm_identity.explicit_topology',
      status: 'pass',
      message: `Preserved ${sourceBonds.length} explicit bonds; ${externalBondCount} cross residue boundaries`,
      metrics: { bondCount: sourceBonds.length, externalBondCount },
    },
    {
      id: 'openmm_identity.complete_coverage',
      status: 'pass',
      message: `Assigned all ${structure.atoms.length} atoms across ${normalizedResidues.length} ordered residue block(s)`,
      metrics: { atomCount: structure.atoms.length, residueCount: normalizedResidues.length },
    },
    {
      id: 'openmm_identity.contiguous_blocks',
      status: 'pass',
      message: `Residue and chain assignments exactly follow canonical source atom order across ${new Set(normalizedResidues.map((residue) => residue.chainId)).size} chain block(s)`,
    },
    {
      id: 'openmm_identity.unique_atom_names',
      status: 'pass',
      message: 'Every assigned atom name is unique inside its residue',
    },
    {
      id: 'openmm_identity.formal_charge_coverage',
      status: hasCompleteIntegerCharges ? 'pass' : hasAnyCharge ? 'fail' : 'skipped',
      message: hasCompleteIntegerCharges
        ? `Complete integer formal charges sum to ${formalCharge}`
        : hasAnyCharge
          ? 'Formal charge annotations are partial or non-integer; OpenMM preparation requires all or none'
          : 'No atom formal charges were supplied; downstream expectedTotalCharge must be checked against force-field charges',
      metrics: { formalCharge },
    },
    {
      id: 'openmm_identity.geometry_topology_preserved',
      status: 'pass',
      message: 'Assignment changed no atom ID, element, Cartesian position, lattice, bond ID, endpoint, or order',
      metrics: { maximumDisplacementA: 0, changedBondCount: 0 },
    },
    {
      id: 'openmm_identity.template_scope',
      status: 'warn',
      message: 'This tool records an explicit identity map but does not prove that any registered force field has a matching residue template; run the OpenMM provider template/charge gates next',
    },
    ...validation.checks,
  ]
  const changeSet = buildStructureChangeSet(options.structure, structure)
  const provenance: StructureProvenance = {
    engine: 'zatom-openmm-identity-assignment',
    engineVersion: '1.0.0',
    sourceFingerprint: fingerprintStructure(options.structure),
    resultFingerprint: fingerprintStructure(structure),
    parameters: {
      residueCount: normalizedResidues.length,
      chainCount: new Set(normalizedResidues.map((residue) => residue.chainId)).size,
      externalBondCount,
      assignmentFingerprint: fingerprintStructure(structure),
    },
  }
  return {
    structure,
    validation,
    checks,
    changeSet,
    provenance,
    inspectionTargets,
    residues: normalizedResidues,
    externalBondCount,
    formalCharge,
  }
}

export function optimizeMoleculeGeometry(options: OptimizeMoleculeOptions): OptimizeMoleculeResult {
  const sourceValidation = validateStructure(options.structure)
  // A minimum-distance failure is precisely the kind of geometric defect this
  // cleanup can attempt to repair.  All schema/topology/lattice failures remain
  // blocking, and the optimized candidate is validated again before it can be
  // applied to a viewport.
  const blockingSourceChecks = sourceValidation.checks.filter((check) => (
    check.status === 'fail' && check.id !== 'structure.minimum_distance'
  ))
  if (blockingSourceChecks.length) {
    throw new MoleculeInputError(
      'invalid_source_structure',
      `Molecular cleanup requires a structurally valid source: ${blockingSourceChecks.map((check) => check.message).join('; ')}`,
    )
  }
  const sourceBonds = options.structure.bonds
  if (!sourceBonds) throw new MoleculeInputError('topology_required', 'Molecular cleanup requires explicit bonds')
  const maxIters = options.maxIters ?? 300
  if (!Number.isInteger(maxIters) || maxIters < 1 || maxIters > 2000) {
    throw new MoleculeInputError('invalid_iterations', 'maxIters must be an integer from 1 through 2000')
  }
  const fixedAtomIds = options.fixedAtomIds ?? []
  if (new Set(fixedAtomIds).size !== fixedAtomIds.length) throw new MoleculeInputError('duplicate_fixed_ids', 'fixedAtomIds must not contain duplicates')
  const availableIds = new Set(options.structure.atoms.map((atom) => atom.id))
  const missingIds = fixedAtomIds.filter((id) => !availableIds.has(id))
  if (missingIds.length) throw new MoleculeInputError('fixed_atoms_missing', `Fixed atom IDs are missing: ${missingIds.join(', ')}`)

  const optimized = quickOptimizeGeometry(
    options.structure.atoms.map((atom) => ({ id: atom.id, element: atom.element, cartesian: atom.position })),
    sourceBonds.map((bond) => ({
      atom1Id: bond.atomIds[0],
      atom2Id: bond.atomIds[1],
      type: orderName(bond.order),
    })),
    {
      ...(options.structure.lattice ? { latticeMatrix: options.structure.lattice.vectors } : {}),
      fixedIds: new Set(fixedAtomIds),
      maxIters,
    },
  )
  const structure: ZatomStructure = {
    ...options.structure,
    label: `${options.structure.label ?? 'molecule'} empirical cleanup`,
    atoms: options.structure.atoms.map((atom) => ({
      ...atom,
      position: [...optimized.positions[atom.id]] as Vec3,
    })),
    bonds: sourceBonds.map((bond) => ({ ...bond, atomIds: [...bond.atomIds] as [string, string] })),
  }
  const validation = validateStructure(structure)
  const topology = validateMolecularTopology(structure, {
    bondLengthToleranceFraction: options.bondLengthToleranceFraction,
  })
  const checks: ValidationCheck[] = [
    {
      id: 'molecule.empirical_cleanup_scope',
      status: 'warn',
      message: 'Geometry used deterministic spring/repulsion cleanup, not a chemistry force field or electronic-structure optimization; do not infer energy or stability',
    },
    {
      id: 'molecule.cleanup_clashes',
      status: optimized.stats.clashesAfter === 0 ? 'pass' : 'fail',
      message: `Nonbonded clashes changed from ${optimized.stats.clashesBefore} to ${optimized.stats.clashesAfter}`,
      metrics: { clashesBefore: optimized.stats.clashesBefore, clashesAfter: optimized.stats.clashesAfter },
    },
    {
      id: 'molecule.topology_preserved',
      status: 'pass',
      message: `Preserved all ${sourceBonds.length} explicit bonds and bond orders`,
      metrics: { bondCount: sourceBonds.length },
    },
    ...(structure.lattice ? [{
      id: 'molecule.periodic_cell_fixed',
      status: 'warn' as const,
      message: 'Minimum-image distances were used, but the periodic cell was not optimized',
    }] : []),
    ...validation.checks,
    ...topology.checks,
  ]
  const changeSet = buildStructureChangeSet(options.structure, structure)
  const provenance: StructureProvenance = {
    engine: 'zatom-empirical-molecule-cleanup',
    engineVersion: '1.0.0',
    sourceFingerprint: fingerprintStructure(options.structure),
    resultFingerprint: fingerprintStructure(structure),
    parameters: {
      maxIters,
      fixedAtomIds,
      bondLengthToleranceFraction: options.bondLengthToleranceFraction ?? 0.35,
      optimizerStats: optimized.stats as unknown as JsonValue,
    },
  }
  return {
    structure,
    validation,
    topology,
    checks,
    changeSet,
    provenance,
    inspectionTargets: [...topology.inspectionTargets, ...validation.inspectionTargets],
    stats: optimized.stats,
  }
}
