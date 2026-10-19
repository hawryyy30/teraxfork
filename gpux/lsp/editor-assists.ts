/**
 * editor-assists — pure helpers for the Phase 1 editor shell.
 *
 * Kept dependency-free so they can be unit-tested headlessly; the native
 * `selection` prop / `onSelect` event (fork) apply the results.
 */

export type Sel = { start: number; end: number }

export const PAIRS: Record<string, string> = {
  '(': ')',
  '[': ']',
  '{': '}',
  '"': '"',
  "'": "'",
  '`': '`',
}
const OPENERS = new Set(Object.keys(PAIRS))
const CLOSERS = new Set(Object.values(PAIRS))

/** Diff old→new into a single inserted run; returns [insertIndex, inserted]. */
export function insertedRun(oldText: string, newText: string): [number, string] {
  let p = 0
  const maxP = Math.min(oldText.length, newText.length)
  while (p < maxP && oldText[p] === newText[p]) p++
  let s = 0
  while (
    s < oldText.length - p &&
    s < newText.length - p &&
    oldText[oldText.length - 1 - s] === newText[newText.length - 1 - s]
  ) {
    s++
  }
  return [p, newText.slice(p, newText.length - s)]
}

export type AssistResult = { value: string; sel: Sel }

/** Locate a single inserted char using the pre-change caret when available. */
function insertionAt(
  oldText: string,
  newText: string,
  selBefore: Sel | undefined,
): [number, string] | null {
  if (selBefore) {
    const { start, end } = selBefore
    const replacedLen = end - start
    if (newText.length === oldText.length - replacedLen + 1) {
      const at = start
      const ch = newText[at]
      if (
        ch !== undefined &&
        newText.slice(0, at) === oldText.slice(0, at) &&
        newText.slice(at + 1) === oldText.slice(end)
      ) {
        return [at, ch]
      }
    }
  }
  const [at, inserted] = insertedRun(oldText, newText)
  return inserted.length === 1 ? [at, inserted] : null
}

/**
 * Editor assists for a single onChange(oldText → newText).
 * `selBefore` is the caret/selection as of the last `onSelect` — it
 * disambiguates the insertion point when the typed char matches its
 * neighbors (e.g. typing `"` between `""`).
 * Returns the corrected value + caret selection when an assist applies,
 * or null when the change should pass through untouched.
 *
 * - bracket auto-close: typing `(` → `()` with caret between
 * - closer skip-over: typing `)` when `)` is next → move past it
 * - indent-on-Enter: carry the current line's leading whitespace
 */
export function applyAssist(
  oldText: string,
  newText: string,
  selBefore?: Sel,
): AssistResult | null {
  const found = insertionAt(oldText, newText, selBefore)
  if (!found) return null
  const [at, ch] = found
  // Skip-over: typed a closer that is already the next char → just move past it.
  if (newText[at + 1] === ch && CLOSERS.has(ch)) {
    return {
      value: newText.slice(0, at) + newText.slice(at + 1),
      sel: { start: at + 1, end: at + 1 },
    }
  }
  // Auto-close an opener.
  if (OPENERS.has(ch)) {
    const closer = PAIRS[ch]
    return {
      value: newText.slice(0, at + 1) + closer + newText.slice(at + 1),
      sel: { start: at + 1, end: at + 1 },
    }
  }
  // Indent-on-Enter: carry the current line's leading whitespace.
  if (ch === '\n') {
    const lineStart = newText.lastIndexOf('\n', at - 1) + 1
    const indent = /^[\t ]*/.exec(newText.slice(lineStart, at))?.[0] ?? ''
    if (indent) {
      return {
        value: newText.slice(0, at + 1) + indent + newText.slice(at + 1),
        sel: { start: at + 1 + indent.length, end: at + 1 + indent.length },
      }
    }
  }
  return null
}

/** Start offsets of every non-overlapping occurrence of query in text. */
export function matchOffsets(text: string, query: string): number[] {
  const out: number[] = []
  if (!query) return out
  let i = 0
  while ((i = text.indexOf(query, i)) !== -1) {
    out.push(i)
    i += query.length
  }
  return out
}

/** Offset of the start of line n (1-based, clamped). */
export function lineStartOffset(text: string, line: number): number {
  const lines = text.split('\n')
  const clamped = Math.max(1, Math.min(line, Math.max(1, lines.length)))
  let off = 0
  for (let i = 0; i < clamped - 1; i++) off += lines[i].length + 1
  return off
}

/** 1-based (line, col) for a UTF-16 offset. */
export function caretLineCol(text: string, offset: number): [number, number] {
  const clamped = Math.max(0, Math.min(offset, text.length))
  const line = text.slice(0, clamped).split('\n').length
  const lineStart = text.lastIndexOf('\n', clamped - 1) + 1
  return [line, clamped - lineStart + 1]
}

const WORD_CHAR = /[A-Za-z0-9_$]/

/** Identifier word around a UTF-16 offset (for completion prefix/filtering). */
export function wordAtOffset(
  text: string,
  offset: number,
): { start: number; end: number; word: string } {
  const o = Math.max(0, Math.min(offset, text.length))
  let start = o
  while (start > 0 && WORD_CHAR.test(text[start - 1]!)) start--
  let end = o
  while (end < text.length && WORD_CHAR.test(text[end]!)) end++
  return { start, end, word: text.slice(start, end) }
}

/** Replace [start, end) with insert, collapsing the caret to its end. */
export function replaceRange(
  text: string,
  start: number,
  end: number,
  insert: string,
): { value: string; sel: Sel } {
  const value = text.slice(0, start) + insert + text.slice(end)
  const pos = start + insert.length
  return { value, sel: { start: pos, end: pos } }
}
