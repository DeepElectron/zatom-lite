import { assertTrue, assertEqual } from '../testing/assert'
import { makeRng } from '../lib/polycrystal/rng'

function testDeterministicForSameSeed() {
  const a = makeRng(12345)
  const b = makeRng(12345)
  for (let i = 0; i < 100; i++) assertEqual(a(), b(), 'same seed must produce same sequence')
}

function testInUnitInterval() {
  const r = makeRng(7)
  for (let i = 0; i < 1000; i++) {
    const v = r()
    assertTrue(v >= 0 && v < 1, `value ${v} out of [0,1)`)
  }
}

function testDifferentSeedsDiffer() {
  const a = makeRng(1), b = makeRng(2)
  let diff = false
  for (let i = 0; i < 10; i++) if (a() !== b()) diff = true
  assertTrue(diff, 'different seeds should diverge')
}

function run() {
  testDeterministicForSameSeed()
  testInUnitInterval()
  testDifferentSeedsDiffer()
  console.log('polycrystal rng tests passed')
}

run()
