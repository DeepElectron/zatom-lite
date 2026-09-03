import { assertEqual, assertTrue } from '../testing/assert'
import {
  AVAILABLE_RADIATION,
  computeXrdPattern,
  getUniqueFamilies,
  WAVELENGTHS,
  type XrdStructure,
} from '../lib/analysis/xrd'

function fccCopper(a = 3.6149): XrdStructure {
  // Conventional FCC Cu cell: 4 atoms at the standard Bravais positions.
  return {
    sites: [
      { element: 'Cu', frac: [0, 0, 0] },
      { element: 'Cu', frac: [0.5, 0.5, 0] },
      { element: 'Cu', frac: [0.5, 0, 0.5] },
      { element: 'Cu', frac: [0, 0.5, 0.5] },
    ],
    lattice: [
      [a, 0, 0],
      [0, a, 0],
      [0, 0, a],
    ],
  }
}

function rocksaltNaCl(a = 5.64): XrdStructure {
  return {
    sites: [
      { element: 'Na', frac: [0, 0, 0] },
      { element: 'Na', frac: [0.5, 0.5, 0] },
      { element: 'Na', frac: [0.5, 0, 0.5] },
      { element: 'Na', frac: [0, 0.5, 0.5] },
      { element: 'Cl', frac: [0.5, 0.5, 0.5] },
      { element: 'Cl', frac: [0, 0, 0.5] },
      { element: 'Cl', frac: [0, 0.5, 0] },
      { element: 'Cl', frac: [0.5, 0, 0] },
    ],
    lattice: [
      [a, 0, 0],
      [0, a, 0],
      [0, 0, a],
    ],
  }
}

function testWavelengthsCatalog() {
  assertTrue(AVAILABLE_RADIATION.length >= 20, 'should ship many radiation sources')
  assertTrue(Math.abs(WAVELENGTHS.CuKa - 1.54184) < 1e-6, 'CuKa wavelength matches IUCr standard')
}

function testFccCopperGivesExpectedPeaks() {
  const pattern = computeXrdPattern(fccCopper(), {
    wavelength: 'CuKa',
    two_theta_range: [30, 90],
  })
  assertTrue(pattern.x.length > 0, 'FCC Cu produces peaks in 30–90° range')
  // Strongest peak should be (111) near 43.3° for Cu Kα.
  const maxIdx = pattern.y.indexOf(Math.max(...pattern.y))
  const strongestAngle = pattern.x[maxIdx]
  assertTrue(
    strongestAngle > 42 && strongestAngle < 45,
    `expected strongest Cu peak near 43.3°, got ${strongestAngle.toFixed(2)}°`,
  )
  // After scaling, max should be 100.
  assertTrue(Math.abs(Math.max(...pattern.y) - 100) < 1e-6, 'strongest peak scales to 100')
}

function testForbiddenReflectionsAreSuppressed() {
  // FCC: (100), (110), (210) are systematically absent. (100) at small angle should not appear
  // as a tall peak — its scaled intensity must be far below the (111) peak.
  const pattern = computeXrdPattern(fccCopper(), {
    wavelength: 'CuKa',
    two_theta_range: [10, 90],
  })
  // No peak below 35° should exceed 5% of the strongest peak (Cu (111) is the lowest allowed).
  for (let i = 0; i < pattern.x.length; i++) {
    if (pattern.x[i] < 35) {
      assertTrue(
        pattern.y[i] < 5,
        `FCC forbidden reflection at 2θ=${pattern.x[i].toFixed(2)}° has scaled intensity ${pattern.y[i].toFixed(2)} (expected <5)`,
      )
    }
  }
}

function testTwoElementPatternHasMultipleStrongPeaks() {
  const pattern = computeXrdPattern(rocksaltNaCl(), {
    wavelength: 'CuKa',
    two_theta_range: [20, 90],
  })
  assertTrue(pattern.x.length >= 4, 'NaCl yields several strong reflections in 20–90°')
  // (200) is the strongest NaCl reflection; should be near ~31.7°.
  const maxIdx = pattern.y.indexOf(Math.max(...pattern.y))
  assertTrue(
    pattern.x[maxIdx] > 30 && pattern.x[maxIdx] < 33,
    `NaCl strongest peak should be near 31.7°, got ${pattern.x[maxIdx].toFixed(2)}°`,
  )
}

function testGetUniqueFamiliesCollapsesPermutations() {
  // (1,1,0) and (0,1,1) and (1,0,1) and their sign variants share the {0,1,1} family.
  const families = getUniqueFamilies([
    [1, 1, 0],
    [0, 1, 1],
    [-1, 0, 1],
    [1, 0, -1],
  ])
  assertEqual(families.size, 1)
  const onlyValue = Array.from(families.values())[0]
  assertEqual(onlyValue, 4)
}

function testRejectsUnknownElement() {
  let caught = false
  try {
    computeXrdPattern({
      sites: [{ element: 'Xx', frac: [0, 0, 0] }],
      lattice: [[3, 0, 0], [0, 3, 0], [0, 0, 3]],
    }, { wavelength: 'CuKa', two_theta_range: [10, 90] })
  } catch {
    caught = true
  }
  assertTrue(caught, 'unknown element rejected with explicit error')
}

function testCustomWavelengthShiftsPeaks() {
  const cuPattern = computeXrdPattern(fccCopper(), { wavelength: 'CuKa', two_theta_range: [20, 90] })
  const moPattern = computeXrdPattern(fccCopper(), { wavelength: 'MoKa', two_theta_range: [10, 90] })
  // Mo Kα (0.71 Å) is shorter — same (hkl) lands at smaller 2θ than Cu Kα (1.54 Å).
  const cuMax = cuPattern.x[cuPattern.y.indexOf(Math.max(...cuPattern.y))]
  const moMax = moPattern.x[moPattern.y.indexOf(Math.max(...moPattern.y))]
  assertTrue(moMax < cuMax, `shorter Mo wavelength should shift (111) to lower 2θ (Cu=${cuMax.toFixed(2)}, Mo=${moMax.toFixed(2)})`)
}

function run() {
  testWavelengthsCatalog()
  testFccCopperGivesExpectedPeaks()
  testForbiddenReflectionsAreSuppressed()
  testTwoElementPatternHasMultipleStrongPeaks()
  testGetUniqueFamiliesCollapsesPermutations()
  testRejectsUnknownElement()
  testCustomWavelengthShiftsPeaks()
  console.log('analysis XRD tests passed')
}

run()
