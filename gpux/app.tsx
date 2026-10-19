/**
 * Terax on GPUIX — migration seed (milestones M1 + M4).
 *
 * The start of the real migration: Terax's Tauri/React frontend rebuilt on
 * native GPUIX rendering. M1 covers the shell + the terminal surface:
 *
 * - Icon rail, tab bar, status bar — all GPUIX native.
 * - Real terminal: ghostty-vt.wasm → block rasterizer → <img> setImagePixels,
 *   with a real PTY (node-pty) and full keyboard input.
 * - File explorer wired to the shell's working directory.
 *
 * M4 (done): AI chat with real model calls (Vercel AI SDK in Bun,
 * BYOK, streaming). M3 (done): LSP in Bun (dumb-pipe session on the spike's
 * lsp-framing/session/manager/presets + diagnostics problems panel +
 * completion/hover UI). M2 adds the code editor (needs the GPUIX fork's
 * selection/onSelect APIs); M5 adds git, settings, command palette.
 *
 * Run:   bun run dev        (needs a real GPU; no software fallback)
 * Check: bun run typecheck
 */

import { useState } from 'react'
import { readFile } from 'node:fs/promises'
import { render } from '@gpuix/react'
import { TerminalPane } from './TerminalPane.tsx'
import { FileExplorerPane } from './FileExplorerPane.tsx'
import { ChatPane } from './ai/ChatPane.tsx'
import { analyzePath, useLspForPath } from './lsp/useLsp.ts'
import { ProblemsPanel } from './lsp/ProblemsPanel.tsx'
import { dispatchWindowKeyDown, writeToTerminal } from './terminal-input-bus.ts'
import { C } from './ui-tokens.ts'

// ── Small components ───────────────────────────────────────────────────────

function RailButton({
  glyph,
  label,
  active,
  onPress,
}: {
  glyph: string
  label: string
  active?: boolean
  onPress?: () => void
}) {
  return (
    <div
      testId={`rail-${label}`}
      onClick={onPress}
      style={{
        width: 48,
        height: 48,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        backgroundColor: active ? C.raised : '#00000000',
        borderRadius: 8,
        cursor: 'pointer',
      }}
    >
      <text style={{ fontSize: 18, color: active ? C.accent : C.secondary }}>{glyph}</text>
      <text style={{ fontSize: 9, color: C.tertiary, marginTop: 2 }}>{label}</text>
    </div>
  )
}

function RailPlaceholder({ label }: { label: string }) {
  return (
    <div style={{ flexGrow: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: C.pane }}>
      <text style={{ fontSize: 13, color: C.tertiary }}>{label} panel — coming in a later milestone</text>
    </div>
  )
}

