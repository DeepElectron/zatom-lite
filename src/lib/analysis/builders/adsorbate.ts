/**
 * Adsorbate placement — surface-site detection + fragment placement.
 *
 * Surface model is the topmost layer of atoms (by z-coord after binning).
 * Sites:
 *   - top:    above each surface atom along its outward normal
 *   - bridge: midpoint of two surface atoms within `bond_cutoff`
 *   - hollow: centroid of three surface atoms forming a triangle (using a
 *             simple nearest-neighbour triangulation, not full Delaunay)
 *
 * Placement reorients the chosen fragment so its local +z aligns with the
 * site normal, then translates so the anchor sits at `site + bond_length·normal`
 * where bond_length is the sum of covalent radii of (anchor element, surface
 * atom element).
 *
 * Collision check: any newly placed atom within 0.8 × (sum of covalent radii
 * to any pre-existing atom) is reported as a collision so the caller can warn
 * and abort.
 */

import { ELEMENTS } from '../../crystal/elements'
import { FRAGMENTS, type Fragment } from './adsorbate-fragments'
import type { AdsorbateAtomInput, DetectedSite, Vec3 } from './adsorbate-types'

// ── Math helpers ───────────────────────────────────────────────────────────

function dot(u: Vec3, v: Vec3): number {
  return u[0] * v[0] + u[1] * v[1] + u[2] * v[2]
}
function cross(u: Vec3, v: Vec3): Vec3 {
  return [
    u[1] * v[2] - u[2] * v[1],
    u[2] * v[0] - u[0] * v[2],
    u[0] * v[1] - u[1] * v[0],
  ]
}
function add(u: Vec3, v: Vec3): Vec3 { return [u[0]+v[0], u[1]+v[1], u[2]+v[2]] }
function sub(u: Vec3, v: Vec3): Vec3 { return [u[0]-v[0], u[1]-v[1], u[2]-v[2]] }
function scale(v: Vec3, s: number): Vec3 { return [v[0]*s, v[1]*s, v[2]*s] }
function norm(v: Vec3): number { return Math.sqrt(v[0]*v[0]+v[1]*v[1]+v[2]*v[2]) }
function unit(v: Vec3): Vec3 {
  const n = norm(v)
  return n > 1e-12 ? scale(v, 1/n) : [0, 0, 1]
}
function dist(u: Vec3, v: Vec3): number { return norm(sub(u, v)) }

/** Covalent radius (Å) with fallback. */
function covalentRadius(el: string): number {
  return ELEMENTS[el]?.radius ?? 0.8
}

/** Fallback surface direction when there is no cell to derive one from (molecules). */
const SURFACE_UP: Vec3 = [0, 0, 1]

/** In-plane + out-of-plane cell vectors of the slab (Å). */
export interface SurfaceLattice {
  a: Vec3
  b: Vec3
  c: Vec3
}

/** Surface frame: outward normal plus two periodic in-plane translations. */
export interface SurfaceFrame {
  up: Vec3
  inPlane: [Vec3, Vec3]
  /** Cell extent along `up`; infinity disables periodic unwrapping. */
  height: number
  /** Unwrapping phase used by `((dot(p, up) - phase) mod height)`. */
  phase: number
  /** Vacuum thickness along the normal, in Å. */
  vacuumA: number
}

const FALLBACK_FRAME: SurfaceFrame = {
  up: SURFACE_UP,
  inPlane: [
    [1, 0, 0],
    [0, 1, 0],
  ],
  height: Number.POSITIVE_INFINITY,
  phase: 0,
  vacuumA: Number.POSITIVE_INFINITY,
}

/** Minimum normal-space vacuum required to treat a periodic cell as a slab. */
export const MIN_VACUUM_A = 5

/** Return a position's normal height in the phase-unwrapped slab frame. */
export function frameHeight(frame: SurfaceFrame, p: Vec3): number {
  const t = dot(p, frame.up) - frame.phase
  if (!Number.isFinite(frame.height)) return t
  return ((t % frame.height) + frame.height) % frame.height
}

/**
 * Infer the surface frame from the largest periodic gap in projected atomic
 * positions. The stacking axis may be any lattice axis, so assuming that c is
 * the vacuum axis is invalid for rotated or skewed slabs. The circular-gap
 * criterion is independent of cell origin and remains valid when a slab crosses
 * the periodic boundary.
 */
