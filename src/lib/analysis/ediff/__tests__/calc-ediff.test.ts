import { computeEdiffRadial } from '../calc-ediff'
import type { XrdStructure } from '../../xrd/types'

// Kinematic electron-diffraction radial profile (NOT a SAED spot pattern).
function run() {
  const a = 4 // Å, simple cubic; reciprocal spacing 1/a = 0.25 Å⁻¹
  const structure: XrdStructure = {
    lattice: [
      [a, 0, 0],
      [0, a, 0],
      [0, 0, a],
    ],
    sites: [{ element: 'Si', frac: [0, 0, 0] }],
  }
  const pat = computeEdiffRadial(structure, { gMax: 2, nBins: 200 })

  if (pat.x.length !== 200 || pat.y.length !== 200) {
    throw new Error(`bin count mismatch: ${pat.x.length}/${pat.y.length}`)
  }
  let argmax = 0
  for (let i = 1; i < pat.y.length; i++) if (pat.y[i] > pat.y[argmax]) argmax = i
  const gPeak = pat.x[argmax]
  // The dominant peak must sit on a cubic reflection: |g|² = (h²+k²+l²)/a², so
  // (|g|·a)² is (close to) a positive integer. This verifies the reciprocal-lattice
  // geometry + structure factor without assuming a specific intensity ordering.
  const nsq = (gPeak * a) ** 2
  const nearestInt = Math.round(nsq)
  if (nearestInt < 1 || Math.abs(nsq - nearestInt) > 0.05) {
    throw new Error(`dominant peak |g|=${gPeak} is not a cubic reflection ((|g|·a)²=${nsq.toFixed(3)})`)
  }
  if (Math.abs(Math.max(...pat.y) - 100) > 1e-6) {
    throw new Error('intensity not normalized to 100')
  }
  console.log(`calc-ediff: dominant reflection (h²+k²+l²)=${nearestInt} at |g|=${gPeak.toFixed(3)} Å⁻¹; OK`)
}

run()
