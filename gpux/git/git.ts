/**
 * Git panel backend: thin `git` CLI subprocess wrapper plus pure parsers.
 *
 * No shell is ever involved: argv goes straight to `git`, so paths with
 * spaces or quotes are safe. All functions are synchronous; the pane calls
 * them from event handlers and refresh effects.
 */
import { spawnSync } from 'node:child_process'

export interface RunResult {
  ok: boolean
  code: number
  stdout: string
  stderr: string
}

export function runGit(cwd: string, args: string[]): RunResult {
  try {
    const r = spawnSync('git', args, {
      cwd,
      encoding: 'utf8',
      timeout: 30_000,
      maxBuffer: 16 * 1024 * 1024,
    })
    const code = r.status ?? -1
    return {
      ok: code === 0,
      code,
      stdout: r.stdout ?? '',
      stderr: (r.stderr ?? '') + (r.error ? String(r.error) : ''),
    }
  } catch (err) {
    return { ok: false, code: -1, stdout: '', stderr: String(err) }
  }
}

export function repoRoot(cwd: string): string | null {
  const r = runGit(cwd, ['rev-parse', '--show-toplevel'])
  if (!r.ok) return null
  const root = r.stdout.trim()
  return root ? root : null
}

export function branchName(root: string): string {
  const r = runGit(root, ['rev-parse', '--abbrev-ref', 'HEAD'])
  if (!r.ok) return ''
  const b = r.stdout.trim()
  if (b === 'HEAD') {
    const s = runGit(root, ['rev-parse', '--short', 'HEAD'])
    return s.ok ? `detached @ ${s.stdout.trim()}` : 'detached'
  }
  return b
}

export interface GitEntry {
  /** Repo-relative path shown in the UI. */
  path: string
  /** Original path for renames/copies. */
  origPath?: string
  /** Index (staged) status letter from porcelain v2. */
  x: string
  /** Worktree (unstaged) status letter. */
  y: string
}

/** Parse `git status --porcelain=v2 -z` output. */
export function parseStatusV2(text: string): GitEntry[] {
  const out: GitEntry[] = []
  // Header lines (`# branch.head …`) are newline-terminated and precede the
  // NUL-separated entries; strip them first so the first token is an entry.
  const body = text.replace(/^#[^\n]*\n/gm, '')
  const tokens = body.split('\0')
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]
    if (!tok || tok.startsWith('#')) continue
    const kind = tok[0]
    if (kind === '1' || kind === 'u') {
      // `1 <XY> <subm> <mH> <mI> <mW> <hH> <hI> <path>`
      const parts = tok.split(' ')
      if (parts.length < 9) continue
      out.push({ x: parts[1][0] ?? '.', y: parts[1][1] ?? '.', path: parts.slice(8).join(' ') })
    } else if (kind === '2') {
      // `2 <XY> <subm> <mH> <mI> <mW> <hH> <hI> <X><score> <path>` + NUL + `<origPath>`
      const parts = tok.split(' ')
      if (parts.length < 10) continue
      const orig = tokens[i + 1]
      i += 1
      out.push({
        x: parts[1][0] ?? '.',
        y: parts[1][1] ?? '.',
        path: parts.slice(9).join(' '),
        origPath: orig || undefined,
      })
    } else if (kind === '?') {
      out.push({ x: '?', y: '?', path: tok.slice(2) })
    }
    // '!' (ignored) lines are skipped.
  }
  return out
}

export function isUntracked(e: GitEntry): boolean {
  return e.x === '?'
}

export function isStaged(e: GitEntry): boolean {
  return e.x !== '.' && e.x !== '?'
}

export function isUnstaged(e: GitEntry): boolean {
  return e.y !== '.'
}

export function gitStatus(root: string): GitEntry[] {
  const r = runGit(root, ['status', '--porcelain=v2', '-z', '--untracked-files=normal'])
  return r.ok ? parseStatusV2(r.stdout) : []
}

export interface CommitInfo {
  hash: string
  author: string
  date: string
  subject: string
}

/** Parse `git log --format=%H%x1f%an%x1f%ad%x1f%s`. */
export function parseLog(text: string): CommitInfo[] {
  return text
    .split('\n')
    .map((l) => l.trimEnd())
    .filter(Boolean)
    .map((l) => {
      const [hash = '', author = '', date = '', subject = ''] = l.split('\x1f')
      return { hash, author, date, subject }
    })
}

export function gitLog(root: string, n = 12): CommitInfo[] {
  const r = runGit(root, [
    'log',
    `-${n}`,
    '--format=%H%x1f%an%x1f%ad%x1f%s',
    '--date=short',
  ])
  return r.ok ? parseLog(r.stdout) : []
}

/** Unified diff for one file; `staged` picks `--cached`. Capped for the UI. */
export function gitDiff(root: string, entry: GitEntry, staged: boolean): string {
  const args = staged
    ? ['diff', '--cached', '--no-color', '--', entry.path]
    : isUntracked(entry)
      ? ['diff', '--no-index', '--no-color', '/dev/null', entry.path]
      : ['diff', '--no-color', '--', entry.path]
  const r = runGit(root, args)
  if (!r.ok) return r.stderr || '(no diff)'
  const lines = r.stdout.split('\n')
  const cap = 240
  return lines.length > cap
    ? lines.slice(0, cap).join('\n') + `\n… (${lines.length - cap} more lines)`
    : r.stdout
}

export function stagePaths(root: string, paths: string[]): RunResult {
  if (paths.length === 0) return { ok: true, code: 0, stdout: '', stderr: '' }
  return runGit(root, ['add', '--', ...paths])
}

export function unstagePaths(root: string, paths: string[]): RunResult {
  if (paths.length === 0) return { ok: true, code: 0, stdout: '', stderr: '' }
  return runGit(root, ['reset', '-q', 'HEAD', '--', ...paths])
}

/**
 * Discard worktree changes for tracked entries (`git checkout --`) and
 * delete untracked entries (`git clean -f --`). Staged content is kept.
 */
export function discardEntries(root: string, entries: GitEntry[]): RunResult {
  const tracked = entries.filter((e) => !isUntracked(e)).map((e) => e.path)
  const untracked = entries.filter(isUntracked).map((e) => e.path)
  if (tracked.length > 0) {
    const r = runGit(root, ['checkout', '--', ...tracked])
    if (!r.ok) return r
  }
  if (untracked.length > 0) {
    const r = runGit(root, ['clean', '-f', '--', ...untracked])
    if (!r.ok) return r
  }
  return { ok: true, code: 0, stdout: '', stderr: '' }
}

export function commitStaged(root: string, message: string): RunResult {
  const msg = message.trim()
  if (!msg) {
    return { ok: false, code: -1, stdout: '', stderr: 'Commit message is empty.' }
  }
  return runGit(root, ['commit', '-m', msg])
}

export function gitPull(root: string): RunResult {
  return runGit(root, ['pull', '--ff-only'])
}

export function gitPush(root: string): RunResult {
  return runGit(root, ['push'])
}
