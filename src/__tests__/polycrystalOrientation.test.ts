import { assertTrue } from '../testing/assert'
import { makeRng } from '../lib/polycrystal/rng'
import { randomRotationMatrix, applyMatrix } from '../lib/polycrystal/orientation'

function dot(a: number[], b: number[]) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] }
function col(m: number[], j: number) { return [m[j], m[3 + j], m[6 + j]] }

function testOrthonormalProperRotation() {
  const rng = makeRng(99)
  for (let t = 0; t < 50; t++) {
    const m = randomRotationMatrix(rng)
    const c0 = col(m, 0), c1 = col(m, 1), c2 = col(m, 2)
    assertTrue(Math.abs(dot(c0, c0) - 1) < 1e-6, 'col0 unit')
    assertTrue(Math.abs(dot(c1, c1) - 1) < 1e-6, 'col1 unit')
    assertTrue(Math.abs(dot(c2, c2) - 1) < 1e-6, 'col2 unit')
    assertTrue(Math.abs(dot(c0, c1)) < 1e-6, 'c0⊥c1')
    assertTrue(Math.abs(dot(c0, c2)) < 1e-6, 'c0⊥c2')
    assertTrue(Math.abs(dot(c1, c2)) < 1e-6, 'c1⊥c2')
    const cross = [c1[1] * c2[2] - c1[2] * c2[1], c1[2] * c2[0] - c1[0] * c2[2], c1[0] * c2[1] - c1[1] * c2[0]]
    assertTrue(Math.abs(dot(c0, cross) - 1) < 1e-6, 'det ≈ +1')
  }
}

function testApplyPreservesLength() {
  const rng = makeRng(3)
  const m = randomRotationMatrix(rng)
  const v: [number, number, number] = [1.3, -2.1, 0.7]
  const r = applyMatrix(m, v)
  const len = Math.hypot(...v), rlen = Math.hypot(...r)
  assertTrue(Math.abs(len - rlen) < 1e-6, 'rotation preserves length')
}

function run() {
  testOrthonormalProperRotation()
  testApplyPreservesLength()
  console.log('polycrystal orientation tests passed')
}

run()
