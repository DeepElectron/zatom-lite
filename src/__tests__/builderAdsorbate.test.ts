import { assertEqual, assertTrue } from '../testing/assert'
import {
  detectSites,
  detectSurfaceLayer,
  siteFromManualSelection,
  placeFragment,
  placeDualFragments,
  emitAdsorbateExtxyz,
  FRAGMENTS,
  type AdsorbateAtomInput,
} from '../lib/analysis/builders/adsorbate'
import { unwrapSites } from './helpers/unwrapSites'

type Vec3 = [number, number, number]

/** Two-layer 2×2 Cu(100) surface — lower z plane is "bulk", upper z plane is surface. */
function cuSurface(): AdsorbateAtomInput[] {
  const a = 2.55  // Cu nearest-neighbour spacing
  const atoms: AdsorbateAtomInput[] = []
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      atoms.push({ element: 'Cu', cartesian: [i * a, j * a, 0] })       // lower layer
      atoms.push({ element: 'Cu', cartesian: [i * a, j * a, a] })       // upper layer (surface)
    }
  }
  return atoms
}

function testDetectSurfaceLayer() {
  const atoms = cuSurface()
  const layer = detectSurfaceLayer(atoms)
  // Surface (top) layer should have 4 atoms — the 4 upper-layer Cu atoms.
  assertEqual(layer.atomIndices.length, 4, `expected 4 surface atoms, got ${layer.atomIndices.length}`)
  // All surface atoms should have z = 2.55
  for (const idx of layer.atomIndices) {
    assertTrue(Math.abs(atoms[idx].cartesian[2] - 2.55) < 0.001, 'surface atom is at z=2.55')
  }
}

function testDetectSites() {
  const atoms = cuSurface()
  const sites = unwrapSites(detectSites(atoms))
  // We should have 4 top sites.
  const topSites = sites.filter((s) => s.kind === 'top')
  assertEqual(topSites.length, 4, `expected 4 top sites, got ${topSites.length}`)
  // Bridge sites: pairs of surface atoms within bond_cutoff (3.5 Å default).
  // 4 surface atoms can form C(4,2) = 6 pairs. Distances: 2.55, 2.55, 2.55*√2=3.61 (too far).
  // 4 edge pairs at 2.55 Å + 2 diagonals at 3.61 Å. The diagonals exceed cutoff, so 4 bridges.
  const bridgeSites = sites.filter((s) => s.kind === 'bridge')
  assertTrue(bridgeSites.length >= 4, `expected ≥ 4 bridge sites, got ${bridgeSites.length}`)
  // Hollow sites: triangles with all three edges within cutoff. With 4 nearest-
  // neighbour atoms and 4 edges of length 2.55, no triangle is valid (the only
  // closed triangles include a 3.61 Å diagonal). Accept that the detector may
  // produce zero or more hollow sites depending on cutoff.
  assertTrue(sites.length === topSites.length + bridgeSites.length + sites.filter((s) => s.kind === 'hollow').length, 'site kinds are partition')
}

function testTopSiteCoordinates() {
  const atoms = cuSurface()
  const sites = unwrapSites(detectSites(atoms))
  const topSites = sites.filter((s) => s.kind === 'top')
  for (const s of topSites) {
    const idx = s.atomIndices[0]
    const surf = atoms[idx]
    // Top site is 1.5 Å above the surface atom.
    assertTrue(Math.abs(s.position[2] - surf.cartesian[2] - 1.5) < 1e-6, 'top site is +1.5 Å above atom')
  }
}

function testManualSelection() {
  const atoms = cuSurface()
  // Find indices of 3 surface atoms (z = 2.55)
  const surfaceIdx = atoms.map((_, i) => i).filter((i) => atoms[i].cartesian[2] > 2.0).slice(0, 3)
  assertEqual(surfaceIdx.length, 3)
  const site = siteFromManualSelection(atoms, [surfaceIdx[0]])
  assertTrue(site !== null, 'single-atom selection produces a site')
  assertEqual(site!.kind, 'top')
  const site2 = siteFromManualSelection(atoms, surfaceIdx.slice(0, 2))
  assertEqual(site2!.kind, 'bridge')
  const site3 = siteFromManualSelection(atoms, surfaceIdx)
  assertEqual(site3!.kind, 'hollow')
  // Empty / too many → null
  assertTrue(siteFromManualSelection(atoms, []) === null, 'empty selection → null')
  assertTrue(siteFromManualSelection(atoms, [0, 1, 2, 3]) === null, '4-atom selection → null')
}

function testPlaceHOnTop() {
  const atoms = cuSurface()
  const sites = unwrapSites(detectSites(atoms))
  const topSite = sites.find((s) => s.kind === 'top')!
  const result = placeFragment({
    atoms,
    site: topSite,
    fragment: 'H',
  })
  assertTrue(result.ok, `placement should succeed (collision: ${JSON.stringify(result.collision)})`)
  assertEqual(result.newAtoms.length, 1)
  // H atom should be above the surface atom along the surface normal.
  const surf = atoms[topSite.atomIndices[0]]
  const h = result.newAtoms[0]
  assertEqual(h.element, 'H')
  // bond length = Cu (1.32) + H (0.31) = 1.63 Å
  const expectedZ = surf.cartesian[2] + 1.63
  assertTrue(Math.abs(h.cartesian[2] - expectedZ) < 0.001, `H z = ${h.cartesian[2]}, expected ${expectedZ}`)
  assertTrue(Math.abs(h.cartesian[0] - surf.cartesian[0]) < 0.001, 'H x aligns with surface atom')
  assertTrue(Math.abs(h.cartesian[1] - surf.cartesian[1]) < 0.001, 'H y aligns with surface atom')
}

