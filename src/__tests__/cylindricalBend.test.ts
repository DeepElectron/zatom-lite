import { assertTrue } from '../testing/assert'
import { cylindricalBend, greenStrainLagrange, cylindricalBendWrapsArc, bentReferenceArcWraps, type Vec3, type Mat3 } from '../lib/deformation/cylindrical-bend'

// --- tiny vector helpers (test-local) ---
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s]
const norm = (a: Vec3): Vec3 => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l] }
const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
/** Mat3 (row-major) times a column vector. */
const matVec = (M: Mat3, v: Vec3): Vec3 => [
  M[0] * v[0] + M[1] * v[1] + M[2] * v[2],
  M[3] * v[0] + M[4] * v[1] + M[5] * v[2],
  M[6] * v[0] + M[7] * v[1] + M[8] * v[2],
]
/** strain component along directions u (left) and w (right): uᵀ E w. */
const project = (E: Mat3, u: Vec3, w: Vec3) => dot(u, matVec(E, w))

// A rotated (non-axis-aligned) orthonormal bend triad plus offset origin catches reference-frame bugs.
const tangent = norm([1, 1, 0])
const radial = norm([-1, 1, 0])
const axis: Vec3 = [0, 0, 1]
const bendOrigin: Vec3 = [5, -3, 2]
const R = 1000

const field = cylindricalBend({ R, tangent, radial, axis, bendOrigin })
/** Reference point from local bend coordinates (s along arc, r transverse, z along axis). */
const refPoint = (s: number, r: number, z: number): Vec3 =>
  add(bendOrigin, add(add(scale(tangent, s), scale(radial, r)), scale(axis, z)))

/** Green strain (analytic Jacobian) at a local coord, projected onto the bend triad. */
function strainAt(s: number, r: number, z: number) {
  const X = refPoint(s, r, z)
  const E = greenStrainLagrange(field.deformationGradient(X))
  return {
    ss: project(E, tangent, tangent),
    rr: project(E, radial, radial),
    zz: project(E, axis, axis),
    sr: project(E, tangent, radial),
    sz: project(E, tangent, axis),
    rz: project(E, radial, axis),
  }
}

/** Numerical deformation gradient via central difference of the map (Float64) — validates the MAP itself. */
function numericGradient(X: Vec3): Mat3 {
  const h = 1e-3
  const cols: Vec3[] = []
  for (let k = 0; k < 3; k++) {
    const xp: Vec3 = [...X] as Vec3, xm: Vec3 = [...X] as Vec3
    xp[k] += h; xm[k] -= h
    const fp = field.map(xp), fm = field.map(xm)
    cols.push([(fp[0] - fm[0]) / (2 * h), (fp[1] - fm[1]) / (2 * h), (fp[2] - fm[2]) / (2 * h)])
  }
  // assemble row-major F with columns = ∂x/∂X_k
  return [cols[0][0], cols[1][0], cols[2][0], cols[0][1], cols[1][1], cols[2][1], cols[0][2], cols[1][2], cols[2][2]]
}

/** Neutral fiber (r=0) must lie on a circle of radius R, i.e. arc length is preserved. */
function neutralFiberTests() {
  const center = add(bendOrigin, scale(radial, -R)) // neutral circle centre
  for (const s of [-300, -100, 0, 100, 300]) {
    const x = field.map(refPoint(s, 0, 0))
    assertTrue(Math.abs(dist(x, center) - R) < 1e-6, `neutral point s=${s} on radius-R circle (got ${dist(x, center)})`)
  }
  // arc length between two neutral points = Δs (angle Δs/R on radius R)
  const a = field.map(refPoint(100, 0, 0)), b = field.map(refPoint(220, 0, 0))
  const chord = dist(a, b)
  const expectedChord = 2 * R * Math.sin((220 - 100) / (2 * R)) // chord of arc Δs on radius R
  assertTrue(Math.abs(chord - expectedChord) < 1e-4, `neutral arc length preserved (chord ${chord} vs ${expectedChord})`)
}

