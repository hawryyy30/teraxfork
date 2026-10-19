import { describe, expect, it } from 'vitest'
import {
  applyAssist,
  caretLineCol,
  insertedRun,
  lineStartOffset,
  matchOffsets,
  replaceRange,
  wordAtOffset,
} from './editor-assists.ts'

describe('insertedRun', () => {
  it('finds a single inserted char', () => {
    expect(insertedRun('hello', 'hezllo')).toEqual([2, 'z'])
  })
  it('finds an insertion at the start and end', () => {
    expect(insertedRun('bc', 'abc')).toEqual([0, 'a'])
    expect(insertedRun('ab', 'abc')).toEqual([2, 'c'])
  })
  it('handles a pasted multi-char run as one insertion', () => {
    expect(insertedRun('ac', 'abbc')).toEqual([1, 'bb'])
  })
})

describe('applyAssist — bracket auto-close', () => {
  it('closes parens with the caret between', () => {
    // caret was after "f"; user typed "(" → native value "f("
    expect(applyAssist('f', 'f(')).toEqual({
      value: 'f()',
      sel: { start: 2, end: 2 },
    })
  })
  it('closes quotes', () => {
    expect(applyAssist('', '"')).toEqual({
      value: '""',
      sel: { start: 1, end: 1 },
    })
  })
  it('skips over an existing closer instead of doubling it', () => {
    // "()" with caret between; user typed ")" → native "())"
    expect(applyAssist('()', '())', { start: 1, end: 1 })).toEqual({
      value: '()',
      sel: { start: 2, end: 2 },
    })
  })
  it('skips over an existing quote', () => {
    // '""' with caret between; user typed '"' → native '"""'
    expect(applyAssist('""', '"""', { start: 1, end: 1 })).toEqual({
      value: '""',
      sel: { start: 2, end: 2 },
    })
  })
  it('leaves ordinary typing alone', () => {
    expect(applyAssist('ab', 'abc')).toBeNull()
    expect(applyAssist('ab', 'ab  ')).toBeNull() // multi-char paste
  })
})

describe('applyAssist — indent on Enter', () => {
  it('carries leading whitespace to the new line', () => {
    const before = '  const x = 1;'
    const after = '  const x = 1;\n'
    expect(applyAssist(before, after)).toEqual({
      value: '  const x = 1;\n  ',
      sel: { start: 17, end: 17 },
    })
  })
  it('does nothing on an unindented line', () => {
    expect(applyAssist('x', 'x\n')).toBeNull()
  })
  it('uses the indent of the line where Enter was pressed', () => {
    const before = 'a\n    b'
    const after = 'a\n    b\n'
    expect(applyAssist(before, after)).toEqual({
      value: 'a\n    b\n    ',
      sel: { start: 12, end: 12 },
    })
  })
})

describe('matchOffsets', () => {
  it('finds non-overlapping matches', () => {
    expect(matchOffsets('aaa', 'aa')).toEqual([0])
    expect(matchOffsets('one two one', 'one')).toEqual([0, 8])
  })
  it('returns [] for an empty query', () => {
    expect(matchOffsets('abc', '')).toEqual([])
  })
})

describe('lineStartOffset / caretLineCol', () => {
  const text = 'ab\ncde\nf'
  it('computes line starts, clamped', () => {
    expect(lineStartOffset(text, 1)).toBe(0)
    expect(lineStartOffset(text, 2)).toBe(3)
    expect(lineStartOffset(text, 3)).toBe(7)
    expect(lineStartOffset(text, 99)).toBe(7)
    expect(lineStartOffset(text, 0)).toBe(0)
  })
  it('computes 1-based line/col', () => {
    expect(caretLineCol(text, 0)).toEqual([1, 1])
    expect(caretLineCol(text, 4)).toEqual([2, 2])
    expect(caretLineCol(text, 99)).toEqual([3, 2])
  })
})

describe('wordAtOffset', () => {
  const text = 'const foo_bar = baz.qux;'
  it('finds the word around a middle offset', () => {
    expect(wordAtOffset(text, 8)).toEqual({ start: 6, end: 13, word: 'foo_bar' })
  })
  it('finds the word at its start and end', () => {
    expect(wordAtOffset(text, 6)).toEqual({ start: 6, end: 13, word: 'foo_bar' })
    expect(wordAtOffset(text, 13)).toEqual({ start: 6, end: 13, word: 'foo_bar' })
  })
  it('stops at punctuation', () => {
    expect(wordAtOffset(text, 18)).toEqual({ start: 16, end: 19, word: 'baz' })
    expect(wordAtOffset(text, 19)).toEqual({ start: 16, end: 19, word: 'baz' })
  })
  it('returns an empty word in whitespace', () => {
    const w = wordAtOffset('a  b', 2) // caret between the two spaces
    expect(w.word).toBe('')
    expect(w.start).toBe(w.end)
  })
  it('clamps out-of-range offsets', () => {
    expect(wordAtOffset(text, 99).word).toBe('')
    expect(wordAtOffset('', 0)).toEqual({ start: 0, end: 0, word: '' })
  })
})

describe('replaceRange', () => {
  it('replaces the range and collapses the caret', () => {
    expect(replaceRange('hello world', 6, 11, 'there')).toEqual({
      value: 'hello there',
      sel: { start: 11, end: 11 },
    })
  })
  it('handles pure insertion', () => {
    expect(replaceRange('ab', 2, 2, 'c')).toEqual({
      value: 'abc',
      sel: { start: 3, end: 3 },
    })
  })
})
