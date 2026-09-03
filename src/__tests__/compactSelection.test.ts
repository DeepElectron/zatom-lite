import { assertEqual, assertTrue } from '../testing/assert'
import {
  encodeId, decodeId, buildSelectedFlags,
  deleteIndices, selectedToXYZ, selectionCentroidSpread,
} from '../lib/render/compact-selection'
import type { CompactStructure } from '../lib/render/compact-selection'

function makeCompact(): CompactStructure {
  return {
    positions: new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0, 10]),
    elementIndex: new Uint8Array([0, 1, 0, 1]),
    elements: ['Cu', 'O'],
    grainId: new Uint32Array([2, 5, 2, 5]),
    count: 4,
    bbox: { min: [0, 0, 0], max: [10, 10, 10] },
  }
}

function testIdRoundTrip() {
  for (const id of [0, 1, 255, 256, 65535, 65536, 1_000_000, 16_000_000]) {
    const [r, g, b] = encodeId(id)
    assertTrue(r >= 0 && r <= 255 && g >= 0 && g <= 255 && b >= 0 && b <= 255, `bytes in range for ${id}`)
    assertEqual(decodeId(r, g, b), id, `round-trip ${id}`)
  }
}

function testDecodeBackground() {
  assertEqual(decodeId(0, 0, 0), -1, 'all-zero = miss (-1)')
}

function testSelectedFlags() {
  const f = buildSelectedFlags(5, new Set([1, 3]))
  assertEqual(f.length, 5, 'length = count')
  assertEqual(f[0], 0, 'unselected 0'); assertEqual(f[1], 1, 'selected 1')
  assertEqual(f[2], 0, 'unselected 0'); assertEqual(f[3], 1, 'selected 1'); assertEqual(f[4], 0, 'unselected 0')
}

function testDelete() {
  const c = makeCompact()
  const out = deleteIndices(c, new Set([1, 3]))
  assertEqual(out.count, 2, 'two removed')
  assertEqual(out.elements[out.elementIndex[0]], 'Cu', 'kept atom 0 = Cu')
  assertEqual(out.positions[0], 0, 'atom0 x'); assertEqual(out.positions[3], 0, 'atom2 x kept')
  assertEqual(out.positions[4], 10, 'atom2 y=10 kept'); assertEqual(out.grainId![0], 2, 'grain kept')
  assertEqual(out.bbox.max[1], 10, 'bbox recomputed (max y = 10)')
}

function testExport() {
  const c = makeCompact()
  const xyz = selectedToXYZ(c, new Set([0, 2]))
  const lines = xyz.split('\n')
  assertEqual(parseInt(lines[0]), 2, 'count = 2')
  assertTrue(lines[1].includes('Lattice='), 'extended-xyz header')
  assertTrue(lines[2].startsWith('Cu '), 'first selected = Cu')
}

function testCentroid() {
  const c = makeCompact()
  const { center, spread } = selectionCentroidSpread(c, new Set([0, 1]))
  assertEqual(center[0], 5, 'centroid x = (0+10)/2')
  assertTrue(Math.abs(spread - 5) < 1e-6, 'spread = 5 (max dist to centroid)')
}

function run() {
  testIdRoundTrip(); testDecodeBackground(); testSelectedFlags()
  testDelete(); testExport(); testCentroid()
  console.log('compact-selection tests passed')
}

run()