function TeraxApp() {
  const [rail, setRail] = useState('terminal')
  // Working directory, shared by the explorer and the terminal shell.
  const [cwd, setCwd] = useState(() => process.cwd())
  // Transient notice shown in the status bar (e.g. "editor lands in M2").
  const [notice, setNotice] = useState('')
  // File under read-only LSP analysis (set by explorer file-open); the M2
  // editor pane takes over doc ownership once it exists.
  const [analysisPath, setAnalysisPath] = useState<string | null>(null)
  const { diags: lspDiags, state: lspState } = useLspForPath(analysisPath)

  /** Explorer navigation: move the explorer AND `cd` the shell, so the
   *  working directory follows clicks like a normal file explorer. */
  const navigateDir = (dir: string) => {
    setCwd(dir)
    // Quote for POSIX shells (bash/zsh) and PowerShell single-quoted strings.
    const q = dir.replace(/'/g, `'\\''`)
    writeToTerminal(`cd '${q}'\n`)
  }

  const openInEditor = (path: string) => {
    // No editor pane yet (M2): hand the file to LSP for read-only analysis
    // so the problems panel shows real diagnostics in the meantime.
    const base = path.split('/').pop() ?? path
    setNotice(`Editor lands in M2 — analyzing ${base} with LSP`)
    setAnalysisPath(path)
    void (async () => {
      try {
        const text = await readFile(path, 'utf8')
        await analyzePath(path, text)
      } catch (err) {
        setNotice(`LSP analysis failed for ${base}: ${(err as Error).message}`)
      }
    })()
  }

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'row', backgroundColor: C.bg }}>
      {/* Icon rail */}
      <div
        style={{
          width: 56,
          backgroundColor: C.rail,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          paddingTop: 8,
          gap: 4,
          borderRightWidth: 1,
          borderColor: C.border,
        }}
      >
        <RailButton glyph="▣" label="term" active={rail === 'terminal'} onPress={() => setRail('terminal')} />
        <RailButton glyph="▤" label="files" active={rail === 'files'} onPress={() => setRail('files')} />
        <RailButton glyph="⑂" label="git" active={rail === 'git'} onPress={() => setRail('git')} />
        <RailButton glyph="✦" label="ai" active={rail === 'ai'} onPress={() => setRail('ai')} />
        <RailButton glyph="⚠" label="problems" active={rail === 'problems'} onPress={() => setRail('problems')} />
        <div style={{ flexGrow: 1 }} />
        <RailButton glyph="⚙" label="setup" active={rail === 'setup'} onPress={() => setRail('setup')} />
      </div>

      {/* Main column */}
      <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Tab bar */}
        <div
          style={{
            height: 36,
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: C.rail,
            borderBottomWidth: 1,
            borderColor: C.border,
            paddingLeft: 12,
            gap: 16,
          }}
        >
          <text style={{ fontSize: 12, color: C.text }}>● shell — {cwd}</text>
          <text style={{ fontSize: 12, color: C.tertiary }}>＋</text>
        </div>

        {/* Split: terminal/explorer | chat */}
        <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'row', minHeight: 0 }}>
          {/* Left pane — switched by the icon rail */}
          <div
            style={{
              flexGrow: 3,
              display: 'flex',
              flexDirection: 'column',
              backgroundColor: '#101013',
              borderRightWidth: 1,
              borderColor: C.border,
              minWidth: 0,
            }}
          >
            {rail === 'terminal' ? (
              <TerminalPane />
            ) : rail === 'files' ? (
              <FileExplorerPane cwd={cwd} onNavigate={navigateDir} onOpenFile={openInEditor} />
            ) : rail === 'problems' ? (
              <ProblemsPanel
                diags={lspDiags}
                path={analysisPath}
                onJumpLine={(d) =>
                  setNotice(`Editor lands in M2 — problem at Ln ${d.range.start.line + 1}`)
                }
              />
            ) : (
              <RailPlaceholder label={rail} />
            )}
          </div>

          {/* AI chat panel — real model calls (M4) */}
          <ChatPane />
        </div>

        {/* Status bar */}
        <div
          style={{
            height: 28,
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: C.rail,
            borderTopWidth: 1,
            borderColor: C.border,
            paddingLeft: 12,
            paddingRight: 12,
            gap: 16,
          }}
        >
          <text style={{ fontSize: 11, color: C.secondary }}>⑂ gpuix/main</text>
          {analysisPath ? (
            <text
              style={{
                fontSize: 11,
                color:
                  lspState === 'running' ? C.green : lspState === 'off' ? C.tertiary : C.amber,
              }}
            >
              LSP {lspState}
              {lspDiags.length > 0 ? ` · ${lspDiags.length}` : ''}
            </text>
          ) : null}
          <text style={{ fontSize: 11, color: C.tertiary }}>{notice || 'migration M3+M4 (M2 blocked: no Windows GPUIX-Fork binary)'}</text>
          <div style={{ flexGrow: 1 }} />
          <text style={{ fontSize: 11, color: C.tertiary }}>GPUIX 0.10.0 · native</text>
        </div>
      </div>
    </div>
  )
}

// ── Entry ──────────────────────────────────────────────────────────────────

const isEntryPoint =
  typeof Bun !== 'undefined'
    ? Bun.isStandaloneExecutable || Bun.main === import.meta.path
    : typeof window !== 'undefined'

if (isEntryPoint) {
  render(<TeraxApp />, {
    title: 'Terax GPUIX',
    width: 1280,
    height: 800,
    focus: typeof process === 'undefined' || process.env.GPUIX_BACKGROUND !== '1',
    // Window-level keys go to the terminal (unless the chat composer is focused).
    onKeyDown: (e) => dispatchWindowKeyDown(e),
  })
}

export { TeraxApp }
