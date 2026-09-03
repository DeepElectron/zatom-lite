import { assertEqual, assertTrue } from '../testing/assert'
import {
  isProjectedCenterInRect,
  boxSelectByProjection,
  type ProjectFn,
  type Projected,
} from '../lib/render/cpu-box-select'

/** Orthographic-ish projection mirroring selection-box.tsx:projectToScreen exactly:
 *  world [-50,50] → ndc [-1,1]; sx=(ndc.x*.5+.5)*w, sy=(-ndc.y*.5+.5)*h; non-finite → null. */
function makeProject(width: number, height: number): ProjectFn {
  return (x, y, z) => {
    const nx = x / 50, ny = y / 50, nz = z / 50
    if (!Number.isFinite(nx) || !Number.isFinite(ny) || !Number.isFinite(nz)) return null
    return { sx: (nx * 0.5 + 0.5) * width, sy: (-ny * 0.5 + 0.5) * height, ndcZ: nz }
  }
}

function predicateTests() {
  const rect = { minX: 10, maxX: 90, minY: 10, maxY: 90 }
  const inside: Projected = { sx: 50, sy: 50, ndcZ: 0 }
  assertEqual(isProjectedCenterInRect(inside, rect), true, 'inside, z=0 → true')
  assertEqual(isProjectedCenterInRect(null, rect), false, 'null projection → false')
  assertEqual(isProjectedCenterInRect({ sx: 50, sy: 50, ndcZ: 1.5 }, rect), false, 'ndcZ>1 culled')
  assertEqual(isProjectedCenterInRect({ sx: 50, sy: 50, ndcZ: -1.5 }, rect), false, 'ndcZ<-1 culled')
  assertEqual(isProjectedCenterInRect({ sx: 50, sy: 50, ndcZ: 1 }, rect), true, 'ndcZ=1 inclusive')
  assertEqual(isProjectedCenterInRect({ sx: 50, sy: 50, ndcZ: -1 }, rect), true, 'ndcZ=-1 inclusive')
  assertEqual(isProjectedCenterInRect({ sx: 10, sy: 90, ndcZ: 0 }, rect), true, 'on the rect boundary inclusive')
  assertEqual(isProjectedCenterInRect({ sx: 9.999, sy: 50, ndcZ: 0 }, rect), false, 'just outside x')
}

/** Reference replication of selection-box.tsx's exact loop, as the oracle. */
function selectionBoxOracle(positions: Float32Array, candidates: number[], project: ProjectFn, a: { x: number; y: number }, b: { x: number; y: number }): number[] {
  const minX = Math.min(a.x, b.x), maxX = Math.max(a.x, b.x)
  const minY = Math.min(a.y, b.y), maxY = Math.max(a.y, b.y)
  const out: number[] = []
  for (const idx of candidates) {
    const p = project(positions[idx * 3], positions[idx * 3 + 1], positions[idx * 3 + 2])
    if (!p || p.ndcZ < -1 || p.ndcZ > 1) continue
    if (p.sx >= minX && p.sx <= maxX && p.sy >= minY && p.sy <= maxY) out.push(idx)
  }
  return out
}

const NO_CAP = 1_000_000

function oracleEquivalenceTests() {
  const W = 200, H = 100
  const project = makeProject(W, H)
  // 6×6×6 lattice across [-45,45]
  const p: number[] = []
  for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) for (let k = 0; k < 6; k++) p.push(-45 + i * 18, -45 + j * 18, -45 + k * 18)
  const positions = Float32Array.from(p)
  const candidates = Array.from({ length: positions.length / 3 }, (_, n) => n)
  const boxStart = { x: 60, y: 20 }, boxEnd = { x: 150, y: 80 }
  const oracle = selectionBoxOracle(positions, candidates, project, boxStart, boxEnd)
  const got = boxSelectByProjection(positions, candidates, project, boxStart, boxEnd, NO_CAP, NO_CAP)
  assertEqual(got.selected.length, oracle.length, 'same count as selection-box oracle')
  for (let n = 0; n < oracle.length; n++) assertEqual(got.selected[n], oracle[n], `same index at ${n}`)
  assertTrue(!got.selectedTruncated && !got.candidateTruncated, 'not truncated under caps')
  assertTrue(oracle.length > 0, 'oracle actually selected something')
}