/** Analytic Green strain must equal finite-strain bend theory E_ss = r/R + ½(r/R)², off-diagonals ~0. */
function analyticStrainTests() {
  for (const r of [-20, -8, 0, 8, 20])
    for (const s of [-200, 0, 200])
      for (const z of [-10, 0, 10]) {
        const e = strainAt(s, r, z)
        const expected = r / R + 0.5 * (r / R) ** 2
        assertTrue(Math.abs(e.ss - expected) < 2e-12, `E_ss(r=${r}) = r/R+½(r/R)² (got ${e.ss}, want ${expected})`)
        assertTrue(Math.abs(e.sr) < 1e-12 && Math.abs(e.sz) < 1e-12 && Math.abs(e.rz) < 1e-12, `off-diagonal ~0 at r=${r},s=${s}`)
        assertTrue(Math.abs(e.rr) < 1e-12 && Math.abs(e.zz) < 1e-12, `transverse Green strain ~0 (plane-sections) at r=${r}`)
      }
}

/** Finite-difference of the MAP (independent of the analytic Jacobian) must match bend theory too. */
function numericStrainTests() {
  for (const r of [-20, 0, 15])
    for (const s of [-150, 50]) {
      const X = refPoint(s, r, 5)
      const E = greenStrainLagrange(numericGradient(X))
      const ess = project(E, tangent, tangent)
      const expected = r / R + 0.5 * (r / R) ** 2
      assertTrue(Math.abs(ess - expected) < 1e-6, `numeric E_ss(r=${r}) matches theory (got ${ess}, want ${expected})`)
      assertTrue(Math.abs(project(E, tangent, radial)) < 1e-6, `numeric off-diagonal ~0 at r=${r}`)
    }
}

/** Neutral fiber zero strain; outer fiber tensile (>0), inner compressive (<0). */
function strainSignTests() {
  assertTrue(Math.abs(strainAt(0, 0, 0).ss) < 1e-12, 'neutral fiber zero strain')
  assertTrue(strainAt(0, 25, 0).ss > 0, 'outer fiber tensile')
  assertTrue(strainAt(0, -25, 0).ss < 0, 'inner fiber compressive')
}

const det3 = (M: Mat3) =>
  M[0] * (M[4] * M[8] - M[5] * M[7]) - M[1] * (M[3] * M[8] - M[5] * M[6]) + M[2] * (M[3] * M[7] - M[4] * M[6])

/** Analytic F must equal the map's true Jacobian ENTRYWISE (C=FᵀF alone can't catch a left rotation
 *  of F, which would still pass the strain test but corrupt downstream geometric checks). */
function analyticVsNumericFTests() {
  for (const r of [-15, 0, 18])
    for (const s of [-120, 90]) {
      const X = refPoint(s, r, 4)
      const Fa = field.deformationGradient(X), Fn = numericGradient(X)
      for (let k = 0; k < 9; k++) assertTrue(Math.abs(Fa[k] - Fn[k]) < 1e-5, `analytic F[${k}]=${Fa[k]} matches numeric ${Fn[k]}`)
    }
}

/** det(F) = volume change = (1+r/R)·1·1 > 0 (no inversion) across the body. */
function determinantTests() {
  for (const r of [-20, -5, 0, 12, 20]) {
    const d = det3(field.deformationGradient(refPoint(50, r, 3)))
    assertTrue(d > 0, `det(F)>0 at r=${r}`)
    assertTrue(Math.abs(d - (1 + r / R)) < 1e-9, `det(F)=1+r/R at r=${r} (got ${d})`)
  }
}

/** Straight limit R→∞: the bend degenerates to the identity (map≈X, F≈I). */
function straightLimitTests() {
  const straight = cylindricalBend({ R: 1e9, tangent, radial, axis, bendOrigin })
  for (const X of [refPoint(300, 20, 10), refPoint(-150, -15, -5)]) {
    assertTrue(dist(straight.map(X), X) < 1e-3, `R→∞: map≈identity (moved ${dist(straight.map(X), X)})`)
    const F = straight.deformationGradient(X)
    for (let k = 0; k < 9; k++) assertTrue(Math.abs(F[k] - (k % 4 === 0 ? 1 : 0)) < 1e-5, `R→∞: F≈I entry ${k}`)
  }
}

/** Invalid inputs (R≤0, non-orthonormal/non-unit triad) must throw — else F is not the chain rule. */
function inputValidationTests() {
  const throws = (fn: () => unknown) => { try { fn(); return false } catch { return true } }
  assertTrue(throws(() => cylindricalBend({ R: 0, tangent, radial, axis, bendOrigin })), 'R=0 throws')
  assertTrue(throws(() => cylindricalBend({ R: -100, tangent, radial, axis, bendOrigin })), 'R<0 throws')
  assertTrue(throws(() => cylindricalBend({ R, tangent: [1, 0, 0], radial: [1, 0, 0], axis: [0, 0, 1], bendOrigin })), 'non-orthogonal triad throws')
  assertTrue(throws(() => cylindricalBend({ R, tangent: [2, 0, 0], radial: [0, 1, 0], axis: [0, 0, 1], bendOrigin })), 'non-unit tangent throws')
}

