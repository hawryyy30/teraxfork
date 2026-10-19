/**
 * AI chat panel with real model calls (milestone M4).
 *
 * BYOK: the provider, model, and key are chosen in the panel. The key is
 * held in React state only, never persisted, never logged. Streaming goes
 * through ai/client.ts; abort via the stop button.
 */

import { useRef, useState } from 'react'
import { C, UI_FONT, useThemeVersion } from '../ui-tokens.ts'
import { setTextUiFocused } from '../terminal-input-bus.ts'
import {
  MissingApiKeyError,
  PROVIDERS,
  effectiveModel,
  keySourceLabel,
  streamChat,
  type ChatConfig,
  type ProviderId,
  type UiMessage,
} from './client.ts'

const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[]

const WELCOME: UiMessage = {
  role: 'assistant',
  text: 'Ask about this repo. Keys are bring-your-own: set the provider env var or paste a key below. Pasted keys live in memory only.',
}

function ChatMessage({ msg }: { msg: UiMessage }) {
  useThemeVersion()
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
        <text style={{ fontSize: 13, color: C.text, lineHeight: 20 }}>{msg.text}</text>
      ) : (
        <markdown source={msg.text || '…'} />
      )}
    </div>
  )
}

function SetupRow({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  useThemeVersion()
  return (
    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 }}>
      <text style={{ fontSize: 11, color: C.tertiary, width: 64 }}>{label}</text>
      <div style={{ flexGrow: 1, minWidth: 0 }}>{children}</div>
    </div>
  )
}

const fieldStyle = {
  width: '100%',
  minWidth: 0,
  fontSize: 12,
  fontFamily: UI_FONT,
  color: C.text,
  backgroundColor: C.raised,
  borderRadius: 6,
  borderWidth: 1,
  borderColor: C.border,
  paddingLeft: 8,
  paddingRight: 8,
  paddingTop: 6,
  paddingBottom: 6,
} as const