export function resolveSurfaceFrame(
  lattice: SurfaceLattice,
  positions: readonly Vec3[],
): SurfaceFrame {
  const axes: [Vec3, Vec3, Vec3] = [lattice.a, lattice.b, lattice.c]
  let best = -Infinity
  let frame: SurfaceFrame | null = null

  for (let i = 0; i < 3; i++) {
    const j = (i + 1) % 3
    const k = (i + 2) % 3
    const n = cross(axes[j], axes[k])
    if (norm(n) < 1e-12) continue
    const un = unit(n)
    // The layer spacing contributed by this axis (unit cell length in the normal direction)
    const height = Math.abs(dot(axes[i], un))
    if (height < 1e-9) continue
    if (positions.length === 0) continue

    const ts = positions
      .map((p) => ((dot(p, un) % height) + height) % height)
      .sort((x, y) => x - y)
    let gap = ts[0] + height - ts[ts.length - 1]
    let gapStart = ts[ts.length - 1]
    for (let m = 0; m + 1 < ts.length; m++) {
      const g = ts[m + 1] - ts[m]
      if (g > gap) {
        gap = g
        gapStart = ts[m]
      }
    }
    if (gap > best) {
      best = gap
      // Put the modular boundary at the vacuum center, farthest from every atom.
      // Using a vacuum edge can wrap the bottom layer to nearly `height` and
      // incorrectly classify it as the exposed surface.
      frame = {
        up: un,
        inPlane: [axes[j], axes[k]],
        height,
        phase: gapStart + gap / 2,
        vacuumA: gap,
      }
    }
  }
  return frame ?? FALLBACK_FRAME
}

/** Reject adsorption-site analysis for periodic bulk cells without a real vacuum gap. */
export type SurfaceAssessment =
  | { ok: true; frame: SurfaceFrame; vacuumA: number }
  | { ok: false; reason: 'no-atoms' | 'bulk'; vacuumA: number; message: string }

export function assessSurface(
  lattice: SurfaceLattice | undefined,
  positions: readonly Vec3[],
): SurfaceAssessment {
  if (positions.length === 0) {
    return { ok: false, reason: 'no-atoms', vacuumA: 0, message: 'No atoms in the structure.' }
  }
  // Molecules and clusters are aperiodic and need no vacuum-axis assessment.
  if (!lattice) {
    return { ok: true, frame: FALLBACK_FRAME, vacuumA: Number.POSITIVE_INFINITY }
  }
  const frame = resolveSurfaceFrame(lattice, positions)
  if (frame.vacuumA < MIN_VACUUM_A) {
    return {
      ok: false,
      reason: 'bulk',
      vacuumA: frame.vacuumA,
      message:
        `This cell is periodic in all three directions — largest vacuum gap is only ` +
        `${frame.vacuumA.toFixed(1)} Å (needs ≥ ${MIN_VACUUM_A} Å), so there is no exposed surface. ` +
        `Use the Slab tool to cut a surface along a Miller index and add a vacuum layer first, ` +
        `then detect adsorption sites.`,
    }
  }
  return { ok: true, frame, vacuumA: frame.vacuumA }
}

/** Prefer explicit `surface_up`, then geometric inference, and finally +z. */
function resolveFrame(opts: {
  surface_up?: Vec3
  lattice?: SurfaceLattice
  positions?: readonly Vec3[]
}): SurfaceFrame {
  const geom = opts.lattice
    ? resolveSurfaceFrame(opts.lattice, opts.positions ?? [])
    : FALLBACK_FRAME
  // Preserve periodic height and phase when overriding orientation; losing them
  // makes frameHeight NaN and prevents detection of surface-layer atoms.
  return opts.surface_up ? { ...geom, up: unit(opts.surface_up) } : geom
}

/**
 * Choose the in-plane periodic image of `to` nearest `from`. Normal translation
 * is intentionally excluded so adsorption heights remain unchanged.
 */
function minImagePartner(
  from: Vec3,
  to: Vec3,
  inPlane?: [Vec3, Vec3],
): { position: Vec3; offsets: [number, number] } {
  if (!inPlane) return { position: to, offsets: [0, 0] }
  let best = to
  let bestOffsets: [number, number] = [0, 0]
  let bestD = dist(from, to)
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      if (i === 0 && j === 0) continue
      const cand = add(to, add(scale(inPlane[0], i), scale(inPlane[1], j)))
      const d = dist(from, cand)
      if (d < bestD - 1e-9) {
        bestD = d
        best = cand
        bestOffsets = [i, j]
      }
    }
  }
  return { position: best, offsets: bestOffsets }
}

interface ImagedNeighbor {
  /** Source atom index in `surfacePositions`. */
  idx: number
  pos: Vec3
  /** Translation key distinguishing images of the same atom. */
  key: string
}

/**
 * Enumerate in-plane images far enough to cover the cutoff. Narrow cells may
 * require more than one translated image in each direction.
 */
