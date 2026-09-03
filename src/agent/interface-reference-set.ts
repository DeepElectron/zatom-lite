/** Exact same-cell reference partition for built or explicitly reconstructed interfaces. */

import type {
  InspectionTarget,
  JsonValue,
  Mat3,
  StructureChangeSet,
  StructureProvenance,
  ValidationCheck,
  Vec3,
  ZatomStructure,
  ZatomStructureAtom,
  ZatomStructureBond,
} from './contracts'
import { ZATOM_STRUCTURE_SCHEMA } from './contracts'
import { buildStructureChangeSet } from './operations'
import { boundsOfPositions, fingerprintCanonicalJson, fingerprintStructure } from './structure-math'
import { parseZatomStructure, validateStructure } from './structure-validation'

export const ZATOM_INTERFACE_REFERENCE_SET_SCHEMA = 'zatom.interface-reference-set/v1' as const
export const ZATOM_INTERFACE_REFERENCE_SCHEMA = 'zatom.interface-reference/v2' as const

type InterfaceLayer = 'bottom' | 'top'

export interface PartitionInterfaceReferenceSetOptions {
  interfaceStructure: ZatomStructure
}

export interface PartitionInterfaceReferenceSetResult {
  structure: ZatomStructure
  referenceStructures: { bottom: ZatomStructure; top: ZatomStructure }
  referenceFingerprints: { bottom: string; top: string }
  referenceSetFingerprint: string
  seedInterfaceFingerprint: string
  constructionFingerprint: string
  validation: ReturnType<typeof validateStructure>
  checks: ValidationCheck[]
  changeSet: StructureChangeSet
  provenance: StructureProvenance
  inspectionTargets: InspectionTarget[]
  metrics: {
    bottomAtomCount: number
    topAtomCount: number
    bottomInternalBondCount: number
    topInternalBondCount: number
    omittedCrossInterfaceBondCount: number
  }
}

export class InterfaceReferenceSetInputError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'InterfaceReferenceSetInputError'
    this.code = code
  }
}

function cloneAtom(atom: ZatomStructureAtom): ZatomStructureAtom {
  return {
    ...atom,
    position: [...atom.position] as Vec3,
    ...(atom.properties ? { properties: { ...atom.properties } } : {}),
  }
}

function cloneBond(bond: ZatomStructureBond): ZatomStructureBond {
  return {
    ...bond,
    atomIds: [...bond.atomIds] as [string, string],
    ...(bond.properties ? { properties: { ...bond.properties } } : {}),
  }
}

function cloneLattice(lattice: NonNullable<ZatomStructure['lattice']>): NonNullable<ZatomStructure['lattice']> {
  return {
    vectors: lattice.vectors.map((vector) => [...vector] as Vec3) as Mat3,
    periodic: [...lattice.periodic] as [boolean, boolean, boolean],
  }
}

function interfaceMetadata(structure: ZatomStructure): Record<string, JsonValue> {
  const metadata = structure.metadata?.['zatom.interface']
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)
    || metadata.schemaVersion !== 'zatom.interface/v1') {
    throw new InterfaceReferenceSetInputError(
      'interface_reference_construction_required',
      'interfaceStructure must carry canonical zatom.interface/v1 construction metadata',
    )
  }
  return metadata
}

function requiredText(value: JsonValue | undefined, field: string): string {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0') || value.length > 256) {
    throw new InterfaceReferenceSetInputError('invalid_interface_reference_metadata', `${field} must be non-empty bounded text`)
  }
  return value.trim()
}

function atomLayer(atom: ZatomStructureAtom): InterfaceLayer | null {
  const layer = atom.properties?.['zatom.interfaceLayer']
  return layer === 'bottom' || layer === 'top' ? layer : null
}

function withoutReferenceSetMetadata(structure: ZatomStructure): ZatomStructure {
  const metadata = Object.fromEntries(
    Object.entries(structure.metadata ?? {}).filter(([key]) => key !== 'zatom.interfaceReferenceSet'),
  ) as Record<string, JsonValue>
  return {
    ...structure,
    ...(Object.keys(metadata).length ? { metadata } : { metadata: undefined }),
  }
}

function referenceLabel(
  interfaceStructure: ZatomStructure,
  metadata: Record<string, JsonValue>,
  role: InterfaceLayer,
): string {
  const declared = metadata[role === 'bottom' ? 'bottomLabel' : 'topLabel']
  const source = typeof declared === 'string' && declared.trim() ? declared.trim() : role
  return `${source} isolated reference for ${interfaceStructure.label ?? 'interface'}`
}

