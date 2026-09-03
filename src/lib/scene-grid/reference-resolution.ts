/**
 * reference-resolution — turns "the atom to the right of this one" into ranked
 * atom candidates with an honest ambiguity score.
 *
 * Every relation is computed in a frame the user actually experiences:
 *   screen words (left/right/up/down/behind/in_front) use the camera frame;
 *   surface words (above_surface/below_surface/same_layer/layer_below/
 *   layer_above) use the detected surface normal and layer analysis;
 *   topological words (bonded_to/nearest/along_bond/between) use distances and
 *   bonds with periodic minimum image.
 *
 * The output is deliberately not a single answer. Ranked candidates plus an
 * ambiguity in [0, 1] let the tool description say "when ambiguity > 0.35,
 * present the top candidates and ask" instead of silently picking one.
 */

import type { Vec3, ZatomStructure } from '../../agent/contracts'
import { createCertifiedMinimumImageCalculator, createDistanceCalculator } from '../../agent/structure-math'
import { detectFragments, detectLayers, hostOnly, resolveSurfaceNormal } from './system-semantics'
import { screenDirection, screenFrame, toScreen, type ScreenDirectionWord, type ScreenFrame } from './viewer-frame'

export type SpatialRelation =
  | ScreenDirectionWord
  | 'nearest'
  | 'bonded_to'
  | 'along_bond'
  | 'between'
  | 'above_surface'
  | 'below_surface'
  | 'same_layer'
  | 'layer_below'
  | 'layer_above'
  | 'same_fragment'

export interface ReferenceQuery {
  relation: SpatialRelation
  /** Anchor atoms the relation is measured from (the "this one"). */
  anchorAtomIds: string[]
  /**
  * A point in space to anchor on instead of atoms — a vacancy site, an
  * adsorption-site position, or an annotation. Used when anchorAtomIds is
  * empty; with both present the atoms win.
  */
  anchorPoint?: Vec3
  /** Second anchor for 'between' and 'along_bond'. */
  secondaryAtomIds?: string[]
  /** Restrict candidates to these elements. */
  elements?: string[]
  /** Restrict candidates to these ids (e.g. a previous candidate set). */
  withinAtomIds?: string[]
  /** Max candidates to return. */
  limit?: number
  /** Max distance from the anchor centroid in Å for distance-bounded relations. */
  maxDistanceA?: number
}

export interface ReferenceCandidate {
  atomId: string
  element: string
  /** Higher is better; monotone within one query, not comparable across queries. */
  score: number
  distanceA: number
  /** Human-readable reason, e.g. "2.1 Å right, 0.3 Å up, same depth". */
  why: string
}

