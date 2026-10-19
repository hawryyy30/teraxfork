import { describe, expect, it } from 'vitest'
import { fuzzyFilter, fuzzyScore } from './fuzzy.ts'

describe('fuzzyScore', () => {
  it('returns -1 for non-subsequences', () => {
    expect(fuzzyScore('xyz', 'abc')).toBe(-1)
    expect(fuzzyScore('ba', 'ab')).toBe(-1)
  })

  it('returns 0 for an empty query', () => {
    expect(fuzzyScore('', 'anything')).toBe(0)
  })

  it('prefers word-boundary and prefix matches', () => {
    const boundary = fuzzyScore('gs', 'git: stage all')
    const scattered = fuzzyScore('gs', 'long settings page')
    expect(boundary).toBeGreaterThan(scattered)
  })

  it('prefers consecutive runs', () => {
    expect(fuzzyScore('com', 'commit staged')).toBeGreaterThan(
      fuzzyScore('com', 'checkout main'),
    )
  })

  it('is case-insensitive', () => {
    expect(fuzzyScore('GIT', 'git: pull')).toBe(fuzzyScore('git', 'git: pull'))
  })
})

describe('fuzzyFilter', () => {
  const items = ['git: stage all', 'git: pull', 'view: terminal', 'theme: next']

  it('returns everything on an empty query', () => {
    expect(fuzzyFilter('  ', items, (s) => s)).toEqual(items)
  })

  it('filters and ranks by score', () => {
    const out = fuzzyFilter('git', items, (s) => s)
    expect(out).toEqual(['git: stage all', 'git: pull'])
  })

  it('drops non-matching items', () => {
    expect(fuzzyFilter('zzz', items, (s) => s)).toEqual([])
  })
})
