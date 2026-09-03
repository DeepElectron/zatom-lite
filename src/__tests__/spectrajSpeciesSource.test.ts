import { assertEqual, assertTrue } from '../testing/assert'
import { unpackSpeciesRow, SpectrajWindowSource } from '../lib/render/spectraj-species-source'

function testUnpackByteAligned() {
  // 16 atoms, pattern 1010... in two bytes. packbits is MSB-first.
  const packed = new Uint8Array([0b10101010, 0b11001100])
  const out = new Uint8Array(16)
  unpackSpeciesRow(packed, 16, out)
  const expected = [1, 0, 1, 0, 1, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 0]
  for (let i = 0; i < 16; i++) assertEqual(out[i], expected[i], `bit ${i}`)
}

function testUnpackNonAligned() {
  // 13 atoms → 2 bytes, last 3 bits are padding and must be ignored.
  const packed = new Uint8Array([0b11110000, 0b10101000])
  const out = new Uint8Array(13)
  unpackSpeciesRow(packed, 13, out)
  const expected = [1, 1, 1, 1, 0, 0, 0, 0, 1, 0, 1, 0, 1]
  for (let i = 0; i < 13; i++) assertEqual(out[i], expected[i], `bit ${i}`)
  assertEqual(out.length, 13, 'length')
}

// Build a raw-codec mask blob: `frames` × rowBytes packed rows, plus a frameOffsets table.
function buildRawMask(frames: number[][], atomCount: number): { blob: Blob; offsets: number[] } {
  const rowBytes = Math.ceil(atomCount / 8)
  const rows: Uint8Array[] = []
  const offsets = [0]
  for (const species of frames) {
    const row = new Uint8Array(rowBytes)
    for (let i = 0; i < atomCount; i++) if (species[i]) row[i >> 3] |= 1 << (7 - (i & 7))
    rows.push(row)
    offsets.push(offsets[offsets.length - 1] + rowBytes)
  }
  return { blob: new Blob(rows as unknown as BlobPart[]), offsets }
}

async function testWindowSourceRoundTrip() {
  const atomCount = 13
  const frames = [
    Array.from({ length: 13 }, (_, i) => (i % 2) as number),
    Array.from({ length: 13 }, (_, i) => ((i + 1) % 2) as number),
    Array.from({ length: 13 }, () => 1),
  ]
  const { blob, offsets } = buildRawMask(frames, atomCount)
  const src = new SpectrajWindowSource(blob, offsets, atomCount, 'raw')
  assertEqual(src.frameCount, 3, 'frameCount')
  assertEqual(src.atomCount, 13, 'atomCount')
  const out = new Uint8Array(13)
  // cold read → miss, then prefetch resolves, then hit
  assertTrue(!src.tryGetSpecies(1, out), 'cold miss')
  await src.prefetch(1)
  assertTrue(src.tryGetSpecies(1, out), 'hit after prefetch')
  for (let i = 0; i < 13; i++) assertEqual(out[i], frames[1][i], `frame1 atom ${i}`)
  await src.prefetch(2)
  assertTrue(src.tryGetSpecies(2, out), 'frame2 hit')
  for (let i = 0; i < 13; i++) assertEqual(out[i], 1, `frame2 atom ${i}`)
}

// The core memory guarantee: streaming many frames must NOT retain them all — early
// frames are evicted so resident RAM is bounded by the window, independent of frameCount.
async function testWindowBoundedMemory() {
  const atomCount = 16
  const N = 200
  const frames = Array.from({ length: N }, (_, f) => Array.from({ length: 16 }, (_, i) => (f + i) % 2))
  const { blob, offsets } = buildRawMask(frames, atomCount)
  const src = new SpectrajWindowSource(blob, offsets, atomCount, 'raw')
  const out = new Uint8Array(16)
  for (let f = 0; f < N; f++) { await src.prefetch(f); src.tryGetSpecies(f, out) }
  assertTrue(!src.tryGetSpecies(0, out), 'early frame evicted → memory bounded by window')
  assertTrue(src.tryGetSpecies(N - 1, out), 'recent frame still resident')
}

async function run() {
  testUnpackByteAligned()
  testUnpackNonAligned()
  await testWindowSourceRoundTrip()
  await testWindowBoundedMemory()
  console.log('spectraj-species-source tests passed')
}

run()
