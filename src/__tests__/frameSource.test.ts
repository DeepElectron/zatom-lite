import { assertEqual, assertTrue } from '../testing/assert'
import { createSyntheticVibrationSource, wrapPlayhead } from '../lib/render/frame-source'

const BBOX = { min: [0, 0, 0] as [number, number, number], max: [30, 30, 30] as [number, number, number] }

function makeBase(n: number): Float32Array {
  const p = new Float32Array(n * 3)
  for (let i = 0; i < n * 3; i++) p[i] = (i * 7919) % 30
  return p
}

function testLengthAndDeterminism() {
  const base = makeBase(100)
  const src = createSyntheticVibrationSource(base, BBOX, { frameCount: 10000, amplitude: 1.0 })
  assertEqual(src.frameCount, 10000, 'frameCount')
  assertEqual(src.atomCount, 100, 'atomCount')
  const a = new Float32Array(300), b = new Float32Array(300)
  src.getFrame(42, a); src.getFrame(42, b)
  for (let i = 0; i < 300; i++) assertEqual(a[i], b[i], `deterministic at ${i}`)
}

function testDisplacementBounded() {
  const base = makeBase(200)
  const A = 1.0, jitter = 0.5 * A
  const src = createSyntheticVibrationSource(base, BBOX, { frameCount: 1000, amplitude: A })
  const out = new Float32Array(600)
  for (const f of [0, 17, 500, 999]) {
    src.getFrame(f, out)
    for (let k = 0; k < 200; k++) {
      assertTrue(Math.abs(out[k * 3] - base[k * 3]) <= jitter + 1e-5, 'x bounded by jitter')
      assertTrue(Math.abs(out[k * 3 + 1] - base[k * 3 + 1]) <= A + jitter + 1e-5, 'y bounded by A+jitter')
      assertTrue(Math.abs(out[k * 3 + 2] - base[k * 3 + 2]) <= jitter + 1e-5, 'z bounded by jitter')
    }
  }
}

function testFramesDiffer() {
  const base = makeBase(50)
  const src = createSyntheticVibrationSource(base, BBOX, { frameCount: 100, amplitude: 1.0 })
  const a = new Float32Array(150), b = new Float32Array(150)
  src.getFrame(0, a); src.getFrame(50, b)
  let diff = 0
  for (let i = 0; i < 150; i++) if (Math.abs(a[i] - b[i]) > 1e-4) diff++
  assertTrue(diff > 50, `frames 0 and 50 differ broadly (${diff})`)
}

function testWrapPlayhead() {
  assertEqual(wrapPlayhead(5, 10), 5, 'in range')
  assertEqual(wrapPlayhead(12.5, 10), 2.5, 'wraps overflow')
  assertEqual(wrapPlayhead(-1, 10), 9, 'wraps negative')
  assertEqual(wrapPlayhead(7, 1), 0, 'frameCount 1 pins to 0')
  assertEqual(wrapPlayhead(3, 0), 0, 'frameCount 0 pins to 0')
}

function run() {
  testLengthAndDeterminism()
  testDisplacementBounded()
  testFramesDiffer()
  testWrapPlayhead()
  console.log('frame-source tests passed')
}

run()
