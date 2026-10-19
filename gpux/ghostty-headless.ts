/**
 * Spike step 2a: drive Terax's ghostty-vt.wasm headlessly in Bun — no DOM,
 * no webview, no GPU. This answers the core feasibility question: can the
 * terminal *core* live outside the browser?
 *
 *   bun ghostty-headless.ts
 */
import { TeraxGhostty } from './vendor/ghostty-core/adapted/TeraxGhostty.ts'

const CORE = new URL('./vendor/ghostty-core', import.meta.url).pathname
const enc = new TextEncoder()

async function main() {
  // SIMD first (Bun supports WASM SIMD); fall back to the scalar build.
  let bytes: ArrayBuffer
  let variant = 'simd'
  try {
    bytes = await Bun.file(`${CORE}/adapted/ghostty-vt.wasm`).arrayBuffer()
    await WebAssembly.compile(bytes.slice(0))
  } catch {
    variant = 'scalar'
    bytes = await Bun.file(`${CORE}/adapted/ghostty-vt-scalar.wasm`).arrayBuffer()
  }
  console.log(`[spike] wasm variant: ${variant}, ${(bytes.byteLength / 1024).toFixed(0)} KiB`)

  const t0 = performance.now()
  const ghostty = await TeraxGhostty.loadBytes(bytes)
  console.log(`[spike] compiled in ${(performance.now() - t0).toFixed(1)} ms`)

  const t1 = performance.now()
  const term = ghostty.createTerminal(80, 24)
  console.log(`[spike] terminal instantiated in ${(performance.now() - t1).toFixed(1)} ms`)

  // Plain text, SGR colors, cursor addressing, erase.
  term.write(enc.encode('hello from bun\r\n'))
  term.write(enc.encode('\x1b[31mred\x1b[32mgreen\x1b[0m plain\r\n'))
  term.write(enc.encode('\x1b[5;10H@5,10'))
  term.write(enc.encode('\x1b[2K')) // erase the @5,10 line

  const text = term.readTextRange(0, 7)
  console.log('[spike] screen text (first 8 rows):')
  console.log('---')
  console.log(JSON.stringify(text))
  console.log('---')

  const ok =
    text.includes('hello from bun') &&
    text.includes('red') &&
    text.includes('green') &&
    text.includes('plain') &&
    !text.includes('@5,10')
  console.log(`[spike] VT semantics ${ok ? 'CORRECT ✓' : 'WRONG ✗'}`)

  // Damage/throughput sanity: how fast can we push bytes through the parser?
  const chunk = enc.encode('\x1b[32m' + 'x'.repeat(78) + '\x1b[0m\r\n')
  const N = 2000
  const t2 = performance.now()
  for (let i = 0; i < N; i++) term.write(chunk)
  const dt = performance.now() - t2
  console.log(
    `[spike] parser throughput: ${N} writes (${((chunk.length * N) / 1024).toFixed(0)} KiB) in ${dt.toFixed(0)} ms`,
  )

  console.log(`[spike] wasm memory: ${(ghostty.getMemoryBytes() / 1024).toFixed(0)} KiB`)
  term.dispose()
  console.log('[spike] terminal disposed, done')
}

await main()
