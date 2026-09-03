import { assertEqual, assertTrue } from '../testing/assert'
import { calculateRdf, calculateAllPairRdfs, type RdfStructure } from '../lib/analysis/rdf'

function makeSimpleCubic(spacing = 3.5): RdfStructure {
  // 2x2x2 cluster of identical atoms in an orthogonal box, side = 2*spacing.
  const sites: RdfStructure['sites'] = []
  for (let i = 0; i < 2; i += 1) {
    for (let j = 0; j < 2; j += 1) {
      for (let k = 0; k < 2; k += 1) {
        sites.push({ element: 'Ar', cartesian: [i * spacing, j * spacing, k * spacing] })
      }
    }
  }
  const side = 2 * spacing
  return {
    sites,
    latticeVectors: {
      a: [side, 0, 0],
      b: [0, side, 0],
      c: [0, 0, side],
    },
  }
}

function makeBinaryMix(): RdfStructure {
  return {
    sites: [
      { element: 'Na', cartesian: [0, 0, 0] },
      { element: 'Cl', cartesian: [2.81, 0, 0] },
      { element: 'Na', cartesian: [5.62, 0, 0] },
      { element: 'Cl', cartesian: [0, 2.81, 0] },
    ],
    latticeVectors: {
      a: [8.43, 0, 0],
      b: [0, 8.43, 0],
      c: [0, 0, 8.43],
    },
  }
}

function testRdfBasicShape() {
  const result = calculateRdf(makeSimpleCubic(), {
    cutoff: 8,
    n_bins: 40,
    auto_expand: false,
    pbc: [false, false, false],
  })
  assertEqual(result.r.length, 40)
  assertEqual(result.g_r.length, 40)
  assertTrue(result.r[0] > 0, 'first bin centre is positive')
  assertTrue(result.r[result.r.length - 1] < 8, 'last bin centre is below cutoff')
  assertTrue(result.g_r.some((v) => v > 0), 'at least one bin has nonzero g(r)')
  assertTrue(result.g_r.every((v) => Number.isFinite(v)), 'all g(r) values are finite')
}

function testRdfRejectsInvalidParams() {
  let caught = false
  try {
    calculateRdf(makeSimpleCubic(), { cutoff: -1, n_bins: 10, auto_expand: false })
  } catch {
    caught = true
  }
  assertTrue(caught, 'negative cutoff throws')
}

function testRdfPeakAtNearestNeighbor() {
  // Nearest-neighbour distance is `spacing` = 3.5 Å. Expect a peak in the bin containing 3.5.
  const result = calculateRdf(makeSimpleCubic(3.5), {
    cutoff: 8,
    n_bins: 80,
    auto_expand: false,
    pbc: [false, false, false],
  })
  const binSize = 8 / 80
  const targetBin = Math.floor(3.5 / binSize)
  const localMax = Math.max(result.g_r[targetBin - 1] ?? 0, result.g_r[targetBin], result.g_r[targetBin + 1] ?? 0)
  assertTrue(localMax > 0, `expected nonzero g(r) around r=3.5 Å, got bin ${targetBin}=${result.g_r[targetBin]}`)
}

function testRdfSpeciesFilter() {
  const result = calculateRdf(makeBinaryMix(), {
    cutoff: 6,
    n_bins: 30,
    center_species: 'Na',
    neighbor_species: 'Cl',
    auto_expand: false,
    pbc: [false, false, false],
  })
  assertEqual(result.element_pair?.[0], 'Na')
  assertEqual(result.element_pair?.[1], 'Cl')
  // Na@(0,0,0) → Cl@(2.81,0,0) and Cl@(0,2.81,0) — both within 6 Å.
  assertTrue(result.g_r.some((v) => v > 0), 'Na–Cl pairs found within cutoff')
}

function testAllPairsCoversAllElementCombinations() {
  const patterns = calculateAllPairRdfs(makeBinaryMix(), {
    cutoff: 5,
    n_bins: 20,
    auto_expand: false,
    pbc: [false, false, false],
  })
  // Elements: Cl, Na → pairs: Cl–Cl, Cl–Na, Na–Na = 3 patterns.
  assertEqual(patterns.length, 3)
  const labels = patterns.map((p) => p.element_pair?.join('-')).sort()
  assertEqual(labels[0], 'Cl-Cl')
  assertEqual(labels[1], 'Cl-Na')
  assertEqual(labels[2], 'Na-Na')
}

function testRdfHandlesEmptyStructure() {
  const result = calculateRdf({ sites: [], latticeVectors: { a: [5, 0, 0], b: [0, 5, 0], c: [0, 0, 5] } }, {
    cutoff: 4,
    n_bins: 10,
    auto_expand: false,
    pbc: [false, false, false],
  })
  assertEqual(result.g_r.every((v) => v === 0), true)
}

function run() {
  testRdfBasicShape()
  testRdfRejectsInvalidParams()
  testRdfPeakAtNearestNeighbor()
  testRdfSpeciesFilter()
  testAllPairsCoversAllElementCombinations()
  testRdfHandlesEmptyStructure()
  console.log('analysis RDF tests passed')
}

run()
