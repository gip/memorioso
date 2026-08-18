import { beforeEach, describe, expect, it } from 'vitest'
import { LIBRO_WORLD_CHAIN_RPC_URLS } from '@libro/core'
import {
  RPC_SETTINGS_KEY,
  enabledLibroRpcUrls,
  isDefaultLibroRpcUrl,
  libroRpcOriginPattern,
  loadLibroRpcEndpoints,
  normalizeLibroRpcUrl,
  saveLibroRpcEndpoints,
} from './rpc-settings'

let store: Record<string, unknown> = {}

beforeEach(() => {
  store = {}
  Object.assign(globalThis, {
    chrome: {
      storage: {
        sync: {
          get: async (key: string) => (key in store ? { [key]: store[key] } : {}),
          set: async (values: Record<string, unknown>) => { Object.assign(store, values) },
        },
      },
    },
  })
})

describe('extension RPC settings', () => {
  it('starts with every built-in endpoint enabled', async () => {
    await expect(loadLibroRpcEndpoints()).resolves.toEqual(
      LIBRO_WORLD_CHAIN_RPC_URLS.map((url) => ({ url, enabled: true }))
    )
  })

  it('keeps a user selection and adds endpoints shipped later', async () => {
    const [first] = LIBRO_WORLD_CHAIN_RPC_URLS
    await saveLibroRpcEndpoints([{ url: first, enabled: false }, { url: 'https://custom.example', enabled: true }])

    const loaded = await loadLibroRpcEndpoints()
    expect(loaded[0]).toEqual({ url: first, enabled: false })
    expect(loaded).toContainEqual({ url: 'https://custom.example', enabled: true })
    // Defaults the stored list has never seen are appended rather than dropped.
    expect(loaded).toHaveLength(LIBRO_WORLD_CHAIN_RPC_URLS.length + 1)
  })

  it('queries only enabled endpoints', async () => {
    await saveLibroRpcEndpoints(LIBRO_WORLD_CHAIN_RPC_URLS.map((url, index) => ({ url, enabled: index === 0 })))
    await expect(enabledLibroRpcUrls()).resolves.toEqual([LIBRO_WORLD_CHAIN_RPC_URLS[0]])
  })

  it('repairs a legacy all-disabled selection without silently enabling every endpoint', async () => {
    await saveLibroRpcEndpoints(LIBRO_WORLD_CHAIN_RPC_URLS.map((url) => ({ url, enabled: false })))
    await expect(enabledLibroRpcUrls()).resolves.toEqual([LIBRO_WORLD_CHAIN_RPC_URLS[0]])
  })

  it('discards malformed stored entries', async () => {
    store[RPC_SETTINGS_KEY] = [{ url: 'https://custom.example' }, 'nonsense', { url: 5, enabled: true }]
    await expect(loadLibroRpcEndpoints()).resolves.toEqual(
      LIBRO_WORLD_CHAIN_RPC_URLS.map((url) => ({ url, enabled: true }))
    )
  })

  it('accepts https endpoints and rejects anything else', () => {
    expect(normalizeLibroRpcUrl('  https://rpc.example/path/  ')).toBe('https://rpc.example/path')
    expect(() => normalizeLibroRpcUrl('http://rpc.example')).toThrow('https')
    expect(() => normalizeLibroRpcUrl('rpc.example')).toThrow('valid URL')
    expect(() => normalizeLibroRpcUrl('   ')).toThrow('Enter an RPC URL')
  })

  it('derives the host permission an added endpoint needs', () => {
    expect(libroRpcOriginPattern('https://rpc.example/v1/key')).toBe('https://rpc.example/*')
  })

  it('knows which endpoints are built in', () => {
    expect(isDefaultLibroRpcUrl(LIBRO_WORLD_CHAIN_RPC_URLS[0])).toBe(true)
    expect(isDefaultLibroRpcUrl('https://custom.example')).toBe(false)
  })
})
