import { assertDeepEqual, assertEqual, assertTrue } from '../testing/assert'
import { analyzeCoordinationEnvironments, convexHull3D } from '../lib/crystal/polyhedra'
import type { Atom } from '../lib/crystal/types'
import { createCrystalStore } from '../orchestration/crystalStore'

type Vec3 = [number, number, number]

function atom(id: string, element: string, pos: Vec3): Atom {
  return { id, element, position: pos, cartesian: pos }
}

function testOctahedralCoordinationIsDetectedFromGeometry() {
  const atoms: Atom[] = [
    atom('Pt0', 'Pt', [0, 0, 0]),
    atom('O1', 'O', [2, 0, 0]),
    atom('O2', 'O', [-2, 0, 0]),
    atom('O3', 'O', [0, 2, 0]),
    atom('O4', 'O', [0, -2, 0]),
    atom('O5', 'O', [0, 0, 2]),
    atom('O6', 'O', [0, 0, -2]),
  ]
  const analysis = analyzeCoordinationEnvironments(atoms)
  assertEqual(analysis.environments.length, 1)
  assertEqual(analysis.environments[0].centralAtomId, 'Pt0')
  assertEqual(analysis.environments[0].coordinationNumber, 6)
  assertEqual(analysis.environments[0].geometry, 'octahedral')
  assertEqual(analysis.environments[0].faces.length, 8)
  assertDeepEqual([...analysis.environments[0].vertexAtomIds].sort(), ['O1', 'O2', 'O3', 'O4', 'O5', 'O6'])
  assertEqual(analysis.summary.recognizedRegionCount, 1)
}

function testPairCutoffOverrideAndAllowlistAreDistinct() {
  const atoms: Atom[] = [
    atom('Pt0', 'Pt', [0, 0, 0]),
    atom('O1', 'O', [2, 0, 0]),
    atom('O2', 'O', [-2, 0, 0]),
    atom('O3', 'O', [0, 2, 0]),
    atom('O4', 'O', [0, -2, 0]),
    atom('O5', 'O', [0, 0, 2]),
    atom('O6', 'O', [0, 0, -2]),
  ]
  const overrideOnly = analyzeCoordinationEnvironments(atoms, { pairCutoffs: { 'N-Pt': 2.5 } })
  assertEqual(overrideOnly.environments.length, 1, 'a cutoff override must not implicitly exclude unlisted ligand pairs')
  const allowlist = analyzeCoordinationEnvironments(atoms, {
    pairCutoffs: { 'N-Pt': 2.5 },
    restrictToConfiguredPairs: true,
  })
  assertEqual(allowlist.environments.length, 0, 'an explicit pair allowlist must exclude unlisted ligand pairs')
  const emptyAllowlist = analyzeCoordinationEnvironments(atoms, {
    pairCutoffs: {},
    restrictToConfiguredPairs: true,
  })
  assertEqual(emptyAllowlist.environments.length, 0, 'an empty explicit pair allowlist must exclude every ligand pair')
}

function testTetrahedralCoordinationIsDetectedWithoutBonds() {
  const s = 1.09 / Math.sqrt(3)
  const atoms: Atom[] = [
    atom('C0', 'C', [0, 0, 0]),
    atom('H1', 'H', [s, s, s]),
    atom('H2', 'H', [-s, -s, s]),
    atom('H3', 'H', [-s, s, -s]),
    atom('H4', 'H', [s, -s, -s]),
  ]
  const analysis = analyzeCoordinationEnvironments(atoms)
  assertEqual(analysis.environments.length, 1)
  assertEqual(analysis.environments[0].geometry, 'tetrahedral')
  assertEqual(analysis.environments[0].faces.length, 4)
}

function testSquarePlanarRegionGetsDrawableFaces() {
  const atoms: Atom[] = [
    atom('Pd0', 'Pd', [0, 0, 0]),
    atom('Cl1', 'Cl', [2.2, 0, 0]),
    atom('Cl2', 'Cl', [-2.2, 0, 0]),
    atom('Cl3', 'Cl', [0, 2.2, 0]),
    atom('Cl4', 'Cl', [0, -2.2, 0]),
  ]
  const analysis = analyzeCoordinationEnvironments(atoms)
  assertEqual(analysis.environments.length, 1)
  assertEqual(analysis.environments[0].geometry, 'square-planar')
  assertEqual(analysis.environments[0].faces.length, 2)
  assertEqual(analysis.summary.drawableRegionCount, 1)
}

function testCoordinationBelowThreeIsSkipped() {
  const atoms: Atom[] = [
    atom('C0', 'C', [0, 0, 0]),
    atom('H1', 'H', [0, 0, 1.09]),
    atom('H2', 'H', [0, 1.09, 0]),
  ]
  const analysis = analyzeCoordinationEnvironments(atoms)
  assertEqual(analysis.environments.length, 0)
}

function testCentralElementFilterIsCanonical() {
  const atoms: Atom[] = [
    atom('Pt0', 'Pt', [0, 0, 0]),
    atom('Pd0', 'Pd', [10, 0, 0]),
    atom('O1', 'O', [2, 0, 0]),
    atom('O2', 'O', [-2, 0, 0]),
    atom('O3', 'O', [0, 2, 0]),
    atom('O4', 'O', [0, -2, 0]),
    atom('O5', 'O', [0, 0, 2]),
    atom('O6', 'O', [0, 0, -2]),
    atom('O7', 'O', [12, 0, 0]),
    atom('O8', 'O', [8, 0, 0]),
    atom('O9', 'O', [10, 2, 0]),
  ]
  const analysis = analyzeCoordinationEnvironments(atoms, { centralElements: new Set(['Pt']) })
  assertEqual(analysis.summary.analyzedCenterCount, 1)
  assertEqual(analysis.environments.length, 1)
  assertEqual(analysis.environments[0].centralAtomId, 'Pt0')
}

