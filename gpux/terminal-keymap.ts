/**
 * Maps GPUIX window key events to Ghostty's native key encoder.
 *
 * GPUIX gives us logical key names (`key`: "a", "enter", "f1", …),
 * the produced character (`keyChar`), and modifiers. Ghostty's encoder
 * wants physical `Key` codes + `Mods` bits + the UTF-8 text, and produces
 * the correct bytes (legacy sequences, Kitty keyboard, ctrl codes…).
 *
 * Key/Mods values mirror ghostty's `src/input/key.zig` via
 * `@terax/ghostty-core`'s `lib/types.ts` (Apache-2.0).
 */
import { Key, KeyAction, Mods } from './vendor/ghostty-core/types.ts'

export type GpuixKeyEvent = {
  key?: string
  keyChar?: string
  isHeld?: boolean
  modifiers?: { shift?: boolean; ctrl?: boolean; alt?: boolean; cmd?: boolean }
}

export type GhosttyEncodeFn = (ev: {
  action: number
  key: number
  mods: number
  utf8?: string
}) => Uint8Array

const NAMED_KEYS: Record<string, number> = {
  enter: Key.ENTER,
  escape: Key.ESCAPE,
  backspace: Key.BACKSPACE,
  tab: Key.TAB,
  space: Key.SPACE,
  delete: Key.DELETE,
  insert: Key.INSERT,
  home: Key.HOME,
  end: Key.END,
  pageup: Key.PAGE_UP,
  pagedown: Key.PAGE_DOWN,
  up: Key.UP,
  down: Key.DOWN,
  left: Key.LEFT,
  right: Key.RIGHT,
  f1: Key.F1,
  f2: Key.F2,
  f3: Key.F3,
  f4: Key.F4,
  f5: Key.F5,
  f6: Key.F6,
  f7: Key.F7,
  f8: Key.F8,
  f9: Key.F9,
  f10: Key.F10,
  f11: Key.F11,
  f12: Key.F12,
}

const PUNCT_KEYS: Record<string, number> = {
  '`': Key.GRAVE,
  '-': Key.MINUS,
  '=': Key.EQUAL,
  '[': Key.BRACKET_LEFT,
  ']': Key.BRACKET_RIGHT,
  '\\': Key.BACKSLASH,
  ';': Key.SEMICOLON,
  "'": Key.QUOTE,
  ',': Key.COMMA,
  '.': Key.PERIOD,
  '/': Key.SLASH,
  // Shifted variants map to the same physical key; utf8 carries the char.
  '~': Key.GRAVE,
  _: Key.MINUS,
  '+': Key.EQUAL,
  '{': Key.BRACKET_LEFT,
  '}': Key.BRACKET_RIGHT,
  '|': Key.BACKSLASH,
  ':': Key.SEMICOLON,
  '"': Key.QUOTE,
  '<': Key.COMMA,
  '>': Key.PERIOD,
  '?': Key.SLASH,
}

function modsFor(m?: GpuixKeyEvent['modifiers']): number {
  let r = Mods.NONE
  if (m?.shift) r |= Mods.SHIFT
  if (m?.ctrl) r |= Mods.CTRL
  if (m?.alt) r |= Mods.ALT
  if (m?.cmd) r |= Mods.SUPER
  return r
}

function keyCodeFor(ev: GpuixKeyEvent): number | null {
  const name = ev.key?.toLowerCase()
  if (name) {
    const named = NAMED_KEYS[name]
    if (named !== undefined) return named
    // Single printable character: derive the physical code.
    const ch = ev.keyChar ?? (name.length === 1 ? name : '')
    if (ch.length === 1) {
      const lower = ch.toLowerCase()
      if (lower >= 'a' && lower <= 'z') return Key.A + (lower.charCodeAt(0) - 97)
      if (lower >= '0' && lower <= '9') return Key.ZERO + (lower.charCodeAt(0) - 48)
      const punct = PUNCT_KEYS[lower] ?? PUNCT_KEYS[ch]
      if (punct !== undefined) return punct
    }
  }
  return null
}

/**
 * Encode a GPUIX keyDown into terminal input bytes via Ghostty's native
 * encoder. Returns null when the key isn't mappable (caller should ignore).
 */
export function encodeGpuixKey(encodeKey: GhosttyEncodeFn, ev: GpuixKeyEvent): Uint8Array | null {
  const code = keyCodeFor(ev)
  if (code === null) return null
  return encodeKey({
    action: ev.isHeld ? KeyAction.REPEAT : KeyAction.PRESS,
    key: code,
    mods: modsFor(ev.modifiers),
    utf8: ev.keyChar || undefined,
  })
}
