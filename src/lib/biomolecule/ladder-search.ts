/** Pure fuzzy search over short hierarchy labels using subsequence matching. */

import { fuzzyScore } from '../fuzzy-score'
import type { LadderNode, StructureLadder } from './structure-ladder'

/** Discount detail matches because the label carries primary identity. */
const DETAIL_WEIGHT = 0.6

/** Default result cap for large structures. */
export const LADDER_SEARCH_LIMIT = 40

/** Re-export the shared scorer from its dependency-neutral module. */
export { fuzzyScore }

/** Search materialized hierarchy nodes in descending match quality. */
export function searchLadder(
  ladder: StructureLadder,
  query: string,
  limit: number = LADDER_SEARCH_LIMIT,
): LadderNode[] {
  if (query.trim().length === 0) return []

  const hits: { node: LadderNode; score: number }[] = []
  for (const node of ladder.nodes.values()) {
    const labelScore = fuzzyScore(query, node.label)
    const detailScore = node.detail === null ? null : fuzzyScore(query, node.detail)
    const weighted = detailScore === null ? null : detailScore * DETAIL_WEIGHT
    // Either label or weighted detail may establish the match.
    if (labelScore === null && weighted === null) continue
    const score = Math.max(labelScore ?? Number.NEGATIVE_INFINITY, weighted ?? Number.NEGATIVE_INFINITY)
    hits.push({ node, score })
  }

  // Break score ties by label so results do not depend on insertion order.
  hits.sort((a, b) => b.score - a.score || a.node.label.localeCompare(b.node.label))
  return hits.slice(0, limit).map((hit) => hit.node)
}
