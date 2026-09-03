import { assertEqual, assertTrue } from '../../testing/assert'
import type { ZatomStructure } from '../contracts'
import { ZATOM_STRUCTURE_SCHEMA } from '../contracts'
import {
  fingerprintForceFieldPackage,
  fingerprintForceFieldTopology,
  parseZatomForceFieldPackage,
  type ZatomForceFieldPackage,
  type ZatomForceFieldPackageValidation,
  ZatomForceFieldPackageInputError,
  ZATOM_FORCE_FIELD_PACKAGE_SCHEMA,
} from '../force-field-package'
import { callZatomMcpTool } from '../mcp-adapter'
import { ZATOM_PROVIDER_SCHEMA, type ZatomModelingProvider } from '../provider'
import { registerZatomModelingProvider } from '../provider-tools'
import { fingerprintStructure } from '../structure-math'

function methaneStructure(): ZatomStructure {
  return {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    label: 'explicit methane parameter target',
    atoms: [
      { id: 'c', element: 'C', position: [0, 0, 0], properties: { formalCharge: 0 } },
      { id: 'h1', element: 'H', position: [0.6293, 0.6293, 0.6293], properties: { formalCharge: 0 } },
      { id: 'h2', element: 'H', position: [-0.6293, -0.6293, 0.6293], properties: { formalCharge: 0 } },
      { id: 'h3', element: 'H', position: [-0.6293, 0.6293, -0.6293], properties: { formalCharge: 0 } },
      { id: 'h4', element: 'H', position: [0.6293, -0.6293, -0.6293], properties: { formalCharge: 0 } },
    ],
    bonds: [1, 2, 3, 4].map((index) => ({
      id: `c-h${index}`,
      atomIds: ['c', `h${index}`],
      order: 1,
    })),
  }
}

function methanePackage(structure: ZatomStructure): ZatomForceFieldPackage {
  const hydrogenPairs: Array<[string, string]> = []
  for (let left = 1; left <= 4; left++) {
    for (let right = left + 1; right <= 4; right++) hydrogenPairs.push([`h${left}`, `h${right}`])
  }
  return {
    schemaVersion: ZATOM_FORCE_FIELD_PACKAGE_SCHEMA,
    structureFingerprint: fingerprintStructure(structure),
    topologyFingerprint: fingerprintForceFieldTopology(structure),
    atomIds: structure.atoms.map((atom) => atom.id),
    template: { residueName: 'LIG', externalBondAtomIds: [] },
    nonbonded: {
      combiningRule: 'lorentz-berthelot',
      coulomb14Scale: 0.8333333333333334,
      lennardJones14Scale: 0.5,
      useDispersionCorrection: true,
    },
    atoms: structure.atoms.map((atom, index) => ({
      atomId: atom.id,
      element: atom.element,
      atomName: index === 0 ? 'C1' : `H${index}`,
      atomType: index === 0 ? 'test-C' : 'test-H',
      atomClass: index === 0 ? 'CT' : 'HC',
      massDa: index === 0 ? 12.011 : 1.008,
      partialChargeE: index === 0 ? -0.4 : 0.1,
      sigmaNm: index === 0 ? 0.339967 : 0.264953,
      epsilonKjMol: index === 0 ? 0.45773 : 0.06569,
    })),
    bonds: structure.bonds!.map((bond) => ({
      bondId: bond.id,
      atomIds: [...bond.atomIds],
      lengthNm: 0.109,
      kKjMolNm2: 284512,
    })),
    angles: hydrogenPairs.map(([left, right], index) => ({
      id: `angle-${index + 1}`,
      atomIds: [left, 'c', right],
      angleRad: 1.9106332362490186,
      kKjMolRad2: 313.8,
    })),
    properTorsions: [],
    improperTorsions: [],
    provenance: {
      engine: 'fixture-parameterizer',
      engineVersion: '1.0.0',
      method: 'explicit regression values',
      parameterizationFamily: 'AMBER-compatible regression fixture',
      chargeModel: 'fixture fixed charges',
      totalCharge: 0,
      citations: ['urn:zatom:test:fixture-parameterizer', 'urn:zatom:test:methane-parameters'],
      scopeWarning: 'Regression-only methane parameters are not a scientific recommendation.',
      sourceArtifacts: [{ label: 'fixture-input.sdf', sha256: 'a'.repeat(64) }],
    },
    metadata: { selectedState: 'methane-neutral' },
  }
}