export function ChatPane() {
  useThemeVersion()
  const [messages, setMessages] = useState<UiMessage[]>([WELCOME])
  const [draft, setDraft] = useState('')
  const [showSetup, setShowSetup] = useState(false)
  const [provider, setProvider] = useState<ProviderId>('anthropic')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [baseURL, setBaseURL] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState('')
  const abortRef = useRef<AbortController | null>(null)

  const config: ChatConfig = {
    provider,
    model,
    apiKey: apiKey || undefined,
    baseURL: baseURL || undefined,
  }
  const info = PROVIDERS[provider]

  const focusProps = {
    onFocus: () => setTextUiFocused(true),
    onBlur: () => setTextUiFocused(false),
  }

  const send = async (text: string) => {
    const t = text.trim()
    if (!t || streaming) return
    setDraft('')
    setError('')
    const next: UiMessage[] = [...messages, { role: 'user', text: t }, { role: 'assistant', text: '' }]
    setMessages(next.slice(-200))
    setStreaming(true)
    const ctrl = new AbortController()
    abortRef.current = ctrl
    try {
      await streamChat({
        config,
        messages: next,
        signal: ctrl.signal,
        onToken: (delta) =>
          setMessages((m) => {
            const copy = [...m]
            const last = copy[copy.length - 1]
            copy[copy.length - 1] = { ...last, text: last.text + delta }
            return copy
          }),
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (ctrl.signal.aborted) {
        setMessages((m) => {
          const copy = [...m]
          const last = copy[copy.length - 1]
          copy[copy.length - 1] = { ...last, text: last.text || '(stopped)' }
          return copy
        })
      } else {
        setError(e instanceof MissingApiKeyError ? msg : `Model call failed: ${msg}`)
      }
    } finally {
      abortRef.current = null
      setStreaming(false)
    }
  }

  const stop = () => abortRef.current?.abort()

  return (
    <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', backgroundColor: C.pane, minWidth: 0 }}>
      <div style={{ padding: 12, borderBottomWidth: 1, borderColor: C.border }}>
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center' }}>
          <text style={{ fontSize: 13, fontWeight: 'bold', color: C.text }}>✦ Ask</text>
          <div style={{ flexGrow: 1 }} />
          <div
            testId="chat-setup-toggle"
            onClick={() => setShowSetup((s) => !s)}
            style={{ cursor: 'pointer', paddingLeft: 8, paddingRight: 8, paddingTop: 4, paddingBottom: 4 }}
          >
            <text style={{ fontSize: 11, color: C.accent }}>{showSetup ? 'hide setup' : 'setup'}</text>
          </div>
        </div>
        <text style={{ fontSize: 11, color: C.tertiary, marginTop: 2 }}>
          {info.label} · {effectiveModel(config) || '(set model)'} · {keySourceLabel(config)}
        </text>
        {showSetup && (
          <div style={{ marginTop: 8 }}>
            <div style={{ display: 'flex', flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
              {PROVIDER_IDS.map((id) => (
                <div
                  key={id}
                  testId={`provider-${id}`}
                  onClick={() => setProvider(id)}
                  style={{
                    cursor: 'pointer',
                    backgroundColor: id === provider ? C.accent : C.raised,
                    borderRadius: 6,
                    paddingLeft: 10,
                    paddingRight: 10,
                    paddingTop: 5,
                    paddingBottom: 5,
                  }}
                >
                  <text style={{ fontSize: 11, color: id === provider ? '#FFFFFF' : C.secondary }}>
                    {PROVIDERS[id].label}
                  </text>
                </div>
              ))}
            </div>
            <SetupRow label="model">
              <input
                testId="chat-model"
                value={model}
                placeholder={info.defaultModel || 'e.g. llama3.1:8b via endpoint'}
                style={fieldStyle}
                {...focusProps}
                onChange={(e) => setModel(e.value ?? '')}
              />
            </SetupRow>
            {provider === 'custom' && (
              <SetupRow label="base URL">
                <input
                  testId="chat-base-url"
                  value={baseURL}
                  placeholder="https://your-host/v1"
                  style={fieldStyle}
                  {...focusProps}
                  onChange={(e) => setBaseURL(e.value ?? '')}
                />
              </SetupRow>
            )}
            <SetupRow label="api key">
              <input
                testId="chat-api-key"
                value={apiKey}
                placeholder={`env: ${info.envKeys.join(', ')} — or paste here`}
                style={fieldStyle}
                {...focusProps}
                onChange={(e) => setApiKey(e.value ?? '')}
              />
            </SetupRow>
            <text style={{ fontSize: 10, color: C.tertiary, marginTop: 6 }}>
              Pasted keys stay in memory only. Get one at {info.hint}.
            </text>
          </div>
        )}
      </div>

      {error && (
        <div style={{ padding: 10, backgroundColor: '#3A1F1F', borderBottomWidth: 1, borderColor: C.border }}>
          <text style={{ fontSize: 12, color: C.red }}>{error}</text>
        </div>
      )}

      <virtual-list
        overdraw={240}
        estimatedItemHeight={120}
        followTail
        style={{ flexGrow: 1, minHeight: 0, width: '100%' }}
      >
        {messages.map((m, i) => (
          <ChatMessage key={i} msg={m} />
        ))}
      </virtual-list>

      <div style={{ borderTopWidth: 1, borderColor: C.border, padding: 8, backgroundColor: C.rail }}>
        <div style={{ display: 'flex', flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
          <div style={{ flexGrow: 1, minWidth: 0 }}>
            <textarea
              testId="composer"
              value={draft}
              placeholder="Ask about this repo…"
              minRows={1}
              maxRows={4}
              autoFocus
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
              {...focusProps}
              onChange={(e) => setDraft(e.value ?? '')}
              onSubmit={(e) => send(e.value ?? draft)}
            />
          </div>
          {streaming && (
            <div
              testId="chat-stop"
              onClick={stop}
              style={{
                cursor: 'pointer',
                backgroundColor: C.red,
                borderRadius: 8,
                paddingLeft: 12,
                paddingRight: 12,
                paddingTop: 8,
                paddingBottom: 8,
              }}
            >
              <text style={{ fontSize: 13, color: '#FFFFFF' }}>Stop</text>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
