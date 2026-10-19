/**
 * Git panel: status, stage/unstage, discard, commit, diff, pull/push, log.
 *
 * Runs `git` as a subprocess (see git.ts); argv only, never a shell.
 * Refreshes on mount, on cwd change, every 8 s while visible, and whenever
 * `emitGitChanged()` fires (e.g. from the command palette).
 */
import { useCallback, useEffect, useState } from 'react'
import { C, useThemeVersion } from '../ui-tokens.ts'
import { setTextUiFocused } from '../terminal-input-bus.ts'
import { emitGitChanged, onGitChanged } from './git-bus.ts'
import {
  branchName,
  commitStaged,
  discardEntries,
  gitDiff,
  gitLog,
  gitPull,
  gitPush,
  gitStatus,
  isStaged,
  isUnstaged,
  isUntracked,
  repoRoot,
  stagePaths,
  unstagePaths,
  type CommitInfo,
  type GitEntry,
} from './git.ts'

const focusProps = {
  onFocus: () => setTextUiFocused(true),
  onBlur: () => setTextUiFocused(false),
}

function statusBadge(e: GitEntry) {
  if (isUntracked(e)) return { letter: '?', color: C.tertiary }
  if (e.x === 'R' || e.y === 'R') return { letter: 'R', color: C.blue }
  if (e.x === 'A' || e.y === 'A') return { letter: 'A', color: C.green }
  if (e.x === 'D' || e.y === 'D') return { letter: 'D', color: C.red }
  return { letter: 'M', color: C.amber }
}

