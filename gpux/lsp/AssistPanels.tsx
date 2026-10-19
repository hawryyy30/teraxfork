/**
 * CompletionPanel + HoverPanel — textDocument/completion and
 * textDocument/hover UI (M3).
 *
 * Ported from the spike's CodeEditorPane (step 2j): in-flow panels, because
 * caret-exact popup anchoring needs a native caret-rect API GPUIX doesn't
 * expose yet. The M2 editor pane drives these: completion calls
 * manager.completion() at the caret and filters by the word under it
 * (editor-assists.wordAtOffset), click inserts via replaceRange; hover fires
 * on caret idle (900 ms in the spike) and renders with native <markdown>.
 */
import type { LspCompletionItem } from './lsp-manager'
import { C } from '../ui-tokens.ts'

export function CompletionPanel({
  items,
  onPick,
  onDismiss,
}: {
  items: LspCompletionItem[]
  onPick: (item: LspCompletionItem) => void
  onDismiss: () => void
}) {
  if (items.length === 0) return null
  return (
    <div
      style={{
        maxHeight: 150,
        borderTopWidth: 1,
        borderColor: C.border,
        backgroundColor: C.rail,
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          paddingLeft: 12,
          paddingRight: 12,
          paddingTop: 6,
          paddingBottom: 2,
        }}
      >
        <text style={{ fontSize: 11, color: C.secondary }}>
          {items.length} suggestion{items.length === 1 ? '' : 's'}
        </text>
        <div style={{ flexGrow: 1 }} />
        <div onClick={onDismiss} style={{ cursor: 'pointer', paddingLeft: 6, paddingRight: 6 }}>
          <text style={{ fontSize: 11, color: C.tertiary }}>✕</text>
        </div>
      </div>
      <virtual-list overdraw={60} estimatedItemHeight={24} style={{ maxHeight: 122, width: '100%' }}>
        {items.map((item, i) => (
          <div
            key={i}
            onClick={() => onPick(item)}
            style={{ cursor: 'pointer', paddingLeft: 12, paddingRight: 12, paddingTop: 2, paddingBottom: 2 }}
          >
            <text style={{ fontSize: 12, color: C.text }}>
              {item.label}
              {item.detail ? `  ·  ${item.detail.split('\n')[0].slice(0, 60)}` : ''}
            </text>
          </div>
        ))}
      </virtual-list>
    </div>
  )
}

export function HoverPanel({ text, onDismiss }: { text: string; onDismiss: () => void }) {
  if (!text) return null
  return (
    <div
      style={{
        maxHeight: 130,
        borderTopWidth: 1,
        borderColor: C.border,
        backgroundColor: C.rail,
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          paddingLeft: 12,
          paddingRight: 12,
          paddingTop: 6,
          paddingBottom: 2,
        }}
      >
        <text style={{ fontSize: 11, color: C.secondary }}>hover</text>
        <div style={{ flexGrow: 1 }} />
        <div onClick={onDismiss} style={{ cursor: 'pointer', paddingLeft: 6, paddingRight: 6 }}>
          <text style={{ fontSize: 11, color: C.tertiary }}>✕</text>
        </div>
      </div>
      <div style={{ paddingLeft: 12, paddingRight: 12, paddingBottom: 8 }}>
        <markdown source={text} />
      </div>
    </div>
  )
}
