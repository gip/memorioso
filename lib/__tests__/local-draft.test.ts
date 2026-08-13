import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearLocalDraft, readLocalDraft, writeLocalDraft } from '@/lib/local-draft'

const KEY = 'memorioso.draft.local.v1'

const createStorage = () => {
  const store = new Map<string, string>()
  return {
    store,
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value) },
    removeItem: (key: string) => { store.delete(key) },
  }
}

const installWindow = (localStorage: unknown) => {
  vi.stubGlobal('window', { localStorage })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('local draft storage', () => {
  let storage: ReturnType<typeof createStorage>

  beforeEach(() => {
    storage = createStorage()
    installWindow(storage)
  })

  it('round-trips a draft and stamps savedAt', () => {
    const stored = writeLocalDraft({
      title: 'Notes',
      subtitle: 'a subtitle',
      content: { html: '<p>body</p>' },
    })

    expect(stored).toBe(true)
    const draft = readLocalDraft()
    expect(draft).toMatchObject({
      title: 'Notes',
      subtitle: 'a subtitle',
      content: { html: '<p>body</p>' },
    })
    expect(Number.isNaN(Date.parse(draft!.savedAt))).toBe(false)
  })

  it('returns null when nothing is stored', () => {
    expect(readLocalDraft()).toBeNull()
  })

  it('clears the stored draft', () => {
    writeLocalDraft({ title: 'Notes', subtitle: '', content: { html: '' } })
    clearLocalDraft()
    expect(readLocalDraft()).toBeNull()
  })

  it('ignores malformed JSON rather than throwing', () => {
    storage.store.set(KEY, '{not json')
    expect(readLocalDraft()).toBeNull()
  })

  it('ignores stored values that are not draft shaped', () => {
    storage.store.set(KEY, JSON.stringify({ title: 'Notes' }))
    expect(readLocalDraft()).toBeNull()
  })

  it('fills in missing optional fields', () => {
    storage.store.set(KEY, JSON.stringify({ content: { html: '<p>x</p>' } }))
    expect(readLocalDraft()).toEqual({
      title: '',
      subtitle: '',
      content: { html: '<p>x</p>' },
      savedAt: '',
    })
  })

  it('reports failure instead of throwing when the quota is exceeded', () => {
    installWindow({
      ...storage,
      setItem: () => { throw new Error('QuotaExceededError') },
    })

    expect(writeLocalDraft({ title: 'Notes', subtitle: '', content: { html: '' } })).toBe(false)
  })

  it('survives a storage that throws on read', () => {
    installWindow({
      ...storage,
      getItem: () => { throw new Error('SecurityError') },
    })

    expect(readLocalDraft()).toBeNull()
  })

  it('is inert on the server', () => {
    vi.unstubAllGlobals()
    expect(readLocalDraft()).toBeNull()
    expect(writeLocalDraft({ title: 'a', subtitle: '', content: { html: '' } })).toBe(false)
    expect(() => clearLocalDraft()).not.toThrow()
  })
})
