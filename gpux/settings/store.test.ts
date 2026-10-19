import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFS, parsePrefs } from './store.ts'

describe('settings store', () => {
  it('parses a valid prefs file', () => {
    expect(parsePrefs('{"themeId":"dracula"}')).toEqual({ themeId: 'dracula' })
  })

  it('falls back to defaults on corrupt input', () => {
    expect(parsePrefs('not json')).toEqual(DEFAULT_PREFS)
    expect(parsePrefs('')).toEqual(DEFAULT_PREFS)
  })

  it('rejects unknown theme ids', () => {
    expect(parsePrefs('{"themeId":"nope"}')).toEqual(DEFAULT_PREFS)
  })

  it('ignores extra fields', () => {
    expect(parsePrefs('{"themeId":"kanagawa","other":1}')).toEqual({
      themeId: 'kanagawa',
    })
  })
})