function cornerOrderTests() {
  const project = makeProject(200, 100)
  const positions = Float32Array.from([0, 0, 0, 40, 40, 0])
  const candidates = [0, 1]
  const fwd = boxSelectByProjection(positions, candidates, project, { x: 20, y: 10 }, { x: 180, y: 90 }, NO_CAP, NO_CAP)
  const rev = boxSelectByProjection(positions, candidates, project, { x: 180, y: 90 }, { x: 20, y: 10 }, NO_CAP, NO_CAP)
  assertEqual(JSON.stringify(fwd.selected), JSON.stringify(rev.selected), 'corner order independent')
}

function selectedCapTests() {
  const project = makeProject(200, 100)
  const p: number[] = []
  for (let i = 0; i < 50; i++) p.push(0, 0, 0) // all project to screen centre, all inside
  const positions = Float32Array.from(p)
  const candidates = Array.from({ length: 50 }, (_, n) => n)
  const res = boxSelectByProjection(positions, candidates, project, { x: 0, y: 0 }, { x: 200, y: 100 }, NO_CAP, 10)
  assertEqual(res.selected.length, 10, 'capped to exactly selectedMax')
  assertTrue(res.selectedTruncated, 'selectedTruncated flag set')
  assertTrue(!res.candidateTruncated, 'candidateTruncated NOT set (it was a selected cap)')
  for (let n = 0; n < 10; n++) assertEqual(res.selected[n], n, 'cap keeps candidate-order prefix')
}

/**
 * Regression for the false-negative: out-of-box candidates appearing FIRST must not hide later
 * in-box matches (the bug when a candidate cap was applied BEFORE the exact filter). With an
 * adequate budget the fused filter finds every in-box atom regardless of order.
 */
function fusedFilterNoFalseNegativeTests() {
  const project = makeProject(200, 100)
  // atoms 0,1,2 project outside the rect (far corner); atoms 3,4 project to centre (inside).
  const positions = Float32Array.from([49, 49, 0, 49, 49, 0, 49, 49, 0, 0, 0, 0, 0, 0, 0])
  const rect = { s: { x: 80, y: 30 }, e: { x: 120, y: 70 } } // centre-only rect; corner (≈198,1) excluded
  const candidates = [0, 1, 2, 3, 4]
  const got = boxSelectByProjection(positions, candidates, project, rect.s, rect.e, NO_CAP, NO_CAP)
  assertEqual(JSON.stringify(got.selected), JSON.stringify([3, 4]), 'later in-box matches found despite earlier misses')
  assertTrue(!got.candidateTruncated && !got.selectedTruncated, 'no truncation under adequate budget')
}

/** candidateMax is a responsiveness fence: stops TESTING early and flags candidateTruncated honestly. */
function candidateFenceTests() {
  const project = makeProject(200, 100)
  const positions = Float32Array.from([49, 49, 0, 49, 49, 0, 0, 0, 0]) // 0,1 outside; 2 inside
  // budget of 2 tested → stops before reaching the inside atom 2 → incomplete, not "nothing matched"
  const res = boxSelectByProjection(positions, [0, 1, 2], project, { x: 80, y: 30 }, { x: 120, y: 70 }, 2, NO_CAP)
  assertEqual(res.selected.length, 0, 'no match within the tested budget')
  assertTrue(res.candidateTruncated, 'candidateTruncated set (selection incomplete)')
  assertTrue(!res.selectedTruncated, 'selectedTruncated NOT set')
}

function run() {
  predicateTests()
  oracleEquivalenceTests()
  cornerOrderTests()
  selectedCapTests()
  fusedFilterNoFalseNegativeTests()
  candidateFenceTests()
  console.log('cpu-box-select tests passed')
}

run()