function imagedNeighbors(
  positions: readonly Vec3[],
  inPlane: [Vec3, Vec3] | undefined,
  cutoff: number,
): ImagedNeighbor[] {
  const out: ImagedNeighbor[] = positions.map((pos, idx) => ({ idx, pos, key: '0,0' }))
  if (!inPlane) return out
  const span = (v: Vec3) => {
    const len = norm(v)
    return len < 1e-9 ? 0 : Math.min(4, Math.ceil(cutoff / len))
  }
  const ra = span(inPlane[0])
  const rb = span(inPlane[1])
  for (let i = -ra; i <= ra; i++) {
    for (let j = -rb; j <= rb; j++) {
      if (i === 0 && j === 0) continue
      const shift = add(scale(inPlane[0], i), scale(inPlane[1], j))
      for (let k = 0; k < positions.length; k++) {
        out.push({ idx: k, pos: add(positions[k], shift), key: `${i},${j}` })
      }
    }
  }
  return out
}

/** Wrap a site into the canonical cell without changing its periodic geometry. */
function wrapInPlane(p: Vec3, lattice?: SurfaceLattice): Vec3 {
  if (!lattice) return p
  const { a: A, b: B, c: C } = lattice
  const det =
    A[0] * (B[1] * C[2] - B[2] * C[1]) -
    B[0] * (A[1] * C[2] - A[2] * C[1]) +
    C[0] * (A[1] * B[2] - A[2] * B[1])
  if (Math.abs(det) < 1e-12) return p
  const f0 =
    ((B[1] * C[2] - B[2] * C[1]) * p[0] +
      (C[0] * B[2] - B[0] * C[2]) * p[1] +
      (B[0] * C[1] - C[0] * B[1]) * p[2]) / det
  const f1 =
    ((C[1] * A[2] - A[1] * C[2]) * p[0] +
      (A[0] * C[2] - C[0] * A[2]) * p[1] +
      (C[0] * A[1] - A[0] * C[1]) * p[2]) / det
  const f2 =
    ((A[1] * B[2] - B[1] * A[2]) * p[0] +
      (B[0] * A[2] - A[0] * B[2]) * p[1] +
      (A[0] * B[1] - B[0] * A[1]) * p[2]) / det
  const w = (v: number) => v - Math.floor(v)
  const [w0, w1, w2] = [w(f0), w(f1), w(f2)]
  return [
    A[0] * w0 + B[0] * w1 + C[0] * w2,
    A[1] * w0 + B[1] * w1 + C[1] * w2,
    A[2] * w0 + B[2] * w1 + C[2] * w2,
  ]
}

