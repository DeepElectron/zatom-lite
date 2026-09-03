import { assertEqual, assertTrue } from '../../testing/assert'
import type { Vec3, ZatomStructure } from '../contracts'
import {
  composeZatomFixedCellRelaxationEvidence,
  fingerprintFixedCellRelaxationEvidence,
  fingerprintLammpsPotentialCommands,
  type ZatomFixedCellRelaxationEvidence,
} from '../fixed-cell-relaxation-evidence'
import { callZatomMcpTool } from '../mcp-adapter'
import {
  buildBalancedPeriodicDislocationReference,
  composeZatomPeriodicDislocationRelaxationEvidence,
  fingerprintPeriodicDislocationRelaxationEvidence,
  type ZatomPeriodicDislocationRelaxationEvidence,
} from '../periodic-dislocation-relaxation-evidence'
import {
  composeZatomPeriodicDislocationDipoleEvidence,
  fingerprintPeriodicDislocationDipoleEvidence,
  PERIODIC_DISLOCATION_PROBE_FRACTIONS,
  type ZatomPeriodicDislocationDipoleEvidence,
} from '../periodic-dislocation-dipole-evidence'
import type { ZatomPeriodicDislocationRelaxationSeriesCaseContext } from '../periodic-dislocation-relaxation-series'
import { cartesianToFractional, determinant3, fingerprintStructure, fractionalToCartesian } from '../structure-math'
import {
  fingerprintPeriodicDislocationCoreEvidence,
  type ZatomPeriodicDislocationCoreEvidence,
} from '../periodic-dislocation-core-evidence'

const source: ZatomStructure = {
  schemaVersion: 'zatom.structure/v1',
  label: 'synthetic primitive Fe source',
  atoms: [{ id: 'source-fe', element: 'Fe', position: [0, 0, 0] }],
  lattice: { vectors: [[2, 0, 0], [0, 2, 0], [0, 0, 2]], periodic: [true, true, true] },
}

const referenceCell: NonNullable<ZatomStructure['lattice']> = {
  vectors: [[2, 0, 0], [0, 8, 4], [0, 0, 8]],
  periodic: [true, true, true],
}

const seedCell: NonNullable<ZatomStructure['lattice']> = {
  vectors: [[2, 0, 0], [-1, 8, 4], [0, 0, 8]],
  periodic: [true, true, true],
}

const reference: ZatomStructure = {
  schemaVersion: 'zatom.structure/v1',
  label: 'synthetic perfect oriented reference',
  atoms: [
    { id: 'periodic-dipole-000001', element: 'Fe', position: [0, 0, 0] },
    { id: 'periodic-dipole-000002', element: 'Fe', position: fractionalToCartesian([0.5, 0.5, 0.5], referenceCell.vectors) },
  ],
  lattice: referenceCell,
}

const seed: ZatomStructure = {
  schemaVersion: 'zatom.structure/v1',
  label: 'synthetic periodic screw dipole seed',
  atoms: [
    { id: 'periodic-dipole-000001', element: 'Fe', position: [0, 0, 0] },
    { id: 'periodic-dipole-000002', element: 'Fe', position: fractionalToCartesian([0.5, 0.5, 0.5], seedCell.vectors) },
  ],
  lattice: seedCell,
}

