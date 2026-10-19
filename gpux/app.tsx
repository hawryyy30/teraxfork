/**
 * Terax on GPUIX — migration seed (milestones M1 + M3 + M4 + M5).
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
 * completion/hover UI). M5 (done): git panel (status/stage/commit/diff/
 * pull/push/log), settings with live theme switching (6 themes, persisted),
 * and a command palette (Ctrl/Cmd+Shift+P). M2 (done-headless): code editor
 * (CodeEditorPane port of the spike: native textarea + fork
 * selection/onSelect APIs, file open/save, dirty tracking, search, go-to,
 * bracket assists, LSP doc ownership with diagnostics/completion/hover).
 * Rendering still needs Windows validation on the GPUIX fork's .node.
 *
 * Run:   bun run dev        (needs a real GPU; no software fallback)
 * Check: bun run typecheck
 */

import { useEffect, useMemo, useState } from 'react'
import { render } from '@gpuix/react'
import { TerminalPane } from './TerminalPane.tsx'
import { FileExplorerPane } from './FileExplorerPane.tsx'
import { CodeEditorPane, type EditorExternalOpen } from './CodeEditorPane.tsx'
import { ChatPane } from './ai/ChatPane.tsx'
import type { LspDiagnostic, LspServerState } from './lsp/lsp-manager.ts'
import { ProblemsPanel } from './lsp/ProblemsPanel.tsx'
import { GitPane } from './git/GitPane.tsx'
import { emitGitChanged } from './git/git-bus.ts'
import { gitPull, gitPush, gitStatus, isUnstaged, isUntracked, repoRoot, stagePaths } from './git/git.ts'
import { CommandPalette, type PaletteCommand } from './palette/CommandPalette.tsx'
import { SettingsPane } from './settings/SettingsPane.tsx'
import { loadPrefs, savePrefs } from './settings/store.ts'
import { dispatchWindowKeyDown, writeToTerminal } from './terminal-input-bus.ts'
import { C, cycleTheme, getThemeId, listThemes, setThemeId, useThemeVersion } from './ui-tokens.ts'

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
  useThemeVersion()
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
  useThemeVersion()
  return (
    <div style={{ flexGrow: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: C.pane }}>
      <text style={{ fontSize: 13, color: C.tertiary }}>{label} panel — coming in a later milestone</text>
    </div>
  )
}

// Module-level bridge: the render() window key handler lives outside the
// component, so TeraxApp publishes its palette setter here.
const paletteToggle: { current: null | ((f: (v: boolean) => boolean) => void) } = {
  current: null,
}

