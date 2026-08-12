import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  isContentNotification,
  isTrustedContentSender,
  isTrustedExtensionPageSender,
  restrictExtensionStorageAccess,
} from './security'

const localAccess = vi.fn()
const syncAccess = vi.fn()
const sessionAccess = vi.fn()

beforeEach(() => {
  localAccess.mockReset().mockResolvedValue(undefined)
  syncAccess.mockReset().mockResolvedValue(undefined)
  sessionAccess.mockReset().mockResolvedValue(undefined)
  Object.assign(globalThis, {
    chrome: {
      runtime: { id: 'extension-id' },
      storage: {
        local: { setAccessLevel: localAccess },
        sync: { setAccessLevel: syncAccess },
        session: { setAccessLevel: sessionAccess },
      },
    },
  })
})

describe('extension trust boundaries', () => {
  it('removes local and synced storage from content-script contexts', async () => {
    await restrictExtensionStorageAccess()
    expect(localAccess).toHaveBeenCalledWith({ accessLevel: 'TRUSTED_CONTEXTS' })
    expect(syncAccess).toHaveBeenCalledWith({ accessLevel: 'TRUSTED_CONTEXTS' })
    expect(sessionAccess).toHaveBeenCalledWith({ accessLevel: 'TRUSTED_CONTEXTS' })
  })

  it('accepts privileged requests only from this extension\'s own pages', () => {
    expect(isTrustedExtensionPageSender({
      id: 'extension-id',
      url: 'chrome-extension://extension-id/sidepanel.html',
      origin: 'chrome-extension://extension-id',
    }, 'extension-id')).toBe(true)
    expect(isTrustedExtensionPageSender({
      id: 'extension-id',
      tab: { id: 7 } as chrome.tabs.Tab,
      url: 'https://hostile.example/',
    }, 'extension-id')).toBe(false)
    expect(isTrustedExtensionPageSender({
      id: 'other-extension',
      url: 'chrome-extension://other-extension/popup.html',
    }, 'extension-id')).toBe(false)
  })

  it('accepts notifications only from this extension in a top-level tab', () => {
    expect(isContentNotification('LIBRO_CAPTURE_UPDATE')).toBe(true)
    expect(isContentNotification('LIBRO_AUTH_VERIFY')).toBe(false)
    expect(isTrustedContentSender({
      id: 'extension-id',
      frameId: 0,
      tab: { id: 7 } as chrome.tabs.Tab,
    }, 'extension-id')).toBe(true)
    expect(isTrustedContentSender({
      id: 'extension-id',
      frameId: 2,
      tab: { id: 7 } as chrome.tabs.Tab,
    }, 'extension-id')).toBe(false)
  })
})
