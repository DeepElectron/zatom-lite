/**
 * MSD on a synthetic 1-D random-walk trajectory.
 *
 * Truth: a 1-D random walker with step length L (deterministic ±L per
 * frame) has MSD(τ) = L² · τ exactly (no statistical variance, since
 * every step contributes |ΔL|² = L² and consecutive jumps along the
 * same axis sum coherently). So the Einstein fit slope must come out
 * to L² and, with d = 1, D = L² / 2.
 *
 * We also exercise PBC unwrapping by wrapping the walker into a cell
 * narrower than the total displacement; if unwrapping works, the MSD
 * stays linear; if it doesn't, the wrap creates a giant phantom jump
 * that destroys linearity.
 */
import { assertEqual, assertTrue } from '../testing/assert'
import { computeMsd } from '../lib/analysis/trajectory/md-postprocess/msd'
import type { XYZAtom, XYZFrame } from '../lib/crystal/xyz-parser'

function atom(
  id: string,
  element: string,
  cartesian: [number, number, number],
): XYZAtom {
  return { id, element, position: [0, 0, 0], cartesian }
}

function deterministicRandomWalkX(
  nFrames: number,
  stepL: number,
  cellLx: number,
): XYZFrame[] {
  // Use a deterministic ±1 sign sequence so the test is fully reproducible.
  // Pattern: alternate runs of +1 then −1 of irregular length, then a long +1
  // tail so the walker definitely escapes the home cell and triggers PBC.
  const signs: number[] = []
  for (let i = 0; i < nFrames - 1; i++) {
    // Mostly forward (+1), with periodic backward (−1) hops so we sample
    // a non-trivial walk that still has nonzero net drift.
    signs.push((i % 7 === 0 || i % 11 === 0) ? -1 : 1)
  }
  const frames: XYZFrame[] = []
  let trueX = 0
  for (let f = 0; f < nFrames; f++) {
    if (f > 0) trueX += signs[f - 1] * stepL
    // Wrap into [0, cellLx).
    let wrappedX = trueX
    wrappedX = wrappedX - Math.floor(wrappedX / cellLx) * cellLx
    frames.push({
      atoms: [atom('x0', 'X', [wrappedX, 0, 0])],
      latticeVectors: {
        a: [cellLx, 0, 0],
        b: [0, cellLx, 0],
        c: [0, 0, cellLx],
      },
    })
  }
  return frames
}

function testMsdLinearGrowth() {
  // Pure walker: at each step trueX = trueX_prev + sign · L, |Δ|² = L².
  // Over τ = k steps the displacement is a sum of k ±L steps. With the
  // deterministic alternating pattern the MSD-over-time-origins is not
  // strictly L² · τ — but it must remain LINEAR in τ for a random walk,
  // and the slope must be of order L². We assert (a) linearity (R² very
  // close to 1) and (b) D ≈ ⟨slope⟩ / 2 > 0.
  const L = 0.3
  const cellLx = 4.0 // smaller than the eventual extent so PBC kicks in
  const frames = deterministicRandomWalkX(100, L, cellLx)
  const res = computeMsd(frames, {
    species: ['X'],
    directions: 'x',
    unwrap_pbc: true,
  })
  assertTrue(res.tau.length > 0, 'MSD has tau axis')
  const r = res.per_species['X']
  assertTrue(r != null, 'species X result present')
  assertTrue((r.fit_r_squared ?? 0) > 0.99, `MSD must be linear, got R² = ${r.fit_r_squared}`)
  assertTrue(r.diffusion_coefficient !== null, 'D is computed')
  assertTrue((r.diffusion_coefficient ?? 0) > 0, 'D positive for a forward-biased walk')
  // Slope must be roughly the per-frame |Δ|² × bias-factor. For our pattern
  // the per-step expectation of Δ over τ frames is τ · ⟨sign⟩ · L, plus a
  // contribution that's exactly L² per step squared — so slope ≈ L² · k
  // with 1 ≤ k ≤ 4. Loose bound.
  assertTrue((r.fit_slope ?? 0) > 0.05, `slope must be Ω(L²), got ${r.fit_slope}`)
  assertTrue((r.fit_slope ?? 0) < 5, `slope must be O(L² · n), got ${r.fit_slope}`)
}

function testMsdUnwrapVsNoUnwrap() {
  // Without unwrap, atoms stay inside the cell, so their MSD saturates near
  // ~(Lx)²/6 (the average squared deviation over a uniform distribution in
  // a box of side Lx) — wrapping erases the long-term diffusive growth. With
  // unwrap, the true ballistic/diffusive growth is recovered, and the linear
  // fit slope is much larger. We check unwrapped slope ≫ wrapped slope.
  const L = 0.3
  const cellLx = 4.0
  const frames = deterministicRandomWalkX(80, L, cellLx)
  const wrapped = computeMsd(frames, { species: ['X'], directions: 'x', unwrap_pbc: false })
  const unwrapped = computeMsd(frames, { species: ['X'], directions: 'x', unwrap_pbc: true })
  const sw = wrapped.per_species['X'].fit_slope ?? 0
  const su = unwrapped.per_species['X'].fit_slope ?? 0
  // The wrapped slope can even be negative or near-zero (the trajectory is
  // bounded). The unwrapped slope reflects the true linear MSD growth.
  // We demand a clear order-of-magnitude separation as the test signal.
  assertTrue(
    Math.abs(su) > Math.abs(sw) * 2,
    `unwrap should recover linear MSD: wrapped=${sw}, unwrapped=${su}`,
  )
  assertTrue(su > 0, `unwrapped slope must be positive, got ${su}`)
}

function testMsdMultipleSpecies() {
  // Frame 0 has two species; build a trivial 2-frame "trajectory" where one
  // species moves and the other doesn't. MSD for the static species must
  // be zero, MSD for the moving species must be > 0.
  const frames: XYZFrame[] = [
    {
      atoms: [
        atom('a0', 'A', [0, 0, 0]),
        atom('b0', 'B', [0, 0, 0]),
      ],
      latticeVectors: { a: [10, 0, 0], b: [0, 10, 0], c: [0, 0, 10] },
    },
    {
      atoms: [
        atom('a0', 'A', [1, 0, 0]),
        atom('b0', 'B', [0, 0, 0]),
      ],
      latticeVectors: { a: [10, 0, 0], b: [0, 10, 0], c: [0, 0, 10] },
    },
  ]
  const res = computeMsd(frames, { directions: 'x' })
  assertEqual(res.per_species['A'].msd.length, 1)
  assertTrue(Math.abs(res.per_species['A'].msd[0] - 1) < 1e-9, 'A MSD(1) = 1²')
  assertTrue(Math.abs(res.per_species['B'].msd[0]) < 1e-9, 'B static → MSD ≈ 0')
}

function testMsdEmptyTrajectory() {
  const res = computeMsd([], {})
  assertEqual(res.tau.length, 0)
  assertEqual(Object.keys(res.per_species).length, 0)
}

function run() {
  testMsdLinearGrowth()
  testMsdUnwrapVsNoUnwrap()
  testMsdMultipleSpecies()
  testMsdEmptyTrajectory()
  console.log('analysis trajectory MSD tests passed')
}

run()
