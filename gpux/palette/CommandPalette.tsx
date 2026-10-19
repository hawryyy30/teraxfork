/**
 * Command palette overlay (Ctrl/Cmd+Shift+P or the tab-bar button).
 *
 * Fuzzy-filters `commands` as you type; Enter runs the highlighted one,
 * arrows move, Escape or click-outside closes. While open the palette's
 * input holds focus so window keys do not reach the terminal.
 */
import { useEffect, useMemo, useState } from 'react'
import type { EventPayload } from '@gpuix/native'
import { C, useThemeVersion } from '../ui-tokens.ts'
import { setTextUiFocused } from '../terminal-input-bus.ts'
import { fuzzyFilter } from './fuzzy.ts'

export interface PaletteCommand {
  id: string
  label: string
  hint?: string
  keywords?: string
  run: () => void
}

export function CommandPalette({
  commands,
  onClose,
}: {
  commands: PaletteCommand[]
  onClose: () => void
}) {
  useThemeVersion()
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)

  const matches = useMemo(
    () => fuzzyFilter(query, commands, (c) => `${c.label} ${c.keywords ?? ''}`),
    [query, commands],
  )

  useEffect(() => {
    setIndex(0)
  }, [query])

  const chosen = matches[Math.min(index, Math.max(0, matches.length - 1))]

  const onKeyDown = (e: EventPayload) => {
    if (e.key === 'escape') {
      onClose()
    } else if (e.key === 'down') {
      setIndex((i) => Math.min(i + 1, matches.length - 1))
    } else if (e.key === 'up') {
      setIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'enter' && chosen) {
      onClose()
      chosen.run()
    }
  }

  return (
    <div
      testId="palette-backdrop"
      onMouseDownOutside={onClose}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: '#00000088',
        display: 'flex',
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'flex-start',
      }}
    >
      <div
        style={{
          width: 520,
          marginTop: 80,
          backgroundColor: C.pane,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: C.border,
          padding: 12,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        <input
          testId="palette-input"
          value={query}
          placeholder="Type a command…"
          autoFocus
          onFocus={() => setTextUiFocused(true)}
          onBlur={() => setTextUiFocused(false)}
          onChange={(e) => setQuery(e.value ?? '')}
          onKeyDown={onKeyDown}
          style={{
            width: '100%',
            fontSize: 14,
            fontFamily: 'Inter',
            color: C.text,
            backgroundColor: C.raised,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: C.border,
            paddingLeft: 12,
            paddingRight: 12,
            paddingTop: 10,
            paddingBottom: 10,
          }}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 320 }}>
          {matches.length === 0 && (
            <text style={{ fontSize: 12, color: C.tertiary, padding: 8 }}>No matching commands.</text>
          )}
          {matches.slice(0, 12).map((c, i) => (
            <div
              key={c.id}
              onClick={() => {
                onClose()
                c.run()
              }}
              style={{
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                borderRadius: 6,
                backgroundColor: i === index ? C.raised : '#00000000',
                paddingLeft: 10,
                paddingRight: 10,
                paddingTop: 7,
                paddingBottom: 7,
                cursor: 'pointer',
              }}
            >
              <text style={{ fontSize: 13, color: i === index ? C.text : C.secondary }}>
                {c.label}
              </text>
              <div style={{ flexGrow: 1 }} />
              {c.hint && <text style={{ fontSize: 11, color: C.tertiary }}>{c.hint}</text>}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
