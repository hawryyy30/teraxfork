/**
 * PTY byte source for the spike terminal.
 *
 * Tries to spawn a real shell via node-pty; falls back to a scripted demo
 * driver when node-pty is unavailable (e.g. native module not built).
 * Emits strings (node-pty) — callers encode to bytes for the WASM core.
 *
 * node-pty build note (this VM): `bun add node-pty` does not produce the
 * binary on its own; run `node-gyp rebuild` inside
 * `node_modules/node-pty` (needs gcc/make/python3). On Windows the fork
 * will want prebuilds or the same manual build.
 */
import { EventEmitter } from 'node:events'

export type PtySource = {
  /** Subscribe to PTY output (strings, may contain ANSI). */
  onData(cb: (data: string) => void): () => void
  /** Write input to the PTY (keyboard, pasted text). */
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
  /** True when backed by a real shell, false for the demo driver. */
  readonly isReal: boolean
  readonly label: string
}

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

function createDemoSource(): PtySource {
  const emitter = new EventEmitter()
  let frame = 0
  const boot = [
    '\x1b[1;36m❯\x1b[0m cargo build --release\r\n',
    '\x1b[32m   Compiling\x1b[0m terax-gpuix v0.1.0\r\n',
    '\x1b[32m    Finished\x1b[0m release profile in 3.1s\r\n',
  ]
  const timer = setInterval(() => {
    const s = SPINNER[frame % SPINNER.length]
    emitter.emit(
      'data',
      `\x1b[28;1H\x1b[2K\x1b[35m${s}\x1b[0m agent working… frame ${frame}`,
    )
    if (frame % 30 === 0) {
      emitter.emit('data', `\x1b[27;1H\x1b[2K\x1b[32m✓\x1b[0m step ${frame / 30} done\r\n`)
    }
    frame++
  }, 100)
  // Emit boot sequence on next tick so onData subscribers are attached.
  setTimeout(() => {
    for (const line of boot) emitter.emit('data', line)
  }, 0)

  return {
    onData: (cb) => {
      emitter.on('data', cb)
      return () => {
        emitter.off('data', cb)
      }
    },
    write: () => {},
    resize: () => {},
    kill: () => clearInterval(timer),
    isReal: false,
    label: 'demo',
  }
}

export async function createPtySource(cols: number, rows: number): Promise<PtySource> {
  try {
    const pty = await import('node-pty')
    const shell =
      process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || 'bash'
    const proc = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: process.env.HOME || process.cwd(),
      env: process.env as Record<string, string>,
    })
    return {
      onData: (cb) => {
        const disp = proc.onData(cb)
        return () => disp.dispose()
      },
      write: (data) => proc.write(data),
      resize: (c, r) => proc.resize(c, r),
      kill: () => proc.kill(),
      isReal: true,
      label: shell,
    }
  } catch (err) {
    console.warn('[pty-source] node-pty unavailable, using demo driver:', (err as Error).message)
    return createDemoSource()
  }
}

