import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** The browser's local storage, as a plain map, holding `initial` under the preferences' key. */
function storage(initial?: unknown) {
  const items = new Map<string, string>(initial === undefined ? [] : [['opencalque.prefs', JSON.stringify(initial)]])
  vi.stubGlobal('localStorage', { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => void items.set(key, value) })
  return { saved: () => JSON.parse(items.get('opencalque.prefs') ?? 'null') }
}

/** The preferences module, read afresh, as when the app starts. */
const start = async () => {
  vi.resetModules()
  return import('./prefs')
}

beforeEach(() => vi.stubGlobal('navigator', { language: 'fr-FR' }))
afterEach(() => vi.unstubAllGlobals())

describe('the preferences kept', () => {
  it('are only what differs from the defaults, so that a default changed later reaches those who never chose', async () => {
    const store = storage()
    const { setAiPrefs, setPrefs, usePrefs } = await start()
    setAiPrefs({ anthropic: { ...usePrefs.getState().ai.anthropic, apiKey: 'sk-ant-1' } })
    setPrefs({ showGrid: false })
    // The model was left as it came: it is not kept, and follows the default of the next version.
    expect(store.saved()).toEqual({ showGrid: false, ai: { anthropic: { apiKey: 'sk-ant-1' } } })
    setPrefs({ showGrid: true })
    expect(store.saved()).toEqual({ ai: { anthropic: { apiKey: 'sk-ant-1' } } })
  })

  it('read what an older version kept whole, and keep only what was chosen of it once anything changes', async () => {
    const store = storage({ theme: 'dark', unit: 'cm', showGrid: true, snapToObjects: true, ai: { provider: 'ollama', anthropic: { apiKey: '', model: 'claude-opus-5-5' }, ollama: { model: 'qwen', baseUrl: 'http://localhost:11434/v1' } } })
    const { setPrefs, usePrefs } = await start()
    expect(usePrefs.getState()).toMatchObject({ theme: 'dark', unit: 'cm', ai: { provider: 'ollama', ollama: { model: 'qwen' }, compatible: { baseUrl: 'https://api.openai.com/v1' } } })
    setPrefs({ autosave: false })
    expect(store.saved()).toEqual({ theme: 'dark', unit: 'cm', autosave: false, ai: { provider: 'ollama', ollama: { model: 'qwen' } } })
  })

  it('keep the unit once chosen, even when it is the one guessed from the language of the system', async () => {
    const store = storage()
    const { setPrefs, usePrefs } = await start()
    expect(usePrefs.getState().unit).toBe('mm')
    setPrefs({ unit: 'mm' })
    expect(store.saved()).toEqual({ unit: 'mm' })
  })

  it('keep the extensions installed and those switched off', async () => {
    const store = storage()
    const { setPrefs } = await start()
    setPrefs({ extensions: { installed: {}, disabled: ['opencalque.architecture'] } })
    expect(store.saved()).toEqual({ extensions: { disabled: ['opencalque.architecture'] } })
  })
})

describe('the keys of the assistant', () => {
  /** A stand-in for the desktop app's keychain. */
  const keychain = (available = true, held: Record<string, string> = {}) => ({
    held,
    available: async () => available,
    get: async (name: string) => held[name] ?? null,
    set: async (name: string, value: string) => {
      if (value) held[name] = value
      else delete held[name]
    },
  })

  it('go into the keychain where there is one, out of the preferences written in plain text', async () => {
    const store = storage({ showGrid: false, ai: { anthropic: { apiKey: 'sk-ant-1', model: 'other' } } })
    const { keepKeysIn, setAiPrefs, usePrefs } = await start()
    const kept = keychain()
    await keepKeysIn(kept)
    expect(kept.held).toEqual({ anthropic: 'sk-ant-1' })
    expect(store.saved()).toEqual({ showGrid: false, ai: { anthropic: { model: 'other' } } })
    expect(usePrefs.getState().ai.anthropic.apiKey).toBe('sk-ant-1')
    // Changed or forgotten, in the keychain only.
    setAiPrefs({ compatible: { ...usePrefs.getState().ai.compatible, apiKey: 'sk-2' } })
    setAiPrefs({ anthropic: { ...usePrefs.getState().ai.anthropic, apiKey: '' } })
    await Promise.resolve()
    expect(kept.held).toEqual({ compatible: 'sk-2' })
    expect(JSON.stringify(store.saved())).not.toContain('sk-')
  })

  it('are read from the keychain at start, and stay in the preferences where nothing can encrypt them', async () => {
    storage()
    let prefs = await start()
    await prefs.keepKeysIn(keychain(true, { anthropic: 'sk-ant-kept' }))
    expect(prefs.usePrefs.getState().ai.anthropic.apiKey).toBe('sk-ant-kept')

    const store = storage({ ai: { anthropic: { apiKey: 'sk-ant-1' } } })
    prefs = await start()
    await prefs.keepKeysIn(keychain(false))
    expect(store.saved()).toEqual({ ai: { anthropic: { apiKey: 'sk-ant-1' } } })
  })
})