function seedEvidence(shiftIndex = 0): ZatomPeriodicDislocationDipoleEvidence {
  const zero: Vec3 = [0, 0, 0]
  const seamRows = ([0, 1, 2] as const).flatMap((axis) => PERIODIC_DISLOCATION_PROBE_FRACTIONS.map((fractionalPointA, probeIndex) => {
    const pointA = fractionalToCartesian(fractionalPointA, referenceCell.vectors)
    return {
      axis,
      probeIndex,
      fractionalPointA: [...fractionalPointA] as Vec3,
      pointA,
      pointB: [
        pointA[0] + referenceCell.vectors[axis][0],
        pointA[1] + referenceCell.vectors[axis][1],
        pointA[2] + referenceCell.vectors[axis][2],
      ] as Vec3,
      displacementA: [...zero] as Vec3,
      displacementB: [...zero] as Vec3,
      residualVectorA: [...zero] as Vec3,
      residualA: 0,
    }
  }))
  const convergenceRows = PERIODIC_DISLOCATION_PROBE_FRACTIONS.map((fractionalPointA, probeIndex) => ({
    probeIndex,
    fractionalPointA: [...fractionalPointA] as Vec3,
    pointA: fractionalToCartesian(fractionalPointA, referenceCell.vectors),
    currentDisplacementA: [...zero] as Vec3,
    comparisonDisplacementA: [...zero] as Vec3,
    gaugeCorrectedDifferenceA: [...zero] as Vec3,
    residualA: 0,
  }))
  return composeZatomPeriodicDislocationDipoleEvidence({
    sourceStructure: source,
    referenceStructure: reference,
    resultStructure: seed,
    elasticity: {
      model: 'anisotropic-linear-elasticity',
      coordinateFrame: 'source-cell-cartesian',
      voigtOrder: ['xx', 'yy', 'zz', 'yz', 'xz', 'xy'],
      stiffnessMatrixGPa: [
        [200, 100, 100, 0, 0, 0],
        [100, 200, 100, 0, 0, 0],
        [100, 100, 200, 0, 0, 0],
        [0, 0, 0, 50, 0, 0],
        [0, 0, 0, 0, 50, 0],
        [0, 0, 0, 0, 0, 50],
      ],
    },
    crystallography: {
      conventionalSetting: 'p',
      burgersMiller: [1, 0, 0],
      lineMiller: [1, 0, 0],
      slipPlaneMiller: [0, 1, 0],
      primitiveBurgersCoefficients: [1, 0, 0],
      rotatedBurgersVectorA: [2, 0, 0],
      rotatedLineUnitVector: [1, 0, 0],
      rotatedSlipPlaneNormalUnitVector: [0, 1, 0],
      mAxis: 'z',
      nAxis: 'y',
    },
    construction: {
      sizeMultipliers: [1, 4, 4],
      imageReplicaCount: 11,
      shiftIndex,
      atommanIndices: { motion: 2, cut: 1, line: 0 },
      cores: [
        { id: 'positive', sign: 1, positionA: fractionalToCartesian([0.5, 0.5, 0.25], seedCell.vectors) },
        { id: 'negative', sign: -1, positionA: fractionalToCartesian([0.5, 0.5, 0.75], seedCell.vectors) },
      ],
    },
    mapping: { mode: 'atomman-oriented-supercell-order' },
    periodicityProbes: { field: 'cai-regularized-volterra-displacement-before-balancing-strain', rows: seamRows },
    imageConvergence: {
      comparison: 'current-versus-two-fewer-image-replicas',
      rigidGaugeA: [0, 0, 0],
      rows: convergenceRows,
    },
    acceptance: {
      maximumTensorSymmetryResidualGPa: 1e-8,
      minimumStiffnessEigenvalueGPa: 1,
      maximumStiffnessConditionNumber: 100,
      maximumScrewCharacterAngleDeg: 1e-8,
      maximumSlipPlaneResidual: 1e-8,
      minimumTransverseCellVectorPerBurgers: 1,
      minimumCoreSeparationPerBurgers: 1,
      minimumCoreClearanceA: 0.1,
      maximumPeriodicSeamResidualA: 1e-8,
      maximumImageConvergenceDisplacementA: 1e-8,
      maximumBalancingPrincipalStrain: 1,
      maximumVolumeChangeFraction: 1e-8,
      maximumNonaffineDisplacementA: 1e-8,
      minimumPairDistanceA: 0.1,
    },
    provenance: {
      engine: 'atomman',
      engineVersion: 'fixture-1.5.2',
      dependencies: { numpyVersion: 'fixture', scipyVersion: 'fixture' },
      method: 'Synthetic periodic seed fixture',
      package: { realPath: '/opt/pinned/atomman', fileCount: 4, totalBytes: 1024, sha256: `sha256:${'a'.repeat(64)}` },
      artifacts: [{ id: 'fixture', role: 'synthetic seed', fingerprint: `sha256:${'b'.repeat(64)}` }],
      parameters: { fixture: true },
      citations: ['https://doi.org/10.1080/0141861021000051109'],
      scopeWarning: 'Synthetic seed fixture.',
    },
  }).evidence
}

function relaxed(sourceStructure: ZatomStructure, displacementA: number, forceEvPerA: number, role: string): ZatomStructure {
  return {
    schemaVersion: 'zatom.structure/v1',
    label: `${role} relaxed`,
    atoms: sourceStructure.atoms.map((atom, index) => {
      const signedDisplacement = index === 0 ? displacementA : -displacementA
      const signedForce = index === 0 ? forceEvPerA : -forceEvPerA
      return {
        ...atom,
        position: [atom.position[0] + signedDisplacement, atom.position[1], atom.position[2]],
        properties: {
          ...(atom.properties ?? {}),
          'zatom.lammps.forceEvPerA': [signedForce, 0, 0],
          'zatom.lammps.forceMagnitudeEvPerA': Math.abs(signedForce),
        },
      }
    }),
    lattice: structuredClone(sourceStructure.lattice),
    metadata: {
      ...(sourceStructure.metadata ?? {}),
      'zatom.lammps.potential': 'fixture-fe',
      'zatom.lammps.potentialVersion': '1',
      'zatom.lammps.engineVersion': 'fixture-lammps',
      'zatom.lammps.geometricState': 'position-minimized-fixed-cell',
    },
  }
}

function fixedEvidence(
  sourceStructure: ZatomStructure,
  resultStructure: ZatomStructure,
  initialEnergyEv: number,
  finalEnergyEv: number,
  finalPressureBar: number,
): ZatomFixedCellRelaxationEvidence {
  const volumeA3 = Math.abs(determinant3(sourceStructure.lattice!.vectors))
  const stress = (pressureBar: number) => ({
    pressureBar,
    tensorBar: { xx: pressureBar + 10, yy: pressureBar, zz: pressureBar - 10, xy: 2, xz: -1, yz: 3 },
    volumeA3,
    quantity: 'pressure-tensor' as const,
    signConvention: 'positive-compression' as const,
    coordinateFrame: 'source-cartesian' as const,
  })
  return composeZatomFixedCellRelaxationEvidence({
    sourceStructure,
    resultStructure,
    method: {
      kind: 'position-minimization',
      cellConstraint: 'fixed',
      temperatureK: 0,
      engine: 'LAMMPS',
      engineVersion: 'fixture-lammps',
    },
    model: {
      id: 'fixture-fe',
      version: '1',
      description: 'Synthetic Fe pair potential',
      elements: ['Fe'],
      commandsFingerprint: fingerprintLammpsPotentialCommands(['pair_style zero 10.0']),
      artifacts: [],
      citations: [],
      scopeWarning: 'Synthetic potential fixture.',
    },
    settings: {
      maxIterations: 100,
      maxEvaluations: 1000,
      energyTolerance: 1e-10,
      forceToleranceEvPerA: 1e-6,
      minStyle: 'cg',
      fixedAtomIds: [],
    },
    observations: {
      initial: {
        potentialEnergyEv: initialEnergyEv,
        reportedMaxForceComponentRestrictedEvPerA: 0.1,
        step: 0,
        stress: stress(finalPressureBar + 100),
      },
      final: {
        potentialEnergyEv: finalEnergyEv,
        reportedMaxForceComponentRestrictedEvPerA: 0.005,
        step: 7,
        stress: stress(finalPressureBar),
      },
    },
    acceptance: {
      maximumEnergyIncreaseEv: 1e-9,
      maximumForceEvPerA: 0.01,
      maximumDisplacementA: 0.2,
      maximumFixedAtomDisplacementA: 0,
      minimumPairDistanceA: 0.1,
    },
    provenance: {
      providerId: 'test.fixture-lammps',
      adapterVersion: '1.4.0',
      executable: { realPath: '/opt/pinned/lmp', totalBytes: 1024, sha256: `sha256:${'c'.repeat(64)}` },
      parameters: { matchedFixture: true },
      citations: ['https://docs.lammps.org/minimize.html'],
      scopeWarning: 'Synthetic matched relaxation fixture.',
    },
  }).evidence
}

