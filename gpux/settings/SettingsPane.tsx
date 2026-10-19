/**
 * Settings pane (rail "setup" view): theme picker + storage note.
 */
import { C, getThemeId, listThemes, setThemeId, useThemeVersion } from '../ui-tokens.ts'
import { loadPrefs, prefsPath, savePrefs } from './store.ts'

function ThemeCard({
  id,
  label,
  active,
  onPick,
}: {
  id: string
  label: string
  active: boolean
  onPick: (id: string) => void
}) {
  const t = listThemes().find((t) => t.id === id)
  if (!t) return null
  const c = t.colors
  return (
    <div
      testId={`theme-${id}`}
      onClick={() => onPick(id)}
      style={{
        width: 168,
        borderRadius: 10,
        borderWidth: active ? 2 : 1,
        borderColor: active ? C.accent : C.border,
        backgroundColor: C.raised,
        padding: 10,
        cursor: 'pointer',
      }}
    >
      <div
        style={{
          height: 44,
          borderRadius: 6,
          backgroundColor: c.bg,
          borderWidth: 1,
          borderColor: C.border,
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          paddingLeft: 8,
          gap: 6,
        }}
      >
        <div style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: c.accent }} />
        <div style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: c.green }} />
        <div style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: c.amber }} />
        <text style={{ fontSize: 11, color: c.text, marginLeft: 4 }}>Aa</text>
      </div>
      <text style={{ fontSize: 12, color: active ? C.text : C.secondary, marginTop: 8 }}>
        {label}
      </text>
    </div>
  )
}

export function SettingsPane({ onNotice }: { onNotice: (s: string) => void }) {
  useThemeVersion()
  const activeId = getThemeId()

  const pick = (id: string) => {
    if (setThemeId(id)) {
      try {
        savePrefs({ ...loadPrefs(), themeId: id })
        onNotice(`Theme: ${listThemes().find((t) => t.id === id)?.label}`)
      } catch (err) {
        onNotice(`Theme applied, but saving failed: ${(err as Error).message}`)
      }
    }
  }

  return (
    <div
      style={{
        flexGrow: 1,
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: C.pane,
        padding: 20,
        gap: 16,
      }}
    >
      <text style={{ fontSize: 15, fontWeight: 'bold', color: C.text }}>Settings</text>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <text style={{ fontSize: 12, fontWeight: 'bold', color: C.secondary }}>Theme</text>
        <div style={{ display: 'flex', flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
          {listThemes().map((t) => (
            <ThemeCard key={t.id} id={t.id} label={t.label} active={t.id === activeId} onPick={pick} />
          ))}
        </div>
      </div>

      <text style={{ fontSize: 11, color: C.tertiary }}>
        Stored in {prefsPath()} (theme only; API keys stay in memory).
      </text>
    </div>
  )
}
