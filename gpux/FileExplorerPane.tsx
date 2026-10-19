/**
 * FileExplorerPane — a normal file-explorer for the spike's left panel.
 *
 * Browse directories with clicks instead of `cd`: directories list first,
 * click to enter, ↑ (or the address bar) to go up, click a file to open it
 * in the editor. The parent owns `cwd` so it can keep the terminal's shell
 * in sync (`cd`) when the explorer navigates.
 */
import { useEffect, useState } from 'react'
import { readdir } from 'node:fs/promises'
import { dirname, join, parse } from 'node:path'

import { C, useThemeVersion } from './ui-tokens.ts'

type Entry = { name: string; isDir: boolean }

async function listDir(dir: string): Promise<Entry[]> {
  const ents = await readdir(dir, { withFileTypes: true })
  const out: Entry[] = ents.map((e) => ({ name: e.name, isDir: e.isDirectory() }))
  out.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  })
  return out
}

function isRoot(dir: string): boolean {
  return parse(dir).root === dir
}

export function FileExplorerPane({
  cwd,
  onNavigate,
  onOpenFile,
}: {
  cwd: string
  onNavigate: (dir: string) => void
  onOpenFile: (path: string) => void
}) {
  useThemeVersion()
  const [entries, setEntries] = useState<Entry[]>([])
  const [error, setError] = useState('')
  const [addr, setAddr] = useState(cwd)

  useEffect(() => {
    setAddr(cwd)
    let cancelled = false
    listDir(cwd)
      .then((ents) => {
        if (!cancelled) {
          setEntries(ents)
          setError('')
        }
      })
      .catch((err) => {
        if (!cancelled) setError(String((err as Error).message ?? err))
      })
    return () => {
      cancelled = true
    }
  }, [cwd])

  const goUp = () => {
    if (!isRoot(cwd)) onNavigate(dirname(cwd))
  }

  const goAddr = () => {
    const target = addr.trim()
    if (target && target !== cwd) onNavigate(target)
    else setAddr(cwd)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', backgroundColor: C.pane }}>
      {/* Header: title + up button */}
      <div
        style={{
          display: 'flex', flexDirection: 'row', alignItems: 'center',
          paddingLeft: 12, paddingRight: 12, height: 36, gap: 8,
          borderBottomWidth: 1, borderColor: C.border, backgroundColor: C.rail,
        }}
      >
        <text style={{ fontSize: 12, fontWeight: 'bold', color: C.text }}>▤ Explorer</text>
        <div style={{ flexGrow: 1 }} />
        <div
          testId="explorer-up"
          onClick={goUp}
          style={{
            cursor: isRoot(cwd) ? 'default' : 'pointer',
            opacity: isRoot(cwd) ? 0.35 : 1,
            paddingLeft: 10, paddingRight: 10, paddingTop: 4, paddingBottom: 4,
            backgroundColor: C.raised, borderRadius: 6,
          }}
        >
          <text style={{ fontSize: 12, color: C.text }}>↑ Up</text>
        </div>
      </div>

      {/* Address bar: type a path + Enter to jump */}
      <div style={{ display: 'flex', flexDirection: 'row', gap: 8, padding: 8, borderBottomWidth: 1, borderColor: C.border }}>
        <input
          testId="explorer-address"
          value={addr}
          style={{ flexGrow: 1, minWidth: 0, fontSize: 12, color: C.text, backgroundColor: C.raised, borderRadius: 6, borderWidth: 1, borderColor: C.border, paddingLeft: 8, paddingRight: 8, paddingTop: 6, paddingBottom: 6 }}
          onChange={(e) => setAddr(e.value ?? '')}
          onSubmit={goAddr}
        />
        <div onClick={goAddr} style={{ cursor: 'pointer', paddingLeft: 10, paddingRight: 10, paddingTop: 6, paddingBottom: 6, backgroundColor: C.accent, borderRadius: 6 }}>
          <text style={{ fontSize: 12, color: '#FFFFFF' }}>Go</text>
        </div>
      </div>

      {/* Current directory */}
      <div style={{ paddingLeft: 12, paddingRight: 12, paddingTop: 6, paddingBottom: 6, borderBottomWidth: 1, borderColor: C.border }}>
        <text style={{ fontSize: 11, color: C.tertiary }}>{cwd}</text>
        {error ? <text style={{ fontSize: 11, color: C.red, marginTop: 2 }}>{error}</text> : null}
      </div>

      {/* Listing: directories first, click a dir to enter, a file to open */}
      <virtual-list overdraw={120} estimatedItemHeight={28} style={{ flexGrow: 1, minHeight: 0, width: '100%' }}>
        {entries.map((e) => (
          <div
            key={e.name}
            testId={e.isDir ? `explorer-dir-${e.name}` : `explorer-file-${e.name}`}
            onClick={() => (e.isDir ? onNavigate(join(cwd, e.name)) : onOpenFile(join(cwd, e.name)))}
            style={{ cursor: 'pointer', paddingLeft: 12, paddingRight: 12, paddingTop: 5, paddingBottom: 5 }}
          >
            <text style={{ fontSize: 13, color: e.isDir ? C.accent : C.text }}>
              {e.isDir ? '📁' : '📄'} {e.name}
            </text>
          </div>
        ))}
      </virtual-list>

      {/* Footer: entry count */}
      <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', height: 26, paddingLeft: 12, paddingRight: 12, borderTopWidth: 1, borderColor: C.border, backgroundColor: C.rail }}>
        <text style={{ fontSize: 11, color: C.tertiary }}>
          {entries.filter((e) => e.isDir).length} folders, {entries.filter((e) => !e.isDir).length} files
        </text>
      </div>
    </div>
  )
}