function syntheticCoreFixture(): {
  sourceStructure: ZatomStructure
  seedStructure: ZatomStructure
  relaxedDefectStructure: ZatomStructure
  relaxedReferenceStructure: ZatomStructure
  seedEvidence: ZatomPeriodicDislocationDipoleEvidence
  defectRelaxationEvidence: ZatomFixedCellRelaxationEvidence
  referenceRelaxationEvidence: ZatomFixedCellRelaxationEvidence
  relaxationEvidence: ZatomPeriodicDislocationRelaxationEvidence
} {
  const grid = 8
  const gridSource: ZatomStructure = {
    schemaVersion: 'zatom.structure/v1',
    label: 'synthetic two-site line source',
    atoms: [
      { id: 'source-line-0', element: 'Fe', position: [0, 0, 0] },
      { id: 'source-line-1', element: 'Fe', position: [1, 0, 0] },
    ],
    lattice: { vectors: [[2, 0, 0], [0, 2, 0], [0, 0, 2]], periodic: [true, true, true] },
  }
  const gridReferenceCell: NonNullable<ZatomStructure['lattice']> = {
    vectors: [[2, 0, 0], [0, 16, 8], [0, 0, 16]],
    periodic: [true, true, true],
  }
  const gridSeedCell: NonNullable<ZatomStructure['lattice']> = {
    vectors: [[2, 0, 0], [-1, 16, 8], [0, 0, 16]],
    periodic: [true, true, true],
  }
  const wrapAngle = (value: number): number => {
    let wrapped = value - 2 * Math.PI * Math.floor((value + Math.PI) / (2 * Math.PI))
    if (wrapped <= -Math.PI) wrapped += 2 * Math.PI
    return wrapped
  }
  const planarAngle = (u: number, v: number, coreU: number, coreV: number): number => {
    const deltaU = u - coreU
    const deltaV = v - coreV
    // This matches the canonical basis: projected motion is +x2D and cut is -y2D.
    return Math.atan2(-16 * deltaV, 16 * deltaU + 8 * deltaV)
  }
  const referenceAtoms: ZatomStructure['atoms'] = []
  const seedAtoms: ZatomStructure['atoms'] = []
  let atomIndex = 0
  for (let motion = 0; motion < grid; motion++) for (let cut = 0; cut < grid; cut++) for (let line = 0; line < 2; line++) {
    const fractional: Vec3 = [line / 2, (cut + 0.5) / grid, (motion + 0.5) / grid]
    const id = `periodic-dipole-${String(++atomIndex).padStart(6, '0')}`
    referenceAtoms.push({ id, element: 'Fe', position: fractionalToCartesian(fractional, gridReferenceCell.vectors) })
    const phase = wrapAngle(
      planarAngle(fractional[2], fractional[1], 0.25, 0.5)
      - planarAngle(fractional[2], fractional[1], 0.75, 0.5),
    )
    const position = fractionalToCartesian(fractional, gridSeedCell.vectors)
    position[0] += 2 * phase / (2 * Math.PI)
    const seedFractional = cartesianToFractional(position, gridSeedCell.vectors)!
    for (let axis = 0; axis < 3; axis++) seedFractional[axis] -= Math.floor(seedFractional[axis])
    seedAtoms.push({ id, element: 'Fe', position: fractionalToCartesian(seedFractional, gridSeedCell.vectors) })
  }
  const gridReference: ZatomStructure = {
    schemaVersion: 'zatom.structure/v1',
    label: 'synthetic perfect 8x8 line-column reference',
    atoms: referenceAtoms,
    lattice: gridReferenceCell,
  }
  const gridSeed: ZatomStructure = {
    schemaVersion: 'zatom.structure/v1',
    label: 'synthetic +1/-1 periodic screw phase seed',
    atoms: seedAtoms,
    lattice: gridSeedCell,
  }
  const zero: Vec3 = [0, 0, 0]
  const seamRows = ([0, 1, 2] as const).flatMap((axis) => PERIODIC_DISLOCATION_PROBE_FRACTIONS.map((fractionalPointA, probeIndex) => {
    const pointA = fractionalToCartesian(fractionalPointA, gridReferenceCell.vectors)
    return {
      axis,
      probeIndex,
      fractionalPointA: [...fractionalPointA] as Vec3,
      pointA,
      pointB: [
        pointA[0] + gridReferenceCell.vectors[axis][0],
        pointA[1] + gridReferenceCell.vectors[axis][1],
        pointA[2] + gridReferenceCell.vectors[axis][2],
      ] as Vec3,
      displacementA: [...zero] as Vec3,
      displacementB: [...zero] as Vec3,
      residualVectorA: [...zero] as Vec3,
      residualA: 0,
    }
  }))
  const convergenceRows = PERIODIC_DISLOCATION_PROBE_FRACTIONS.map((fractionalPointA, probeIndex) => ({
    probeIndex,
    fractionalPointA: [...fractionalPointA] as Vec3,
    pointA: fractionalToCartesian(fractionalPointA, gridReferenceCell.vectors),
    currentDisplacementA: [...zero] as Vec3,
    comparisonDisplacementA: [...zero] as Vec3,
    gaugeCorrectedDifferenceA: [...zero] as Vec3,
    residualA: 0,
  }))
  const gridSeedEvidence = composeZatomPeriodicDislocationDipoleEvidence({
    sourceStructure: gridSource,
    referenceStructure: gridReference,
    resultStructure: gridSeed,
    elasticity: {
      model: 'anisotropic-linear-elasticity',
      coordinateFrame: 'source-cell-cartesian',
      voigtOrder: ['xx', 'yy', 'zz', 'yz', 'xz', 'xy'],
      stiffnessMatrixGPa: [
        [200, 100, 100, 0, 0, 0],
        [100, 200, 100, 0, 0, 0],
        [100, 100, 200, 0, 0, 0],
        [0, 0, 0, 50, 0, 0],
        [0, 0, 0, 0, 50, 0],
        [0, 0, 0, 0, 0, 50],
      ],
    },
    crystallography: {
      conventionalSetting: 'p',
      burgersMiller: [1, 0, 0],
      lineMiller: [1, 0, 0],
      slipPlaneMiller: [0, 1, 0],
      primitiveBurgersCoefficients: [1, 0, 0],
      rotatedBurgersVectorA: [2, 0, 0],
      rotatedLineUnitVector: [1, 0, 0],
      rotatedSlipPlaneNormalUnitVector: [0, 1, 0],
      mAxis: 'z',
      nAxis: 'y',
    },
    construction: {
      sizeMultipliers: [1, grid, grid],
      imageReplicaCount: 11,
      shiftIndex: 0,
      atommanIndices: { motion: 2, cut: 1, line: 0 },
      cores: [
        { id: 'positive', sign: 1, positionA: fractionalToCartesian([0.5, 0.5, 0.25], gridSeedCell.vectors) },
        { id: 'negative', sign: -1, positionA: fractionalToCartesian([0.5, 0.5, 0.75], gridSeedCell.vectors) },
      ],
    },
    mapping: { mode: 'atomman-oriented-supercell-order' },
    periodicityProbes: { field: 'cai-regularized-volterra-displacement-before-balancing-strain', rows: seamRows },
    imageConvergence: {
      comparison: 'current-versus-two-fewer-image-replicas',
      rigidGaugeA: [0, 0, 0],
      rows: convergenceRows,
    },
    acceptance: {
      maximumTensorSymmetryResidualGPa: 1e-8,
      minimumStiffnessEigenvalueGPa: 1,
      maximumStiffnessConditionNumber: 100,
      maximumScrewCharacterAngleDeg: 1e-8,
      maximumSlipPlaneResidual: 1e-8,
      minimumTransverseCellVectorPerBurgers: 1,
      minimumCoreSeparationPerBurgers: 1,
      minimumCoreClearanceA: 0,
      maximumPeriodicSeamResidualA: 1e-8,
      maximumImageConvergenceDisplacementA: 1e-8,
      maximumBalancingPrincipalStrain: 1,
      maximumVolumeChangeFraction: 1e-8,
      maximumNonaffineDisplacementA: 2,
      minimumPairDistanceA: 0,
    },
    provenance: {
      engine: 'atomman',
      engineVersion: 'synthetic-core-fixture',
      dependencies: { numpyVersion: 'fixture', scipyVersion: 'fixture' },
      method: 'Synthetic periodic +1/-1 phase fixture',
      package: { realPath: '/opt/pinned/atomman', fileCount: 4, totalBytes: 1024, sha256: `sha256:${'d'.repeat(64)}` },
      artifacts: [{ id: 'synthetic-core-field', role: 'deterministic test field', fingerprint: `sha256:${'e'.repeat(64)}` }],
      parameters: { grid },
      citations: ['https://www.ctcms.nist.gov/potentials/atomman/tutorial/4.10_Differential_Displacement_Maps.html'],
      scopeWarning: 'Synthetic phase-field contract fixture.',
    },
  }, { maxOutputAtoms: 512 }).evidence
  const balancedReference = buildBalancedPeriodicDislocationReference(gridSeedEvidence, gridSeed)
  const markRelaxed = (structure: ZatomStructure, role: string): ZatomStructure => ({
    schemaVersion: 'zatom.structure/v1',
    label: `${role} unchanged relaxed fixture`,
    atoms: structure.atoms.map((atom, index) => ({
      ...atom,
      position: [...atom.position],
      properties: {
        'zatom.lammps.forceEvPerA': [index % 2 ? -0.005 : 0.005, 0, 0],
        'zatom.lammps.forceMagnitudeEvPerA': 0.005,
      },
    })),
    lattice: structuredClone(structure.lattice),
    metadata: {
      'zatom.lammps.potential': 'fixture-fe',
      'zatom.lammps.potentialVersion': '1',
      'zatom.lammps.engineVersion': 'fixture-lammps',
      'zatom.lammps.geometricState': 'position-minimized-fixed-cell',
    },
  })
  const relaxedDefectStructure = markRelaxed(gridSeed, 'defect')
  const relaxedReferenceStructure = markRelaxed(balancedReference, 'reference')
  const defectRelaxationEvidence = fixedEvidence(gridSeed, relaxedDefectStructure, -8.8, -9, 120)
  const referenceRelaxationEvidence = fixedEvidence(balancedReference, relaxedReferenceStructure, -9.8, -10, 20)
  const relaxationEvidence = composeZatomPeriodicDislocationRelaxationEvidence({
    sourceStructure: gridSource,
    seedStructure: gridSeed,
    relaxedDefectStructure,
    relaxedReferenceStructure,
    seedEvidence: gridSeedEvidence,
    defectRelaxationEvidence,
    referenceRelaxationEvidence,
    acceptance: {
      maximumFinalForceEvPerA: 0.01,
      maximumReferenceRelaxationDisplacementA: 0.01,
      maximumDefectRelaxationDisplacementA: 0.01,
      maximumDifferentialDisplacementA: 2,
      minimumPairDistanceA: 0,
    },
    provenance: {
      method: 'Synthetic matched pair for topological core evidence',
      artifacts: [
        { id: 'periodic-dislocation-seed-evidence', role: 'seed', fingerprint: fingerprintPeriodicDislocationDipoleEvidence(gridSeedEvidence) },
        { id: 'defect-fixed-cell-relaxation-evidence', role: 'defect', fingerprint: fingerprintFixedCellRelaxationEvidence(defectRelaxationEvidence) },
        { id: 'reference-fixed-cell-relaxation-evidence', role: 'reference', fingerprint: fingerprintFixedCellRelaxationEvidence(referenceRelaxationEvidence) },
        { id: 'balanced-perfect-reference', role: 'balanced reference', fingerprint: fingerprintStructure(balancedReference) },
      ],
      parameters: { fixture: 'periodic-core' },
      citations: ['https://docs.lammps.org/minimize.html'],
      scopeWarning: 'Synthetic core localization fixture.',
    },
  }).evidence
  return {
    sourceStructure: gridSource,
    seedStructure: gridSeed,
    relaxedDefectStructure,
    relaxedReferenceStructure,
    seedEvidence: gridSeedEvidence,
    defectRelaxationEvidence,
    referenceRelaxationEvidence,
    relaxationEvidence,
  }
}

