// Pure screen-space snap picker shared by atom placement and dragging.
// Priority is atom center, line intersection, nearest line point/foot, then none.
// Restricting activation to one feature prevents competing snap targets.
import * as THREE from 'three'
import {
  pointsOnLine,
  line3DClosestPoint,
  type SnapLine,
  type SnapPoint,
  type Vec3,
} from './geometry-snap'
import type { GeometrySnapTargets } from '../orchestration/slices/view-settings-slice'

export const MAX_SNAP_ATOMS = 3000 // Disable atom-center snapping beyond this O(N) projection budget.
const ATOM_PX = 14         // Atom snap radius in pixels.
const LINE_PX = 12         // Line snap radius in pixels.
const POINT_PX = 16        // Discrete point snap radius in pixels.
const INTERSECT_PX = 14    // Intersection point capture pixel threshold
const INTERSECT_GAP = 0.6  // The maximum 3D distance (Å) at which two 3D lines "intersect"

export type SnapResult =
  | { pos: Vec3; type: 'atom'; atomId: string }
  | { pos: Vec3; type: 'point'; line: SnapLine; point: SnapPoint }
  | { pos: Vec3; type: 'foot'; line: SnapLine }
  | { pos: Vec3; type: 'intersection'; lineA: SnapLine; lineB: SnapLine }

export interface ActiveFeature {
  snap: SnapResult
  /** Guide lines to draw: none for atoms, one for a line, two for an intersection. */
  lines: SnapLine[]
}

export interface SnapAtomPoint {
  id: string
  pos: Vec3
}

/**
 * Mapping of SnapPoint.kind to user-visible four types of switches.
 */
function pointTargetKey(kind: SnapPoint['kind']): keyof GeometrySnapTargets {
  // The bisecting points (including midpoints) within the line segment are classified as division; the extension points and endpoints outside the line segment are classified as extension.
  return kind === 'extension' || kind === 'endpoint' ? 'extension' : 'division'
}

/** Return whether current target filters permit this snap point. */
export function isSnapPointEnabled(kind: SnapPoint['kind'], targets: GeometrySnapTargets): boolean {
  return targets[pointTargetKey(kind)]
}

/** Return whether any enabled target requires building line features. */
export function needsSnapLines(targets: GeometrySnapTargets): boolean {
  return targets.division || targets.extension || targets.intersection
}

export interface PickSnapArgs {
  camera: THREE.Camera
  /**
  * The getBoundingClientRect() of the canvas is used to convert client coordinates into pixels in the canvas.
  */
  rect: { left: number; top: number; width: number; height: number }
  /**
  * clientX / clientY of the cursor.
  */
  clientX: number
  clientY: number
  snapLines: readonly SnapLine[]
  atomPoints: readonly SnapAtomPoint[]
  targets: GeometrySnapTargets
  /**
  * Exclude itself when dragging an atom, otherwise the atom will always be adsorbed on itself and cannot be dragged at all.
  */
  excludeAtomIds?: ReadonlySet<string>
}

/**
 * Parse the active snap feature at the cursor. Returns null if there are no hits (or all targets are off).
 * Pure function: Do not read the store, do not touch React, add-atom and drag-atom are shared.
 */
