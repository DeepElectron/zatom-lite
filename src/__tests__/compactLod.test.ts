import { assertEqual, assertTrue } from '../testing/assert'
import {
  COMPACT_SPHERE_MAX_ATOMS,
  COMPACT_CPU_TILE_PICK_MAX_ATOMS,
  COMPACT_BOX_TILE_MAX_ATOMS,
  COMPACT_TILE_EDGE_MIN_A,
  COMPACT_TILE_EDGE_MAX_A,
  compactRenderMode,
  compactPickMode,
  compactBoxSelectMode,
  compactHoverEnabled,
  compactTileEdge,
} from '../lib/render/compact-lod'

/** Sphere impostors at or below the cap, GL points above it. */
function renderModeTests() {
  assertEqual(compactRenderMode(1), 'sphere', 'tiny → sphere')
  assertEqual(compactRenderMode(COMPACT_SPHERE_MAX_ATOMS), 'sphere', 'exactly at cap → sphere')
  assertEqual(compactRenderMode(COMPACT_SPHERE_MAX_ATOMS + 1), 'points', 'one past cap → points')
  assertEqual(compactRenderMode(10_000_000), 'points', '10M → points')
}

/** Selection ladder: GPU ≤250k, CPU tile 250k..2M, tile focus >2M. */
function pickModeTests() {
  assertEqual(compactPickMode(250_000), 'gpu', '≤250k → gpu id picker')
  assertEqual(compactPickMode(250_001), 'cpu-tile', 'past 250k → cpu tile pick')
  assertEqual(compactPickMode(COMPACT_CPU_TILE_PICK_MAX_ATOMS), 'cpu-tile', 'at 2M → cpu tile pick')
  assertEqual(compactPickMode(COMPACT_CPU_TILE_PICK_MAX_ATOMS + 1), 'tile-focus', 'past 2M → tile focus only')
}

/** Box-selection ladder: full ≤250k, tile 250k..1M, disabled >1M. */
function boxSelectTests() {
  assertEqual(compactBoxSelectMode(250_000), 'full', '≤250k → full box-select')
  assertEqual(compactBoxSelectMode(250_001), 'tile', 'past 250k → tile-scoped')
  assertEqual(compactBoxSelectMode(COMPACT_BOX_TILE_MAX_ATOMS), 'tile', 'at 1M → tile-scoped')
  assertEqual(compactBoxSelectMode(COMPACT_BOX_TILE_MAX_ATOMS + 1), 'disabled', 'past 1M → disabled')
}

/** Hover is disabled above 2M, leaving tile-focus single-click only. */
function hoverTests() {
  assertEqual(compactHoverEnabled(2_000_000), true, 'hover on at 2M')
  assertEqual(compactHoverEnabled(2_000_001), false, 'hover off past 2M')
}

/** Edge = clamp(cuberoot(16384/density), 32, 128) Å. */
function tileEdgeTests() {
  // Si conventional cell: 8 atoms in a³ (a=5.431) → density ≈ 0.0499 atoms/Å³ → ~69 Å.
  const siEdge = compactTileEdge(8, 5.431 ** 3)
  assertTrue(siEdge > 60 && siEdge < 75, `Si tile edge ~69 Å, got ${siEdge}`)
  assertTrue(siEdge >= COMPACT_TILE_EDGE_MIN_A && siEdge <= COMPACT_TILE_EDGE_MAX_A, 'Si edge within clamp')
  // Dense (1 atom/Å³): cuberoot(16384) ≈ 25.4 → clamps up to the floor.
  assertEqual(compactTileEdge(1000, 1000), COMPACT_TILE_EDGE_MIN_A, 'dense clamps to min edge')
  // Sparse (1e-9 atoms/Å³): huge → clamps down to the ceiling.
  assertEqual(compactTileEdge(1, 1e9), COMPACT_TILE_EDGE_MAX_A, 'sparse clamps to max edge')
  // Degenerate (no atoms / zero volume): fall back to max edge, never NaN/0.
  assertEqual(compactTileEdge(0, 100), COMPACT_TILE_EDGE_MAX_A, 'zero atoms → max edge')
  assertEqual(compactTileEdge(100, 0), COMPACT_TILE_EDGE_MAX_A, 'zero volume → max edge')
}

function run() {
  renderModeTests()
  pickModeTests()
  boxSelectTests()
  hoverTests()
  tileEdgeTests()
  console.log('compact-lod tests passed')
}

run()