function scaledFixture(multiplier: number, shiftIndex = 0): {
  seedStructure: ZatomStructure
  seedArtifact: ZatomPeriodicDislocationDipoleEvidence
} {
  const scaledReferenceCell: NonNullable<ZatomStructure['lattice']> = {
    vectors: [[2, 0, 0], [0, 2 * multiplier, multiplier], [0, 0, 2 * multiplier]],
    periodic: [true, true, true],
  }
  const scaledSeedCell: NonNullable<ZatomStructure['lattice']> = {
    vectors: [[2, 0, 0], [-1, 2 * multiplier, multiplier], [0, 0, 2 * multiplier]],
    periodic: [true, true, true],
  }
  const scaledReference: ZatomStructure = {
    schemaVersion: 'zatom.structure/v1',
    label: `scaled perfect reference ${multiplier}`,
    atoms: [
      { id: 'periodic-dipole-000001', element: 'Fe', position: [0, 0, 0] },
      { id: 'periodic-dipole-000002', element: 'Fe', position: fractionalToCartesian([0.5, 0.5, 0.5], scaledReferenceCell.vectors) },
    ],
    lattice: scaledReferenceCell,
  }
  const scaledSeed: ZatomStructure = {
    schemaVersion: 'zatom.structure/v1',
    label: `scaled periodic seed ${multiplier}`,
    atoms: [
      { id: 'periodic-dipole-000001', element: 'Fe', position: [0, 0, 0] },
      { id: 'periodic-dipole-000002', element: 'Fe', position: fractionalToCartesian([0.5, 0.5, 0.5], scaledSeedCell.vectors) },
    ],
    lattice: scaledSeedCell,
  }
  const base = seedEvidence(shiftIndex)
  const zero: Vec3 = [0, 0, 0]
  const seamRows = ([0, 1, 2] as const).flatMap((axis) => PERIODIC_DISLOCATION_PROBE_FRACTIONS.map((fractionalPointA, probeIndex) => {
    const pointA = fractionalToCartesian(fractionalPointA, scaledReferenceCell.vectors)
    return {
      axis,
      probeIndex,
      fractionalPointA: [...fractionalPointA] as Vec3,
      pointA,
      pointB: [
        pointA[0] + scaledReferenceCell.vectors[axis][0],
        pointA[1] + scaledReferenceCell.vectors[axis][1],
        pointA[2] + scaledReferenceCell.vectors[axis][2],
      ] as Vec3,
      displacementA: [...zero] as Vec3,
      displacementB: [...zero] as Vec3,
      residualVectorA: [...zero] as Vec3,
      residualA: 0,
    }
  }))
  const convergenceRows = PERIODIC_DISLOCATION_PROBE_FRACTIONS.map((fractionalPointA, probeIndex) => ({
    probeIndex,
    fractionalPointA: [...fractionalPointA] as Vec3,
    pointA: fractionalToCartesian(fractionalPointA, scaledReferenceCell.vectors),
    currentDisplacementA: [...zero] as Vec3,
    comparisonDisplacementA: [...zero] as Vec3,
    gaugeCorrectedDifferenceA: [...zero] as Vec3,
    residualA: 0,
  }))
  const seedArtifact = composeZatomPeriodicDislocationDipoleEvidence({
    sourceStructure: source,
    referenceStructure: scaledReference,
    resultStructure: scaledSeed,
    elasticity: base.elasticity,
    crystallography: {
      conventionalSetting: base.crystallography.conventionalSetting,
      burgersMiller: base.crystallography.burgersMiller,
      lineMiller: base.crystallography.lineMiller,
      slipPlaneMiller: base.crystallography.slipPlaneMiller,
      primitiveBurgersCoefficients: base.crystallography.primitiveBurgersCoefficients,
      rotatedBurgersVectorA: base.crystallography.rotatedBurgersVectorA,
      rotatedLineUnitVector: base.crystallography.rotatedLineUnitVector,
      rotatedSlipPlaneNormalUnitVector: base.crystallography.rotatedSlipPlaneNormalUnitVector,
      mAxis: base.crystallography.mAxis,
      nAxis: base.crystallography.nAxis,
    },
    construction: {
      sizeMultipliers: [1, multiplier, multiplier],
      imageReplicaCount: 11,
      shiftIndex,
      atommanIndices: base.construction.atommanIndices,
      cores: [
        { id: 'positive', sign: 1, positionA: fractionalToCartesian([0.5, 0.5, 0.25], scaledSeedCell.vectors) },
        { id: 'negative', sign: -1, positionA: fractionalToCartesian([0.5, 0.5, 0.75], scaledSeedCell.vectors) },
      ],
    },
    mapping: { mode: 'atomman-oriented-supercell-order' },
    periodicityProbes: { field: 'cai-regularized-volterra-displacement-before-balancing-strain', rows: seamRows },
    imageConvergence: {
      comparison: 'current-versus-two-fewer-image-replicas',
      rigidGaugeA: [0, 0, 0],
      rows: convergenceRows,
    },
    acceptance: base.acceptance,
    provenance: {
      ...base.provenance,
      parameters: { fixture: true, sizeMultipliers: [1, multiplier, multiplier], shiftIndex },
    },
  }).evidence
  return { seedStructure: scaledSeed, seedArtifact }
}