function ActionButton({
  label,
  onPress,
  danger,
  disabled,
}: {
  label: string
  onPress: () => void
  danger?: boolean
  disabled?: boolean
}) {
  return (
    <div
      onClick={disabled ? undefined : onPress}
      style={{
        cursor: disabled ? 'default' : 'pointer',
        backgroundColor: danger ? '#3A2226' : C.raised,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: danger ? C.red : C.border,
        paddingLeft: 10,
        paddingRight: 10,
        paddingTop: 4,
        paddingBottom: 4,
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <text style={{ fontSize: 11, color: danger ? C.red : C.secondary }}>{label}</text>
    </div>
  )
}

function SectionTitle({ label, count }: { label: string; count: number }) {
  return (
    <text style={{ fontSize: 11, fontWeight: 'bold', color: C.secondary, marginTop: 10 }}>
      {label} ({count})
    </text>
  )
}

function DiffLine({ line }: { line: string }) {
  const color = line.startsWith('+')
    ? C.green
    : line.startsWith('-')
      ? C.red
      : line.startsWith('@@')
        ? C.blue
        : C.tertiary
  return <text style={{ fontSize: 11, color, fontFamily: 'monospace' }}>{line || ' '}</text>
}

export function GitPane({ cwd, onNotice }: { cwd: string; onNotice: (s: string) => void }) {
  useThemeVersion()
  const [root, setRoot] = useState<string | null>(null)
  const [branch, setBranch] = useState('')
  const [entries, setEntries] = useState<GitEntry[]>([])
  const [log, setLog] = useState<CommitInfo[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [diff, setDiff] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState<string | null>(null)

  const refresh = useCallback(() => {
    const r = repoRoot(cwd)
    setRoot(r)
    if (!r) return
    setBranch(branchName(r))
    setEntries(gitStatus(r))
    setLog(gitLog(r))
  }, [cwd])

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 8000)
    const off = onGitChanged(refresh)
    return () => {
      clearInterval(t)
      off()
    }
  }, [refresh])

  useEffect(() => {
    setSelected(null)
    setDiff('')
    setConfirmDiscard(null)
  }, [root])

  const run = (label: string, fn: () => { ok: boolean; stderr: string }) => {
    setBusy(true)
    try {
      const r = fn()
      if (!r.ok) onNotice(`${label} failed: ${r.stderr.trim().split('\n')[0] || 'unknown error'}`)
      else onNotice('')
    } finally {
      setBusy(false)
    }
    refresh()
    emitGitChanged()
  }

  const openDiff = (e: GitEntry) => {
    if (!root) return
    setSelected(e.path)
    setDiff(gitDiff(root, e, isStaged(e) && !isUnstaged(e)))
  }

  if (root === null) {
    return (
      <div style={{ flexGrow: 1, backgroundColor: C.pane, padding: 20 }}>
        <text style={{ fontSize: 13, color: C.tertiary }}>
          {cwd} is not inside a git repository.
        </text>
      </div>
    )
  }

  const staged = entries.filter(isStaged)
  const unstaged = entries.filter((e) => isUnstaged(e) && !isUntracked(e))
  const untracked = entries.filter(isUntracked)

  const row = (e: GitEntry) => {
    const badge = statusBadge(e)
    const sel = selected === e.path
    return (
      <div
        key={e.path}
        onClick={() => openDiff(e)}
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingLeft: 8,
          paddingRight: 8,
          paddingTop: 3,
          paddingBottom: 3,
          borderRadius: 6,
          backgroundColor: sel ? C.raised : '#00000000',
          cursor: 'pointer',
        }}
      >
        <text style={{ fontSize: 11, fontWeight: 'bold', color: badge.color, width: 14 }}>
          {badge.letter}
        </text>
        <div style={{ flexGrow: 1, minWidth: 0 }}>
          <text style={{ fontSize: 12, color: C.text }}>
            {e.origPath ? `${e.origPath} -> ${e.path}` : e.path}
          </text>
        </div>
        {isUnstaged(e) && !isUntracked(e) && (
          <ActionButton
            label="+ stage"
            disabled={busy}
            onPress={() =>
              run('Stage', () => {
                const r = stagePaths(root, [e.path])
                return r
              })
            }
          />
        )}
        {isUntracked(e) && (
          <ActionButton
            label="+ track"
            disabled={busy}
            onPress={() => run('Track', () => stagePaths(root, [e.path]))}
          />
        )}
        {isStaged(e) && (
          <ActionButton
            label="- unstage"
            disabled={busy}
            onPress={() => run('Unstage', () => unstagePaths(root, [e.path]))}
          />
        )}
        {confirmDiscard === e.path ? (
          <ActionButton
            label="confirm discard"
            danger
            disabled={busy}
            onPress={() => {
              setConfirmDiscard(null)
              run('Discard', () => discardEntries(root, [e]))
            }}
          />
        ) : (
          <ActionButton
            label="discard"
            danger
            disabled={busy}
            onPress={() => setConfirmDiscard(e.path)}
          />
        )}
      </div>
    )
  }

  return (
    <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', backgroundColor: C.pane, minHeight: 0 }}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          padding: 12,
          borderBottomWidth: 1,
          borderColor: C.border,
          flexWrap: 'wrap',
        }}
      >
        <text style={{ fontSize: 13, fontWeight: 'bold', color: C.text }}>{branch || '(no branch)'}</text>
        <div style={{ flexGrow: 1 }} />
        <ActionButton label="refresh" disabled={busy} onPress={refresh} />
        <ActionButton
          label="stage all"
          disabled={busy || unstaged.length + untracked.length === 0}
          onPress={() =>
            run('Stage all', () =>
              stagePaths(root, [...unstaged, ...untracked].map((e) => e.path)),
            )
          }
        />
        <ActionButton label="pull" disabled={busy} onPress={() => run('Pull', () => gitPull(root))} />
        <ActionButton label="push" disabled={busy} onPress={() => run('Push', () => gitPush(root))} />
      </div>

      <div style={{ flexGrow: 1, minHeight: 0, display: 'flex', flexDirection: 'row' }}>
        <div style={{ flexGrow: 1, minWidth: 0, padding: 12, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
            <div style={{ flexGrow: 1, minWidth: 0 }}>
              <textarea
                testId="git-commit-message"
                value={message}
                placeholder="Commit message"
                minRows={1}
                maxRows={3}
                style={{
                  width: '100%',
                  fontSize: 12,
                  fontFamily: 'Inter',
                  color: C.text,
                  backgroundColor: C.raised,
                  borderRadius: 8,
                  borderWidth: 1,
                  borderColor: C.border,
                  paddingLeft: 10,
                  paddingRight: 10,
                  paddingTop: 6,
                  paddingBottom: 6,
                }}
                {...focusProps}
                onChange={(e) => setMessage(e.value ?? '')}
              />
            </div>
            <ActionButton
              label={`commit (${staged.length})`}
              disabled={busy || staged.length === 0 || !message.trim()}
              onPress={() =>
                run('Commit', () => {
                  const r = commitStaged(root, message)
                  if (r.ok) setMessage('')
                  return r
                })
              }
            />
          </div>

          {entries.length === 0 ? (
            <text style={{ fontSize: 12, color: C.tertiary, marginTop: 16 }}>
              Working tree clean.
            </text>
          ) : (
            <>
              {staged.length > 0 && <SectionTitle label="Staged" count={staged.length} />}
              {staged.map(row)}
              {unstaged.length > 0 && <SectionTitle label="Changes" count={unstaged.length} />}
              {unstaged.map(row)}
              {untracked.length > 0 && <SectionTitle label="Untracked" count={untracked.length} />}
              {untracked.map(row)}
            </>
          )}

          {log.length > 0 && <SectionTitle label="Recent commits" count={log.length} />}
          {log.map((c) => (
            <div key={c.hash} style={{ paddingLeft: 8, paddingTop: 2, paddingBottom: 2 }}>
              <text style={{ fontSize: 11, color: C.tertiary }}>
                {c.hash.slice(0, 7)} {c.date} {c.author}: {c.subject}
              </text>
            </div>
          ))}
        </div>

        {selected && (
          <div
            style={{
              width: '45%',
              borderLeftWidth: 1,
              borderColor: C.border,
              padding: 12,
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0,
            }}
          >
            <text style={{ fontSize: 12, fontWeight: 'bold', color: C.text }}>{selected}</text>
            <div style={{ marginTop: 8, flexGrow: 1, minHeight: 0 }}>
              {diff.split('\n').map((l, i) => (
                <DiffLine key={i} line={l} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
