/**
 * Shared block rasterizer: ghostty GPU cell records → RGBA framebuffer.
 *
 * Used by `terminal-frame.ts` (headless benchmark) and `TerminalPane.tsx`
 * (live `<img>` presentation via `setImagePixels`). Cells are drawn as their
 * background rect with an inset foreground rect where a glyph is present —
 * no font rasterization yet (see SPIKE.md step 2b).
 */
import { GPU_CELL_WORDS, GPU_GLYPH_ID_MASK } from './vendor/ghostty-core/adapted/gpuCells.ts'

export type RasterCursor = { row: number; column: number; visible: boolean }

export function createRasterizer(cols: number, rows: number, cellW: number, cellH: number) {
  const fw = cols * cellW
  const fh = rows * cellH
  const fb = new Uint8Array(fw * fh * 4)

  function fillRect(x: number, y: number, w: number, h: number, r: number, g: number, b: number) {
    for (let row = 0; row < h; row++) {
      const off = ((y + row) * fw + x) * 4
      for (let col = 0; col < w; col++) {
        const i = off + col * 4
        fb[i] = r
        fb[i + 1] = g
        fb[i + 2] = b
        fb[i + 3] = 255
      }
    }
  }

  function rasterize(
    words: Uint32Array,
    dirtyRows: Uint8Array,
    fullDamage: boolean,
    cursor: RasterCursor,
  ) {
    for (let row = 0; row < rows; row++) {
      if (!fullDamage && !dirtyRows[row]) continue
      for (let col = 0; col < cols; col++) {
        const cell = (row * cols + col) * GPU_CELL_WORDS
        const w0 = words[cell]
        const fg = words[cell + 1]
        const bg = words[cell + 2]
        const glyphId = w0 & GPU_GLYPH_ID_MASK
        const px = col * cellW
        const py = row * cellH
        fillRect(px, py, cellW, cellH, bg & 255, (bg >> 8) & 255, (bg >> 16) & 255)
        if (glyphId !== 0) {
          fillRect(
            px + 1,
            py + 3,
            cellW - 2,
            cellH - 6,
            fg & 255,
            (fg >> 8) & 255,
            (fg >> 16) & 255,
          )
        }
      }
    }
    if (cursor.visible && cursor.row >= 0 && cursor.row < rows && cursor.column >= 0 && cursor.column < cols) {
      fillRect(cursor.column * cellW, cursor.row * cellH, cellW, cellH, 74, 222, 128)
    }
  }

  return { fb, fw, fh, rasterize }
}