function pairCase(
  id: string,
  fixture: { seedStructure: ZatomStructure; seedArtifact: ZatomPeriodicDislocationDipoleEvidence },
  defectFinalEnergyEv: number,
  defectPressureBar = 120,
): ZatomPeriodicDislocationRelaxationSeriesCaseContext {
  const balancedReference = buildBalancedPeriodicDislocationReference(fixture.seedArtifact, fixture.seedStructure)
  const relaxedDefect = relaxed(fixture.seedStructure, 0.05, 0.005, `${id} defect`)
  const relaxedReference = relaxed(balancedReference, 0.01, 0.005, `${id} reference`)
  const defectEvidence = fixedEvidence(fixture.seedStructure, relaxedDefect, defectFinalEnergyEv + 0.2, defectFinalEnergyEv, defectPressureBar)
  const referenceEvidence = fixedEvidence(balancedReference, relaxedReference, -9.8, -10, 20)
  const seedFingerprint = fingerprintPeriodicDislocationDipoleEvidence(fixture.seedArtifact)
  const defectFingerprint = fingerprintFixedCellRelaxationEvidence(defectEvidence)
  const referenceFingerprint = fingerprintFixedCellRelaxationEvidence(referenceEvidence)
  const pairEvidence = composeZatomPeriodicDislocationRelaxationEvidence({
    sourceStructure: source,
    seedStructure: fixture.seedStructure,
    relaxedDefectStructure: relaxedDefect,
    relaxedReferenceStructure: relaxedReference,
    seedEvidence: fixture.seedArtifact,
    defectRelaxationEvidence: defectEvidence,
    referenceRelaxationEvidence: referenceEvidence,
    acceptance: {
      maximumFinalForceEvPerA: 0.01,
      maximumReferenceRelaxationDisplacementA: 0.1,
      maximumDefectRelaxationDisplacementA: 0.1,
      maximumDifferentialDisplacementA: 0.1,
      minimumPairDistanceA: 0.1,
    },
    provenance: {
      method: 'Synthetic matched pair for relaxation-series contract',
      artifacts: [
        { id: 'periodic-dislocation-seed-evidence', role: 'seed', fingerprint: seedFingerprint },
        { id: 'defect-fixed-cell-relaxation-evidence', role: 'defect', fingerprint: defectFingerprint },
        { id: 'reference-fixed-cell-relaxation-evidence', role: 'reference', fingerprint: referenceFingerprint },
        { id: 'balanced-perfect-reference', role: 'balanced reference', fingerprint: fingerprintStructure(balancedReference) },
      ],
      parameters: { fixture: id },
      citations: ['https://docs.lammps.org/minimize.html'],
      scopeWarning: 'Synthetic pair fixture.',
    },
  }).evidence
  return {
    id,
    pairEvidence,
    sourceStructure: source,
    seedStructure: fixture.seedStructure,
    relaxedDefectStructure: relaxedDefect,
    relaxedReferenceStructure: relaxedReference,
    seedEvidence: fixture.seedArtifact,
    defectRelaxationEvidence: defectEvidence,
    referenceRelaxationEvidence: referenceEvidence,
  }
}