/**
 * Partition one current interface hypothesis into exact bottom/top same-cell references.
 * Every atom must declare its layer. Cross-interface bonds are intentionally absent from
 * isolated references; every layer-internal bond is preserved exactly.
 */
export function partitionInterfaceReferenceSet(
  options: PartitionInterfaceReferenceSetOptions,
): PartitionInterfaceReferenceSetResult {
  const source = parseZatomStructure(options.interfaceStructure)
  if (!source.lattice || !source.lattice.periodic.every(Boolean)) {
    throw new InterfaceReferenceSetInputError(
      'interface_reference_fixed_cell_required',
      'interfaceStructure must declare one fully periodic cell for same-cell reference partitioning',
    )
  }
  const metadata = interfaceMetadata(source)
  const constructionFingerprint = requiredText(metadata.constructionFingerprint, 'constructionFingerprint')
  const unclassified = source.atoms.filter((atom) => atomLayer(atom) === null)
  if (unclassified.length) {
    throw new InterfaceReferenceSetInputError(
      'interface_reference_layer_missing',
      `${unclassified.length} atom(s) lack properties.zatom.interfaceLayer=bottom|top: ${unclassified.slice(0, 8).map((atom) => atom.id).join(', ')}`,
    )
  }
  const bottomAtoms = source.atoms.filter((atom) => atomLayer(atom) === 'bottom').map(cloneAtom)
  const topAtoms = source.atoms.filter((atom) => atomLayer(atom) === 'top').map(cloneAtom)
  if (!bottomAtoms.length || !topAtoms.length) {
    throw new InterfaceReferenceSetInputError(
      'interface_reference_empty_layer',
      `Both interface layers must remain non-empty (bottom=${bottomAtoms.length}, top=${topAtoms.length})`,
    )
  }

  const layers = new Map(source.atoms.map((atom) => [atom.id, atomLayer(atom) as InterfaceLayer]))
  const bottomBonds: ZatomStructureBond[] = []
  const topBonds: ZatomStructureBond[] = []
  const crossBonds: ZatomStructureBond[] = []
  for (const bond of source.bonds ?? []) {
    const first = layers.get(bond.atomIds[0])
    const second = layers.get(bond.atomIds[1])
    if (first === 'bottom' && second === 'bottom') bottomBonds.push(cloneBond(bond))
    else if (first === 'top' && second === 'top') topBonds.push(cloneBond(bond))
    else crossBonds.push(cloneBond(bond))
  }

  const seedInterface = withoutReferenceSetMetadata(source)
  const seedInterfaceFingerprint = fingerprintStructure(seedInterface)
  const referenceSetFingerprint = fingerprintCanonicalJson({
    schemaVersion: ZATOM_INTERFACE_REFERENCE_SET_SCHEMA,
    constructionFingerprint,
    seedInterfaceFingerprint,
    bottomAtomIds: bottomAtoms.map((atom) => atom.id),
    topAtomIds: topAtoms.map((atom) => atom.id),
    bottomInternalBondIds: bottomBonds.map((bond) => bond.id),
    topInternalBondIds: topBonds.map((bond) => bond.id),
    omittedCrossInterfaceBondIds: crossBonds.map((bond) => bond.id),
  })
  const referenceSetMetadata: Record<string, JsonValue> = {
    schemaVersion: ZATOM_INTERFACE_REFERENCE_SET_SCHEMA,
    referenceSetFingerprint,
    constructionFingerprint,
    seedInterfaceFingerprint,
    partitionProperty: 'zatom.interfaceLayer',
    bottomAtomCount: bottomAtoms.length,
    topAtomCount: topAtoms.length,
    bottomInternalBondCount: bottomBonds.length,
    topInternalBondCount: topBonds.length,
    omittedCrossInterfaceBondCount: crossBonds.length,
  }
  const structure: ZatomStructure = {
    ...source,
    metadata: {
      ...(source.metadata ?? {}),
      'zatom.interfaceReferenceSet': referenceSetMetadata,
    },
  }
  const makeReference = (
    role: InterfaceLayer,
    atoms: ZatomStructureAtom[],
    bonds: ZatomStructureBond[],
  ): ZatomStructure => ({
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    label: referenceLabel(structure, metadata, role),
    lattice: cloneLattice(source.lattice!),
    atoms,
    ...(bonds.length ? { bonds } : {}),
    metadata: {
      'zatom.interfaceReference': {
        schemaVersion: ZATOM_INTERFACE_REFERENCE_SCHEMA,
        constructionFingerprint,
        referenceSetFingerprint,
        seedInterfaceFingerprint,
        role,
        counterpartRole: role === 'bottom' ? 'top' : 'bottom',
      },
    },
  })
  const referenceStructures = {
    bottom: makeReference('bottom', bottomAtoms, bottomBonds),
    top: makeReference('top', topAtoms, topBonds),
  }
  const referenceFingerprints = {
    bottom: fingerprintStructure(referenceStructures.bottom),
    top: fingerprintStructure(referenceStructures.top),
  }
  const validation = validateStructure(structure, { requirePeriodic: true })
  const bottomValidation = validateStructure(referenceStructures.bottom, { requirePeriodic: true })
  const topValidation = validateStructure(referenceStructures.top, { requirePeriodic: true })
  const checks: ValidationCheck[] = [
    {
      id: 'interface_reference.layer_partition',
      status: 'pass',
      message: `Partitioned every interface atom into ${bottomAtoms.length} bottom and ${topAtoms.length} top atoms`,
      metrics: { bottomAtomCount: bottomAtoms.length, topAtomCount: topAtoms.length },
    },
    {
      id: 'interface_reference.topology_partition',
      status: 'pass',
      message: `Preserved ${bottomBonds.length}+${topBonds.length} layer-internal bonds and omitted ${crossBonds.length} cross-interface bonds from isolated references`,
      metrics: {
        bottomInternalBondCount: bottomBonds.length,
        topInternalBondCount: topBonds.length,
        omittedCrossInterfaceBondCount: crossBonds.length,
      },
      ...(crossBonds.length ? { atomIds: [...new Set(crossBonds.flatMap((bond) => bond.atomIds))].slice(0, 80) } : {}),
    },
    {
      id: 'interface_reference.reference_set_binding',
      status: 'pass',
      message: `Bound the interface and both references to ${referenceSetFingerprint}`,
      metrics: { referenceSetFingerprint, constructionFingerprint, seedInterfaceFingerprint },
    },
    {
      id: 'interface_reference.reference_validation',
      status: bottomValidation.verdict === 'fail' || topValidation.verdict === 'fail' ? 'fail' : 'pass',
      message: bottomValidation.verdict === 'fail' || topValidation.verdict === 'fail'
        ? 'At least one isolated same-cell reference fails canonical structure validation'
        : 'Both isolated same-cell references pass canonical structure validation',
      metrics: { bottomVerdict: bottomValidation.verdict, topVerdict: topValidation.verdict },
    },
    {
      id: 'interface_reference.model_scope',
      status: 'warn',
      message: 'This operation partitions an explicit geometry/topology hypothesis only; it does not infer reconstruction, termination, bond formation, relaxation, model applicability, adhesion, or stability',
    },
    ...validation.checks,
  ]
  const bounds = boundsOfPositions(source.atoms.map((atom) => atom.position))
  const inspectionTargets: InspectionTarget[] = bounds ? [{
    id: 'interface-reference-set',
    reason: 'Inspect the exact reconstructed interface hypothesis used to derive isolated references',
    center: bounds.center,
    radius: Math.max(2, bounds.radius),
    atomIds: source.atoms.slice(0, 256).map((atom) => atom.id),
    ...(source.atoms.length > 256 ? { atomIdsTruncated: true } : {}),
  }] : []
  inspectionTargets.push(...validation.inspectionTargets)
  const changeSet = buildStructureChangeSet(source, structure)
  const provenance: StructureProvenance = {
    engine: 'zatom-interface-reference-partition',
    engineVersion: '1.0.0',
    sourceFingerprint: fingerprintStructure(source),
    resultFingerprint: fingerprintStructure(structure),
    parameters: {
      constructionFingerprint,
      referenceSetFingerprint,
      seedInterfaceFingerprint,
      bottomReferenceFingerprint: referenceFingerprints.bottom,
      topReferenceFingerprint: referenceFingerprints.top,
      omittedCrossInterfaceBondCount: crossBonds.length,
    },
  }
  return {
    structure,
    referenceStructures,
    referenceFingerprints,
    referenceSetFingerprint,
    seedInterfaceFingerprint,
    constructionFingerprint,
    validation,
    checks,
    changeSet,
    provenance,
    inspectionTargets,
    metrics: {
      bottomAtomCount: bottomAtoms.length,
      topAtomCount: topAtoms.length,
      bottomInternalBondCount: bottomBonds.length,
      topInternalBondCount: topBonds.length,
      omittedCrossInterfaceBondCount: crossBonds.length,
    },
  }
}