export interface ReferenceResolution {
  relation: SpatialRelation
  frame: 'screen' | 'surface' | 'topology'
  candidates: ReferenceCandidate[]
  /** 0 = clear winner, 1 = indistinguishable. */
  ambiguity: number
  /** Present when the frame needed something that was missing (no camera, no lattice). */
  note: string | null
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const norm = (v: Vec3) => Math.hypot(v[0], v[1], v[2])
const unit = (v: Vec3): Vec3 => {
  const n = norm(v)
  return n > 1e-12 ? [v[0] / n, v[1] / n, v[2] / n] : [0, 0, 0]
}

function centroidOf(structure: ZatomStructure, ids: readonly string[]): Vec3 | null {
  const byId = new Map(structure.atoms.map((a) => [a.id, a]))
  const pts = ids.map((id) => byId.get(id)?.position).filter((p): p is Vec3 => !!p)
  if (!pts.length) return null
  const c: Vec3 = [0, 0, 0]
  for (const p of pts) {
    c[0] += p[0]
    c[1] += p[1]
    c[2] += p[2]
  }
  return [c[0] / pts.length, c[1] / pts.length, c[2] / pts.length]
}

/** Ambiguity from the score gap between the best and the runner-up. */
function ambiguityOf(scores: number[]): number {
  if (scores.length < 2) return scores.length === 0 ? 1 : 0
  const [a, b] = scores
  if (!Number.isFinite(a) || a <= 0) return 1
  const gap = (a - b) / a
  return Math.max(0, Math.min(1, 1 - gap * 2))
}

/** Minimum-image displacement from a to b, if a lattice exists. */
function displacement(structure: ZatomStructure, a: Vec3, b: Vec3): Vec3 {
  const lattice = structure.lattice
  const d = sub(b, a)
  if (!lattice || !lattice.periodic.some(Boolean)) return d
  // Oblique slab cells make naive [-0.5, 0.5) wrapping pick the wrong image;
  // the certified search is exact.
  let calc = minimumImageCache.get(lattice)
  if (!calc) {
    calc = createCertifiedMinimumImageCalculator(lattice)
    minimumImageCache.set(lattice, calc)
  }
  return calc(d).vector
}

const minimumImageCache = new WeakMap<
  NonNullable<ZatomStructure['lattice']>,
  ReturnType<typeof createCertifiedMinimumImageCalculator>
>()

export interface ResolveContext {
  pose?: { position: Vec3; lookAt: Vec3; up?: Vec3 } | null
}

export function resolveReference(
  structure: ZatomStructure,
  query: ReferenceQuery,
  context: ResolveContext = {},
): ReferenceResolution {
  const limit = query.limit ?? 5
  const byId = new Map(structure.atoms.map((a) => [a.id, a]))
  const anchorIds = query.anchorAtomIds.filter((id) => byId.has(id))
  const anchor = centroidOf(structure, anchorIds) ?? query.anchorPoint ?? null
  const anchorSet = new Set(anchorIds)
  const elementFilter = query.elements ? new Set(query.elements) : null
  const withinFilter = query.withinAtomIds ? new Set(query.withinAtomIds) : null
  const distance = createDistanceCalculator(structure.lattice)

  const pool = structure.atoms.filter(
    (a) => !anchorSet.has(a.id) && (!elementFilter || elementFilter.has(a.element)) && (!withinFilter || withinFilter.has(a.id)),
  )

  const finish = (
    frame: ReferenceResolution['frame'],
    scored: ReferenceCandidate[],
    note: string | null = null,
  ): ReferenceResolution => {
    scored.sort((a, b) => b.score - a.score)
    const top = scored.slice(0, limit)
    return {
      relation: query.relation,
      frame,
      candidates: top.map((c) => ({ ...c, score: Number(c.score.toFixed(4)), distanceA: Number(c.distanceA.toFixed(3)) })),
      ambiguity: Number(ambiguityOf(top.map((c) => c.score)).toFixed(3)),
      note,
    }
  }

  if (!anchor && query.relation !== 'above_surface' && query.relation !== 'below_surface') {
    return finish('topology', [], 'No anchor atoms found in the structure.')
  }
  if (!anchorIds.length && anchor && (query.relation === 'bonded_to' || query.relation === 'same_fragment')) {
    return finish('topology', [], `${query.relation} needs anchor atoms; a point anchor has no bonds. Use nearest with maxDistanceA.`)
  }

  // ---- screen-relative ----------------------------------------------------
  const screenWords: ScreenDirectionWord[] = ['right', 'left', 'up', 'down', 'behind', 'in_front']
  if ((screenWords as string[]).includes(query.relation)) {
    if (!context.pose) return finish('screen', [], 'No camera pose: screen-relative words need a mounted viewport. Use viewer_observe first or a surface/topology relation.')
    const frame: ScreenFrame = screenFrame(context.pose)
    const dir = screenDirection(frame, query.relation as ScreenDirectionWord)
    const anchorScreen = toScreen(frame, anchor!)
    const maxD = query.maxDistanceA ?? Math.max(6, frame.distance * 0.6)
    const scored: ReferenceCandidate[] = []
    for (const atom of pool) {
      // Raw (not minimum-image) displacement: screen words refer to where the
      // atom is DRAWN, and in a small cell the periodic image on the right is
      // the very same atom the user sees on the left.
      const disp = sub(atom.position, anchor!)
      const d = norm(disp)
      if (d > maxD || d < 1e-6) continue
      const along = dot(disp, dir)
      if (along <= 0) continue
      const cosine = along / d
      // Prefer atoms squarely in the direction and close by; penalise depth
      // spread for screen words because "to the right" implies roughly the
      // same depth plane.
      const s = toScreen(frame, atom.position)
      const depthPenalty = Math.abs(s.depth - anchorScreen.depth) / Math.max(1, d)
      const score = cosine ** 2 / (1 + 0.35 * d) / (1 + depthPenalty)
      scored.push({
        atomId: atom.id,
        element: atom.element,
        score,
        distanceA: d,
        why: `${along.toFixed(2)} Å ${query.relation.replace('_', ' ')}, ${Math.abs(s.depth - anchorScreen.depth).toFixed(2)} Å depth offset`,
      })
    }
    return finish('screen', scored)
  }

  // ---- surface-relative ---------------------------------------------------
  if (['above_surface', 'below_surface', 'same_layer', 'layer_below', 'layer_above'].includes(query.relation)) {
    const normalInfo = resolveSurfaceNormal(structure)
    if (!normalInfo) return finish('surface', [], 'No surface normal: the structure has no aperiodic axis or vacuum gap. Use screen or topology relations.')
    const n = unit(normalInfo.normal)
    const fragments = detectFragments(structure)
    const host = hostOnly(structure, fragments)
    const layers = detectLayers(host, n)
    const layerOf = new Map<string, number>()
    for (const layer of layers.layers) for (const id of layer.atomIds) layerOf.set(id, layer.index)

    if (query.relation === 'above_surface' || query.relation === 'below_surface') {
      // Height is measured from the anchor when there is one ("the Cu below
      // this CO" includes the top layer); otherwise from the top host layer.
      const refHeight = anchor ? dot(anchor, n) : (layers.layers[0]?.heightA ?? 0)
      const refLabel = anchor ? 'the anchor' : 'the top layer'
      const sign = query.relation === 'above_surface' ? 1 : -1
      const scored: ReferenceCandidate[] = []
      for (const atom of pool) {
        const h = dot(atom.position, n) - refHeight
        if (h * sign <= 0.2) continue
        let lateral = 0
        if (anchor) {
          const disp = displacement(structure, anchor, atom.position)
          const along = dot(disp, n)
          lateral = norm(sub(disp, n.map((x) => x * along) as Vec3))
        }
        const score = 1 / (1 + 0.3 * Math.abs(h)) / (1 + 0.5 * lateral)
        scored.push({
          atomId: atom.id,
          element: atom.element,
          score,
          distanceA: anchor ? distance(anchor, atom.position) : Math.abs(h),
          why: `${Math.abs(h).toFixed(2)} Å ${sign > 0 ? 'above' : 'below'} ${refLabel}${anchor ? `, ${lateral.toFixed(2)} Å lateral` : ''}`,
        })
      }
      return finish('surface', scored)
    }

    const anchorLayers = anchorIds.map((id) => layerOf.get(id)).filter((l): l is number => l !== undefined)
    if (!anchorLayers.length) return finish('surface', [], 'Anchor atoms are not part of a host layer (adsorbate?). Use nearest/bonded_to instead.')
    const base = Math.round(anchorLayers.reduce((s, x) => s + x, 0) / anchorLayers.length)
    const target = query.relation === 'same_layer' ? base : query.relation === 'layer_below' ? base + 1 : base - 1
    if (target < 0 || target >= layers.layers.length) {
      return finish('surface', [], `Layer ${target} does not exist (layers 0..${layers.layers.length - 1}, 0 = top).`)
    }
    const scored: ReferenceCandidate[] = []
    for (const atom of pool) {
      if (layerOf.get(atom.id) !== target) continue
      const d = anchor ? distance(anchor, atom.position) : 0
      scored.push({ atomId: atom.id, element: atom.element, score: 1 / (1 + 0.4 * d), distanceA: d, why: `layer ${target}, ${d.toFixed(2)} Å from anchor` })
    }
    return finish('surface', scored)
  }

  // ---- topology -----------------------------------------------------------
  if (query.relation === 'nearest') {
    const maxD = query.maxDistanceA ?? Infinity
    const scored: ReferenceCandidate[] = []
    for (const atom of pool) {
      const d = distance(anchor!, atom.position)
      if (d > maxD) continue
      scored.push({ atomId: atom.id, element: atom.element, score: 1 / (1e-3 + d), distanceA: d, why: `${d.toFixed(2)} Å away` })
    }
    return finish('topology', scored)
  }

  if (query.relation === 'bonded_to') {
    const bonded = new Set<string>()
    for (const bond of structure.bonds ?? []) {
      const [a, b] = bond.atomIds
      if (anchorSet.has(a) && !anchorSet.has(b)) bonded.add(b)
      if (anchorSet.has(b) && !anchorSet.has(a)) bonded.add(a)
    }
    const scored: ReferenceCandidate[] = []
    const note = structure.bonds?.length ? null : 'Structure has no bond list; falling back to covalent-distance neighbours.'
    if (bonded.size) {
      for (const atom of pool) {
        if (!bonded.has(atom.id)) continue
        const d = distance(anchor!, atom.position)
        scored.push({ atomId: atom.id, element: atom.element, score: 1 / (1e-3 + d), distanceA: d, why: `bonded, ${d.toFixed(2)} Å` })
      }
    } else {
      for (const atom of pool) {
        const d = distance(anchor!, atom.position)
        if (d > 2.6) continue
        scored.push({ atomId: atom.id, element: atom.element, score: 1 / (1e-3 + d), distanceA: d, why: `${d.toFixed(2)} Å (no bond list)` })
      }
    }
    return finish('topology', scored, note)
  }

  if (query.relation === 'same_fragment') {
    const fragments = detectFragments(structure)
    const frag = fragments.find((f) => f.atomIds.some((id) => anchorSet.has(id)))
    if (!frag) return finish('topology', [], 'Anchor is not in any fragment.')
    const members = new Set(frag.atomIds)
    const scored: ReferenceCandidate[] = []
    for (const atom of pool) {
      if (!members.has(atom.id)) continue
      const d = distance(anchor!, atom.position)
      scored.push({ atomId: atom.id, element: atom.element, score: 1 / (1 + d), distanceA: d, why: `${frag.id} (${frag.formula}), ${d.toFixed(2)} Å` })
    }
    return finish('topology', scored)
  }

  if (query.relation === 'along_bond' || query.relation === 'between') {
    const secondary = centroidOf(structure, (query.secondaryAtomIds ?? []).filter((id) => byId.has(id)))
    if (!secondary) return finish('topology', [], `${query.relation} needs secondaryAtomIds.`)
    const axis = displacement(structure, anchor!, secondary)
    const len = norm(axis)
    if (len < 1e-6) return finish('topology', [], 'Anchor and secondary coincide.')
    const u = unit(axis)
    const scored: ReferenceCandidate[] = []
    for (const atom of pool) {
      if ((query.secondaryAtomIds ?? []).includes(atom.id)) continue
      const disp = displacement(structure, anchor!, atom.position)
      const t = dot(disp, u)
      const perp = norm(sub(disp, [u[0] * t, u[1] * t, u[2] * t]))
      if (query.relation === 'between') {
        if (t <= 0 || t >= len) continue
        const score = 1 / (1 + perp) / (1 + Math.abs(t - len / 2) / len)
        scored.push({ atomId: atom.id, element: atom.element, score, distanceA: norm(disp), why: `${(t / len * 100).toFixed(0)}% along, ${perp.toFixed(2)} Å off axis` })
      } else {
        // along_bond: continue past the secondary atom in the anchor→secondary direction
        if (t <= len) continue
        const score = 1 / (1 + perp) / (1 + 0.3 * (t - len))
        scored.push({ atomId: atom.id, element: atom.element, score, distanceA: norm(disp), why: `${(t - len).toFixed(2)} Å beyond, ${perp.toFixed(2)} Å off axis` })
      }
    }
    return finish('topology', scored)
  }

  return finish('topology', [], `Unknown relation ${String(query.relation)}.`)
}

export const SPATIAL_RELATIONS: readonly SpatialRelation[] = [
  'right', 'left', 'up', 'down', 'behind', 'in_front',
  'nearest', 'bonded_to', 'along_bond', 'between',
  'above_surface', 'below_surface', 'same_layer', 'layer_below', 'layer_above',
  'same_fragment',
]
