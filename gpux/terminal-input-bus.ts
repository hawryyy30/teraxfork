/**
 * Routes GPUIX window keyDown events to the terminal.
 *
 * The terminal takes all keys *unless* a text UI (the chat composer) has
 * focus — otherwise typing in chat would also type into the shell.
 */
import type { GpuixKeyEvent } from './terminal-keymap.ts'

let terminalHandler: ((ev: GpuixKeyEvent) => void) | null = null
let textUiFocused = false
let ptyWriter: ((data: string) => void) | null = null

export function setTerminalKeyHandler(h: ((ev: GpuixKeyEvent) => void) | null) {
  terminalHandler = h
}

/** The active PTY source registers here so UI (e.g. the file explorer)
 *  can send input to the shell. Cleared when the terminal unmounts. */
export function setPtyWriter(w: ((data: string) => void) | null) {
  ptyWriter = w
}

/** Write raw input to the shell, e.g. `cd 'path'\n`. No-op when the
 *  terminal isn't running (or is the demo driver, which ignores writes). */
export function writeToTerminal(data: string) {
  ptyWriter?.(data)
}

export function setTextUiFocused(focused: boolean) {
  textUiFocused = focused
}

/** Call from `render()`'s `onKeyDown`. */
export function dispatchWindowKeyDown(ev: GpuixKeyEvent) {
  if (!textUiFocused) terminalHandler?.(ev)
}