function TeraxApp() {
  useThemeVersion()
  const [rail, setRail] = useState('terminal')
  // Working directory, shared by the explorer and the terminal shell.
  const [cwd, setCwd] = useState(() => process.cwd())
  // Transient notice shown in the status bar.
  const [notice, setNotice] = useState('')
  // File opened in the editor (set by explorer file-open); the editor pane
  // owns this file's LSP doc handle, so its diagnostics supersede any
  // read-only analysis.
  const [editorOpen, setEditorOpen] = useState<EditorExternalOpen | null>(null)
  const [editorNonce, setEditorNonce] = useState(0)
  const [editorDiags, setEditorDiags] = useState<LspDiagnostic[]>([])
  const [editorLspState, setEditorLspState] = useState<LspServerState>('off')
  const [paletteOpen, setPaletteOpen] = useState(false)
  paletteToggle.current = setPaletteOpen

  // Apply the persisted theme once at startup.
  useEffect(() => {
    const prefs = loadPrefs()
    if (prefs.themeId !== getThemeId()) setThemeId(prefs.themeId)
  }, [])

  /** Explorer navigation: move the explorer AND `cd` the shell, so the
   *  working directory follows clicks like a normal file explorer. */
  const navigateDir = (dir: string) => {
    setCwd(dir)
    // Quote for POSIX shells (bash/zsh) and PowerShell single-quoted strings.
    const q = dir.replace(/'/g, `'\\''`)
    writeToTerminal(`cd '${q}'\n`)
  }

  const openInEditor = (path: string) => {
    // Hand the file to the M2 editor pane, which owns its LSP doc handle.
    const n = editorNonce + 1
    setEditorNonce(n)
    setEditorOpen({ path, nonce: n })
    setRail('editor')
  }

  /** Jump to a diagnostic from the problems rail (reuses the open editor). */
  const jumpToProblem = (d: LspDiagnostic) => {
    const p = editorOpen?.path
    if (!p) {
      setNotice('open a file in the editor first')
      return
    }
    const n = editorNonce + 1
    setEditorNonce(n)
    setEditorOpen({ path: p, nonce: n, jumpLine: d.range.start.line + 1 })
    setRail('editor')
  }

  /** Run a git action from the palette against the shell's cwd. */
  const gitAction = (label: string, fn: (root: string) => { ok: boolean; stderr: string }) => {
    const root = repoRoot(cwd)
    if (!root) {
      setNotice(`${label}: not a git repository`)
      return
    }
    const r = fn(root)
    setNotice(r.ok ? '' : `${label} failed: ${r.stderr.trim().split('\n')[0] || 'unknown error'}`)
    emitGitChanged()
  }

  const paletteCommands: PaletteCommand[] = useMemo(
    () => [
      { id: 'view-terminal', label: 'View: Terminal', keywords: 'go rail shell', run: () => setRail('terminal') },
      { id: 'view-files', label: 'View: Files', keywords: 'go rail explorer', run: () => setRail('files') },
      { id: 'view-editor', label: 'View: Editor', keywords: 'go rail code', run: () => setRail('editor') },
      { id: 'view-git', label: 'View: Git', keywords: 'go rail source control', run: () => setRail('git') },
      { id: 'view-ai', label: 'View: AI Chat', keywords: 'go rail', run: () => setRail('ai') },
      { id: 'view-problems', label: 'View: Problems', keywords: 'go rail diagnostics', run: () => setRail('problems') },
      { id: 'view-settings', label: 'View: Settings', keywords: 'go rail setup theme', run: () => setRail('setup') },
      {
        id: 'git-stage-all',
        label: 'Git: Stage all changes',
        keywords: 'add',
        run: () =>
          gitAction('Stage all', (root) =>
            stagePaths(
              root,
              gitStatus(root)
                .filter((e) => isUnstaged(e) || isUntracked(e))
                .map((e) => e.path),
            ),
          ),
      },
      { id: 'git-pull', label: 'Git: Pull (fast-forward only)', keywords: 'fetch', run: () => gitAction('Pull', gitPull) },
      { id: 'git-push', label: 'Git: Push', keywords: 'upload', run: () => gitAction('Push', gitPush) },
      {
        id: 'theme-next',
        label: 'Theme: Switch to next theme',
        keywords: 'color dark light appearance',
        run: () => {
          const id = cycleTheme()
          try {
            savePrefs({ ...loadPrefs(), themeId: id })
          } catch {
            // Theme still applied; persistence is best-effort here.
          }
          setNotice(`Theme: ${listThemes().find((t) => t.id === id)?.label}`)
        },
      },
      {
        id: 'terminal-clear',
        label: 'Terminal: Clear screen',
        keywords: 'cls',
        run: () => writeToTerminal('\x0c'),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cwd],
  )

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'row',
        backgroundColor: C.bg,
        position: 'relative',
      }}
    >
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
        <RailButton glyph="✎" label="editor" active={rail === 'editor'} onPress={() => setRail('editor')} />
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
          <div style={{ flexGrow: 1 }} />
          <div
            testId="palette-button"
            onClick={() => setPaletteOpen(true)}
            style={{
              cursor: 'pointer',
              backgroundColor: C.raised,
              borderRadius: 6,
              borderWidth: 1,
              borderColor: C.border,
              paddingLeft: 10,
              paddingRight: 10,
              paddingTop: 3,
              paddingBottom: 3,
              marginRight: 8,
            }}
          >
            <text style={{ fontSize: 11, color: C.secondary }}>◈ commands (Ctrl+Shift+P)</text>
          </div>
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
            ) : rail === 'editor' ? (
              <CodeEditorPane
                externalOpen={editorOpen ?? undefined}
                onDiagnostics={(diags, _path, state) => {
                  setEditorDiags(diags)
                  setEditorLspState(state)
                }}
              />
            ) : rail === 'git' ? (
              <GitPane cwd={cwd} onNotice={setNotice} />
            ) : rail === 'setup' ? (
              <SettingsPane onNotice={setNotice} />
            ) : rail === 'problems' ? (
              <ProblemsPanel
                diags={editorDiags}
                path={editorOpen?.path ?? null}
                onJumpLine={jumpToProblem}
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
          {editorOpen ? (
            <text
              style={{
                fontSize: 11,
                color:
                  editorLspState === 'running' ? C.green : editorLspState === 'off' ? C.tertiary : C.amber,
              }}
            >
              LSP {editorLspState}
              {editorDiags.length > 0 ? ` · ${editorDiags.length}` : ''}
            </text>
          ) : null}
          <text style={{ fontSize: 11, color: C.tertiary }}>{notice || 'migration M1-M5 (editor on the GPUIX fork)'}</text>
          <div style={{ flexGrow: 1 }} />
          <text style={{ fontSize: 11, color: C.tertiary }}>GPUIX fork · native</text>
        </div>
      </div>

      {paletteOpen && (
        <CommandPalette commands={paletteCommands} onClose={() => setPaletteOpen(false)} />
      )}
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
    // Ctrl/Cmd+Shift+P opens the command palette instead.
    onKeyDown: (e) => {
      const mods = e.modifiers
      if (
        mods &&
        (mods.ctrl || mods.cmd) &&
        mods.shift &&
        (e.key === 'p' || e.key === 'P')
      ) {
        paletteToggle.current?.((v: boolean) => !v)
        return
      }
      dispatchWindowKeyDown(e)
    },
  })
}

export { TeraxApp }
