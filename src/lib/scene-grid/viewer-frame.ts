/**
 * viewer-frame — turns a camera pose into a screen frame the agent can reason in.
 *
 * Everything an agent says about "left / right / above / behind / closer" is
 * relative to the user's current view, not to the Cartesian axes. This module
 * owns that mapping: pose → orthonormal (right, up, forward) frame, world →
 * screen-relative coordinates, and the neighbourhood queries built on them.
 * Pure functions, no store access, so scene_resolve_reference and
 * viewer_observe can share them and tests can supply deterministic poses.
 */

import type { Vec3, ZatomStructure } from '../../agent/contracts'

export interface ScreenFrame {
  /** Unit vector pointing to the right of the screen, in world space. */
  right: Vec3
  /** Unit vector pointing to the top of the screen, in world space. */
  up: Vec3
  /** Unit vector from the eye into the scene (away from the viewer). */
  forward: Vec3
  eye: Vec3
  lookAt: Vec3
  /** Eye→lookAt distance; the depth at which "screen units" are Å. */
  distance: number
}

export interface ScreenPoint {
  /** Å to the right of the look-at point, in the view plane. */
  x: number
  /** Å above the look-at point, in the view plane. */
  y: number
  /** Å along the view direction from the look-at point (positive = farther from the viewer). */
  depth: number
  /** Distance from the eye in Å. */
  eyeDistance: number
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
const norm = (v: Vec3) => Math.hypot(v[0], v[1], v[2])
const unit = (v: Vec3): Vec3 => {
  const n = norm(v)
  return n > 1e-12 ? [v[0] / n, v[1] / n, v[2] / n] : [0, 0, 0]
}

export function screenFrame(pose: { position: Vec3; lookAt: Vec3; up?: Vec3 }): ScreenFrame {
  const forwardRaw = sub(pose.lookAt, pose.position)
  const distance = norm(forwardRaw)
  const forward = distance > 1e-9 ? unit(forwardRaw) : ([0, 0, -1] as Vec3)
  let upHint: Vec3 = pose.up ?? [0, 1, 0]
  // Degenerate when looking straight along the up hint (top / bottom views):
  // fall back to +Z, then +X, so "right" is still well defined.
  if (Math.abs(dot(unit(upHint), forward)) > 0.999) upHint = Math.abs(forward[2]) > 0.999 ? [1, 0, 0] : [0, 0, 1]
  const right = unit(cross(forward, upHint))
  const up = unit(cross(right, forward))
  return { right, up, forward, eye: [...pose.position] as Vec3, lookAt: [...pose.lookAt] as Vec3, distance }
}

export function toScreen(frame: ScreenFrame, p: Vec3): ScreenPoint {
  const rel = sub(p, frame.lookAt)
  const fromEye = sub(p, frame.eye)
  return {
    x: dot(rel, frame.right),
    y: dot(rel, frame.up),
    depth: dot(rel, frame.forward),
    eyeDistance: norm(fromEye),
  }
}

/** World direction for a screen-relative word, or null when the word is not directional. */
export function screenDirection(frame: ScreenFrame, word: ScreenDirectionWord): Vec3 {
  switch (word) {
    case 'right':
      return frame.right
    case 'left':
      return [-frame.right[0], -frame.right[1], -frame.right[2]]
    case 'up':
      return frame.up
    case 'down':
      return [-frame.up[0], -frame.up[1], -frame.up[2]]
    case 'behind':
      return frame.forward
    case 'in_front':
      return [-frame.forward[0], -frame.forward[1], -frame.forward[2]]
  }
}

export type ScreenDirectionWord = 'right' | 'left' | 'up' | 'down' | 'behind' | 'in_front'

export interface ScreenAxes {
  right: Vec3
  up: Vec3
  /** Into the scene, away from the viewer. */
  forward: Vec3
  /** Best-matching lattice axis for each screen axis, when a lattice exists. */
  latticeHints: { right: string | null; up: string | null; forward: string | null } | null
}

/**
 * Lattice-aware description of the screen axes: which crystal axis is
 * (roughly) pointing right / up / into the screen, so the agent can say
 * "the b axis runs left-to-right in your view".
 */
export function describeScreenAxes(frame: ScreenFrame, structure: ZatomStructure | null): ScreenAxes {
  let latticeHints: ScreenAxes['latticeHints'] = null
  if (structure?.lattice) {
    const axes = structure.lattice.vectors.map((v, i) => ({ name: 'abc'[i], dir: unit(v as Vec3) }))
    const best = (screen: Vec3) => {
      let top: { name: string; score: number } | null = null
      for (const axis of axes) {
        const score = dot(axis.dir, screen)
        if (!top || Math.abs(score) > Math.abs(top.score)) top = { name: axis.name, score }
      }
      if (!top || Math.abs(top.score) < 0.5) return null
      return top.score >= 0 ? `+${top.name}` : `-${top.name}`
    }
    latticeHints = { right: best(frame.right), up: best(frame.up), forward: best(frame.forward) }
  }
  return { right: frame.right, up: frame.up, forward: frame.forward, latticeHints }
}

export interface VisibleAtomsSummary {
  /** Atoms inside the camera's forward view frustum. */
  inFrameCount: number
  totalCount: number
  /** Atom ids nearest the screen centre, closest first. */
  nearCenter: { id: string; element: string; screen: ScreenPoint }[]
  /** Largest half-extent in Å at the camera look-at depth. */
  halfExtentA: number
  elementCounts: Record<string, number>
}

/**
 * What is inside the frame right now. Perspective bounds expand at each
 * atom's own eye-space depth using the viewer's 50° vertical FOV;
 * orthographic bounds remain fixed from viewport size / zoom. This is
 * deliberately a region-level answer (atom centres, no sphere radii), not a
 * renderer replacement.
 */
export function summarizeVisibleAtoms(
  frame: ScreenFrame,
  structure: ZatomStructure,
  options: { zoom?: number; viewportSizePx?: [number, number] | null; nearCenterLimit?: number } = {},
): VisibleAtomsSummary {
  const viewport = options.viewportSizePx
    && options.viewportSizePx[0] > 0
    && options.viewportSizePx[1] > 0
    ? options.viewportSizePx
    : null
  const aspect = viewport
    ? viewport[0] / viewport[1]
    : 16 / 9
  const orthographic = options.zoom !== undefined && options.zoom > 0
  const tanHalfFov = Math.tan((50 * Math.PI) / 360)
  const targetHalfHeight = orthographic
    ? (viewport ? viewport[1] / 2 : 400) / options.zoom!
    : frame.distance * tanHalfFov
  const targetHalfWidth = targetHalfHeight * aspect
  const elementCounts: Record<string, number> = {}
  const projected: { id: string; element: string; screen: ScreenPoint; r: number }[] = []
  for (const atom of structure.atoms) {
    const screen = toScreen(frame, atom.position)
    // `eyeDistance` is unsigned and therefore cannot distinguish a point in
    // front of the camera from one behind it. Eye-space axial depth can.
    const eyeDepth = frame.distance + screen.depth
    if (eyeDepth < 0.01) continue
    const halfHeight = orthographic ? targetHalfHeight : eyeDepth * tanHalfFov
    const halfWidth = halfHeight * aspect
    if (Math.abs(screen.x) > halfWidth || Math.abs(screen.y) > halfHeight) continue

    elementCounts[atom.element] = (elementCounts[atom.element] ?? 0) + 1
    // Rank by actual screen offset. In perspective, equal world offsets at
    // different depths do not occupy equal distances from the screen centre.
    const r = Math.hypot(screen.x / halfWidth, screen.y / halfHeight)
    projected.push({ id: atom.id, element: atom.element, screen, r })
  }
  projected.sort((a, b) => a.r - b.r)
  const limit = options.nearCenterLimit ?? 8
  return {
    inFrameCount: projected.length,
    totalCount: structure.atoms.length,
    nearCenter: projected.slice(0, limit).map(({ id, element, screen }) => ({ id, element, screen: roundScreen(screen) })),
    halfExtentA: Number(Math.max(targetHalfWidth, targetHalfHeight).toFixed(2)),
    elementCounts,
  }
}

export function roundScreen(s: ScreenPoint): ScreenPoint {
  return {
    x: Number(s.x.toFixed(2)),
    y: Number(s.y.toFixed(2)),
    depth: Number(s.depth.toFixed(2)),
    eyeDistance: Number(s.eyeDistance.toFixed(2)),
  }
}

/** Centroid of a set of positions. */
export function centroid(points: readonly Vec3[]): Vec3 | null {
  if (!points.length) return null
  const c: Vec3 = [0, 0, 0]
  for (const p of points) {
    c[0] += p[0]
    c[1] += p[1]
    c[2] += p[2]
  }
  return [c[0] / points.length, c[1] / points.length, c[2] / points.length]
}