async function testPrepareComposeReplayAndTamper(): Promise<void> {
  const seedArtifact = seedEvidence()
  const balancedReference = buildBalancedPeriodicDislocationReference(seedArtifact, seed)
  const relaxedDefect = relaxed(seed, 0.05, 0.005, 'defect')
  const relaxedReference = relaxed(balancedReference, 0.01, 0.005, 'reference')
  const defectEvidence = fixedEvidence(seed, relaxedDefect, -8.8, -9, 120)
  const referenceEvidence = fixedEvidence(balancedReference, relaxedReference, -9.8, -10, 20)

  const prepared = await callZatomMcpTool('periodic_dislocation_prepare_relaxation_reference', {
    sourceStructure: source,
    seedStructure: seed,
    useActiveSeed: false,
    seedEvidence: seedArtifact,
    applyToWorkspace: false,
  })
  assertTrue(prepared.structuredContent.ok, prepared.structuredContent.summary)

  const shared = {
    sourceStructure: source,
    seedStructure: seed,
    relaxedDefectStructure: relaxedDefect,
    relaxedReferenceStructure: relaxedReference,
    seedEvidence: seedArtifact,
    defectRelaxationEvidence: defectEvidence,
    referenceRelaxationEvidence: referenceEvidence,
  }
  const composed = await callZatomMcpTool('periodic_dislocation_compose_relaxation_evidence', {
    ...shared,
    maximumFinalForceEvPerA: 0.01,
    maximumReferenceRelaxationDisplacementA: 0.1,
    maximumDefectRelaxationDisplacementA: 0.1,
    maximumDifferentialDisplacementA: 0.1,
    minimumPairDistanceA: 0.1,
  })
  assertTrue(composed.structuredContent.ok, composed.structuredContent.summary)
  const data = composed.structuredContent.data as { evidence: ZatomPeriodicDislocationRelaxationEvidence }
  const evidence = data.evidence
  assertEqual(evidence.metrics.acceptancePassed, true)
  assertTrue(Math.abs(evidence.metrics.cellExcessPotentialEnergyEv - 1) < 1e-12)
  assertTrue(Math.abs(evidence.metrics.maximumDifferentialDisplacementA - 0.04) < 1e-12)

  const replay = await callZatomMcpTool('periodic_dislocation_validate_relaxation_evidence', {
    evidence,
    ...shared,
  })
  assertTrue(replay.structuredContent.ok, replay.structuredContent.summary)
  const replayData = replay.structuredContent.data as { fingerprint: string }
  assertEqual(replayData.fingerprint, fingerprintPeriodicDislocationRelaxationEvidence(evidence))

  const tampered = structuredClone(evidence)
  tampered.metrics.cellExcessPotentialEnergyEv += 0.5
  const rejected = await callZatomMcpTool('periodic_dislocation_validate_relaxation_evidence', {
    evidence: tampered,
    ...shared,
  })
  assertEqual(rejected.structuredContent.ok, false)

  const parameterMismatchedReferenceEvidence = structuredClone(referenceEvidence)
  parameterMismatchedReferenceEvidence.provenance.parameters.protocol = 'different-host-request'
  const mismatchedPair = await callZatomMcpTool('periodic_dislocation_compose_relaxation_evidence', {
    ...shared,
    referenceRelaxationEvidence: parameterMismatchedReferenceEvidence,
    maximumFinalForceEvPerA: 0.01,
    maximumReferenceRelaxationDisplacementA: 0.1,
    maximumDefectRelaxationDisplacementA: 0.1,
    maximumDifferentialDisplacementA: 0.1,
    minimumPairDistanceA: 0.1,
  })
  assertEqual(mismatchedPair.structuredContent.ok, false)
}

