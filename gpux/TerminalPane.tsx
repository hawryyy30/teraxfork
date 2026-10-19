/**
 * TerminalPane — live terminal surface for the GPUIX spike.
 *
 * Pipeline: PTY bytes → ghostty-vt.wasm (GPU cell records) → block
 * rasterizer → `<img>.setImagePixels()` → GPUI compositor.
 *
 * Byte source: `pty-source.ts` — a real shell via node-pty when the native
 * module is available, otherwise a scripted demo driver. Keyboard input is
 * the next workstream (GPUIX window key events → pty.write).
 *
 * NOTE: presenting requires a real GPU + display. This component typechecks
 * and the pipeline is benchmarked headlessly (see terminal-frame.ts), but
 * `setImagePixels` presentation itself is unverified until run on GPU
 * hardware (Windows DirectX is the target).
 */
import { useEffect, useRef, useState } from 'react'
import type { ImgInstance } from '@gpuix/react'
import { TeraxGhostty } from './vendor/ghostty-core/adapted/TeraxGhostty.ts'
import { createRasterizer } from './terminal-raster.ts'
import { createPtySource } from './pty-source.ts'
import { encodeGpuixKey } from './terminal-keymap.ts'
import { setPtyWriter, setTerminalKeyHandler } from './terminal-input-bus.ts'

const COLS = 100
const ROWS = 30
const CELL_W = 8
const CELL_H = 16
const CORE = new URL('./vendor/ghostty-core', import.meta.url).pathname
const enc = new TextEncoder()

export function TerminalPane() {
  const imgRef = useRef<ImgInstance>(null)
  const [sourceLabel, setSourceLabel] = useState('starting…')

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setInterval> | null = null
    let term: { dispose(): void } | null = null
    let pty: { kill(): void } | null = null

    async function start() {
      const bytes = await Bun.file(`${CORE}/adapted/ghostty-vt.wasm`).arrayBuffer()
      if (cancelled) return
      const ghostty = await TeraxGhostty.loadBytes(bytes)
      if (cancelled) return
      const t = ghostty.createTerminal(COLS, ROWS)
      t.setRenderFormat('gpu')
      term = t

      const { fb, fw, fh, rasterize } = createRasterizer(COLS, ROWS, CELL_W, CELL_H)

      // Byte source: real PTY when node-pty is available, demo driver otherwise.
      const src = await createPtySource(COLS, ROWS)
      if (cancelled) {
        src.kill()
        return
      }
      pty = src
      setSourceLabel(src.isReal ? `pty: ${src.label}` : 'demo driver')
      // Let outside UI (file explorer) send input to the shell.
      setPtyWriter((data) => src.write(data))

      // Keyboard → Ghostty native key encoder → PTY.
      setTerminalKeyHandler((ev) => {
        const bytes = encodeGpuixKey((e) => t.encodeKey(e), ev)
        if (bytes && bytes.length > 0) {
          src.write(Buffer.from(bytes).toString('latin1'))
        }
      })

      // PTY → WASM core. Present on a fixed tick; damage-gated.
      src.onData((data) => {
        if (!cancelled) t.write(enc.encode(data))
      })
      const present = () => {
        if (cancelled) return
        const st = t.updateGpuRenderState()
        if (st.anyDirty) {
          rasterize(st.cellWords, st.dirtyRows, st.fullDamage, st.cursor)
          // Pipeline cost measured headless at ~0.05 ms/frame; the remaining
          // cost here is the GPU upload + present (needs GPU hardware).
          imgRef.current?.setImagePixels(fw, fh, fb)
        }
      }
      timer = setInterval(present, 50)
    }

    start().catch((err) => {
      console.error('[TerminalPane] failed to start:', err)
    })

    return () => {
      cancelled = true
      if (timer) clearInterval(timer)
      setTerminalKeyHandler(null)
      setPtyWriter(null)
      pty?.kill()
      term?.dispose()
    }
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}>
      <div style={{ padding: 12, borderBottomWidth: 1, borderColor: '#2E2E34' }}>
        <text style={{ fontSize: 11, color: '#FBBF24' }}>
          TERMINAL: live ghostty-vt.wasm → setImagePixels ({sourceLabel})
        </text>
      </div>
      <div
        style={{
          flexGrow: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#101013',
        }}
      >
        <img ref={imgRef} testId="terminal-surface" style={{ width: COLS * CELL_W, height: ROWS * CELL_H }} />
      </div>
    </div>
  )
}