/** Deduplicate periodically equivalent sites to 0.01 Å. */
function dedupeSites(sites: DetectedSite[]): DetectedSite[] {
  const seen = new Set<string>()
  const out: DetectedSite[] = []
  for (const s of sites) {
    const key = `${s.kind}:${s.position.map((v) => Math.round(v * 100)).join(',')}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(s)
  }
  return out
}

// ── Surface layer detection ────────────────────────────────────────────────

export interface SurfaceLayer {
  /** Atom indices in the input array that belong to the topmost layer. */
  atomIndices: number[]
  /** Mean z of topmost layer (used as surface reference plane). */
  meanZ: number
  /** Outward surface normal, derived from the vacuum axis when a cell is given. */
  normal: Vec3
}

export interface DetectSitesOptions {
  /** Tolerance (Å) for grouping atoms into z-layers. Default 0.5 Å. */
  layer_tolerance?: number
  /** Maximum in-plane distance for bridge sites (Å). Default 3.5 Å. */
  bond_cutoff?: number
  /** Maximum edge length for hollow sites (Å). Default 3.5 Å. */
  triangle_cutoff?: number
  /** Surface "up" direction. Overrides the geometry-derived normal when given. */
  surface_up?: Vec3
  /** Slab cell. Lets detection find the vacuum axis (hence the true outward
  *  normal) and apply in-plane minimum-image so boundary sites aren't lost. */
  lattice?: SurfaceLattice
}

/** Identify topmost layer of surface atoms by binning along the up direction. */
export function detectSurfaceLayer(
  atoms: AdsorbateAtomInput[],
  opts: { layer_tolerance?: number; surface_up?: Vec3; lattice?: SurfaceLattice } = {},
): SurfaceLayer {
  if (atoms.length === 0) {
    return { atomIndices: [], meanZ: 0, normal: resolveFrame(opts).up }
  }
  const layerFrame = resolveFrame({ ...opts, positions: atoms.map((a) => a.cartesian) })
  const up = layerFrame.up
  const tol = opts.layer_tolerance ?? 0.5
  // Use phase-unwrapped height so a layer crossing the cell boundary stays intact.
  const projected = atoms.map((a, i) => ({ idx: i, z: frameHeight(layerFrame, a.cartesian) }))
  // Split by height gaps, then choose the highest substrate-sized layer. A small
  // adsorbate layer such as CO/OH must not replace the substrate surface.
  const sorted = [...projected].sort((a, b) => b.z - a.z)
  const layers: (typeof projected)[] = []
  for (const p of sorted) {
    const current = layers[layers.length - 1]
    if (current && current[current.length - 1].z - p.z <= tol) current.push(p)
    else layers.push([p])
  }
  const largest = Math.max(...layers.map((l) => l.length))
  const top = layers.find((l) => l.length * 2 >= largest) ?? layers[0]
  const meanZ = top.reduce((s, p) => s + p.z, 0) / top.length
  return {
    atomIndices: top.map((p) => p.idx),
    meanZ,
    normal: up,
  }
}

/**
 * Detect adsorption sites. The discriminated result forces callers to handle a
 * bulk cell explicitly instead of treating arbitrary points as surface sites.
 */
export type DetectSitesResult =
  | { ok: true; sites: DetectedSite[]; vacuumA: number }
  | { ok: false; reason: 'no-atoms' | 'bulk'; vacuumA: number; message: string }

export function detectSites(
  atoms: AdsorbateAtomInput[],
  opts: DetectSitesOptions = {},
): DetectSitesResult {
  const positions = atoms.map((a) => a.cartesian)
  // A periodic cell without a vacuum gap has no exposed surface.
  const assessment = assessSurface(opts.lattice, positions)
  if (!assessment.ok) return assessment

  const frame = resolveFrame({ ...opts, positions })
  const up = frame.up
  const layer = detectSurfaceLayer(atoms, { ...opts, surface_up: up })
  const inPlane = opts.lattice ? frame.inPlane : undefined
  const bondCutoff = opts.bond_cutoff ?? 3.5
  const triCutoff = opts.triangle_cutoff ?? 3.5
  const sites: DetectedSite[] = []
  const surfacePositions: Vec3[] = layer.atomIndices.map((i) => atoms[i].cartesian)
  const surfaceCount = layer.atomIndices.length

  // Top sites: directly above each surface atom (offset of 1.5 Å for the
  // marker; actual bond offset is applied at place time).
  for (let i = 0; i < surfaceCount; i++) {
    const pos = surfacePositions[i]
    const sitePos: Vec3 = wrapInPlane(add(pos, scale(up, 1.5)), opts.lattice)
    sites.push({
      id: `top-${i}`,
      kind: 'top',
      position: sitePos,
      normal: up,
      atomIndices: [layer.atomIndices[i]],
    })
  }

  // In-plane periodic-image neighbor list.
  //
  // The nearest image alone is insufficient: different images inside the cutoff
  // define distinct bridge and hollow sites. A one-atom surface cell has only
  // self-images as neighbors, so enumerate every image in range, including
  // nonzero translations of the same atom.
  const maxCutoff = Math.max(bondCutoff, triCutoff)
  const images = imagedNeighbors(surfacePositions, inPlane, maxCutoff)

  for (let i = 0; i < surfaceCount; i++) {
    const pi = surfacePositions[i]
    const near = images.filter((m) => {
      const d = dist(pi, m.pos)
      return d > 1e-6 && d <= maxCutoff
    })

    // Each periodic neighbor defines a bridge candidate; deduplication follows.
    for (const m of near) {
      if (dist(pi, m.pos) > bondCutoff) continue
      const mid: Vec3 = scale(add(pi, m.pos), 0.5)
      sites.push({
        id: `bridge-${i}-${m.idx}-${m.key}`,
        kind: 'bridge',
        position: wrapInPlane(add(mid, scale(up, 1.5)), opts.lattice),
        normal: up,
        atomIndices: [layer.atomIndices[i], layer.atomIndices[m.idx]],
      })
    }

    // Two mutually adjacent neighbors and atom i define a hollow candidate.
    for (let m = 0; m < near.length; m++) {
      if (dist(pi, near[m].pos) > triCutoff) continue
      for (let n = m + 1; n < near.length; n++) {
        if (dist(pi, near[n].pos) > triCutoff) continue
        if (dist(near[m].pos, near[n].pos) > triCutoff) continue
        const centroid: Vec3 = [
          (pi[0] + near[m].pos[0] + near[n].pos[0]) / 3,
          (pi[1] + near[m].pos[1] + near[n].pos[1]) / 3,
          (pi[2] + near[m].pos[2] + near[n].pos[2]) / 3,
        ]
        sites.push({
          id: `hollow-${i}-${near[m].idx}-${near[n].idx}-${near[m].key}-${near[n].key}`,
          kind: 'hollow',
          position: wrapInPlane(add(centroid, scale(up, 1.5)), opts.lattice),
          normal: up,
          atomIndices: [
            layer.atomIndices[i],
            layer.atomIndices[near[m].idx],
            layer.atomIndices[near[n].idx],
          ],
        })
      }
    }
  }

  return { ok: true, sites: dedupeSites(sites), vacuumA: assessment.vacuumA }
}

/** Build a site from a manual atom selection (1, 2, or 3 surface atoms). */
export function siteFromManualSelection(
  atoms: AdsorbateAtomInput[],
  selectedIndices: number[],
  opts: { surface_up?: Vec3; lattice?: SurfaceLattice } = {},
): DetectedSite | null {
  const frame = resolveFrame({ ...opts, positions: atoms.map((a) => a.cartesian) })
  const up = frame.up
  const n = selectedIndices.length
  if (n < 1 || n > 3) return null
  // Resolve every selected atom to the nearest image of the first one so a
  // boundary-crossing selection has the correct midpoint or centroid.
  const inPlane = opts.lattice ? frame.inPlane : undefined
  const raw: Vec3[] = selectedIndices.map((i) => atoms[i].cartesian)
  const imaged = raw.map((p, i) => i === 0
    ? { position: p, offsets: [0, 0] as [number, number] }
    : minImagePartner(raw[0], p, inPlane))
  const ps: Vec3[] = imaged.map((entry) => entry.position)
  const latticeAxes = opts.lattice ? [opts.lattice.a, opts.lattice.b, opts.lattice.c] : []
  const inPlaneAxisIndices = inPlane?.map((vector) => latticeAxes.findIndex((axis) => (
    dist(axis, vector) <= 1e-9
  ))) ?? []
  const atomImages = imaged.map((entry): [number, number, number] => {
    const image: [number, number, number] = [0, 0, 0]
    if (inPlaneAxisIndices[0] >= 0) image[inPlaneAxisIndices[0]] = entry.offsets[0]
    if (inPlaneAxisIndices[1] >= 0) image[inPlaneAxisIndices[1]] = entry.offsets[1]
    return image
  })
  if (n === 1) {
    const sitePos: Vec3 = add(ps[0], scale(up, 1.5))
    return {
      id: `manual-top-${selectedIndices[0]}`,
      kind: 'top',
      position: sitePos,
      bindingPosition: [...ps[0]],
      normal: up,
      atomIndices: [...selectedIndices],
      atomImages,
    }
  }
  if (n === 2) {
    const mid: Vec3 = scale(add(ps[0], ps[1]), 0.5)
    return {
      id: `manual-bridge-${selectedIndices.join('-')}`,
      kind: 'bridge',
      position: add(mid, scale(up, 1.5)),
      bindingPosition: mid,
      normal: up,
      atomIndices: [...selectedIndices],
      atomImages,
    }
  }
  // n === 3
  const centroid: Vec3 = [
    (ps[0][0] + ps[1][0] + ps[2][0]) / 3,
    (ps[0][1] + ps[1][1] + ps[2][1]) / 3,
    (ps[0][2] + ps[1][2] + ps[2][2]) / 3,
  ]
  return {
    id: `manual-hollow-${selectedIndices.join('-')}`,
    kind: 'hollow',
    position: add(centroid, scale(up, 1.5)),
    bindingPosition: centroid,
    normal: up,
    atomIndices: [...selectedIndices],
    atomImages,
  }
}

// ── Fragment orientation & placement ───────────────────────────────────────

/** Rodrigues rotation: rotate vector v about axis k (unit) by angle (radians). */
function rotateRodrigues(v: Vec3, axis: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const k = unit(axis)
  const kxv = cross(k, v)
  const kdotv = dot(k, v)
  return [
    v[0] * c + kxv[0] * s + k[0] * kdotv * (1 - c),
    v[1] * c + kxv[1] * s + k[1] * kdotv * (1 - c),
    v[2] * c + kxv[2] * s + k[2] * kdotv * (1 - c),
  ]
}

/** Build a rotation that maps +z to target unit vector n.
 *  Returns a function that rotates any vector v accordingly. */
function rotationToAlignZ(n: Vec3): (v: Vec3) => Vec3 {
  const target = unit(n)
  const zAxis: Vec3 = [0, 0, 1]
  const c = dot(zAxis, target)
  if (c > 1 - 1e-9) {
    // Already aligned
    return (v) => [...v] as Vec3
  }
  if (c < -1 + 1e-9) {
    // 180° rotation about any perpendicular axis (use +x).
    return (v) => [v[0], -v[1], -v[2]] as Vec3
  }
  const axis = cross(zAxis, target)
  const angle = Math.acos(Math.max(-1, Math.min(1, c)))
  return (v) => rotateRodrigues(v, axis, angle)
}

export interface PlaceFragmentOptions {
  atoms: AdsorbateAtomInput[]
  site: DetectedSite
  /** Either a fragment id (key into FRAGMENTS) or a custom Fragment. */
  fragment: string | Fragment
  /** Optional explicit bond length. If omitted, sum of covalent radii is used. */
  bond_length?: number
  /** Override surface anchor element used to compute bond length. Default = first atomIndex element. */
  surface_element?: string
  /** Collision threshold factor (× sum of covalent radii). Default 0.8. */
  collision_factor?: number
  /** Tilt local +z toward local +x before surface alignment. */
  tilt_deg?: number
  /** Rotate the tilted local frame around local +z before surface alignment. */
  azimuth_deg?: number
}

export interface PlaceFragmentResult {
  /** Newly placed atoms (cartesian, in world frame). */
  newAtoms: AdsorbateAtomInput[]
  /** True when no clashes with existing atoms (within collision_factor × Σradii). */
  ok: boolean
  /** First detected collision pair (newIdx, existingIdx, distance) if !ok. */
  collision?: { newIdx: number; existingIdx: number; distance: number; threshold: number }
}

/** Place a single fragment at the given site. Returns the new atoms plus a
 *  collision flag. Does not mutate `atoms`. */
export function placeFragment(opts: PlaceFragmentOptions): PlaceFragmentResult {
  const fragment: Fragment = typeof opts.fragment === 'string'
    ? (FRAGMENTS[opts.fragment] ?? FRAGMENTS.H)
    : opts.fragment
  const collisionFactor = opts.collision_factor ?? 0.8
  const tiltRad = (opts.tilt_deg ?? 0) * Math.PI / 180
  const azimuthRad = (opts.azimuth_deg ?? 0) * Math.PI / 180
  if (!Number.isFinite(tiltRad) || !Number.isFinite(azimuthRad)) {
    throw new Error('tilt_deg and azimuth_deg must be finite')
  }

  // Bond length: sum of covalent radii (surface element + fragment anchor element)
  // unless overridden.
  const anchorAtom = fragment.atoms[fragment.anchor]
  const anchorElement = anchorAtom.element
  const surfaceElement = opts.surface_element
    ?? (opts.site.atomIndices.length > 0
      ? opts.atoms[opts.site.atomIndices[0]].element
      : 'C')
  const bondLength = opts.bond_length ?? covalentRadius(surfaceElement) + covalentRadius(anchorElement)

  // The site.position has a built-in 1.5 Å marker offset from the actual
  // surface atom — recompute the on-surface reference based on atomIndices,
  // then add bond_length × normal to get the anchor placement.
  const surfacePts = opts.site.atomIndices.map((i) => opts.atoms[i].cartesian)
  let baseRef: Vec3
  if (opts.site.bindingPosition) {
    baseRef = [...opts.site.bindingPosition]
  } else if (surfacePts.length === 1) {
    baseRef = surfacePts[0]
  } else if (surfacePts.length === 2) {
    baseRef = scale(add(surfacePts[0], surfacePts[1]), 0.5)
  } else {
    baseRef = [
      (surfacePts[0][0] + surfacePts[1][0] + surfacePts[2][0]) / 3,
      (surfacePts[0][1] + surfacePts[1][1] + surfacePts[2][1]) / 3,
      (surfacePts[0][2] + surfacePts[1][2] + surfacePts[2][2]) / 3,
    ]
  }
  const anchorWorld: Vec3 = add(baseRef, scale(unit(opts.site.normal), bondLength))

  // Rotate fragment so its local +z aligns with the site normal, then
  // translate so anchor sits at anchorWorld.
  const rotate = rotationToAlignZ(opts.site.normal)
  const localAnchor = fragment.atoms[fragment.anchor].pos
  const newAtoms: AdsorbateAtomInput[] = fragment.atoms.map((a) => {
    const localOffset: Vec3 = sub(a.pos, localAnchor)  // fragment frame offset from anchor
    const tilted = rotateRodrigues(localOffset, [0, 1, 0], tiltRad)
    const spun = rotateRodrigues(tilted, [0, 0, 1], azimuthRad)
    const rotated = rotate(spun)
    const world: Vec3 = add(anchorWorld, rotated)
    return { element: a.element, cartesian: world }
  })

  // Collision detection against existing atoms.
  for (let i = 0; i < newAtoms.length; i++) {
    const newAtom = newAtoms[i]
    for (let j = 0; j < opts.atoms.length; j++) {
      const ex = opts.atoms[j]
      const threshold = collisionFactor * (covalentRadius(newAtom.element) + covalentRadius(ex.element))
      const d = dist(newAtom.cartesian, ex.cartesian)
      if (d < threshold) {
        return {
          newAtoms,
          ok: false,
          collision: { newIdx: i, existingIdx: j, distance: d, threshold },
        }
      }
    }
  }
  return { newAtoms, ok: true }
}

export interface PlaceDualOptions {
  atoms: AdsorbateAtomInput[]
  siteA: DetectedSite
  siteB: DetectedSite
  fragmentA: string | Fragment
  fragmentB: string | Fragment
  /** Desired distance between the anchor atoms of the two fragments (Å). Default 1.5 */
  desired_distance?: number
  collision_factor?: number
}

export interface PlaceDualResult {
  newAtomsA: AdsorbateAtomInput[]
  newAtomsB: AdsorbateAtomInput[]
  /** Distance between the two anchor atoms after placement. */
  anchorDistance: number
  /** Whether desired_distance enforcement shifted fragment B. */
  shiftedToEnforceDistance: boolean
  ok: boolean
  collision?: { which: 'A' | 'B' | 'AB'; distance: number; threshold: number }
}

/** Check newAtoms against existing atoms; return first collision (or null). */
function findCollision(
  newAtoms: AdsorbateAtomInput[],
  existing: AdsorbateAtomInput[],
  collisionFactor: number,
): { newIdx: number; existingIdx: number; distance: number; threshold: number } | null {
  for (let i = 0; i < newAtoms.length; i++) {
    const na = newAtoms[i]
    for (let j = 0; j < existing.length; j++) {
      const ex = existing[j]
      const threshold = collisionFactor * (covalentRadius(na.element) + covalentRadius(ex.element))
      const d = dist(na.cartesian, ex.cartesian)
      if (d < threshold) return { newIdx: i, existingIdx: j, distance: d, threshold }
    }
  }
  return null
}

/** Dual placement: place two fragments with a target separation between
 *  anchor atoms.
 *
 *  When `desired_distance` is supplied, fragment B is shifted along the A→B
 *  in-plane direction so its anchor sits exactly that far from A's anchor —
 *  the UI control is now load-bearing, not diagnostic. Sites the user picks
 *  define the *kind* (top/bridge/hollow) and `siteB.normal`, but the actual
 *  lateral position is controlled by desired_distance. This avoids the trap
 *  where two clicked sites land < 1 Å apart and the placement always collides. */
export function placeDualFragments(opts: PlaceDualOptions): PlaceDualResult {
  const collisionFactor = opts.collision_factor ?? 0.8
  const desired = opts.desired_distance ?? 0

  // Place each fragment independently first.
  const a = placeFragment({
    atoms: opts.atoms,
    site: opts.siteA,
    fragment: opts.fragmentA,
    collision_factor: collisionFactor,
  })
  const atomsAfterA = [...opts.atoms, ...a.newAtoms]
  // For fragment B we DON'T pass collision_factor — we'll re-check after the
  // optional shift. Initial run is just to compute the natural anchor position.
  const bNatural = placeFragment({
    atoms: atomsAfterA,
    site: opts.siteB,
    fragment: opts.fragmentB,
    collision_factor: collisionFactor,
  })

  const fragA: Fragment = typeof opts.fragmentA === 'string'
    ? (FRAGMENTS[opts.fragmentA] ?? FRAGMENTS.H)
    : opts.fragmentA
  const fragB: Fragment = typeof opts.fragmentB === 'string'
    ? (FRAGMENTS[opts.fragmentB] ?? FRAGMENTS.H)
    : opts.fragmentB
  const anchorA = a.newAtoms[fragA.anchor].cartesian
  const anchorBNatural = bNatural.newAtoms[fragB.anchor].cartesian
  const naturalDist = dist(anchorA, anchorBNatural)

  // Enforce desired_distance by shifting B's atoms in-plane.
  // Decompose AB into normal-aligned and lateral components, scale lateral
  // so |AB|² = desired². If desired_distance ≤ |along-normal|, the request is
  // geometrically impossible (anchors are at different z-levels by more than
  // desired); we degrade to the in-plane attempt anyway with newLat = 0.
  let bAtoms = bNatural.newAtoms
  let shifted = false
  if (desired > 0 && Math.abs(naturalDist - desired) > 0.05) {
    const normalA = unit(opts.siteA.normal)
    const ab = sub(anchorBNatural, anchorA)
    const along = dot(ab, normalA)
    const lateralVec = sub(ab, scale(normalA, along))
    const lateralLen = norm(lateralVec)
    // Pick lateral direction. If natural lateral is degenerate (two sites
    // share the same in-plane position), pick an arbitrary direction in the
    // surface plane —— project +x onto the plane perpendicular to normalA.
    let lateralUnit: Vec3
    if (lateralLen > 1e-6) {
      lateralUnit = scale(lateralVec, 1 / lateralLen)
    } else {
      const xAxis: Vec3 = [1, 0, 0]
      const xProj = sub(xAxis, scale(normalA, dot(xAxis, normalA)))
      const xProjLen = norm(xProj)
      lateralUnit = xProjLen > 1e-6 ? scale(xProj, 1 / xProjLen) : [1, 0, 0]
    }
    const desiredSq = desired * desired
    const alongSq = along * along
    const newLatLen = desiredSq > alongSq ? Math.sqrt(desiredSq - alongSq) : 0
    const newAnchorB = add(anchorA, add(scale(lateralUnit, newLatLen), scale(normalA, along)))
    const shift = sub(newAnchorB, anchorBNatural)
    bAtoms = bNatural.newAtoms.map((at) => ({
      element: at.element,
      cartesian: add(at.cartesian, shift) as Vec3,
    }))
    shifted = true
  }

  const anchorB = bAtoms[fragB.anchor].cartesian
  const anchorDist = dist(anchorA, anchorB)

  // Re-check all collisions on final placement: A vs originals, B vs (originals + A), and A vs B.
  let ok = true
  let collision: { newIdx: number; existingIdx: number; distance: number; threshold: number } | null = null
  let which: 'A' | 'B' | 'AB' | undefined

  if (!a.ok) {
    ok = false
    collision = a.collision ?? null
    which = 'A'
  }
  if (ok) {
    const bCol = findCollision(bAtoms, atomsAfterA, collisionFactor)
    if (bCol) {
      ok = false
      collision = bCol
      which = 'B'
    }
  }
  if (ok) {
    const abCol = findCollision(bAtoms, a.newAtoms, collisionFactor)
    if (abCol) {
      ok = false
      collision = abCol
      which = 'AB'
    }
  }

  // Suppress unused-binding lint when shifted=false but bAtoms unchanged (kept above for symmetry).
  void shifted

  return {
    newAtomsA: a.newAtoms,
    newAtomsB: bAtoms,
    anchorDistance: anchorDist,
    shiftedToEnforceDistance: shifted,
    ok,
    collision: collision
      ? { which: which ?? 'A', distance: collision.distance, threshold: collision.threshold }
      : undefined,
  }
}

// ── Extended-XYZ emission ──────────────────────────────────────────────────

export interface EmitOptions {
  /** Original atoms (kept as-is). */
  baseAtoms: AdsorbateAtomInput[]
  /** Atoms appended to the base set. */
  addedAtoms: AdsorbateAtomInput[]
  /** Optional lattice rows; if omitted, no Lattice="..." key is emitted. */
  lattice?: [Vec3, Vec3, Vec3]
  /** Comment line append. */
  comment?: string
}

/** Produce extended-XYZ string from base + added atoms (cartesian) with
 *  optional lattice vectors. Mirrors the format used by other builders. */
export function emitAdsorbateExtxyz(opts: EmitOptions): string {
  const all = [...opts.baseAtoms, ...opts.addedAtoms]
  const lines: string[] = []
  lines.push(String(all.length))
  let header = 'Properties=species:S:1:pos:R:3'
  if (opts.lattice) {
    const latStr = opts.lattice.flatMap((v) => v.map((x) => x.toFixed(6))).join(' ')
    header = `Lattice="${latStr}" ${header}`
  }
  if (opts.comment) {
    header = `${header} ${opts.comment}`
  }
  lines.push(header)
  for (const atom of all) {
    lines.push(
      `${atom.element} ${atom.cartesian[0].toFixed(6)} ${atom.cartesian[1].toFixed(6)} ${atom.cartesian[2].toFixed(6)}`,
    )
  }
  return lines.join('\n')
}

export { FRAGMENTS } from './adsorbate-fragments'
export type { Fragment } from './adsorbate-fragments'
export type { Vec3, DetectedSite, SiteKind, AdsorbateAtomInput } from './adsorbate-types'
