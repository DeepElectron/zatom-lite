import { assertEqual, assertTrue } from '../testing/assert'
import { createSpectrajSource, parseSpectrajHeader } from '../lib/render/spectraj'

// Hand-build a raw-codec .spectraj Blob: 2 atoms (1 layer), 2 frames.
function buildSpectraj(): Blob {
  const count = 2, frameCount = 2, rowBytes = 1
  const positions = new Float32Array([0, 0, 0, 1, 0, 0])
  const palette = [[1, 1, 1], [0, 0, 0]]
  const header = {
    version: 1, count, frameCount, elements: ['Si', 'Ge'], palette,
    trajFps: 30, a: 1, d: 1, W: 2, H: 1, layers: 1, rowBytes,
    codec: 'raw', positionsBytes: count * 3 * 4, offsetTableBytes: (frameCount + 1) * 4,
  }
  const headerBytes = new TextEncoder().encode(JSON.stringify(header))
  const offsets = new Uint32Array([0, rowBytes, rowBytes * 2]) // frame0 @0, frame1 @1
  // frame0: atom0=Si(0), atom1=Ge(1) → bits 01 → 0b01000000; frame1: both Ge → 0b11000000
  const mask = new Uint8Array([0b01000000, 0b11000000])
  const head = new Uint8Array(8)
  const dv = new DataView(head.buffer)
  dv.setUint32(0, 0x53504354, false) // "SPCT" big-endian magic
  dv.setUint32(4, headerBytes.length, true)
  return new Blob([head, headerBytes, positions.buffer, offsets.buffer, mask] as unknown as BlobPart[])
}

async function testParseHeader() {
  const { header, bodyStart } = await parseSpectrajHeader(buildSpectraj())
  assertEqual(header.count, 2, 'count')
  assertEqual(header.frameCount, 2, 'frameCount')
  assertEqual(header.codec, 'raw', 'codec')
  assertTrue(bodyStart > 8, 'bodyStart past header')
}

async function testCreateSpectrajSource() {
  const { structure, source, frameCount, trajFps } = await createSpectrajSource(buildSpectraj())
  assertEqual(frameCount, 2, 'frameCount')
  assertEqual(trajFps, 30, 'trajFps')
  assertEqual(structure.count, 2, 'count')
  assertEqual(structure.positions[3], 1, 'atom1 x')
  assertTrue(!!structure.palette, 'palette present')
  assertEqual(structure.elementIndex[1], 1, 'frame0 atom1 Ge (initial)')
  await source.prefetch(0); await source.prefetch(1)
  const out = new Uint8Array(2)
  assertTrue(source.tryGetSpecies(0, out), 'f0 hit')
  assertEqual(out[0], 0, 'f0 a0 Si'); assertEqual(out[1], 1, 'f0 a1 Ge')
  assertTrue(source.tryGetSpecies(1, out), 'f1 hit')
  assertEqual(out[0], 1, 'f1 a0 Ge'); assertEqual(out[1], 1, 'f1 a1 Ge')
}

async function run() {
  await testParseHeader()
  await testCreateSpectrajSource()
  console.log('spectraj tests passed')
}

run()