async function testPeriodicCoreComposeReplayAndTamper(): Promise<void> {
  const fixture = syntheticCoreFixture()
  const composed = await callZatomMcpTool('periodic_dislocation_compose_core_evidence', {
    ...fixture,
    neighborCutoffA: 2.5,
    signalRadiusA: 5,
    columnToleranceFractional: 1e-8,
    minimumColumnPhaseConcentration: 0.999999,
    minimumPhaseBranchMarginRad: 0,
    maximumWindingResidual: 1e-10,
    maximumCoreShiftA: 5,
    maximumLocalizationResolutionA: 5,
    minimumNeighborCount: 1,
    minimumCoreDifferentialDisplacementSignalA: 0.01,
    maximumSignalCenterShiftA: 5,
    maximumSignalRmsRadiusA: 8,
  })
  assertTrue(composed.structuredContent.ok, composed.structuredContent.summary)
  const data = composed.structuredContent.data as {
    evidence: ZatomPeriodicDislocationCoreEvidence
    fingerprint: string
    inspectionTargets: Array<{ id: string }>
  }
  assertEqual(data.evidence.cores[0].observedWindingCharge, 1)
  assertEqual(data.evidence.cores[1].observedWindingCharge, -1)
  assertEqual(data.evidence.metrics.netWindingCharge, 0)
  assertEqual(data.evidence.metrics.totalAbsoluteWindingCharge, 2)
  assertEqual(data.evidence.metrics.columnCount, 64)
  assertTrue(data.evidence.metrics.differentialDisplacementBondCount > 0)
  assertTrue(data.inspectionTargets.some((target) => target.id === 'periodic-dislocation-core-positive'))
  assertTrue(data.inspectionTargets.some((target) => target.id === 'periodic-dislocation-core-negative'))
  assertTrue(data.inspectionTargets.some((target) => target.id === 'periodic-dislocation-core-maximum-dd-bond'))

  const replay = await callZatomMcpTool('periodic_dislocation_validate_core_evidence', {
    evidence: data.evidence,
    ...fixture,
  })
  assertTrue(replay.structuredContent.ok, replay.structuredContent.summary)
  assertEqual(data.fingerprint, fingerprintPeriodicDislocationCoreEvidence(data.evidence))

  const tampered = structuredClone(data.evidence)
  tampered.cores[0].topologicalCenterA[0] += 0.25
  const rejected = await callZatomMcpTool('periodic_dislocation_validate_core_evidence', {
    evidence: tampered,
    ...fixture,
  })
  assertEqual(rejected.structuredContent.ok, false)
  assertEqual(rejected.structuredContent.error?.code, 'periodic_dislocation_core_derived_mismatch')

  const budgetRejected = await callZatomMcpTool('periodic_dislocation_compose_core_evidence', {
    ...fixture,
    maxPairCandidates: 100,
  })
  assertEqual(budgetRejected.structuredContent.ok, false)
  assertEqual(budgetRejected.structuredContent.error?.code, 'periodic_dislocation_core_budget_exceeded')
}

