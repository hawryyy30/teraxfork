/**
 * CodeEditorPane — the M2 code editor (ported from the spike, Phase 1 shell).
 *
 * Multiline editing with IME + undo (native `<textarea>`, fork
 * `selection`/`onSelect` APIs), file open/save (Bun fs), dirty tracking,
 * language badge, search match counting, find-next/prev, go-to-line,
 * bracket auto-close/skip-over, indent-on-Enter. The pane owns the open
 * file's LSP doc handle (didOpen/didChange via the shared LspManager),
 * debounces full-text didChange, renders publishDiagnostics in-flow
 * (click jumps to the line), and reports diagnostics up through
 * onDiagnostics so the app's problems rail + status pill stay fed by one
 * owner. Completion + hover use gpux's AssistPanels; like the spike, they
 * render in-flow because caret-exact popup anchoring needs a native
 * caret-rect API the fork doesn't expose yet.
 *
 * Still missing for a shipping editor: scroll-synced line gutter (tears,
 * needs a custom element owning scroll+text, Zed-style), Vim/multi-cursor.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { setTextUiFocused } from './terminal-input-bus.ts'
import { getLspManager } from './lsp/useLsp.ts'
import {
  type LspCompletionItem,
  type LspDiagnostic,
  type LspDocHandle,
  type LspServerState,
} from './lsp/lsp-manager.ts'
import {
  applyAssist,
  caretLineCol,
  insertedRun,
  lineStartOffset,
  matchOffsets,
  replaceRange,
  wordAtOffset,
  type Sel,
} from './lsp/editor-assists.ts'
import { CompletionPanel, HoverPanel } from './lsp/AssistPanels.tsx'
import { C, useThemeVersion } from './ui-tokens.ts'

function languageFor(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    rs: 'rust', py: 'python', go: 'go', json: 'json', md: 'markdown',
    sh: 'bash', toml: 'toml', html: 'html', css: 'css', jsonc: 'jsonc',
  }
  return map[ext] ?? 'text'
}

function countMatches(text: string, query: string): number {
  if (!query) return 0
  let n = 0
  let i = 0
  while ((i = text.indexOf(query, i)) !== -1) {
    n++
    i += query.length
  }
  return n
}

function severityColor(sev: number | undefined): string {
  return sev === 1 ? C.red : sev === 2 ? C.amber : C.secondary
}

export interface EditorExternalOpen {
  path: string
  nonce: number
  /** 1-based line to jump to after opening (problems rail jump). */
  jumpLine?: number
}

