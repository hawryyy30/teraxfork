/**
 * Terax on GPUIX — migration seed (milestone M1).
 *
 * The start of the real migration: Terax's Tauri/React frontend rebuilt on
 * native GPUIX rendering. M1 covers the shell + the terminal surface:
 *
 * - Icon rail, tab bar, AI chat panel (mock), status bar — all GPUIX native.
 * - Real terminal: ghostty-vt.wasm → block rasterizer → <img> setImagePixels,
 *   with a real PTY (node-pty) and full keyboard input.
 * - File explorer wired to the shell's working directory.
 *
 * M2 adds the code editor (needs the GPUIX fork's selection/onSelect APIs).
 * M3 adds LSP; M4 wires the AI chat to real models.
 *
 * Run:   bun run dev        (needs a real GPU; no software fallback)
 * Check: bun run typecheck
 */

import { useState } from 'react'
import { render } from '@gpuix/react'
import { TerminalPane } from './TerminalPane.tsx'
import { FileExplorerPane } from './FileExplorerPane.tsx'
import { dispatchWindowKeyDown, setTextUiFocused, writeToTerminal } from './terminal-input-bus.ts'

// ── Design tokens ──────────────────────────────────────────────────────────
// GPUI does not inherit `color`: every <text> sets one explicitly.

const C = {
  bg: '#141417',
  rail: '#1B1B1E',
  pane: '#1E1E22',
  raised: '#26262B',
  border: '#2E2E34',
  text: '#E4E4E7',
  secondary: '#A1A1AA',
  tertiary: '#71717A',
  accent: '#7C6CF0',
  green: '#4ADE80',
  blue: '#60A5FA',
  amber: '#FBBF24',
}

const UI_FONT = 'Inter'

// ── Mock data (chat goes real in M4) ────────────────────────────────────────

type Msg = { role: 'user' | 'assistant'; body: string }

const SEED: Msg[] = [
  {
    role: 'user',
    body: 'Why is `git status` slow in this repo?',
  },
  {
    role: 'assistant',
    body: `Likely culprits, in order:

1. **Untracked directory scans** — \`node_modules\` or build output not ignored
2. **FS watcher backlog** — check \`fs.inotify.max_user_watches\`
3. **Status config** — try \`git status --porcelain=v2\` to time the plumbing

\`\`\`sh
time git status --porcelain=v2 | wc -l
\`\`\`

If that is fast but the UI is slow, the bottleneck is on our side, not git's.`,
  },
]

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

function ChatMessage({ msg }: { msg: Msg }) {
  const isUser = msg.role === 'user'
  return (
    <div style={{ paddingLeft: 12, paddingRight: 12, paddingTop: 8, paddingBottom: 8 }}>
      <text
        style={{
          fontSize: 11,
          fontWeight: 'bold',
          color: isUser ? C.blue : C.accent,
          marginBottom: 4,
        }}
      >
        {isUser ? 'you' : 'terax'}
      </text>
      {isUser ? (
        <text style={{ fontSize: 13, color: C.text, lineHeight: 20 }}>{msg.body}</text>
      ) : (
        <markdown source={msg.body} />
      )}
    </div>
  )
}

// ── The app ────────────────────────────────────────────────────────────────

function TeraxApp() {
  const [messages, setMessages] = useState<Msg[]>(SEED)
  const [draft, setDraft] = useState('')
  const [rail, setRail] = useState('terminal')
  // Working directory, shared by the explorer and the terminal shell.
  const [cwd, setCwd] = useState(() => process.cwd())
  // Transient notice shown in the status bar (e.g. "editor lands in M2").
  const [notice, setNotice] = useState('')

  /** Explorer navigation: move the explorer AND `cd` the shell, so the
   *  working directory follows clicks like a normal file explorer. */
  const navigateDir = (dir: string) => {
    setCwd(dir)
    // Quote for POSIX shells (bash/zsh) and PowerShell single-quoted strings.
    const q = dir.replace(/'/g, `'\\''`)
    writeToTerminal(`cd '${q}'\n`)
  }

  const openInEditor = (path: string) => {
    setNotice(`Editor lands in M2 — would open ${path}`)
  }

  const send = (text: string) => {
    const t = text.trim()
    if (!t) return
    setDraft('')
    setMessages((m) => [
      ...m,
      { role: 'user', body: t },
      {
        role: 'assistant',
        body: `Real model calls land in M4 — echoing for now.\n\nYou asked: \`${t.slice(0, 80)}\``,
      },
    ])
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
            ) : (
              <RailPlaceholder label={rail} />
            )}
          </div>

          {/* AI chat panel (mock until M4) */}
          <div
            style={{
              flexGrow: 2,
              display: 'flex',
              flexDirection: 'column',
              backgroundColor: C.pane,
              minWidth: 0,
            }}
          >
            <div style={{ padding: 12, borderBottomWidth: 1, borderColor: C.border }}>
              <text style={{ fontSize: 13, fontWeight: 'bold', color: C.text }}>✦ Ask</text>
              <text style={{ fontSize: 11, color: C.tertiary, marginTop: 2 }}>
                BYOK · no telemetry · local models supported
              </text>
            </div>
            <virtual-list overdraw={240} estimatedItemHeight={120} style={{ flexGrow: 1, minHeight: 0, width: '100%' }}>
              {messages.map((m, i) => (
                <ChatMessage key={i} msg={m} />
              ))}
            </virtual-list>
            <div
              style={{
                borderTopWidth: 1,
                borderColor: C.border,
                padding: 8,
                backgroundColor: C.rail,
              }}
            >
              <textarea
                testId="composer"
                value={draft}
                placeholder="Ask about this repo…"
                minRows={1}
                maxRows={4}
                autoFocus
                onFocus={() => setTextUiFocused(true)}
                onBlur={() => setTextUiFocused(false)}
                style={{
                  width: '100%',
                  minWidth: 0,
                  fontSize: 13,
                  lineHeight: 19,
                  fontFamily: UI_FONT,
                  color: C.text,
                  backgroundColor: C.raised,
                  borderRadius: 8,
                  borderWidth: 1,
                  borderColor: C.border,
                  paddingLeft: 10,
                  paddingRight: 10,
                  paddingTop: 8,
                  paddingBottom: 8,
                }}
                onChange={(e) => setDraft(e.value ?? '')}
                onSubmit={(e) => send(e.value ?? draft)}
              />
            </div>
          </div>
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
          <text style={{ fontSize: 11, color: C.tertiary }}>{notice || 'migration M1'}</text>
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