function fourCarbonStructure(): ZatomStructure {
  return {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    atoms: [0, 1, 2, 3].map((index) => ({
      id: `c${index + 1}`,
      element: 'C',
      position: [index * 1.54, 0, 0],
      properties: { formalCharge: 0 },
    })),
    bonds: [0, 1, 2].map((index) => ({
      id: `b${index + 1}`,
      atomIds: [`c${index + 1}`, `c${index + 2}`],
      order: 1,
    })),
  }
}

function fourCarbonPackage(structure: ZatomStructure): ZatomForceFieldPackage {
  return {
    schemaVersion: ZATOM_FORCE_FIELD_PACKAGE_SCHEMA,
    structureFingerprint: fingerprintStructure(structure),
    topologyFingerprint: fingerprintForceFieldTopology(structure),
    atomIds: structure.atoms.map((atom) => atom.id),
    template: { residueName: 'LIN', externalBondAtomIds: [] },
    nonbonded: {
      combiningRule: 'lorentz-berthelot',
      coulomb14Scale: 0.8333333333333334,
      lennardJones14Scale: 0.5,
      useDispersionCorrection: true,
    },
    atoms: structure.atoms.map((atom, index) => ({
      atomId: atom.id,
      element: atom.element,
      atomName: `C${index + 1}`,
      atomType: 'linear-C',
      atomClass: 'CT',
      massDa: 12.011,
      partialChargeE: 0,
      sigmaNm: 0.34,
      epsilonKjMol: 0.45,
    })),
    bonds: structure.bonds!.map((bond) => ({
      bondId: bond.id,
      atomIds: [...bond.atomIds],
      lengthNm: 0.154,
      kKjMolNm2: 200000,
    })),
    angles: [
      { id: 'a1', atomIds: ['c1', 'c2', 'c3'], angleRad: 1.91, kKjMolRad2: 300 },
      { id: 'a2', atomIds: ['c2', 'c3', 'c4'], angleRad: 1.91, kKjMolRad2: 300 },
    ],
    properTorsions: [{
      id: 't1',
      atomIds: ['c1', 'c2', 'c3', 'c4'],
      terms: [{ periodicity: 3, phaseRad: 0, kKjMol: 0.5 }],
    }],
    improperTorsions: [],
    provenance: {
      engine: 'fixture-parameterizer',
      engineVersion: '1.0.0',
      method: 'linear topology regression',
      parameterizationFamily: 'test',
      chargeModel: 'zero',
      totalCharge: 0,
      citations: ['urn:zatom:test:linear'],
      scopeWarning: 'Topology-only regression fixture.',
      sourceArtifacts: [],
    },
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function expectPackageError(run: () => unknown, code: string) {
  let observed: unknown
  try {
    run()
  } catch (error) {
    observed = error
  }
  assertTrue(observed instanceof ZatomForceFieldPackageInputError)
  assertEqual((observed as ZatomForceFieldPackageInputError).code, code)
}

async function testCanonicalPackageValidationAndMcp() {
  const structure = methaneStructure()
  const raw = methanePackage(structure)
  const first = parseZatomForceFieldPackage(raw, { structure })
  const reordered = clone(raw)
  reordered.angles.reverse()
  reordered.provenance.citations.reverse()
  const second = parseZatomForceFieldPackage(reordered, { structure })
  assertEqual(first.fingerprint, second.fingerprint)
  assertEqual(first.bindingMode, 'exact-source')
  assertEqual(first.fingerprint, fingerprintForceFieldPackage(first.package))
  assertTrue(first.checks.every((check) => check.status !== 'fail'))
  assertTrue(first.checks.some((check) => check.id === 'force_field_package.bonded_coverage' && check.status === 'pass'))
  assertTrue(first.checks.some((check) => check.id === 'force_field_package.model_scope' && check.status === 'warn'))
  assertTrue(first.inspectionTargets.some((target) => target.id === 'force-field-package-largest-charge'))
  assertTrue(first.inspectionTargets.some((target) => target.id === 'force-field-package-largest-bond-deviation'))

  const response = await callZatomMcpTool('force_field_validate_package', {
    structure,
    package: reordered,
  })
  assertTrue(response.structuredContent.ok, response.structuredContent.summary)
  const data = response.structuredContent.data as ZatomForceFieldPackageValidation
  assertEqual(data.fingerprint, first.fingerprint)
  assertEqual(data.package.angles[0].atomIds.join('-'), 'h1-c-h2')

  const viaActive = await callZatomMcpTool('force_field_validate_package', { package: raw }, {
    readStructure: () => structure,
  })
  assertTrue(viaActive.structuredContent.ok, viaActive.structuredContent.summary)
}

function testFailuresAndProperCoverage() {
  const methane = methaneStructure()
  const chargeMismatch = clone(methanePackage(methane))
  chargeMismatch.atoms[0].partialChargeE = -0.3
  expectPackageError(
    () => parseZatomForceFieldPackage(chargeMismatch, { structure: methane }),
    'force_field_package_charge_mismatch',
  )

  const missingAngle = clone(methanePackage(methane))
  missingAngle.angles.pop()
  expectPackageError(
    () => parseZatomForceFieldPackage(missingAngle, { structure: methane }),
    'force_field_package_angle_coverage_mismatch',
  )

  const wrongFingerprint = clone(methanePackage(methane))
  wrongFingerprint.structureFingerprint = 'fnv1a64:0000000000000000'
  expectPackageError(
    () => parseZatomForceFieldPackage(wrongFingerprint, { structure: methane }),
    'force_field_package_structure_mismatch',
  )

  const movedMethane = clone(methane)
  movedMethane.atoms[0].position[0] += 0.1
  const compatible = parseZatomForceFieldPackage(methanePackage(methane), {
    structure: movedMethane,
    allowCompatibleGeometry: true,
  })
  assertEqual(compatible.bindingMode, 'topology-compatible')

  const reorderedTopology = clone(methane)
  reorderedTopology.bonds!.reverse()
  for (const bond of reorderedTopology.bonds!) bond.atomIds.reverse()
  assertEqual(fingerprintForceFieldTopology(reorderedTopology), fingerprintForceFieldTopology(methane))
  const reorderedCompatible = parseZatomForceFieldPackage(methanePackage(methane), {
    structure: reorderedTopology,
    allowCompatibleGeometry: true,
  })
  assertEqual(reorderedCompatible.bindingMode, 'topology-compatible')
  assertEqual(reorderedCompatible.fingerprint, parseZatomForceFieldPackage(methanePackage(methane), {
    structure: methane,
  }).fingerprint)
  assertEqual(reorderedCompatible.package.bonds[0].atomIds.join('-'), 'c-h1')

  const unrelatedMetadata = clone(movedMethane)
  unrelatedMetadata.atoms[0].properties!['zatom.note'] = 'geometry workflow annotation'
  assertEqual(fingerprintForceFieldTopology(unrelatedMetadata), fingerprintForceFieldTopology(methane))
  const changedChemicalIdentity = clone(movedMethane)
  changedChemicalIdentity.atoms[0].properties!['zatom.chemical.stereochemistry'] = 'R'
  expectPackageError(
    () => parseZatomForceFieldPackage(methanePackage(methane), {
      structure: changedChemicalIdentity,
      allowCompatibleGeometry: true,
    }),
    'force_field_package_topology_mismatch',
  )

  const changedTopology = clone(movedMethane)
  changedTopology.bonds![0].order = 2
  expectPackageError(
    () => parseZatomForceFieldPackage(methanePackage(methane), {
      structure: changedTopology,
      allowCompatibleGeometry: true,
    }),
    'force_field_package_topology_mismatch',
  )

  const chain = fourCarbonStructure()
  const complete = parseZatomForceFieldPackage(fourCarbonPackage(chain), { structure: chain })
  assertEqual(complete.package.properTorsions.length, 1)
  const missingProper = clone(fourCarbonPackage(chain))
  missingProper.properTorsions = []
  expectPackageError(
    () => parseZatomForceFieldPackage(missingProper, { structure: chain }),
    'force_field_package_proper_coverage_mismatch',
  )

  expectPackageError(
    () => parseZatomForceFieldPackage(methanePackage(methane), { structure: methane, maxAngles: 5 }),
    'force_field_package_budget_exceeded',
  )

  const trefoilImproper = clone(methanePackage(methane))
  trefoilImproper.improperTorsions = [
    {
      id: 'improper-1',
      atomIds: ['c', 'h1', 'h2', 'h3'],
      centralAtomId: 'c',
      terms: [{ periodicity: 2, phaseRad: Math.PI, kKjMol: 1 }],
    },
    {
      id: 'improper-2',
      atomIds: ['c', 'h3', 'h1', 'h2'],
      centralAtomId: 'c',
      terms: [{ periodicity: 1, phaseRad: 0, kKjMol: 2 }],
    },
    {
      id: 'improper-3',
      atomIds: ['c', 'h2', 'h3', 'h1'],
      centralAtomId: 'c',
      terms: [{ periodicity: 3, phaseRad: 0, kKjMol: 3 }],
    },
  ]
  const trefoilValidated = parseZatomForceFieldPackage(trefoilImproper, { structure: methane })
  assertEqual(trefoilValidated.package.improperTorsions.length, 3)

  const duplicateImproper = clone(trefoilImproper)
  duplicateImproper.improperTorsions[1].atomIds = ['c', 'h1', 'h2', 'h3']
  expectPackageError(
    () => parseZatomForceFieldPackage(duplicateImproper, { structure: methane }),
    'invalid_force_field_package',
  )

  const invalidSource = clone(methane)
  invalidSource.atoms[4].id = 'h3'
  expectPackageError(
    () => parseZatomForceFieldPackage(methanePackage(methane), { structure: invalidSource }),
    'invalid_force_field_package_source',
  )
}

async function testProviderArtifactContract() {
  const structure = methaneStructure()
  const forceFieldPackage = methanePackage(structure)
  const provider: ZatomModelingProvider = {
    manifest: {
      schemaVersion: ZATOM_PROVIDER_SCHEMA,
      id: 'test.parameter-package-provider',
      title: 'Parameter package fixture provider',
      description: 'Returns one canonical force-field package for broker contract regression.',
      adapterVersion: '1.0.0',
      engine: { name: 'fixture-parameterizer', version: '1.0.0' },
      execution: 'browser',
      capabilities: [{
        id: 'molecule.parameterize.fixture',
        title: 'Parameterize fixture molecule',
        description: 'Return complete fixed-charge regression parameters.',
        fidelity: 'force-field',
        source: 'required',
        deterministic: true,
        inputSchema: { type: 'object', additionalProperties: false },
        requiredCheckIds: ['fixture.parameterization'],
        outputArtifacts: ['force-field-package'],
        tags: ['molecule', 'ligand', 'parameterization'],
      }],
    },
    execute: () => ({
      structure,
      forceFieldPackage,
      checks: [{ id: 'fixture.parameterization', status: 'pass', message: 'Fixture parameters emitted.' }],
    }),
  }
  const unregister = registerZatomModelingProvider(provider)
  try {
    const response = await callZatomMcpTool('modeling_run_provider', {
      providerId: provider.manifest.id,
      capability: 'molecule.parameterize.fixture',
      structure,
      parameters: {},
      seed: 9,
      applyToWorkspace: false,
    })
    assertTrue(response.structuredContent.ok, response.structuredContent.summary)
    const data = response.structuredContent.data as {
      result: {
        forceFieldPackage: ZatomForceFieldPackage
        checks: Array<{ id: string; status: string }>
        provenance: { forceFieldPackageFingerprint: string }
      }
    }
    assertEqual(data.result.forceFieldPackage.schemaVersion, ZATOM_FORCE_FIELD_PACKAGE_SCHEMA)
    assertTrue(data.result.provenance.forceFieldPackageFingerprint.startsWith('fnv1a64:'))
    assertTrue(data.result.checks.some((check) => (
      check.id === 'provider.force_field_package_contract' && check.status === 'pass'
    )))
    assertTrue(data.result.checks.some((check) => (
      check.id === 'force_field_package.identity' && check.status === 'pass'
    )))
  } finally {
    unregister()
  }

  const missingArtifactProvider: ZatomModelingProvider = {
    ...provider,
    manifest: {
      ...provider.manifest,
      id: 'test.parameter-package-missing-artifact',
    },
    execute: () => ({
      structure,
      checks: [{ id: 'fixture.parameterization', status: 'pass', message: 'Incorrectly omitted package.' }],
    }),
  }
  const unregisterMissing = registerZatomModelingProvider(missingArtifactProvider)
  try {
    const response = await callZatomMcpTool('modeling_run_provider', {
      providerId: missingArtifactProvider.manifest.id,
      capability: 'molecule.parameterize.fixture',
      structure,
      parameters: {},
      applyToWorkspace: false,
    })
    assertEqual(response.structuredContent.ok, false)
    assertEqual(response.structuredContent.error?.code, 'invalid_provider_result')
  } finally {
    unregisterMissing()
  }

  let observedInputFingerprint: string | null = null
  const consumer: ZatomModelingProvider = {
    manifest: {
      schemaVersion: ZATOM_PROVIDER_SCHEMA,
      id: 'test.parameter-package-consumer',
      title: 'Parameter package fixture consumer',
      description: 'Consumes one broker-validated package input for regression.',
      adapterVersion: '1.0.0',
      engine: { name: 'fixture-consumer', version: '1.0.0' },
      execution: 'browser',
      capabilities: [{
        id: 'molecule.consume-parameters.fixture',
        title: 'Consume fixture parameters',
        description: 'Verify package input transport.',
        fidelity: 'force-field',
        source: 'required',
        deterministic: true,
        inputSchema: { type: 'object', additionalProperties: false },
        requiredCheckIds: ['fixture.package_consumed'],
        inputArtifacts: [{ artifact: 'force-field-package', mode: 'required' }],
        tags: ['molecule', 'force-field', 'package'],
      }],
    },
    execute: (request) => {
      observedInputFingerprint = request.forceFieldPackage?.fingerprint ?? null
      return {
        structure: request.source!,
        checks: [{ id: 'fixture.package_consumed', status: 'pass', message: 'Consumed package.' }],
      }
    },
  }
  const unregisterConsumer = registerZatomModelingProvider(consumer)
  try {
    const moved = clone(structure)
    moved.atoms[0].position[0] += 0.05
    const consumed = await callZatomMcpTool('modeling_run_provider', {
      providerId: consumer.manifest.id,
      capability: 'molecule.consume-parameters.fixture',
      structure: moved,
      forceFieldPackage,
      parameters: {},
      applyToWorkspace: false,
    })
    assertTrue(consumed.structuredContent.ok, consumed.structuredContent.summary)
    const data = consumed.structuredContent.data as {
      result: {
        checks: Array<{ id: string; status: string }>
        provenance: { inputForceFieldPackageFingerprint: string }
      }
    }
    const observed = observedInputFingerprint as string | null
    assertTrue(typeof observed === 'string' && observed.startsWith('fnv1a64:'))
    assertEqual(data.result.provenance.inputForceFieldPackageFingerprint, observed)
    assertTrue(data.result.checks.some((check) => (
      check.id === 'provider.force_field_package_input_contract' && check.status === 'pass'
    )))

    const missing = await callZatomMcpTool('modeling_run_provider', {
      providerId: consumer.manifest.id,
      capability: 'molecule.consume-parameters.fixture',
      structure,
      parameters: {},
      applyToWorkspace: false,
    })
    assertEqual(missing.structuredContent.ok, false)
    assertEqual(missing.structuredContent.error?.code, 'force_field_package_input_required')
  } finally {
    unregisterConsumer()
  }
}

async function main() {
  await testCanonicalPackageValidationAndMcp()
  testFailuresAndProperCoverage()
  await testProviderArtifactContract()
  console.log('agent force-field package tests passed')
}

void main()