export function CodeEditorPane({
  initialPath,
  externalOpen,
  onDiagnostics,
}: {
  initialPath?: string
  /** Open a file on demand (e.g. from the file explorer). */
  externalOpen?: EditorExternalOpen
  /** Diagnostics + server state for the open file; the app feeds its
   *  problems rail and status pill from this. */
  onDiagnostics?: (diags: LspDiagnostic[], path: string, state: LspServerState) => void
}) {
  useThemeVersion()
  const [path, setPath] = useState(initialPath ?? '')
  const [value, setValue] = useState('')
  const [savedValue, setSavedValue] = useState('')
  const [status, setStatus] = useState('open a file to begin')
  const [query, setQuery] = useState('')
  const [sel, setSel] = useState<Sel | undefined>(undefined)
  const [gotoLine, setGotoLine] = useState('')
  const [lspDiags, setLspDiags] = useState<LspDiagnostic[]>([])
  const [lspState, setLspState] = useState<LspServerState>('off')
  const [completions, setCompletions] = useState<{ items: LspCompletionItem[]; at: number } | null>(null)
  const [hoverText, setHoverText] = useState<string | null>(null)
  const lspHandleRef = useRef<LspDocHandle | null>(null)
  const didChangeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const completionToken = useRef(0)
  const pathRef = useRef(path)
  pathRef.current = path
  const valueRef = useRef(value)
  valueRef.current = value
  const selRef = useRef(sel)
  selRef.current = sel
  const onDiagsRef = useRef(onDiagnostics)
  onDiagsRef.current = onDiagnostics
  const dirty = value !== savedValue
  const language = languageFor(path)
  const matches = useMemo(() => countMatches(value, query), [value, query])
  const offsets = useMemo(() => matchOffsets(value, query), [value, query])
  const sortedDiags = useMemo(
    () =>
      [...lspDiags].sort(
        (a, b) =>
          a.range.start.line - b.range.start.line ||
          a.range.start.character - b.range.start.character,
      ),
    [lspDiags],
  )
  const lineCount = value === '' ? 0 : value.split('\n').length
  const caret = sel?.end ?? value.length
  const [caretLine, caretCol] = caretLineCol(value, caret)

  // Report diagnostics up whenever they or the open path change.
  const reportDiags = (diags: LspDiagnostic[], p: string, state: LspServerState) => {
    setLspDiags(diags)
    setLspState(state)
    onDiagsRef.current?.(diags, p, state)
  }

  // LSP: refresh diagnostics + server state whenever the manager emits.
  useEffect(() => {
    const m = getLspManager()
    return m.subscribe(() => {
      const p = pathRef.current
      if (!p) return
      reportDiags(m.getDiagnostics(p), p, m.sessionStateForPath(p))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // Release the doc handle + timers on unmount.
  useEffect(
    () => () => {
      if (didChangeTimer.current) clearTimeout(didChangeTimer.current)
      if (hoverTimer.current) clearTimeout(hoverTimer.current)
      lspHandleRef.current?.release()
      lspHandleRef.current = null
    },
    [],
  )

  /** Immediate full-text didChange (manager versions it). */
  const flushLspDidChange = (next: string) => {
    if (didChangeTimer.current) {
      clearTimeout(didChangeTimer.current)
      didChangeTimer.current = null
    }
    const handle = lspHandleRef.current
    if (handle) getLspManager().didChange(handle.uri, next)
  }

  /** Debounced full-text didChange after edits (manager versions it). */
  const scheduleLspDidChange = (next: string) => {
    if (didChangeTimer.current) clearTimeout(didChangeTimer.current)
    didChangeTimer.current = setTimeout(() => flushLspDidChange(next), 400)
  }

  /** textDocument/completion at a caret offset; shows the filtered panel. */
  const requestCompletion = (text: string, offset: number) => {
    const handle = lspHandleRef.current
    if (!handle) return
    const m = getLspManager()
    const [line, col] = caretLineCol(text, offset)
    const token = ++completionToken.current
    void m
      .completion(handle.uri, line - 1, col - 1)
      .then((items) => {
        if (token !== completionToken.current) return // superseded
        if (valueRef.current !== text) return // user kept typing
        if (!items || items.length === 0) {
          setCompletions(null)
          return
        }
        const { word } = wordAtOffset(text, offset)
        const lower = word.toLowerCase()
        setCompletions({
          items: items
            .filter((i) => i.label.toLowerCase().startsWith(lower))
            .slice(0, 50),
          at: offset,
        })
      })
      .catch(() => setCompletions(null))
  }

  const dismissCompletion = () => {
    completionToken.current++ // invalidate inflight requests
    setCompletions(null)
  }

  /** Insert a completion item, replacing the word at the caret. */
  const applyCompletion = (item: LspCompletionItem) => {
    const text = valueRef.current
    const offset = selRef.current?.end ?? text.length
    const w = wordAtOffset(text, offset)
    const r = replaceRange(text, w.start, w.end, item.insertText ?? item.label)
    setValue(r.value)
    setSel(r.sel)
    dismissCompletion()
    flushLspDidChange(r.value)
  }

  /** textDocument/hover at the caret into the tooltip panel. */
  const requestHover = () => {
    const handle = lspHandleRef.current
    if (!handle) return
    const text = valueRef.current
    const offset = selRef.current?.end ?? text.length
    const [line, col] = caretLineCol(text, offset)
    void getLspManager()
      .hover(handle.uri, line - 1, col - 1)
      .then((t) => setHoverText(t))
      .catch(() => setHoverText(null))
  }

  // Hover on caret idle: hide the stale tooltip when the caret moves, then
  // re-arm; 900 ms of stillness fires textDocument/hover.
  useEffect(() => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    setHoverText(null)
    if (!sel || !lspHandleRef.current) return
    hoverTimer.current = setTimeout(() => requestHover(), 900)
    return () => {
      if (hoverTimer.current) clearTimeout(hoverTimer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel])

  /** onChange with editor assists: bracket auto-close, closer skip-over, indent-on-Enter. */
  const handleChange = (next: string) => {
    // `sel` still holds the pre-change caret here: onSelect (which refreshes
    // it) fires after onChange for a native edit.
    const assist = applyAssist(value, next, sel)
    if (assist) {
      setValue(assist.value)
      setSel(assist.sel)
      scheduleLspDidChange(assist.value)
      return
    }
    setValue(next)
    scheduleLspDidChange(next)
    // Typing `.` is the member-access trigger: flush the text so the server
    // sees the dot, then ask for completions at the new caret.
    const ins = insertedRun(value, next)
    if (ins && ins[1] === '.') {
      const caretPos = ins[0] + 1
      flushLspDidChange(next)
      setTimeout(() => requestCompletion(next, caretPos), 150)
    }
  }

  const goToMatch = (dir: 1 | -1) => {
    if (!offsets.length || !query) return
    const qlen = query.length
    let idx: number
    if (dir === 1) {
      idx = offsets.findIndex((o) => o >= caret) // caret sits at/between; land on next at-or-after
      if (idx === -1) idx = 0
      // If the caret is already exactly on this match's start, advance to the next one.
      if (offsets[idx] === sel?.start && sel.start !== sel.end) idx = (idx + 1) % offsets.length
    } else {
      idx = offsets.length - 1
      for (let i = offsets.length - 1; i >= 0; i--) {
        if (offsets[i] + qlen <= (sel?.start ?? caret)) {
          idx = i
          break
        }
      }
    }
    const o = offsets[idx]
    setSel({ start: o, end: o + qlen })
  }

  const goToLine = () => {
    const n = parseInt(gotoLine, 10)
    if (!Number.isFinite(n)) return
    const off = lineStartOffset(value, n)
    setSel({ start: off, end: off })
    setGotoLine('')
  }

  const jumpToLine = (line1Based: number) => {
    const off = lineStartOffset(valueRef.current, line1Based)
    setSel({ start: off, end: off })
  }

  const openFile = async (p: string, jumpLine?: number) => {
    const target = p.trim()
    if (!target) return
    // Same file: keep the buffer (unsaved edits survive), just jump.
    if (target === pathRef.current) {
      if (jumpLine) jumpToLine(jumpLine)
      return
    }
    if (didChangeTimer.current) {
      clearTimeout(didChangeTimer.current)
      didChangeTimer.current = null
    }
    lspHandleRef.current?.release()
    lspHandleRef.current = null
    dismissCompletion()
    setHoverText(null)
    try {
      const text = await Bun.file(target).text()
      setPath(target)
      setValue(text)
      setSavedValue(text)
      setStatus(`opened ${target}`)
      if (jumpLine) jumpToLine(jumpLine)
      // LSP: acquire a doc handle (spawns / reuses the server for the root).
      const m = getLspManager()
      const handle = await m.acquireDoc(target, text).catch(() => null)
      lspHandleRef.current = handle
      reportDiags(m.getDiagnostics(target), target, m.sessionStateForPath(target))
    } catch (err) {
      setStatus(`open failed: ${(err as Error).message}`)
    }
  }

  const saveFile = async () => {
    if (!path) return
    try {
      await Bun.write(path, value)
      setSavedValue(value)
      getLspManager().didSave(path)
      setStatus(`saved ${path}`)
    } catch (err) {
      setStatus(`save failed: ${(err as Error).message}`)
    }
  }

  // Open files on demand from outside (file explorer / problems rail).
  const lastOpenNonce = useRef(0)
  useEffect(() => {
    if (externalOpen && externalOpen.nonce !== lastOpenNonce.current) {
      lastOpenNonce.current = externalOpen.nonce
      void openFile(externalOpen.path, externalOpen.jumpLine)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalOpen])

  const goToDiagLine = (d: LspDiagnostic) => {
    jumpToLine(d.range.start.line + 1)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', backgroundColor: C.pane }}>
      {/* Header: path + language + dirty dot + actions */}
      <div
        style={{
          display: 'flex', flexDirection: 'row', alignItems: 'center',
          paddingLeft: 12, paddingRight: 12, height: 36, gap: 8,
          borderBottomWidth: 1, borderColor: C.border, backgroundColor: C.rail,
        }}
      >
        <text style={{ fontSize: 12, color: dirty ? C.amber : C.text }}>
          {dirty ? '●' : '○'} {path || 'untitled'}
        </text>
        {path ? (
          <text style={{ fontSize: 10, color: C.tertiary, backgroundColor: C.raised, paddingLeft: 6, paddingRight: 6, paddingTop: 2, paddingBottom: 2, borderRadius: 4 }}>
            {language}
          </text>
        ) : null}
        {path && lspState !== 'off' ? (
          <text
            style={{
              fontSize: 10,
              color: lspState === 'running' ? C.green : lspState === 'crashed-out' ? C.red : C.amber,
              backgroundColor: C.raised, paddingLeft: 6, paddingRight: 6, paddingTop: 2, paddingBottom: 2, borderRadius: 4,
            }}
          >
            LSP {lspState}
            {lspDiags.length > 0 ? ` · ${lspDiags.length}` : ''}
          </text>
        ) : null}
        <div style={{ flexGrow: 1 }} />
        {lspHandleRef.current || lspState === 'running' ? (
          <>
            <div onClick={() => requestCompletion(valueRef.current, selRef.current?.end ?? valueRef.current.length)} style={{ cursor: 'pointer', paddingLeft: 8, paddingRight: 8, paddingTop: 4, paddingBottom: 4, backgroundColor: C.raised, borderRadius: 6 }}>
              <text style={{ fontSize: 12, color: C.text }}>Suggest</text>
            </div>
            <div onClick={() => requestHover()} style={{ cursor: 'pointer', paddingLeft: 8, paddingRight: 8, paddingTop: 4, paddingBottom: 4, backgroundColor: C.raised, borderRadius: 6 }}>
              <text style={{ fontSize: 12, color: C.text }}>Hover</text>
            </div>
          </>
        ) : null}
        <div onClick={() => saveFile()} style={{ cursor: 'pointer', paddingLeft: 8, paddingRight: 8, paddingTop: 4, paddingBottom: 4, backgroundColor: C.raised, borderRadius: 6 }}>
          <text style={{ fontSize: 12, color: C.text }}>Save</text>
        </div>
      </div>

      {/* Path bar */}
      <div style={{ display: 'flex', flexDirection: 'row', gap: 8, padding: 8, borderBottomWidth: 1, borderColor: C.border }}>
        <input
          testId="editor-path"
          value={path}
          placeholder="/path/to/file.ts"
          style={{ flexGrow: 1, minWidth: 0, fontSize: 12, color: C.text, backgroundColor: C.raised, borderRadius: 6, borderWidth: 1, borderColor: C.border, paddingLeft: 8, paddingRight: 8, paddingTop: 6, paddingBottom: 6 }}
          onChange={(e) => setPath(e.value ?? '')}
          onSubmit={(e) => openFile(e.value ?? path)}
        />
        <div onClick={() => openFile(path)} style={{ cursor: 'pointer', paddingLeft: 10, paddingRight: 10, paddingTop: 6, paddingBottom: 6, backgroundColor: C.accent, borderRadius: 6 }}>
          <text style={{ fontSize: 12, color: '#FFFFFF' }}>Open</text>
        </div>
      </div>

      {/* Editor surface */}
      <div style={{ flexGrow: 1, minHeight: 0, padding: 0 }}>
        <textarea
          testId="editor-textarea"
          value={value}
          selection={sel}
          placeholder="// open a file, or start typing…"
          onFocus={() => setTextUiFocused(true)}
          onBlur={() => setTextUiFocused(false)}
          style={{
            width: '100%', height: '100%', minWidth: 0,
            fontSize: 13, lineHeight: 20, fontFamily: 'JetBrains Mono',
            color: C.text, backgroundColor: C.bg,
            paddingLeft: 12, paddingRight: 12, paddingTop: 10, paddingBottom: 10,
          }}
          onChange={(e) => handleChange(e.value ?? '')}
          onSelect={(e) => setSel({ start: e.startIndex ?? 0, end: e.endIndex ?? 0 })}
        />
      </div>

      {/* Completion panel: textDocument/completion results, click to insert. */}
      {completions && completions.items.length > 0 ? (
        <CompletionPanel
          items={completions.items}
          onPick={applyCompletion}
          onDismiss={dismissCompletion}
        />
      ) : null}

      {/* Hover tooltip panel: textDocument/hover contents as markdown. */}
      {hoverText ? (
        <HoverPanel text={hoverText} onDismiss={() => setHoverText(null)} />
      ) : null}

      {/* Problems panel: LSP publishDiagnostics, click jumps to the line. */}
      {sortedDiags.length > 0 ? (
        <div style={{ maxHeight: 116, borderTopWidth: 1, borderColor: C.border, backgroundColor: C.rail }}>
          <div style={{ paddingLeft: 12, paddingRight: 12, paddingTop: 6, paddingBottom: 2 }}>
            <text style={{ fontSize: 11, color: C.secondary }}>
              {sortedDiags.length} problem{sortedDiags.length === 1 ? '' : 's'}
            </text>
          </div>
          <virtual-list overdraw={60} estimatedItemHeight={22} style={{ maxHeight: 88, width: '100%' }}>
            {sortedDiags.map((d, i) => (
              <div
                key={i}
                onClick={() => goToDiagLine(d)}
                style={{ cursor: 'pointer', paddingLeft: 12, paddingRight: 12, paddingTop: 2, paddingBottom: 2 }}
              >
                <text style={{ fontSize: 11, color: severityColor(d.severity) }}>
                  Ln {d.range.start.line + 1}, Col {d.range.start.character + 1}  {d.message.split('\n')[0]}
                </text>
              </div>
            ))}
          </virtual-list>
        </div>
      ) : null}

      {/* Search bar */}
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8, borderTopWidth: 1, borderColor: C.border, backgroundColor: C.rail }}>
        <input
          testId="editor-search"
          value={query}
          placeholder="Find in file…"
          style={{ width: 180, fontSize: 12, color: C.text, backgroundColor: C.raised, borderRadius: 6, borderWidth: 1, borderColor: C.border, paddingLeft: 8, paddingRight: 8, paddingTop: 6, paddingBottom: 6 }}
          onChange={(e) => setQuery(e.value ?? '')}
        />
        <text style={{ fontSize: 11, color: C.secondary }}>
          {query ? `${matches} match${matches === 1 ? '' : 'es'}` : ''}
        </text>
        <div onClick={() => goToMatch(-1)} style={{ cursor: 'pointer', paddingLeft: 8, paddingRight: 8, paddingTop: 4, paddingBottom: 4, backgroundColor: C.raised, borderRadius: 6 }}>
          <text style={{ fontSize: 12, color: C.text }}>▲ Prev</text>
        </div>
        <div onClick={() => goToMatch(1)} style={{ cursor: 'pointer', paddingLeft: 8, paddingRight: 8, paddingTop: 4, paddingBottom: 4, backgroundColor: C.raised, borderRadius: 6 }}>
          <text style={{ fontSize: 12, color: C.text }}>▼ Next</text>
        </div>
        <input
          testId="editor-goto"
          value={gotoLine}
          placeholder="line #"
          style={{ width: 64, fontSize: 12, color: C.text, backgroundColor: C.raised, borderRadius: 6, borderWidth: 1, borderColor: C.border, paddingLeft: 8, paddingRight: 8, paddingTop: 6, paddingBottom: 6 }}
          onChange={(e) => setGotoLine((e.value ?? '').replace(/[^0-9]/g, ''))}
          onSubmit={() => goToLine()}
        />
        <div onClick={() => goToLine()} style={{ cursor: 'pointer', paddingLeft: 8, paddingRight: 8, paddingTop: 4, paddingBottom: 4, backgroundColor: C.raised, borderRadius: 6 }}>
          <text style={{ fontSize: 12, color: C.text }}>Go</text>
        </div>
      </div>

      {/* Status bar */}
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', height: 26, paddingLeft: 12, paddingRight: 12, gap: 16, borderTopWidth: 1, borderColor: C.border, backgroundColor: C.rail }}>
        <text style={{ fontSize: 11, color: dirty ? C.amber : C.tertiary }}>{dirty ? '● unsaved' : 'saved'}</text>
        <text style={{ fontSize: 11, color: C.tertiary }}>{lineCount} lines</text>
        <text style={{ fontSize: 11, color: C.tertiary }}>Ln {caretLine}, Col {caretCol}</text>
        {lspDiags.length > 0 ? (
          <text style={{ fontSize: 11, color: C.amber }}>
            {lspDiags.length} problem{lspDiags.length === 1 ? '' : 's'}
          </text>
        ) : null}
        <div style={{ flexGrow: 1 }} />
        <text style={{ fontSize: 11, color: C.tertiary }}>{status}</text>
      </div>
    </div>
  )
}