async function testSampledShiftAndFiniteCellSeries(): Promise<void> {
  const shiftCases = [
    pairCase('shift-0', scaledFixture(4, 0), -9),
    pairCase('shift-1', scaledFixture(4, 1), -9.1),
    pairCase('shift-2', scaledFixture(4, 2), -8.9),
  ]
  const shiftResponse = await callZatomMcpTool('periodic_dislocation_compose_relaxation_series', {
    kind: 'shift-scan-at-fixed-cell',
    cases: shiftCases,
    selectedCaseId: 'shift-1',
    selectionMethod: 'minimum-excess-energy',
    selectionRationale: 'Lowest matched excess potential energy among the three explicitly sampled shifts.',
    minimumCaseCount: 3,
    applyToWorkspace: false,
  })
  assertTrue(shiftResponse.structuredContent.ok, shiftResponse.structuredContent.summary)
  const shiftData = shiftResponse.structuredContent.data as {
    result: { seriesEvidence: import('../periodic-dislocation-relaxation-series').ZatomPeriodicDislocationRelaxationSeriesEvidence }
  }
  const shiftSeries = shiftData.result.seriesEvidence
  assertEqual(shiftSeries.metrics.acceptancePassed, true)
  assertEqual(shiftSeries.selection.selectedCaseId, 'shift-1')
  assertTrue(Math.abs(shiftSeries.metrics.sampledExcessEnergySpreadEvPerA - 0.05) < 1e-12)
  const shiftReplay = await callZatomMcpTool('periodic_dislocation_validate_relaxation_series', {
    evidence: shiftSeries,
    cases: shiftCases,
    applyToWorkspace: false,
  })
  assertTrue(shiftReplay.structuredContent.ok, shiftReplay.structuredContent.summary)

  const mismatchedRuntimeFixture = scaledFixture(4, 2)
  mismatchedRuntimeFixture.seedArtifact.provenance.engineVersion = 'different-atomman-runtime'
  const mismatchedRuntimeSeries = await callZatomMcpTool('periodic_dislocation_compose_relaxation_series', {
    kind: 'shift-scan-at-fixed-cell',
    cases: [shiftCases[0], shiftCases[1], pairCase('shift-runtime-mismatch', mismatchedRuntimeFixture, -8.9)],
    selectedCaseId: 'shift-1',
    selectionMethod: 'minimum-excess-energy',
    selectionRationale: 'This series must be rejected before selection because the Atomman runtime differs.',
    minimumCaseCount: 3,
    applyToWorkspace: false,
  })
  assertEqual(mismatchedRuntimeSeries.structuredContent.ok, false)

  const sizeCases = [
    pairCase('size-4', scaledFixture(4, 0), -9),
    pairCase('size-5', scaledFixture(5, 0), -8.98),
    pairCase('size-6', scaledFixture(6, 0), -8.975),
  ]
  const sizeResponse = await callZatomMcpTool('periodic_dislocation_compose_relaxation_series', {
    kind: 'cell-size-at-fixed-shift',
    cases: sizeCases,
    selectedCaseId: 'size-6',
    selectionMethod: 'largest-transverse-cell',
    selectionRationale: 'Use the largest accepted transverse cell after checking largest-two sampled observable drift.',
    minimumCaseCount: 3,
    minimumLargestTransverseCellVectorPerBurgers: 3,
    maximumLargestPairExcessEnergyDriftEvPerA: 0.01,
    maximumLargestPairCoreAnchorRmsDriftA: 0.01,
    maximumLargestPairStressDifferenceDriftBar: 1,
    applyToWorkspace: false,
  })
  assertTrue(sizeResponse.structuredContent.ok, sizeResponse.structuredContent.summary)
  const sizeData = sizeResponse.structuredContent.data as {
    result: { seriesEvidence: import('../periodic-dislocation-relaxation-series').ZatomPeriodicDislocationRelaxationSeriesEvidence }
  }
  const sizeSeries = sizeData.result.seriesEvidence
  assertEqual(sizeSeries.metrics.acceptancePassed, true)
  assertEqual(sizeSeries.metrics.largestPairCaseIds?.[1], 'size-6')
  assertTrue((sizeSeries.metrics.largestPairExcessEnergyDriftEvPerA ?? 1) < 0.01)

  const tampered = structuredClone(sizeSeries)
  tampered.metrics.largestPairExcessEnergyDriftEvPerA = 0
  const rejected = await callZatomMcpTool('periodic_dislocation_validate_relaxation_series', {
    evidence: tampered,
    cases: sizeCases,
    applyToWorkspace: false,
  })
  assertEqual(rejected.structuredContent.ok, false)
}

Promise.all([
  testPrepareComposeReplayAndTamper(),
  testPeriodicCoreComposeReplayAndTamper(),
  testSampledShiftAndFiniteCellSeries(),
])
  .then(() => console.log('agent periodic-dislocation relaxation evidence tests passed'))
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
