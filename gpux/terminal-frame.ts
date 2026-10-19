/**
 * Spike step 2b: terminal frame presentation pipeline, headless.
 *
 * Pipeline under test:
 *   ghostty-vt.wasm (GPU cell records) → RGBA framebuffer (block rasterizer)
 *   → [on GPU hardware: <img>.setImagePixels(frame)]
 *
 * The block rasterizer (./terminal-raster.ts, shared with TerminalPane.tsx)
 * draws each cell as its background color rect, with an inset foreground rect
 * where a glyph is present. No font rasterization yet — this measures the
 * *pipeline* cost (WASM → pixels), which is the gate for the setImagePixels
 * approach. Real glyph shapes come later (native CustomElement, or a
 * software rasterizer).
 *
 *   bun terminal-frame.ts          # throughput numbers + writes frame.ppm
 *
 * frame.ppm can be viewed to verify correctness visually.
 */
import { TeraxGhostty } from './vendor/ghostty-core/adapted/TeraxGhostty.ts'
import { createRasterizer } from './terminal-raster.ts'

const COLS = 100
const ROWS = 30
const CELL_W = 8
const CELL_H = 16
const CORE = new URL('./vendor/ghostty-core', import.meta.url).pathname
const enc = new TextEncoder()

async function main() {
  const bytes = await Bun.file(`${CORE}/adapted/ghostty-vt.wasm`).arrayBuffer()
  const ghostty = await TeraxGhostty.loadBytes(bytes)
  const term = ghostty.createTerminal(COLS, ROWS)
  term.setRenderFormat('gpu')

  const { fb, fw, fh, rasterize } = createRasterizer(COLS, ROWS, CELL_W, CELL_H)

  // Paint a static screen first (prompt + colored output).
  term.write(enc.encode('\x1b[1;36m❯\x1b[0m cargo build --release\r\n'))
  term.write(enc.encode('\x1b[32m   Compiling\x1b[0m terax v0.9.0\r\n'))
  term.write(enc.encode('\x1b[32m    Finished\x1b[0m release profile in 41.2s\r\n'))
  term.write(enc.encode('\x1b[33mw warning:\x1b[0m unused variable `foo`\r\n'))
  term.write(enc.encode('\x1b[31merror[E0308]:\x1b[0m mismatched types\r\n'))
  let st = term.updateGpuRenderState()
  rasterize(st.cellWords, st.dirtyRows, st.fullDamage, st.cursor)

  // Workload: agent-TUI-like streaming — spinner + log lines, 600 frames.
  const spinner = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
  const FRAMES = 600
  const t0 = performance.now()
  let dirtyRowCount = 0
  for (let f = 0; f < FRAMES; f++) {
    const s = spinner[f % spinner.length]
    term.write(enc.encode(`\x1b[28;1H\x1b[2K\x1b[35m${s}\x1b[0m working… frame ${f}`))
    if (f % 60 === 0) {
      term.write(enc.encode(`\x1b[27;1H\x1b[32m✓\x1b[0m step ${f / 60} done\r\n`))
    }
    st = term.updateGpuRenderState()
    for (let r = 0; r < ROWS; r++) dirtyRowCount += st.dirtyRows[r] ? 1 : 0
    rasterize(st.cellWords, st.dirtyRows, st.fullDamage, st.cursor)
  }
  const dt = performance.now() - t0
  console.log(`[spike] ${FRAMES} frames: ${dt.toFixed(0)} ms total, ${(dt / FRAMES).toFixed(2)} ms/frame`)
  console.log(`[spike] effective pipeline fps: ${(1000 / (dt / FRAMES)).toFixed(0)}`)
  console.log(`[spike] avg dirty rows/frame: ${(dirtyRowCount / FRAMES).toFixed(1)} of ${ROWS}`)

  // Worst case: full damage every frame.
  const t1 = performance.now()
  for (let f = 0; f < 120; f++) {
    term.write(enc.encode('\x1b[2J'))
    term.write(enc.encode(`\x1b[1;1Hframe ${f} ` + '█'.repeat(40)))
    st = term.updateGpuRenderState()
    rasterize(st.cellWords, st.dirtyRows, true, st.cursor)
  }
  const dt1 = performance.now() - t1
  console.log(`[spike] full-damage worst case: ${(dt1 / 120).toFixed(2)} ms/frame (${(1000 / (dt1 / 120)).toFixed(0)} fps)`)

  // Write one frame as PPM for visual verification.
  const header = `P6\n${fw} ${fh}\n255\n`
  const rgb = new Uint8Array(fw * fh * 3)
  for (let i = 0; i < fw * fh; i++) {
    rgb[i * 3] = fb[i * 4]
    rgb[i * 3 + 1] = fb[i * 4 + 1]
    rgb[i * 3 + 2] = fb[i * 4 + 2]
  }
  await Bun.write('frame.ppm', Buffer.concat([Buffer.from(header), Buffer.from(rgb)]))
  console.log('[spike] wrote frame.ppm (view to verify correctness)')

  term.dispose()
}

await main()
