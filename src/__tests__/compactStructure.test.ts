import { assertEqual, assertTrue } from '../testing/assert'
import { buildElementTables, buildInstanceRadii, buildInstanceColors, BALL_STICK_RADIUS_FACTOR, viewModeRadiusFactor } from '../lib/render/compact-structure'
import type { CompactStructure } from '../lib/render/compact-structure'
import { grainColorHex } from '../lib/polycrystal/grain-colors'

function makeCompact(): CompactStructure {
  return {
    positions: new Float32Array([0, 0, 0, 1, 0, 0]),
    elementIndex: new Uint8Array([0, 1]),
    elements: ['Cu', 'O'],
    grainId: new Uint32Array([3, 7]),
    count: 2,
    bbox: { min: [0, 0, 0], max: [1, 0, 0] },
  }
}

function hexToRgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255]
}

function testElementTables() {
  const t = buildElementTables(['Cu', 'O'])
  assertEqual(t.radii.length, 2, 'one radius per element')
  assertEqual(t.colors.length, 6, '3 floats per element')
  assertTrue(t.radii[0] > 0, 'Cu radius > 0')
}

function testRadii() {
  const c = makeCompact()
  const t = buildElementTables(c.elements)
  const r = buildInstanceRadii(c, t, 0.5)
  assertEqual(r.length, 2, 'one radius per atom')
  assertEqual(r[0], t.radii[0] * BALL_STICK_RADIUS_FACTOR * 0.5, 'radius = elementRadius*0.5*scale')
  assertEqual(r[1], t.radii[1] * BALL_STICK_RADIUS_FACTOR * 0.5, 'radius = elementRadius*0.5*scale')
  let rejectedStick = false
  try { viewModeRadiusFactor('stick') } catch { rejectedStick = true }
  assertTrue(rejectedStick, 'compact structures must reject stick instead of silently falling back without bonds')
}

function testColorsElementMode() {
  const c = makeCompact()
  const t = buildElementTables(c.elements)
  const col = buildInstanceColors(c, t, false)
  assertEqual(col.length, 6, '3 floats per atom')
  assertEqual(col[0], t.colors[0], 'atom0 = element0 color r')
  assertEqual(col[3], t.colors[3], 'atom1 = element1 color r')
}

function testColorsGrainMode() {
  const c = makeCompact()
  const t = buildElementTables(c.elements)
  const col = buildInstanceColors(c, t, true)
  const [r0] = hexToRgb(grainColorHex(3))
  assertTrue(Math.abs(col[0] - r0) < 1e-4, 'atom0 grain color r matches grainColorHex(3)')
}

function run() {
  testElementTables()
  testRadii()
  testColorsElementMode()
  testColorsGrainMode()
  console.log('compact-structure tests passed')
}

run()
