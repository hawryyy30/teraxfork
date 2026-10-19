/**
 * Shared design tokens for the gpux shell.
 *
 * `C` is the live palette object: `setThemeId` mutates it in place and
 * bumps a version counter, so every component that reads `C` re-renders
 * once it calls `useThemeVersion()`. Add that one hook call at the top of
 * any component that renders colors; the `C.xxx` references stay as-is.
 *
 * GPUI does not inherit `color`: every <text> sets one explicitly.
 */
import { useSyncExternalStore } from 'react'
import { THEMES, themeById, type Palette } from './settings/themes.ts'

export const C: Palette = { ...THEMES[0].colors }

let themeId = THEMES[0].id
let version = 0
const listeners = new Set<() => void>()

export function getThemeId(): string {
  return themeId
}

export function listThemes() {
  return THEMES
}

/** Apply a theme; returns false when the id is unknown. */
export function setThemeId(id: string): boolean {
  const t = themeById(id)
  if (!t) return false
  if (t.id === themeId) return true
  Object.assign(C, t.colors)
  themeId = t.id
  version += 1
  for (const l of listeners) l()
  return true
}

/** Switch to the next theme in the registry; returns the new id. */
export function cycleTheme(): string {
  const i = THEMES.findIndex((t) => t.id === themeId)
  const next = THEMES[(i + 1) % THEMES.length]
  setThemeId(next.id)
  return next.id
}

function subscribeThemeVersion(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

/** Call once per component that renders colors so theme switches repaint. */
export function useThemeVersion(): number {
  return useSyncExternalStore(subscribeThemeVersion, () => version)
}

export const UI_FONT = 'Inter'
