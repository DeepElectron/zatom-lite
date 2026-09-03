import { assertEqual, assertTrue } from '../testing/assert'
import { grainColorHex } from '../lib/polycrystal/grain-colors'

function testDeterministic() {
  assertEqual(grainColorHex(0), grainColorHex(0), 'same id → same color')
  assertEqual(grainColorHex(42), grainColorHex(42), 'same id → same color')
}

function testValidHex() {
  for (let g = 0; g < 50; g++) {
    const c = grainColorHex(g)
    assertTrue(/^#[0-9a-f]{6}$/i.test(c), `valid hex for grain ${g}: ${c}`)
  }
}

function testAdjacentIdsDiffer() {
  assertTrue(grainColorHex(0) !== grainColorHex(1), 'adjacent grains differ')
}

function run() {
  testDeterministic()
  testValidHex()
  testAdjacentIdsDiffer()
  console.log('polycrystal grain-colors tests passed')
}

run()
