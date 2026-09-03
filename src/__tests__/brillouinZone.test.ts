/**
 * Verify Wigner-Seitz output from lib/brillouin using known geometric facts rather than snapshots.
 *
 * - Simple cubic BZ: cube with 6 faces, 8 vertices, and 12 edges.
 * - FCC BZ: truncated octahedron with 14 faces, 24 vertices, and 36 edges.
 * - BCC BZ: rhombic dodecahedron with 12 faces, 14 vertices, and 24 edges.
 * - Simple cubic BZ volume: (2pi/a)^3.
 *
 * These three cubic Bravais lattices cover planar and non-planar faces plus vertices shared by
 * four or more faces.
 */

import { assertEqual, assertTrue } from '../testing/assert'
import {
  constructBrillouinZone,
  reciprocalLattice,
  type Vec3,
} from '../lib/brillouin/wigner-seitz'
import {
  conventionalToPrimitiveLattice,
  fitBrillouinZoneToCell,
} from '../lib/crystal/brillouin-zone'

function run() {
  // ── reciprocal lattice basic identity ──────────────────────────────────
  // For a cubic lattice a=1: b_i = 2π * e_i.
  {
    const recip = reciprocalLattice([1, 0, 0], [0, 1, 0], [0, 0, 1])
    const tol = 1e-9
    assertTrue(Math.abs(recip[0][0] - 2 * Math.PI) < tol, 'recip b1.x ≈ 2π')
    assertTrue(Math.abs(recip[1][1] - 2 * Math.PI) < tol, 'recip b2.y ≈ 2π')
    assertTrue(Math.abs(recip[2][2] - 2 * Math.PI) < tol, 'recip b3.z ≈ 2π')
    console.log('  ✓ reciprocalLattice gives 2π·I for cubic a=1')
  }

  // ── simple cubic BZ = cube ─────────────────────────────────────────────
  {
    // direct lattice a=1 → reciprocal is 2π·I. BZ = cube of side 2π, V=(2π)^3.
    const recip = reciprocalLattice([1, 0, 0], [0, 1, 0], [0, 0, 1])
    const bz = constructBrillouinZone(recip[0], recip[1], recip[2])

    assertEqual(bz.faces.length, 6, 'sc BZ has 6 faces (cube)')
    assertEqual(bz.vertices.length, 8, 'sc BZ has 8 vertices (cube)')
    assertEqual(bz.edges.length, 12, 'sc BZ has 12 edges (cube)')

    // Volume should equal (2π)^3 within numerical tolerance.
    const expected = (2 * Math.PI) ** 3
    const relErr = Math.abs(bz.volume - expected) / expected
    assertTrue(relErr < 1e-6, `sc BZ volume ≈ (2π)^3, rel err ${relErr}`)
    console.log('  ✓ simple cubic BZ = 6 faces / 8 vertices / 12 edges, volume = (2π)^3')
  }

  // ── fcc BZ = truncated octahedron ──────────────────────────────────────
  {
    // fcc primitive vectors with conventional cube edge a=1:
    // a1=(0,1/2,1/2), a2=(1/2,0,1/2), a3=(1/2,1/2,0)
    const recip = reciprocalLattice([0, 0.5, 0.5], [0.5, 0, 0.5], [0.5, 0.5, 0])
    const bz = constructBrillouinZone(recip[0], recip[1], recip[2])

    // Truncated octahedron: 14 faces (8 hexagons + 6 squares), 24 vertices, 36 edges.
    assertEqual(bz.faces.length, 14, `fcc BZ has 14 faces (got ${bz.faces.length})`)
    assertEqual(bz.vertices.length, 24, `fcc BZ has 24 vertices (got ${bz.vertices.length})`)
    assertEqual(bz.edges.length, 36, `fcc BZ has 36 edges (got ${bz.edges.length})`)

    let hex = 0, sq = 0
    for (const f of bz.faces) {
      if (f.length === 6) hex++
      else if (f.length === 4) sq++
    }
    assertEqual(hex, 8, `fcc BZ has 8 hexagonal faces (got ${hex})`)
    assertEqual(sq, 6, `fcc BZ has 6 square faces (got ${sq})`)

    // volume of reciprocal cell = (2π)^3 / V_direct. V_direct = 1/4 for fcc primitive of a=1.
    const expected = (2 * Math.PI) ** 3 / 0.25
    const relErr = Math.abs(bz.volume - expected) / expected
    assertTrue(relErr < 1e-6, `fcc BZ volume ≈ 32π^3, rel err ${relErr}`)
    console.log('  ✓ fcc BZ = truncated octahedron (8 hex + 6 sq, 24 vert, 36 edges)')
  }

  // ── bcc BZ = rhombic dodecahedron ─────────────────────────────────────
  {
    // bcc primitive: a1=(-1/2,1/2,1/2), a2=(1/2,-1/2,1/2), a3=(1/2,1/2,-1/2) for cube a=1.
    const recip = reciprocalLattice([-0.5, 0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, -0.5])
    const bz = constructBrillouinZone(recip[0], recip[1], recip[2])

    // Rhombic dodecahedron: 12 faces (all rhombic), 14 vertices, 24 edges.
    assertEqual(bz.faces.length, 12, `bcc BZ has 12 faces (got ${bz.faces.length})`)
    assertEqual(bz.vertices.length, 14, `bcc BZ has 14 vertices (got ${bz.vertices.length})`)
    assertEqual(bz.edges.length, 24, `bcc BZ has 24 edges (got ${bz.edges.length})`)
    for (const f of bz.faces) {
      assertEqual(f.length, 4, `bcc BZ face must be rhombic (4-sided), got ${f.length}`)
    }
    console.log('  ✓ bcc BZ = rhombic dodecahedron (12 rhombic faces, 14 vert, 24 edges)')
  }

  // ── Euler V - E + F = 2 ────────────────────────────────────────────────
  {
    // verify topology invariant for all three cases.
    const cases: { name: string; recip: [Vec3, Vec3, Vec3] }[] = [
      { name: 'sc', recip: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as [Vec3, Vec3, Vec3] },
      { name: 'fcc', recip: [...reciprocalLattice([0, 0.5, 0.5], [0.5, 0, 0.5], [0.5, 0.5, 0])] as [Vec3, Vec3, Vec3] },
      { name: 'bcc', recip: [...reciprocalLattice([-0.5, 0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, -0.5])] as [Vec3, Vec3, Vec3] },
    ]
    for (const c of cases) {
      const bz = constructBrillouinZone(c.recip[0], c.recip[1], c.recip[2])
      const euler = bz.vertices.length - bz.edges.length + bz.faces.length
      assertEqual(euler, 2, `Euler V-E+F=2 for ${c.name}, got ${euler}`)
    }
    console.log('  ✓ Euler V-E+F=2 holds for sc / fcc / bcc BZs')
  }

  // ── main-viewport display keeps reciprocal geometry undistorted ────────
  {
    const reciprocalVertices: [number, number, number][] = [
      [-2, -1, -0.5],
      [2, 1, 0.5],
      [1, -1.5, 0.25],
    ]
    const transform = fitBrillouinZoneToCell(
      reciprocalVertices,
      [4, 0, 0],
      [1, 3, 0],
      [0.5, 0.25, 5],
    )

    assertTrue(
      Math.abs(transform.origin[0] - 2.75) < 1e-12 &&
      Math.abs(transform.origin[1] - 1.625) < 1e-12 &&
      Math.abs(transform.origin[2] - 2.5) < 1e-12,
      'BZ display is anchored at the real-cell center',
    )
    assertTrue(transform.scale > 0 && Number.isFinite(transform.scale), 'BZ display scale is finite and positive')

    const p = reciprocalVertices[0]
    const q = reciprocalVertices[1]
    const rawDistance = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2])
    const displayDistance = Math.hypot(
      (q[0] - p[0]) * transform.scale,
      (q[1] - p[1]) * transform.scale,
      (q[2] - p[2]) * transform.scale,
    )
    assertTrue(
      Math.abs(displayDistance / rawDistance - transform.scale) < 1e-12,
      'BZ display uses one uniform scale and preserves reciprocal-space shape',
    )
    console.log('  ✓ main-viewport BZ fit preserves reciprocal-space shape')
  }

  // ── centered conventional cells use their primitive lattice ───────────
  {
    const a1: [number, number, number] = [4, 0, 0]
    const a2: [number, number, number] = [0, 4, 0]
    const a3: [number, number, number] = [0, 0, 4]
    const volume = (vectors: [[number, number, number], [number, number, number], [number, number, number]]) => {
      const [u, v, w] = vectors
      return Math.abs(
        u[0] * (v[1] * w[2] - v[2] * w[1]) -
        u[1] * (v[0] * w[2] - v[2] * w[0]) +
        u[2] * (v[0] * w[1] - v[1] * w[0]),
      )
    }

    assertTrue(Math.abs(volume(conventionalToPrimitiveLattice(a1, a2, a3, 'F')) - 16) < 1e-12, 'F primitive volume is conventional volume / 4')
    assertTrue(Math.abs(volume(conventionalToPrimitiveLattice(a1, a2, a3, 'I')) - 32) < 1e-12, 'I primitive volume is conventional volume / 2')
    assertTrue(Math.abs(volume(conventionalToPrimitiveLattice(a1, a2, a3, 'C')) - 32) < 1e-12, 'C primitive volume is conventional volume / 2')
    assertTrue(Math.abs(volume(conventionalToPrimitiveLattice(a1, a2, a3, 'A')) - 32) < 1e-12, 'A primitive volume is conventional volume / 2')

    const fPrimitive = conventionalToPrimitiveLattice(a1, a2, a3, 'F')
    const fReciprocal = reciprocalLattice(...fPrimitive)
    const fZone = constructBrillouinZone(...fReciprocal)
    assertEqual(fZone.faces.length, 14, 'runtime FCC overlay must be a truncated octahedron')
    assertEqual(fZone.vertices.length, 24, 'runtime FCC overlay must have 24 vertices')

    const iPrimitive = conventionalToPrimitiveLattice(a1, a2, a3, 'I')
    const iReciprocal = reciprocalLattice(...iPrimitive)
    const iZone = constructBrillouinZone(...iReciprocal)
    assertEqual(iZone.faces.length, 12, 'runtime BCC overlay must be a rhombic dodecahedron')
    assertEqual(iZone.vertices.length, 14, 'runtime BCC overlay must have 14 vertices')
    console.log('  ✓ centered conventional cells convert to primitive lattices')
  }

  console.log('brillouinZone tests passed')
}

run()
