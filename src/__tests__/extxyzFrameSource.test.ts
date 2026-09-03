import { assertEqual, assertTrue } from '../testing/assert'
import {
  indexExtxyzFrames, parseFramePositions, buildStructureFromFrame, createExtxyzFileSource,
} from '../lib/render/extxyz-frame-source'
import { parseFrameBytes } from '../lib/render/extxyz-bytes'

/** deterministic multi-frame extXYZ text: nAtoms × nFrames, coords = f(frame, atom) */
function makeXyz(nAtoms: number, nFrames: number): string {
  const parts: string[] = []
  for (let f = 0; f < nFrames; f++) {
    parts.push(String(nAtoms))
    parts.push(`Lattice="20 0 0 0 20 0 0 0 20" Properties=species:S:1:pos:R:3 frame=${f}`)
    for (let a = 0; a < nAtoms; a++) {
      const el = a % 2 === 0 ? 'Cu' : 'O'
      parts.push(`${el} ${(a + f * 0.5).toFixed(4)} ${(a * 2).toFixed(4)} ${(f * 1.5).toFixed(4)}`)
    }
  }
  return parts.join('\n') + '\n'
}

async function testIndex() {
  const blob = new Blob([makeXyz(7, 5)])
  const idx = await indexExtxyzFrames(blob)
  assertEqual(idx.offsets.length, 5, 'five frames indexed')
  assertEqual(idx.atomCount, 7, 'atom count')
  assertEqual(idx.offsets[0], 0, 'first frame at byte 0')
  assertEqual(idx.ends[4], blob.size, 'last frame ends at file size')
  // each frame slice should start with the count line
  const f2 = await blob.slice(idx.offsets[2], idx.ends[2]).text()
  assertTrue(f2.startsWith('7\n'), 'frame slice starts with count line')
}

async function testParseAndStructure() {
  const blob = new Blob([makeXyz(7, 3)])
  const idx = await indexExtxyzFrames(blob)
  const t0 = await blob.slice(idx.offsets[0], idx.ends[0]).text()
  const s = buildStructureFromFrame(t0, 7)
  assertEqual(s.count, 7, 'structure count')
  assertEqual(s.elements.join(','), 'Cu,O', 'species table')
  assertEqual(s.elementIndex[0], 0, 'atom0 Cu'); assertEqual(s.elementIndex[1], 1, 'atom1 O')
  assertEqual(s.positions[0], 0, 'atom0 x@f0')
  // frame 2: atom0 x = 0 + 2*0.5 = 1.0, z = 3.0
  const t2 = await blob.slice(idx.offsets[2], idx.ends[2]).text()
  const out = new Float32Array(21)
  parseFramePositions(t2, 7, out)
  assertTrue(Math.abs(out[0] - 1.0) < 1e-5, 'frame2 atom0 x')
  assertTrue(Math.abs(out[2] - 3.0) < 1e-5, 'frame2 atom0 z')
}

async function testWindowSource() {
  const { source, structure, frameCount } = await createExtxyzFileSource(new Blob([makeXyz(5, 200)]))
  assertEqual(frameCount, 200, '200 frames')
  assertEqual(structure.count, 5, 'structure atoms')
  const out = new Float32Array(15)
  // warmed frames hit immediately
  assertTrue(source.tryGetFrame(0, out), 'frame 0 warm')
  assertTrue(Math.abs(out[2] - 0) < 1e-5, 'frame0 atom0 z=0')
  // far frame: miss first, hit after prefetch resolves
  const cold = source.tryGetFrame(150, out)
  assertEqual(cold, false, 'far frame is a cache miss')
  await source.prefetch(150)
  assertTrue(source.tryGetFrame(150, out), 'frame 150 after prefetch')
  assertTrue(Math.abs(out[2] - 225.0) < 1e-4, 'frame150 atom0 z=150*1.5')
  // window stays bounded after touring many frames
  for (let i = 0; i < 200; i += 1) await source.prefetch(i)
  let resident = 0
  for (let i = 0; i < 200; i++) { if (source.tryGetFrame(i, out)) resident++ }
  assertTrue(resident <= 150, `window bounded (resident=${resident})`)
  source.dispose?.()
}

async function run() {
  await testIndex()
  await testParseAndStructure()
  await testWindowSource()
  console.log('extxyz-frame-source tests passed')
}

void run()

// byte parser must agree with the string parser exactly
async function testByteParser() {
  const text = makeXyz(9, 1) + '' // single frame
  const bytes = new TextEncoder().encode(text)
  const a = new Float32Array(27), b = new Float32Array(27)
  parseFramePositions(text, 9, a)
  parseFrameBytes(bytes, 9, b)
  for (let i = 0; i < 27; i++) assertTrue(Math.abs(a[i] - b[i]) < 1e-5, `byte==string at ${i}`)
  // negative + exponent forms
  const t2 = `2\nLattice="1 0 0 0 1 0 0 0 1"\nCu -1.5 2.25e1 -3.5E-2\nO 0.001 -0.5 1e3\n`
  const c = new Float32Array(6)
  parseFrameBytes(new TextEncoder().encode(t2), 2, c)
  assertTrue(Math.abs(c[0] - -1.5) < 1e-6, 'neg')
  assertTrue(Math.abs(c[1] - 22.5) < 1e-6, 'exp')
  assertTrue(Math.abs(c[2] - -0.035) < 1e-7, 'neg exp')
  assertTrue(Math.abs(c[5] - 1000) < 1e-3, 'e3')
}
void testByteParser().then(() => console.log('byte-parser tests passed'))
