import { describe, expect, it } from 'vitest'
import { PALETTE_KEYS, THEMES, isValidHexColor, themeById } from './themes.ts'

describe('theme registry', () => {
  it('has unique ids', () => {
    const ids = THEMES.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.length).toBeGreaterThan(0)
  })

  it('every theme supplies the full palette with valid hex colors', () => {
    for (const t of THEMES) {
      expect(t.label.length).toBeGreaterThan(0)
      for (const k of PALETTE_KEYS) {
        expect(isValidHexColor(t.colors[k]), `${t.id}.${k}`).toBe(true)
      }
    }
  })

  it('themeById resolves terax-dark as the default', () => {
    expect(themeById('terax-dark')?.label).toBe('Terax Dark')
    expect(themeById('nope')).toBeUndefined()
  })

  it('text is readable against bg in dark themes (simple luminance check)', () => {
    const lum = (hex: string) => {
      const r = parseInt(hex.slice(1, 3), 16) / 255
      const g = parseInt(hex.slice(3, 5), 16) / 255
      const b = parseInt(hex.slice(5, 7), 16) / 255
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    for (const t of THEMES.filter((t) => t.dark)) {
      const diff = Math.abs(lum(t.colors.text) - lum(t.colors.bg))
      expect(diff, t.id).toBeGreaterThan(0.35)
    }
  })
})
