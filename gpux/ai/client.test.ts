import { describe, expect, it, vi, afterEach } from 'vitest'
import {
  MissingApiKeyError,
  PROVIDERS,
  effectiveModel,
  keySourceLabel,
  resolveApiKey,
  type ChatConfig,
} from './client.ts'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('resolveApiKey', () => {
  it('prefers the explicit in-panel key over the environment', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'env-key')
    const cfg: ChatConfig = { provider: 'anthropic', model: '', apiKey: 'panel-key' }
    expect(resolveApiKey(cfg)).toBe('panel-key')
  })

  it('falls back to the provider env var', () => {
    vi.stubEnv('OPENAI_API_KEY', 'env-key')
    expect(resolveApiKey({ provider: 'openai', model: '' })).toBe('env-key')
  })

  it('returns undefined when nothing is set', () => {
    expect(resolveApiKey({ provider: 'openrouter', model: '' })).toBeUndefined()
  })

  it('trims whitespace-only keys away', () => {
    expect(resolveApiKey({ provider: 'anthropic', model: '', apiKey: '   ' })).toBeUndefined()
  })
})

describe('keySourceLabel', () => {
  it('never includes the key itself', () => {
    const cfg: ChatConfig = { provider: 'anthropic', model: '', apiKey: 'sk-secret-123' }
    expect(keySourceLabel(cfg)).not.toContain('sk-secret-123')
    expect(keySourceLabel(cfg)).toBe('key pasted in panel, memory only')
  })

  it('names the env var when the key comes from the environment', () => {
    vi.stubEnv('OPENAI_API_KEY', 'x')
    expect(keySourceLabel({ provider: 'openai', model: '' })).toBe('OPENAI_API_KEY from environment')
  })

  it('reports absence', () => {
    expect(keySourceLabel({ provider: 'anthropic', model: '' })).toBe('no key found')
  })
})

describe('effectiveModel', () => {
  it('uses the provider default when the model field is blank', () => {
    expect(effectiveModel({ provider: 'anthropic', model: '  ' })).toBe(PROVIDERS.anthropic.defaultModel)
  })

  it('honours an explicit model id', () => {
    expect(effectiveModel({ provider: 'openai', model: 'gpt-4o-mini' })).toBe('gpt-4o-mini')
  })
})

describe('MissingApiKeyError', () => {
  it('tells the user exactly which env var to set', () => {
    const err = new MissingApiKeyError(PROVIDERS.anthropic)
    expect(err.message).toContain('ANTHROPIC_API_KEY')
    expect(err.message).toContain('memory only')
  })
})
