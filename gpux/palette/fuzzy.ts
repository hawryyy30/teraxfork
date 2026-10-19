/**
 * Fuzzy subsequence matcher for the command palette.
 *
 * Score rewards: match at the start, at word boundaries, and consecutive
 * runs. Returns -1 when the query is not a subsequence of the target.
 */

export function fuzzyScore(query: string, target: string): number {
  const q = query.toLowerCase()
  const t = target.toLowerCase()
  if (q.length === 0) return 0
  if (q.length > t.length) return -1

  let score = 0
  let ti = 0
  let run = 0
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi]
    let found = -1
    for (let j = ti; j < t.length; j++) {
      if (t[j] === ch) {
        found = j
        break
      }
    }
    if (found === -1) return -1
    if (found === 0 || /[\s\-_/.:]/.test(t[found - 1])) score += 8
    else if (found === ti) {
      run += 1
      score += 4 + run
    } else {
      run = 0
      score += 1
    }
    score += Math.max(0, 3 - (found - ti))
    ti = found + 1
  }
  return score
}

export function fuzzyFilter<T>(
  query: string,
  items: T[],
  key: (item: T) => string,
): T[] {
  const q = query.trim()
  if (!q) return items
  return items
    .map((item) => ({ item, score: fuzzyScore(q, key(item)) }))
    .filter((r) => r.score >= 0)
    .sort((a, b) => b.score - a.score)
    .map((r) => r.item)
}