function testPeriodicNeighboursUseNearestCellImages() {
  const atoms: Atom[] = [
    atom('M0', 'Pt', [0.2, 0.2, 0.2]),
    atom('O1', 'O', [9.2, 0.2, 0.2]),
    atom('O2', 'O', [0.2, 9.2, 0.2]),
    atom('O3', 'O', [0.2, 0.2, 9.2]),
    atom('O4', 'O', [1.2, 1.2, 1.2]),
  ]
  const analysis = analyzeCoordinationEnvironments(atoms, {
    periodicLatticeVectors: {
      a: [10, 0, 0],
      b: [0, 10, 0],
      c: [0, 0, 10],
    },
  })

  assertEqual(analysis.environments.length, 1)
  assertEqual(analysis.environments[0].faces.length, 4)
  for (const vertex of analysis.environments[0].vertices) {
    const distance = Math.hypot(
      vertex[0] - analysis.environments[0].centralPosition[0],
      vertex[1] - analysis.environments[0].centralPosition[1],
      vertex[2] - analysis.environments[0].centralPosition[2],
    )
    assertTrue(distance < 2, `periodic neighbour should be local; got ${distance.toFixed(3)} Å`)
  }
}

function testPrimitiveCellRecoversSelfImages() {
  const analysis = analyzeCoordinationEnvironments(
    [atom('C0', 'C', [0, 0, 0])],
    {
      centralElements: new Set(['C']),
      periodicLatticeVectors: {
        a: [2, 0, 0],
        b: [0, 2, 0],
        c: [0, 0, 2],
      },
    },
  )
  assertEqual(analysis.environments.length, 1)
  assertEqual(analysis.environments[0].coordinationNumber, 6)
  assertEqual(analysis.environments[0].geometry, 'octahedral')
}

function testMetalsArePreferredAsAutomaticCenters() {
  const s = 2 / Math.sqrt(3)
  const atoms: Atom[] = [
    atom('Cu0', 'Cu', [0, 0, 0]),
    atom('N1', 'N', [s, s, s]),
    atom('N2', 'N', [-s, -s, s]),
    atom('N3', 'N', [-s, s, -s]),
    atom('N4', 'N', [s, -s, -s]),
    atom('C1', 'C', [5, 0, 0]),
    atom('C2', 'C', [6.4, 0, 0]),
  ]
  const analysis = analyzeCoordinationEnvironments(atoms)
  assertEqual(analysis.summary.analyzedCenterCount, 1)
  assertEqual(analysis.environments.length, 1)
  assertEqual(analysis.environments[0].centralElement, 'Cu')
}

function testConvexHull3DCubeCorners() {
  const pts: Vec3[] = [
    [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0],
    [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
  ]
  const faces = convexHull3D(pts)
  assertTrue(
    faces.length === 12 || faces.length === 24,
    `cube hull expected 12 or 24 triangles; got ${faces.length}`,
  )
}

async function testMigratedTemplateCoordinationRules() {
  const expectedCenters: Record<string, number> = {
    sbs6: 2,
    perovskite: 8,
    rutile: 16,
  }
  for (const [templateId, centerCount] of Object.entries(expectedCenters)) {
    const store = createCrystalStore()
    const loaded = await store.getState().loadTemplate(templateId)
    assertTrue(loaded.success, `${templateId} must load before coordination analysis`)
    const state = store.getState()
    const analysis = analyzeCoordinationEnvironments(state.atoms, {
      centralElements: state.polyhedraCentralElements,
      pairCutoffs: state.bondSettings.elementPairRadii,
      restrictToConfiguredPairs: state.bondSettings.restrictToConfiguredPairs,
      periodicLatticeVectors: {
        a: state.latticeVectors.a.map((value) => value * state.supercellParams.nx) as Vec3,
        b: state.latticeVectors.b.map((value) => value * state.supercellParams.ny) as Vec3,
        c: state.latticeVectors.c.map((value) => value * state.supercellParams.nz) as Vec3,
      },
    })
    assertEqual(analysis.summary.analyzedCenterCount, centerCount, `${templateId} center count`)
    assertEqual(analysis.environments.length, centerCount, `${templateId} drawable coordination count`)
    for (const environment of analysis.environments) {
      assertEqual(environment.coordinationNumber, 6, `${templateId} centers must stay six-coordinate`)
      assertEqual(environment.geometry, 'octahedral', `${templateId} centers must remain octahedral`)
    }
  }
}

async function run() {
  testOctahedralCoordinationIsDetectedFromGeometry()
  testPairCutoffOverrideAndAllowlistAreDistinct()
  testTetrahedralCoordinationIsDetectedWithoutBonds()
  testSquarePlanarRegionGetsDrawableFaces()
  testCoordinationBelowThreeIsSkipped()
  testCentralElementFilterIsCanonical()
  testPeriodicNeighboursUseNearestCellImages()
  testPrimitiveCellRecoversSelfImages()
  testMetalsArePreferredAsAutomaticCenters()
  testConvexHull3DCubeCorners()
  await testMigratedTemplateCoordinationRules()
  console.log('coordination polyhedra tests passed')
}

void run()
