import { beforeEach, describe, expect, it } from 'vitest'
import {
  AUTO_SCAN_KEY,
  AUTO_SCAN_ORIGINS,
  AUTO_SCAN_SCRIPT_ID,
  autoScanPreference,
  hasAutoScanPermission,
  setAutoScan,
  syncAutoScan,
} from './auto-scan'

let store: Record<string, unknown> = {}
let grantedOrigins: string[] = []
let registered: Array<{ id: string; js: string[]; matches: string[] }> = []

beforeEach(() => {
  store = {}
  grantedOrigins = []
  registered = []
  Object.assign(globalThis, {
    chrome: {
      storage: {
        local: {
          get: async (key: string) => (key in store ? { [key]: store[key] } : {}),
          set: async (values: Record<string, unknown>) => { Object.assign(store, values) },
        },
      },
      permissions: {
        contains: async ({ origins }: { origins: string[] }) =>
          origins.every((origin) => grantedOrigins.includes(origin)),
      },
      scripting: {
        getRegisteredContentScripts: async ({ ids }: { ids: string[] }) =>
          registered.filter((script) => ids.includes(script.id)),
        registerContentScripts: async (scripts: typeof registered) => {
          for (const script of scripts) {
            if (registered.some((existing) => existing.id === script.id)) {
              throw new Error(`Duplicate script ID '${script.id}'`)
            }
            registered.push(script)
          }
        },
        unregisterContentScripts: async ({ ids }: { ids: string[] }) => {
          registered = registered.filter((script) => !ids.includes(script.id))
        },
      },
    },
  })
})

function grantAutoScan(): void {
  grantedOrigins = [...AUTO_SCAN_ORIGINS]
}

describe('automatic page scanning', () => {
  it('is off with nothing registered until it is asked for', async () => {
    await expect(autoScanPreference()).resolves.toBe(false)
    await expect(syncAutoScan()).resolves.toBe(false)
    expect(registered).toHaveLength(0)
  })

  it('registers the content script once permission is granted', async () => {
    grantAutoScan()
    await expect(setAutoScan(true)).resolves.toBe(true)
    expect(registered).toEqual([expect.objectContaining({
      id: AUTO_SCAN_SCRIPT_ID,
      js: ['content.js'],
      matches: AUTO_SCAN_ORIGINS,
    })])
  })

  it('refuses to turn on without the permission it depends on', async () => {
    await expect(hasAutoScanPermission()).resolves.toBe(false)
    await expect(setAutoScan(true)).resolves.toBe(false)
    expect(store[AUTO_SCAN_KEY]).toBe(false)
    expect(registered).toHaveLength(0)
  })

  it('unregisters the content script when it is turned off', async () => {
    grantAutoScan()
    await setAutoScan(true)
    await expect(setAutoScan(false)).resolves.toBe(false)
    expect(registered).toHaveLength(0)
  })

  it('turns itself off when the permission is revoked outside the extension', async () => {
    grantAutoScan()
    await setAutoScan(true)

    grantedOrigins = []
    await expect(syncAutoScan()).resolves.toBe(false)
    expect(store[AUTO_SCAN_KEY]).toBe(false)
    expect(registered).toHaveLength(0)
  })

  it('registers once when the grant and the options page reconcile at the same time', async () => {
    grantAutoScan()
    // registerContentScripts rejects a duplicate id, so an unserialized pair would throw here.
    // The bare syncs enqueue before setAutoScan has written the preference, so they legitimately
    // report off; what must hold is that the settled state is on and registered exactly once.
    const [enabled] = await Promise.all([setAutoScan(true), syncAutoScan(), syncAutoScan()])
    expect(enabled).toBe(true)
    await expect(syncAutoScan()).resolves.toBe(true)
    expect(registered).toHaveLength(1)
  })

  it('leaves a registration in place across a redundant sync', async () => {
    grantAutoScan()
    await setAutoScan(true)
    await syncAutoScan()
    expect(registered).toHaveLength(1)
  })
})
