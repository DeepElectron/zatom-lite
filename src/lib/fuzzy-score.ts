/** Dependency-neutral subsequence scoring for short UI labels. */

/**
 * Consecutive hits on adjacent characters: "glu" hits with GLU34 should be significantly better than scattered hits.
 */
const CONSECUTIVE_BONUS = 8
/**
 * The hit falls at the beginning of the word/number field: "a" hitting the A in "Chain A" is better than hitting the a in "Chain".
 */
const BOUNDARY_BONUS = 6
/**
 * The upper limit of the number of characters skipped at a time, to prevent a huge jump in long text from pushing the score to negative infinity.
 */
const MAX_GAP_PENALTY = 4
/**
 * Full score for length fit. The closer the text is to the query length, the more likely it is the one the user wants.
 */
const TIGHTNESS_BONUS = 12

/** Treat delimiters and letter-to-digit transitions as word boundaries. */
function isWordBoundary(text: string, index: number): boolean {
  if (index === 0) return true
  const previous = text[index - 1]
  const current = text[index]
  if (!/[a-z0-9]/i.test(previous)) return true
  return /[0-9]/.test(current) && /[a-z]/i.test(previous)
}

/**
 * Score "whether query is a subsequence of text".
 *
 * @returns Score (the larger, the better the match); `null` means it is not a subsequence at all, that is, it does not match.
 * An empty query returns 0 instead of null - "matches all but no preference".
 */
export function fuzzyScore(query: string, text: string): number | null {
  const needle = query.trim().toLowerCase()
  if (needle.length === 0) return 0

  // Preserve original text for boundary detection while matching case-insensitively.
  const haystack = text.toLowerCase()
  let score = 0
  let cursor = 0
  let previousIndex = -1

  for (const character of needle) {
    const index = haystack.indexOf(character, cursor)
    if (index < 0) return null
    if (index === previousIndex + 1) score += CONSECUTIVE_BONUS
    if (isWordBoundary(text, index)) score += BOUNDARY_BONUS
    score -= Math.min(index - cursor, MAX_GAP_PENALTY)
    previousIndex = index
    cursor = index + 1
  }

  // Length fit: When "glu" is also hit, "GLU34" should be ranked in front of a long tag that scatters g/l/u in it.
  score += Math.max(0, TIGHTNESS_BONUS - (haystack.length - needle.length))
  return score
}