export function pickSnapFeature(args: PickSnapArgs): ActiveFeature | null {
  const { camera, rect, clientX, clientY, snapLines, atomPoints, targets, excludeAtomIds } = args
  const halfW = rect.width / 2
  const halfH = rect.height / 2
  const mx = clientX - rect.left
  const my = clientY - rect.top

  const projectToPx = (p: Vec3): { x: number; y: number } | null => {
    const v = new THREE.Vector3(p[0], p[1], p[2]).project(camera)
    if (v.z < -1 || v.z > 1) return null
    return { x: (v.x + 1) * halfW, y: (1 - v.y) * halfH }
  }

  // ---- Priority 1: Nearest atom (~14px)----
  if (targets.atomCenter) {
    let bestId: string | null = null
    let bestPos: Vec3 | null = null
    let bestPx = ATOM_PX
    for (const a of atomPoints) {
      if (excludeAtomIds?.has(a.id)) continue
      const s = projectToPx(a.pos)
      if (!s) continue
      const px = Math.hypot(s.x - mx, s.y - my)
      if (px < bestPx) { bestPx = px; bestId = a.id; bestPos = a.pos }
    }
    if (bestId && bestPos) {
      return { snap: { pos: bestPos, type: 'atom', atomId: bestId }, lines: [] }
    }
  }

  if (!needsSnapLines(targets) || !snapLines.length) return null

  // Resolve the 3D foot against the camera ray; screen interpolation is not
  // perspective-correct.
  const ndcX = (mx / rect.width) * 2 - 1
  const ndcY = -((my / rect.height) * 2 - 1)
  const rp1 = new THREE.Vector3(ndcX, ndcY, -1).unproject(camera)
  const rp2 = new THREE.Vector3(ndcX, ndcY, 1).unproject(camera)
  const rayLine: SnapLine = { id: '__ray', kind: 'bond', p1: [rp1.x, rp1.y, rp1.z], p2: [rp2.x, rp2.y, rp2.z] }

  // ---- Project each line into a 2D line segment (take the straight line it is located on), and calculate the pixel distance from the cursor to the straight line (for line selection) ----
  interface ProjLine {
    line: SnapLine
    pxDist: number  // The screen distance from the cursor to the 2D straight line** where the line** is located (both orthogonal and perspective are correct)
    foot3D: Vec3    // 3D vertical foot: camera ray × the closest point of the 3D straight line (perspective accurate)
  }
  const proj: ProjLine[] = []
  for (const line of snapLines) {
    const a = projectToPx(line.p1)
    const b = projectToPx(line.p2)
    if (!a || !b) continue
    const dx = b.x - a.x; const dy = b.y - a.y
    const segLen2 = dx * dx + dy * dy
    if (segLen2 < 1e-6) continue
    // Screen parameter u2d (not clamped → allowed to extend), only used to calculate screen distance
    const u2d = ((mx - a.x) * dx + (my - a.y) * dy) / segLen2
    const footX = a.x + dx * u2d; const footY = a.y + dy * u2d
    const pxDist = Math.hypot(mx - footX, my - footY)
    // 3D vertical foot uses the closest point of the camera ray; when the parallel degenerates (the line faces the camera), the screen parameter lerp is returned
    const ca = line3DClosestPoint(line, rayLine)
    const t = ca ? ca.t1 : u2d
    const foot3D: Vec3 = [
      line.p1[0] + (line.p2[0] - line.p1[0]) * t,
      line.p1[1] + (line.p2[1] - line.p1[1]) * t,
      line.p1[2] + (line.p2[2] - line.p1[2]) * t,
    ]
    proj.push({ line, pxDist, foot3D })
  }
  if (!proj.length) return null

  proj.sort((p, q) => p.pxDist - q.pxDist)
  const near = proj.filter((p) => p.pxDist <= LINE_PX)
  if (!near.length) return null

  // ---- Priority 2: Intersection (the second closest line is also within the threshold, and the 3D truth of the two lines intersects) ----
  if (targets.intersection && near.length >= 2) {
    const ca = line3DClosestPoint(near[0].line, near[1].line)
    if (ca && ca.gap <= INTERSECT_GAP) {
      const s = projectToPx(ca.pos)
      if (s && Math.hypot(s.x - mx, s.y - my) <= INTERSECT_PX) {
        return {
          snap: { pos: ca.pos, type: 'intersection', lineA: near[0].line, lineB: near[1].line },
          lines: [near[0].line, near[1].line],
        }
      }
    }
  }

  // ---- Priority 3: Nearest line ACTIVE ----
  const activeLine = near[0]
  // Special points on the line → absorb the nearest (~16px), filter by category switch
  let bestPoint: SnapPoint | null = null
  let bestPx = POINT_PX
  for (const pt of pointsOnLine(activeLine.line)) {
    if (!targets[pointTargetKey(pt.kind)]) continue
    const s = projectToPx(pt.pos)
    if (!s) continue
    const px = Math.hypot(s.x - mx, s.y - my)
    if (px < bestPx) { bestPx = px; bestPoint = pt }
  }
  if (bestPoint) {
    return {
      snap: { pos: bestPoint.pos, type: 'point', line: activeLine.line, point: bestPoint },
      lines: [activeLine.line],
    }
  }
  // A free line foot belongs to the extension target; division-only mode must
  // not let it override discrete division points.
  if (!targets.extension) return null
  return { snap: { pos: activeLine.foot3D, type: 'foot', line: activeLine.line }, lines: [activeLine.line] }
}

const byKind: Record<string, string> = {
  midpoint: '#30D158', third: '#0A84FF', quarter: '#64D2FF', extension: '#FF9F0A', endpoint: '#FF9F0A',
}

/**
 * The highlight color of the active feature (add-atom and drag-atom share the same set of colors).
 */
export function snapFeatureColor(active: ActiveFeature | null): string {
  if (!active) return '#FF9F0A'
  if (active.snap.type === 'atom') return '#FFD60A'
  if (active.snap.type === 'intersection') return '#FF375F'
  if (active.snap.type === 'point') return byKind[active.snap.point.kind] ?? '#FF9F0A'
  return '#FF9F0A'
}
