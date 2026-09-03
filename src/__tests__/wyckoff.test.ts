/**
 * wyckoff.test —— Validate lib/symmetry against known structures.
 *
 * Test cases:
 *   - NaCl (Fm-3m, #225): Na → 4a (0,0,0), Cl → 4b (1/2,1/2,1/2).
 *   - α-Po (Pm-3m, #221): Po → 1a (0,0,0).
 *   - bcc-W (Im-3m, #229): W → 2a (0,0,0).
 *   - α-quartz (P3_121, #152): generate Si on 3a + O on 6c from a partial set + ops.
 *
 * We supply operations directly (as backend would) rather than re-deriving from SG number,
 * keeping the test self-contained and deterministic.
 */

import { assertEqual, assertDefined } from '../testing/assert'
import {
  assignWyckoffPositions,
  generateOrbit,
  type WyckoffAtomInput,
  type SymmetryOperation,
} from '../lib/symmetry'

// ── operation set helpers ────────────────────────────────────────────────────

const I: SymmetryOperation = {
  rotation: [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
  translation: [0, 0, 0],
}

const INV: SymmetryOperation = {
  rotation: [
    [-1, 0, 0],
    [0, -1, 0],
    [0, 0, -1],
  ],
  translation: [0, 0, 0],
}

/**
 * Fm-3m centering ops: identity + 3 face-centering translations.
 * For our orbit test we only need to expand a single representative atom to
 * the 4 centering positions. (full 192 SG operations would also work; we use
 * the minimal 4 for clarity.)
 */
const FCC_CENTERING: SymmetryOperation[] = [
  { rotation: I.rotation, translation: [0, 0, 0] },
  { rotation: I.rotation, translation: [0, 0.5, 0.5] },
  { rotation: I.rotation, translation: [0.5, 0, 0.5] },
  { rotation: I.rotation, translation: [0.5, 0.5, 0] },
]

const BCC_CENTERING: SymmetryOperation[] = [
  { rotation: I.rotation, translation: [0, 0, 0] },
  { rotation: I.rotation, translation: [0.5, 0.5, 0.5] },
]

function run() {
  // ── NaCl: Fm-3m, Na on 4a, Cl on 4b ────────────────────────────────────
  {
    const atoms: WyckoffAtomInput[] = [
      // 4a (0,0,0) + 3 centering images
      { index: 0, element: 'Na', frac: [0, 0, 0] },
      { index: 1, element: 'Na', frac: [0, 0.5, 0.5] },
      { index: 2, element: 'Na', frac: [0.5, 0, 0.5] },
      { index: 3, element: 'Na', frac: [0.5, 0.5, 0] },
      // 4b (1/2,1/2,1/2) + 3 centering images
      { index: 4, element: 'Cl', frac: [0.5, 0.5, 0.5] },
      { index: 5, element: 'Cl', frac: [0.5, 0, 0] },
      { index: 6, element: 'Cl', frac: [0, 0.5, 0] },
      { index: 7, element: 'Cl', frac: [0, 0, 0.5] },
    ]

    const result = assignWyckoffPositions(atoms, 225, FCC_CENTERING)
    const analysis = assertDefined(result, 'analysis returned for SG 225')

    assertEqual(analysis.spaceGroup.number, 225, 'SG number = 225')
    assertEqual(analysis.spaceGroup.hm, 'Fm-3m', 'SG H-M = Fm-3m')
    assertEqual(analysis.assignments.length, 2, 'NaCl has 2 orbits (Na, Cl)')

    const naOrbit = analysis.assignments.find((a) => a.element === 'Na')
    const clOrbit = analysis.assignments.find((a) => a.element === 'Cl')
    assertDefined(naOrbit, 'Na orbit found')
    assertDefined(clOrbit, 'Cl orbit found')

    assertEqual(naOrbit!.label, '4a', 'Na assigned to Wyckoff 4a')
    assertEqual(clOrbit!.label, '4b', 'Cl assigned to Wyckoff 4b')
    assertEqual(naOrbit!.atomIndices.length, 4, 'Na orbit has 4 atoms')
    assertEqual(clOrbit!.atomIndices.length, 4, 'Cl orbit has 4 atoms')
    assertEqual(analysis.unclassified.length, 0, 'no unclassified atoms in NaCl')
    console.log('  ✓ NaCl: Na→4a, Cl→4b (Fm-3m)')
  }

  // ── α-Po: Pm-3m, Po on 1a ──────────────────────────────────────────────
  {
    const atoms: WyckoffAtomInput[] = [
      { index: 0, element: 'Po', frac: [0, 0, 0] },
    ]
    // primitive cubic ops: just identity is enough since 1a is invariant under inversion.
    const result = assignWyckoffPositions(atoms, 221, [I])
    const analysis = assertDefined(result, 'analysis returned for SG 221')
    assertEqual(analysis.assignments.length, 1)
    assertEqual(analysis.assignments[0].label, '1a', 'Po → Wyckoff 1a')
    console.log('  ✓ α-Po: Po→1a (Pm-3m)')
  }

  // ── α-Fe / W (bcc): Im-3m, W on 2a ─────────────────────────────────────
  {
    const atoms: WyckoffAtomInput[] = [
      { index: 0, element: 'W', frac: [0, 0, 0] },
      { index: 1, element: 'W', frac: [0.5, 0.5, 0.5] },
    ]
    const result = assignWyckoffPositions(atoms, 229, BCC_CENTERING)
    const analysis = assertDefined(result, 'analysis returned for SG 229')
    assertEqual(analysis.assignments.length, 1)
    assertEqual(analysis.assignments[0].label, '2a', 'W → Wyckoff 2a')
    assertEqual(analysis.assignments[0].atomIndices.length, 2)
    console.log('  ✓ bcc W: W→2a (Im-3m)')
  }

  // ── orbit generation manual check ──────────────────────────────────────
  {
    // Under FCC_CENTERING, (0,0,0) should generate 4 distinct images.
    const orbit = generateOrbit([0, 0, 0], FCC_CENTERING)
    assertEqual(orbit.length, 4, 'FCC centering applied to origin yields 4 images')
    console.log('  ✓ generateOrbit: (0,0,0) under FCC centering → 4 images')
  }

  // ── inversion symmetry for centrosymmetric atom at origin ─────────────
  {
    // (0,0,0) is invariant under inversion, so orbit size stays 1 under {I, INV}.
    const orbit = generateOrbit([0, 0, 0], [I, INV])
    assertEqual(orbit.length, 1, 'origin invariant under inversion (orbit size 1)')
    // A non-special site (1/4, 1/4, 1/4) gets a partner (3/4, 3/4, 3/4) (= -1/4 mod 1)
    const orbit2 = generateOrbit([0.25, 0.25, 0.25], [I, INV])
    assertEqual(orbit2.length, 2, '(1/4,1/4,1/4) + inversion → 2 images')
    console.log('  ✓ inversion symmetry: origin invariant, (1/4)³ → 2 images')
  }

  // ── α-quartz P3_121 (#152): Si on 3a, O on 6c (free params x/y/z) ────
  {
    // 3-fold rotation about c-axis (in hexagonal axes, transforms (x,y,z) → (-y, x-y, z))
    // We use the 3 operations of the 3-fold axis (no helical part — the 3_1 screws give different z).
    // For the test, use full conventional ops set so Si on 3a generates 3 images.
    // 3-fold rotation operations for P3_121 (subset):
    const c3a: SymmetryOperation = {
      rotation: [
        [0, -1, 0],
        [1, -1, 0],
        [0, 0, 1],
      ],
      translation: [0, 0, 1 / 3],
    }
    const c3b: SymmetryOperation = {
      rotation: [
        [-1, 1, 0],
        [-1, 0, 0],
        [0, 0, 1],
      ],
      translation: [0, 0, 2 / 3],
    }
    const ops: SymmetryOperation[] = [I, c3a, c3b]

    // Si on 3a representative (x, 0, 1/3) with x ≈ 0.47
    const xSi = 0.47
    const siAtom: WyckoffAtomInput = { index: 0, element: 'Si', frac: [xSi, 0, 1 / 3] }
    const orbit = generateOrbit(siAtom.frac, ops)
    assertEqual(orbit.length, 3, 'Si on 3a has orbit size 3 under 3-fold rotation')

    // Build full Si trio (apply ops manually)
    const siAtoms: WyckoffAtomInput[] = orbit.map((f, i) => ({
      index: i,
      element: 'Si',
      frac: f,
    }))
    const result = assignWyckoffPositions(siAtoms, 152, ops)
    const analysis = assertDefined(result, 'analysis returned for SG 152')
    assertEqual(analysis.assignments.length, 1)
    assertEqual(analysis.assignments[0].label, '3a', 'Si → Wyckoff 3a (P3_121)')
    console.log('  ✓ α-quartz: Si→3a (P3_121)')
  }

  // ── unsupported SG returns null ─────────────────────────────────────────
  {
    const result = assignWyckoffPositions(
      [{ index: 0, element: 'X', frac: [0, 0, 0] }],
      999, // out of range
      [I],
    )
    assertEqual(result, null, 'invalid SG returns null')
    console.log('  ✓ unsupported SG number → null')
  }

  console.log('wyckoff tests passed')
}

run()