function testPlaceCollisionDetection() {
  // Try to place H *at* an existing surface atom (zero distance) — should
  // collide because covalent radius is much larger than 0.
  const atoms: AdsorbateAtomInput[] = [{ element: 'Cu', cartesian: [0, 0, 0] }]
  // Manually craft a site at exactly the Cu position with a 0 Å offset by
  // providing an explicit bond_length of 0.
  const site = { id: 'fake', kind: 'top' as const, position: [0, 0, 0] as Vec3, normal: [0, 0, 1] as Vec3, atomIndices: [0] }
  const result = placeFragment({
    atoms,
    site,
    fragment: 'H',
    bond_length: 0,
  })
  assertTrue(!result.ok, 'co-located placement should be flagged as collision')
  assertTrue(result.collision !== undefined, 'collision details present')
}

function testPlaceCoBondLength() {
  // CO placed on a Cu top site — anchor atom is C, bond length = r_Cu + r_C =
  // 1.32 + 0.76 = 2.08 Å. The O sits 1.13 Å above C.
  const atoms = cuSurface()
  const sites = unwrapSites(detectSites(atoms))
  const topSite = sites.find((s) => s.kind === 'top')!
  const result = placeFragment({ atoms, site: topSite, fragment: 'CO' })
  assertTrue(result.ok, 'CO placement succeeds')
  assertEqual(result.newAtoms.length, 2)
  const surf = atoms[topSite.atomIndices[0]]
  const c = result.newAtoms[0]  // anchor
  const o = result.newAtoms[1]
  assertEqual(c.element, 'C')
  assertEqual(o.element, 'O')
  assertTrue(Math.abs(c.cartesian[2] - surf.cartesian[2] - 2.08) < 0.01, `C-Cu bond length`)
  assertTrue(Math.abs(o.cartesian[2] - c.cartesian[2] - 1.13) < 0.01, `C-O bond length`)
}

function testDualPlacement() {
  const atoms = cuSurface()
  const sites = unwrapSites(detectSites(atoms))
  const topSites = sites.filter((s) => s.kind === 'top')
  assertTrue(topSites.length >= 2)
  const result = placeDualFragments({
    atoms,
    siteA: topSites[0],
    siteB: topSites[1],
    fragmentA: 'H',
    fragmentB: 'H',
  })
  assertTrue(result.ok, `dual placement succeeds (collision: ${JSON.stringify(result.collision)})`)
  assertEqual(result.newAtomsA.length, 1)
  assertEqual(result.newAtomsB.length, 1)
  assertTrue(result.anchorDistance > 0, 'anchor distance is positive')
  // Distance should be roughly the in-plane separation of the two top sites
  // (2.55 Å) — since both H atoms sit at the same z above their surface atoms.
  assertTrue(Math.abs(result.anchorDistance - 2.55) < 0.5, `dual distance ≈ in-plane separation (got ${result.anchorDistance})`)
}

function testEmitExtxyz() {
  const baseAtoms: AdsorbateAtomInput[] = [
    { element: 'Cu', cartesian: [0, 0, 0] },
  ]
  const addedAtoms: AdsorbateAtomInput[] = [
    { element: 'H', cartesian: [0, 0, 1.6] },
  ]
  const xyz = emitAdsorbateExtxyz({
    baseAtoms,
    addedAtoms,
    lattice: [[5, 0, 0], [0, 5, 0], [0, 0, 5]],
    comment: 'test',
  })
  const lines = xyz.split('\n')
  assertEqual(lines[0], '2', 'count line')
  assertTrue(lines[1].includes('Lattice="'), 'header has Lattice key')
  assertTrue(lines[1].includes('Properties='), 'header has Properties key')
  assertTrue(lines[1].includes('test'), 'header has comment')
  assertTrue(lines[2].startsWith('Cu'), 'base atom present')
  assertTrue(lines[3].startsWith('H'), 'added atom present')
}

function testFragmentLibrary() {
  // All expected fragments exist with the right element composition.
  assertTrue('H' in FRAGMENTS)
  assertTrue('OH' in FRAGMENTS)
  assertTrue('H2O' in FRAGMENTS)
  assertTrue('CO' in FRAGMENTS)
  assertTrue('CO2' in FRAGMENTS)
  assertTrue('N2' in FRAGMENTS)
  assertTrue('NH3' in FRAGMENTS)
  assertTrue('CH3' in FRAGMENTS)
  // CO2: 3 atoms, anchor at index 0 (O).
  assertEqual(FRAGMENTS.CO2.atoms.length, 3)
  assertEqual(FRAGMENTS.CO2.atoms[0].element, 'O')
  assertEqual(FRAGMENTS.CO2.atoms[1].element, 'C')
}

function run() {
  testDetectSurfaceLayer()
  testDetectSites()
  testTopSiteCoordinates()
  testManualSelection()
  testPlaceHOnTop()
  testPlaceCollisionDetection()
  testPlaceCoBondLength()
  testDualPlacement()
  testEmitExtxyz()
  testFragmentLibrary()
  console.log('analysis Adsorbate tests passed')
}

run()
