/**
 * AI chat client for the gpux shell (milestone M4).
 *
 * BYOK streaming chat over the Vercel AI SDK, running in Bun. No keychain
 * yet: keys come from the environment or are pasted into the panel and held
 * in memory only. They are never logged, never persisted, and never sent
 * anywhere except the chosen provider's API.
 *
 * The pure helpers (provider table, key resolution) are covered by
 * client.test.ts. Real calls need a key and are exercised on Windows.
 */

import { streamText, type LanguageModel } from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'

export type ProviderId = 'anthropic' | 'openai' | 'openrouter' | 'custom'

export interface ProviderInfo {
  id: ProviderId
  label: string
  defaultModel: string
  envKeys: string[]
  hint: string
}

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic',
    defaultModel: 'claude-sonnet-4-5',
    envKeys: ['ANTHROPIC_API_KEY'],
    hint: 'console.anthropic.com',
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    defaultModel: 'gpt-5',
    envKeys: ['OPENAI_API_KEY'],
    hint: 'platform.openai.com',
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    defaultModel: 'anthropic/claude-sonnet-4-5',
    envKeys: ['OPENROUTER_API_KEY'],
    hint: 'openrouter.ai/keys',
  },
  custom: {
    id: 'custom',
    label: 'OpenAI-compatible',
    defaultModel: '',
    envKeys: ['TERAX_GPUX_API_KEY'],
    hint: 'any OpenAI-compatible endpoint',
  },
}

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'

export interface ChatConfig {
  provider: ProviderId
  model: string
  /** In-memory only. Never persisted, never logged. */
  apiKey?: string
  /** Custom provider only. */
  baseURL?: string
}

export interface UiMessage {
  role: 'user' | 'assistant'
  text: string
}

export class MissingApiKeyError extends Error {
  readonly provider: ProviderInfo
  constructor(provider: ProviderInfo) {
    super(
      `No API key for ${provider.label}. Set ${provider.envKeys.join(' or ')} ` +
        `in the environment, or paste a key in the panel (held in memory only).`,
    )
    this.name = 'MissingApiKeyError'
    this.provider = provider
  }
}

/** Explicit in-panel key wins; otherwise the first set env var wins. */
export function resolveApiKey(cfg: ChatConfig): string | undefined {
  const explicit = cfg.apiKey?.trim()
  if (explicit) return explicit
  for (const name of PROVIDERS[cfg.provider].envKeys) {
    const v = process.env[name]?.trim()
    if (v) return v
  }
  return undefined
}

/** Human-readable key provenance for the panel. Never includes the key. */
export function keySourceLabel(cfg: ChatConfig): string {
  if (cfg.apiKey?.trim()) return 'key pasted in panel, memory only'
  for (const name of PROVIDERS[cfg.provider].envKeys) {
    if (process.env[name]?.trim()) return `${name} from environment`
  }
  return 'no key found'
}

export function effectiveModel(cfg: ChatConfig): string {
  return cfg.model.trim() || PROVIDERS[cfg.provider].defaultModel
}

function buildModel(cfg: ChatConfig, apiKey: string): LanguageModel {
  const modelId = effectiveModel(cfg)
  switch (cfg.provider) {
    case 'anthropic':
      return createAnthropic({ apiKey })(modelId)
    case 'openai':
      return createOpenAI({ apiKey })(modelId)
    case 'openrouter':
      return createOpenAI({ apiKey, baseURL: OPENROUTER_BASE_URL })(modelId)
    case 'custom':
      return createOpenAI({ apiKey, baseURL: cfg.baseURL?.trim() || undefined })(modelId)
  }
}

/**
 * Stream a completion, calling onToken per delta. Resolves with the full
 * assistant text. Aborts propagate as AbortError from the signal.
 */
export async function streamChat(opts: {
  config: ChatConfig
  messages: UiMessage[]
  signal?: AbortSignal
  onToken: (delta: string) => void
}): Promise<string> {
  const { config, messages, signal, onToken } = opts
  const info = PROVIDERS[config.provider]
  const apiKey = resolveApiKey(config)
  if (!apiKey) throw new MissingApiKeyError(info)
  const modelId = effectiveModel(config)
  if (!modelId) throw new Error('Enter a model id for the OpenAI-compatible endpoint.')

  const result = streamText({
    model: buildModel(config, apiKey),
    messages: messages.map((m) => ({ role: m.role, content: m.text })),
    abortSignal: signal,
  })

  let full = ''
  for await (const delta of result.textStream) {
    full += delta
    onToken(delta)
  }
  return full
}
