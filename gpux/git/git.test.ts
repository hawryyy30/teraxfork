import { describe, expect, it } from 'vitest'
import {
  isStaged,
  isUnstaged,
  isUntracked,
  parseLog,
  parseStatusV2,
} from './git.ts'

const SAMPLE =
  '# branch.head main\n' +
  '# branch.upstream origin/main\n' +
  '1 M. N... 100644 100644 100644 abc123 def456 src/app.ts\0' +
  '1 .M N... 100644 100644 100644 abc123 def456 src/util.ts\0' +
  '1 MM N... 100644 100644 100644 abc123 def456 src/both.ts\0' +
  '1 A. N... 000000 100644 100644 000000 def456 src/new file.ts\0' +
  '2 R. N... 100644 100644 100644 abc123 def456 R100 src/renamed.ts\0src/old.ts\0' +
  'u UU N... 100644 100644 100644 abc123 def456 src/conflict.ts\0' +
  '? src/scratch.ts\0' +
  '! src/ignored.ts\0'

describe('parseStatusV2', () => {
  it('parses ordinary, staged, and mixed entries', () => {
    const es = parseStatusV2(SAMPLE)
    expect(es.map((e) => e.path)).toEqual([
      'src/app.ts',
      'src/util.ts',
      'src/both.ts',
      'src/new file.ts',
      'src/renamed.ts',
      'src/conflict.ts',
      'src/scratch.ts',
    ])
    const byPath = Object.fromEntries(es.map((e) => [e.path, e]))
    expect([byPath['src/app.ts'].x, byPath['src/app.ts'].y]).toEqual(['M', '.'])
    expect([byPath['src/util.ts'].x, byPath['src/util.ts'].y]).toEqual(['.', 'M'])
    expect([byPath['src/both.ts'].x, byPath['src/both.ts'].y]).toEqual(['M', 'M'])
    expect(byPath['src/new file.ts'].x).toBe('A')
  })

  it('parses renames with the original path', () => {
    const es = parseStatusV2(SAMPLE)
    const r = es.find((e) => e.path === 'src/renamed.ts')
    expect(r?.x).toBe('R')
    expect(r?.origPath).toBe('src/old.ts')
  })

  it('keeps paths with spaces intact', () => {
    const es = parseStatusV2(SAMPLE)
    expect(es.some((e) => e.path === 'src/new file.ts')).toBe(true)
  })

  it('marks untracked and unmerged entries', () => {
    const es = parseStatusV2(SAMPLE)
    const scratch = es.find((e) => e.path === 'src/scratch.ts')
    expect(scratch && isUntracked(scratch)).toBe(true)
    expect(scratch && isStaged(scratch)).toBe(false)
    const conflict = es.find((e) => e.path === 'src/conflict.ts')
    expect(conflict && isStaged(conflict)).toBe(true)
    expect(conflict && isUnstaged(conflict)).toBe(true)
  })

  it('skips branch headers and ignored files', () => {
    const es = parseStatusV2(SAMPLE)
    expect(es.some((e) => e.path.includes('branch.head'))).toBe(false)
    expect(es.some((e) => e.path === 'src/ignored.ts')).toBe(false)
  })

  it('handles empty output', () => {
    expect(parseStatusV2('')).toEqual([])
  })
})

describe('parseLog', () => {
  it('parses unit-separator log lines', () => {
    const out = parseLog('abc123\x1fJane\x1f2026-10-19\x1fFix the thing\ndef456\x1fBo\x1f2026-10-18\x1fAdd stuff\n')
    expect(out).toEqual([
      { hash: 'abc123', author: 'Jane', date: '2026-10-19', subject: 'Fix the thing' },
      { hash: 'def456', author: 'Bo', date: '2026-10-18', subject: 'Add stuff' },
    ])
  })

  it('handles empty output', () => {
    expect(parseLog('')).toEqual([])
  })
})
