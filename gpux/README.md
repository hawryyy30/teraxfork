# Terax on GPUIX — migration

The GPUIX-native Terax app. This is the migration destination: the Tauri/React
frontend rebuilt on native GPU rendering via GPUIX (`@gpuix/react`).

## Status

- **M1 (in progress):** shell (icon rail, tab bar, status bar) + real terminal
  (ghostty-vt.wasm → block rasterizer → `<img>` `setImagePixels`, real PTY via
  node-pty, full keyboard input) + file explorer wired to the shell's cwd.
  AI chat panel is a mock. Runs on npm `@gpuix/*` 0.10.0 (exact).
- **M2 (next):** code editor — needs the GPUIX fork's `selection`/`onSelect`
  APIs (`hawryyy30/GPUIX-Fork`), then port the spike's editor + assists.
- **M3:** LSP in Bun (port spike's lsp-framing/session/manager/presets) +
  diagnostics, completion, hover.
- **M4:** AI chat with real model calls (Vercel AI SDK in Bun, BYOK).
- **M5:** git panel, settings/themes, command palette.

Dropped vs stock Terax: the web preview pane (GPUIX has no webview).

## Run it (Windows, needs a real GPU)

```powershell
cd gpux
bun install
bun run dev
```

Typecheck: `bun run typecheck`. Tests: `bun run test`.

## Layout

- `app.tsx` — shell + entry point
- `TerminalPane.tsx`, `terminal-*.ts`, `pty-source.ts`, `ghostty-headless.ts` —
  the terminal stack (ported from the spike, `~/workspace/terax-gpuix/spike/`)
- `FileExplorerPane.tsx` — file explorer
- `vendor/ghostty-core/` — vendored ghostty-core WASM + TS bridge (portable)

## Notes

- Glyphs are block rectangles for now (font rasterization is a later
  workstream); the pipeline underneath is the verified 60fps path.
- `node-pty` needs a native build on first install (`node-gyp rebuild` inside
  `node_modules/node-pty` if the install script doesn't produce it); without
  it the terminal falls back to the scripted demo driver.
