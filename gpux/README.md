# Terax on GPUIX — migration

The GPUIX-native Terax app. This is the migration destination: the Tauri/React
frontend rebuilt on native GPU rendering via GPUIX (`@gpuix/react`).

## Status

- **M1 (done):** shell (icon rail, tab bar, status bar) + real terminal
  (ghostty-vt.wasm → block rasterizer → `<img>` `setImagePixels`, real PTY via
  node-pty, full keyboard input) + file explorer wired to the shell's cwd.
  Runs on npm `@gpuix/*` 0.10.0 (exact).
- **M4 (done):** AI chat with real model calls — Vercel AI SDK v7 in Bun,
  BYOK (Anthropic / OpenAI / OpenRouter / OpenAI-compatible endpoint),
  streaming responses, stop button, key from env or pasted in the panel
  (memory only, never logged or persisted). Real calls need a key and a
  GPU machine; the key-resolution and error paths are unit-tested.
- **M2 (blocked on user):** code editor — needs the GPUIX fork's
  `selection`/`onSelect` APIs and a Windows `.node` binary; the fork
  (`hawryyy30/GPUIX-Fork`) was never pushed and this VM has no credentials.
- **M3 (next):** LSP in Bun (port spike's lsp-framing/session/manager/presets) +
  diagnostics, completion, hover.
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
- `ai/client.ts`, `ai/ChatPane.tsx` — BYOK streaming chat (M4); `ui-tokens.ts` — shared design tokens
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