/** Zero-allocation mapInto must write the same coordinates as map on the bulk-transform path. */
function mapIntoTests() {
  const out = new Float32Array(9)
  for (const [i, X] of [refPoint(120, 18, 7), refPoint(-90, -12, -4), refPoint(0, 0, 0)].entries()) {
    field.mapInto(X[0], X[1], X[2], out, i * 3)
    const m = field.map(X)
    // Float32 round-trip: compare at single-precision tolerance
    assertTrue(Math.abs(out[i * 3] - m[0]) < 1e-3 && Math.abs(out[i * 3 + 1] - m[1]) < 1e-3 && Math.abs(out[i * 3 + 2] - m[2]) < 1e-3, `mapInto == map at ${X}`)
  }
}

/** Analytic inverse recovers the straight reference point (needed for the build-level strain gate). */
function inverseMapTests() {
  for (const r of [-20, 0, 17])
    for (const s of [-300, 150])
      for (const z of [-8, 11]) {
        const X = refPoint(s, r, z)
        const back = field.inverseMap(field.map(X))
        assertTrue(dist(back, X) < 1e-6, `inverse(map(X)) ≈ X at s=${s},r=${r},z=${z} (off ${dist(back, X)})`)
      }
}

/** R+r≤0 (a point at/through the bend axis) folds the body — inverseMap can't recover it, so reject. */
function domainGuardTests() {
  const throws = (fn: () => unknown) => { try { fn(); return false } catch { return true } }
  const f = cylindricalBend({ R: 10, tangent: [1, 0, 0], radial: [0, 1, 0], axis: [0, 0, 1], bendOrigin: [0, 0, 0] })
  const out = new Float32Array(3)
  assertTrue(throws(() => f.map([0, -15, 0])), 'map throws when R+r≤0 (folded through axis)')
  assertTrue(throws(() => f.mapInto(0, -15, 0, out, 0)), 'mapInto throws when R+r≤0')
  assertTrue(throws(() => f.deformationGradient([0, -15, 0])), 'deformationGradient throws when R+r≤0')
  assertTrue(throws(() => cylindricalBend({ R: 10, tangent: [1, 0, 0], radial: [0, 1, 0], axis: [0, 0, 1], bendOrigin: [NaN, 0, 0] })), 'non-finite bendOrigin throws')
}

/** Wrap guard: arc within (−πR, πR) is single-valued under inverseMap; beyond it wraps the branch cut. */
function wrapHelperTests() {
  assertTrue(!cylindricalBendWrapsArc(1000, -2000, 2000), 'arc within half-turn is safe')  // |s|=2000 < π·1000≈3141.6
  assertTrue(cylindricalBendWrapsArc(1000, -3500, 3500), 'arc beyond half-turn wraps')      // |s|=3500 > 3141.6
  assertTrue(cylindricalBendWrapsArc(1000, 0, 3200), 'one-sided arc past π·R wraps')
}

/** Pre-fill wrap guard over a reference bbox: a body spanning past πR wraps; a short one does not. */
function referenceArcWrapTests() {
  const p = (R: number): Parameters<typeof bentReferenceArcWraps>[0] => ({ R, tangent: [1, 0, 0], radial: [0, 1, 0], axis: [0, 0, 1], bendOrigin: [0, 0, 0] })
  // R=100 → πR≈314. Short body x∈[-100,100] is safe; long body x∈[-400,400] wraps.
  assertTrue(!bentReferenceArcWraps(p(100), [-100, -10, -10], [100, 10, 10]), 'short reference body does not wrap')
  assertTrue(bentReferenceArcWraps(p(100), [-400, -10, -10], [400, 10, 10]), 'reference body past πR wraps')
}

function run() {
  neutralFiberTests()
  analyticStrainTests()
  numericStrainTests()
  strainSignTests()
  analyticVsNumericFTests()
  determinantTests()
  straightLimitTests()
  inputValidationTests()
  mapIntoTests()
  inverseMapTests()
  domainGuardTests()
  wrapHelperTests()
  referenceArcWrapTests()
  console.log('cylindrical-bend tests passed')
}

run()
