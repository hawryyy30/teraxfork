/**
 * ProblemsPanel — LSP publishDiagnostics rendered in-flow (M3).
 *
 * Ported from the spike's CodeEditorPane problems panel: diagnostics live
 * here instead of beside the text because a scroll-synced inline gutter
 * tears on GPUIX (native scroll moves a frame before onScroll arrives).
 * Clicking a diagnostic jumps to its line once the M2 editor pane exists;
 * until then the shell passes a notice callback.
 */
import { useMemo } from 'react'
import type { LspDiagnostic } from './lsp-manager'
import { C, useThemeVersion } from '../ui-tokens.ts'

function severityColor(sev: number | undefined): string {
  return sev === 1 ? C.red : sev === 2 ? C.amber : C.secondary
}

export function ProblemsPanel({
  diags,
  path,
  onJumpLine,
}: {
  diags: LspDiagnostic[]
  path: string | null
  onJumpLine?: (d: LspDiagnostic) => void
}) {
  useThemeVersion()
  const sorted = useMemo(
    () =>
      [...diags].sort(
        (a, b) =>
          a.range.start.line - b.range.start.line ||
          a.range.start.character - b.range.start.character,
      ),
    [diags],
  )

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: C.pane,
      }}
    >
      <div style={{ paddingLeft: 12, paddingRight: 12, paddingTop: 10, paddingBottom: 6 }}>
        <text style={{ fontSize: 12, color: C.secondary }}>
          {sorted.length === 0
            ? path
              ? `no problems — ${path.split('/').pop()}`
              : 'open a file from the explorer to analyze it'
            : `${sorted.length} problem${sorted.length === 1 ? '' : 's'}${
                path ? ` — ${path.split('/').pop()}` : ''
              }`}
        </text>
      </div>
      {sorted.length > 0 ? (
        <virtual-list overdraw={60} estimatedItemHeight={22} style={{ flexGrow: 1, width: '100%' }}>
          {sorted.map((d, i) => (
            <div
              key={i}
              onClick={() => onJumpLine?.(d)}
              style={{ cursor: 'pointer', paddingLeft: 12, paddingRight: 12, paddingTop: 3, paddingBottom: 3 }}
            >
              <text style={{ fontSize: 11, color: severityColor(d.severity) }}>
                Ln {d.range.start.line + 1}, Col {d.range.start.character + 1} {'  '}
                {d.message.split('\n')[0]}
              </text>
            </div>
          ))}
        </virtual-list>
      ) : null}
    </div>
  )
}
