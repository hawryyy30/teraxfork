/**
 * Settings persistence for the gpux shell.
 *
 * Prefs live in `~/.config/terax-gpux/settings.json`. Reads tolerate a
 * missing or corrupt file (defaults win); writes create the directory.
 * API keys are never stored here, they stay in memory (see ai/client.ts).
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { themeById } from './themes.ts'

export interface Prefs {
  themeId: string
}

export const DEFAULT_PREFS: Prefs = { themeId: 'terax-dark' }

export function prefsPath(): string {
  return join(homedir(), '.config', 'terax-gpux', 'settings.json')
}

/** Pure: parse serialized prefs, falling back to defaults per field. */
export function parsePrefs(text: string): Prefs {
  try {
    const raw = JSON.parse(text) as Partial<Prefs>
    return {
      themeId:
        typeof raw.themeId === 'string' && themeById(raw.themeId)
          ? raw.themeId
          : DEFAULT_PREFS.themeId,
    }
  } catch {
    return { ...DEFAULT_PREFS }
  }
}

export function loadPrefs(): Prefs {
  try {
    return parsePrefs(readFileSync(prefsPath(), 'utf8'))
  } catch {
    return { ...DEFAULT_PREFS }
  }
}

export function savePrefs(prefs: Prefs): void {
  const path = prefsPath()
  mkdirSync(join(homedir(), '.config', 'terax-gpux'), { recursive: true })
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(prefs, null, 2) + '\n', 'utf8')
  renameSync(tmp, path)
}
