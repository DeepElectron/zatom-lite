import { assertEqual } from '../testing/assert'
import { pruneOverlaps } from '../lib/polycrystal/overlap-prune'

function testRemovesCrossGrainCloserThanDmin() {
  const positions = new Float32Array([0, 0, 0, 0.5, 0, 0])
  const grainId = new Uint32Array([0, 1])
  const elementIndex = new Uint8Array([0, 0])
  const out = pruneOverlaps(positions, grainId, elementIndex, Uint32Array.from([0, 1]), 1.0)
  assertEqual(out.count, 1, 'one cross-grain atom removed')
}

function testKeepsCrossGrainBeyondDmin() {
  const positions = new Float32Array([0, 0, 0, 2, 0, 0])
  const grainId = new Uint32Array([0, 1])
  const elementIndex = new Uint8Array([0, 0])
  const out = pruneOverlaps(positions, grainId, elementIndex, Uint32Array.from([0, 1]), 1.0)
  assertEqual(out.count, 2, 'far apart → both kept')
}

function testNeverRemovesIntraGrain() {
  const positions = new Float32Array([0, 0, 0, 0.1, 0, 0])
  const grainId = new Uint32Array([5, 5])
  const elementIndex = new Uint8Array([0, 0])
  const out = pruneOverlaps(positions, grainId, elementIndex, Uint32Array.from([0, 1]), 1.0)
  assertEqual(out.count, 2, 'intra-grain never pruned')
}

function testDisabledWhenDminZero() {
  const positions = new Float32Array([0, 0, 0, 0.1, 0, 0])
  const grainId = new Uint32Array([0, 1])
  const elementIndex = new Uint8Array([0, 0])
  const out = pruneOverlaps(positions, grainId, elementIndex, Uint32Array.from([0, 0]), 0)
  assertEqual(out.count, 2, 'dmin=0 disables pruning')
}

function run() {
  testRemovesCrossGrainCloserThanDmin()
  testKeepsCrossGrainBeyondDmin()
  testNeverRemovesIntraGrain()
  testDisabledWhenDminZero()
  console.log('polycrystal overlap-prune tests passed')
}

run()
