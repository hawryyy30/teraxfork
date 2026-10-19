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
- **M2 (done, headless):** code editor — `CodeEditorPane.tsx` ported from
  the spike onto the GPUIX fork's `selection`/`onSelect` APIs: native
  `<textarea>` editing (IME + undo), file open/save (Bun fs), dirty tracking,
  language badge, search match counting, find-next/prev, go-to-line, bracket
  auto-close/skip-over, indent-on-Enter. The pane owns the open file's LSP
  doc handle (didOpen/didChange through the shared `LspManager`), renders
  publishDiagnostics in-flow (click jumps to the line), and reports
  diagnostics up via `onDiagnostics` so the app's problems rail + status-bar
  pill are fed by one owner. Completion/hover use gpux's `AssistPanels`
  (in-flow panels; caret-exact anchoring still needs a native caret-rect API).
  Explorer file-open lands in the editor (new `editor` rail view); the
  problems rail's jump reuses the open editor without clobbering unsaved
  edits. Fork blocker cleared: `hawryyy30/GPUIX-Fork` CI run `39267538571`
  (commit `87d2fae`, the selection-prop fix) is fully green, all 4 native
  builds + tests + publish success, and the Windows x64 `.node` artifact
  (`bindings-x86_64-pc-windows-msvc`, 9.8 MB) is published. Verified
  headless: `bun run test` (93 tests) and `bun run typecheck`.
- **M5 (done):** git panel (`git/` — status, stage/unstage, discard
  (two-step), commit, per-file diff, pull/push, recent log; subprocess
  `git`, argv only, never a shell) + settings with live theme switching
  (6 themes: Terax Dark/Light, Kanagawa, Dracula, Tokyo Night, Catppuccin
  Mocha; persisted to `~/.config/terax-gpux/settings.json`, API keys never
  stored) + command palette (Ctrl/Cmd+Shift+P or the tab-bar button;
  fuzzy-matched commands for navigation, git actions, theme cycling).
  Verified headless: `bun run test` (93 tests) and `bun run typecheck`.
- **M3 (done):** LSP in Bun — port of the spike's `lsp-framing` /
  `lsp-session` / `lsp-manager` / `lsp-presets` (dumb JSON-RPC pipe,
  per-root sessions, refcounts, idle shutdown, crash backoff, session cap)
  + diagnostics Problems panel (status-bar pill + `⚠` rail view; fed by
  the M2 editor pane's `onDiagnostics`, which owns the open file's doc
  handle) + completion and hover UI components (wired to the M2 editor
  pane via `AssistPanels`). Verified headless: `bun run test` (69 tests) and
  `bun run test:lsp:e2e` against a real `typescript-language-server`.
- **Remaining (user-side, Windows):** all milestones are done as far as
  the headless VM goes. Left: download the fork's Windows x64 `.node`
  artifact (`bindings-x86_64-pc-windows-msvc` from CI run `39267538571`)
  into the `fork-pkgs` staging (replacing the staged Linux binary), then on
  Windows: `bun install`, `bun run dev`, and validate terminal rendering,
  editor keyboard/LSP, and the fork's `selection`/`onSelect` behavior live.

Dropped vs stock Terax: the web preview pane (GPUIX has no webview).

## Run it (Windows, needs a real GPU)

```powershell
cd gpux
bun install
bun run dev
```

Typecheck: `bun run typecheck`. Tests: `bun run test`. LSP e2e: `bun run test:lsp:e2e`.

## Fork staging notes

`@gpuix/native` + `@gpuix/react` resolve to the fork snapshot at
`~/workspace/terax-gpuix/fork-pkgs/` via `file:` deps (the fork isn't on a
registry yet). The staging's `index.js` loads the fork-built `.node` in its
own directory first, so the staged Linux binary (with the selection fix)
wins over any npm platform package. Two quirks to know:

- `node_modules/react` is a symlink to the spike's react copy: the staging
  pins `react/node_modules/react` at the spike's copy, and a second react
  copy breaks hooks at runtime, so gpux reuses the same one. `bun install`
  may replace this symlink with a fresh copy; restore it with
  `rm -rf node_modules/react && ln -s ../../../terax-gpuix/spike/node_modules/react node_modules/react`.
- On the user's Windows machine, re-stage `fork-pkgs` the same way the
  staging README describes and drop the downloaded Windows x64 `.node`
  (`gpuix-native.win32-x64-msvc.node`) next to the Linux one.

## Layout

- `app.tsx` — shell + entry point
- `ai/client.ts`, `ai/ChatPane.tsx` — BYOK streaming chat (M4); `ui-tokens.ts` — shared design tokens
- `TerminalPane.tsx`, `terminal-*.ts`, `pty-source.ts`, `ghostty-headless.ts` —
  the terminal stack (ported from the spike, `~/workspace/terax-gpuix/spike/`)
- `FileExplorerPane.tsx` — file explorer
- `CodeEditorPane.tsx` — M2 code editor (spike port): textarea editing,
  fork selection/onSelect, open/save, search, go-to, bracket assists,
  LSP doc ownership + in-flow diagnostics/completion/hover
- `lsp/` — LSP in Bun: `lsp-framing.ts`, `lsp-session.ts`, `lsp-manager.ts`,
  `lsp-presets.ts` (ported from the spike), `editor-assists.ts`,
  `useLsp.ts` (shared manager + analysis hook), `ProblemsPanel.tsx`,
  `AssistPanels.tsx` (completion + hover UI), `lsp-e2e.ts` (headless e2e)
- `git/` — git panel backend + UI (M5): `git.ts` (subprocess wrapper,
  porcelain-v2/log parsers), `git-bus.ts` (refresh pub/sub), `GitPane.tsx`
- `settings/` — `themes.ts` (theme registry), `store.ts` (prefs
  persistence), `SettingsPane.tsx` (M5)
- `palette/` — `fuzzy.ts` (fuzzy matcher), `CommandPalette.tsx` (M5)
- `vendor/ghostty-core/` — vendored ghostty-core WASM + TS bridge (portable)

## Notes

- Glyphs are block rectangles for now (font rasterization is a later
  workstream); the pipeline underneath is the verified 60fps path.
- `node-pty` needs a native build on first install (`node-gyp rebuild` inside
  `node_modules/node-pty` if the install script doesn't produce it); without
  it the terminal falls back to the scripted demo driver.
