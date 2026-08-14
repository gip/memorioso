// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const dialogState = vi.hoisted(() => ({
  sessionProps: null as Record<string, unknown> | null,
}))

vi.mock('./world-id-dialog', () => ({
  WorldIdSessionDialog: (props: Record<string, unknown>) => {
    dialogState.sessionProps = props
    return null
  },
  WorldIdRequestDialog: () => null,
}))

import { App, isValidHandle, normalizeHandle } from './sidepanel'

const rpContext = {
  rp_id: 'rp_1234567890abcdef',
  nonce: 'nonce-1',
  created_at: 1_775_000_000,
  expires_at: 1_775_000_300,
  signature: '0xsigned',
}

type StorageListener = (changes: Record<string, { newValue?: unknown }>, areaName: string) => void

let root: Root
let container: HTMLDivElement
let runtimeMock: ReturnType<typeof vi.fn>
let storageListeners: StorageListener[]

async function renderApp(): Promise<void> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root.render(<App />)
    await Promise.resolve()
  })
}

async function changeInput(selector: string, value: string): Promise<void> {
  const input = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!
  await act(async () => {
    const prototype = input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function finishHandleLookup(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(400)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  dialogState.sessionProps = null
  storageListeners = []
  runtimeMock = vi.fn(async (message: Record<string, unknown>) => {
    if (message.type === 'LIBRO_GET_SIGNING_STATE') {
      return {
        success: true,
        session: null,
        capture: { tabId: 4, text: 'Captured essay', canReplace: true },
        job: null,
        autoCapture: null,
        followPages: false,
      }
    }
    throw new Error(`Unexpected extension message: ${String(message.type)}`)
  })
  vi.stubGlobal('chrome', {
    runtime: { sendMessage: runtimeMock },
    storage: {
      onChanged: {
        addListener: vi.fn((listener: StorageListener) => storageListeners.push(listener)),
        removeListener: vi.fn(),
      },
    },
  })
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(async () => {
  if (root) {
    await act(async () => root.unmount())
  }
  document.body.replaceChildren()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('extension author onboarding', () => {
  it('normalizes and validates handles consistently with Memorioso', () => {
    expect(normalizeHandle(' New_Writer ')).toBe('new_writer')
    expect(isValidHandle('new_writer')).toBe(true)
    expect(isValidHandle('No Spaces')).toBe(false)
  })

  it('creates an available author and preserves captured text for signing', async () => {
    runtimeMock.mockImplementation(async (message: Record<string, unknown>) => {
      if (message.type === 'LIBRO_GET_SIGNING_STATE') {
        return {
          success: true,
          session: null,
          capture: { tabId: 4, text: 'Captured essay', canReplace: true },
          job: null,
        }
      }
      if (message.type === 'LIBRO_HANDLE_LOOKUP') {
        return { success: true, handle: 'new_writer', valid: true, exists: false, canLogin: false }
      }
      if (message.type === 'LIBRO_AUTH_CONTEXT') {
        return {
          success: true,
          intent: 'signup',
          attemptId: 'attempt-1',
          appId: 'app_424563557eea16567fdb5655c9ee742e',
          environment: 'production',
          rpContext,
          existingSessionId: null,
          allowedCredentials: ['proof_of_human'],
        }
      }
      if (message.type === 'LIBRO_AUTH_VERIFY') {
        return {
          success: true,
          created: true,
          expiresAt: '2099-01-01T00:00:00.000Z',
          user: { id: 9, subject: 'world-id-session:new', handle: 'new_writer' },
          author: { id: 'author-9', name: 'New Writer', handle: 'new_writer', bio: 'Writes essays.' },
        }
      }
      throw new Error(`Unexpected extension message: ${String(message.type)}`)
    })

    await renderApp()
    await changeInput('#handle', ' New_Writer ')
    await finishHandleLookup()

    expect(container.textContent).toContain('@new_writer is available.')
    expect(container.querySelector('#name')).not.toBeNull()
    expect(container.querySelector('#bio')).not.toBeNull()

    await changeInput('#name', '  New Writer  ')
    await changeInput('#bio', '  Writes essays.  ')
    await act(async () => {
      container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await Promise.resolve()
    })

    expect(dialogState.sessionProps?.existing_session_id).toBeUndefined()
    expect(runtimeMock).toHaveBeenCalledWith(expect.objectContaining({
      type: 'LIBRO_AUTH_CONTEXT',
      handle: 'new_writer',
      intent: 'signup',
    }))

    await act(async () => {
      const verify = dialogState.sessionProps?.handleVerify as (result: Record<string, unknown>) => Promise<void>
      await verify({ session_id: 'session_new' })
    })

    expect(runtimeMock).toHaveBeenCalledWith(expect.objectContaining({
      type: 'LIBRO_AUTH_VERIFY',
      profile: {
        handle: 'new_writer',
        name: 'New Writer',
        bio: 'Writes essays.',
      },
    }))
    expect(container.textContent).toContain('Created @new_writer')
    expect(container.textContent).toContain('Connected as @new_writer')
    expect(container.textContent).toContain('Review text')
    expect(container.querySelector<HTMLTextAreaElement>('section textarea')?.value).toBe('Captured essay')
  })

  it('retains existing-handle login and connects an existing author discovered during signup', async () => {
    let lookupMode: 'login' | 'signup' = 'login'
    runtimeMock.mockImplementation(async (message: Record<string, unknown>) => {
      if (message.type === 'LIBRO_GET_SIGNING_STATE') {
        return {
          success: true,
          session: null,
          capture: { tabId: 4, text: 'Captured essay', canReplace: true },
          job: null,
        }
      }
      if (message.type === 'LIBRO_HANDLE_LOOKUP') {
        return lookupMode === 'login'
          ? { success: true, handle: 'ada', valid: true, exists: true, canLogin: true }
          : { success: true, handle: 'other', valid: true, exists: false, canLogin: false }
      }
      if (message.type === 'LIBRO_AUTH_CONTEXT') {
        return {
          success: true,
          intent: message.intent,
          attemptId: 'attempt-2',
          appId: 'app_424563557eea16567fdb5655c9ee742e',
          environment: 'production',
          rpContext,
          existingSessionId: message.intent === 'login' ? `session_${'a'.repeat(128)}` : null,
          allowedCredentials: ['proof_of_human'],
        }
      }
      if (message.type === 'LIBRO_AUTH_VERIFY') {
        return {
          success: true,
          created: false,
          expiresAt: '2099-01-01T00:00:00.000Z',
          user: { id: 7, subject: 'world-id-session:ada', handle: 'ada' },
          author: { id: 'author-1', name: 'Ada', handle: 'ada', bio: 'Existing bio.' },
        }
      }
      throw new Error(`Unexpected extension message: ${String(message.type)}`)
    })

    await renderApp()
    await changeInput('#handle', 'ADA')
    await finishHandleLookup()
    expect(container.textContent).toContain('@ada exists.')
    expect(container.querySelector('#name')).toBeNull()

    await act(async () => {
      container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await Promise.resolve()
    })
    expect(dialogState.sessionProps?.existing_session_id).toBe(`session_${'a'.repeat(128)}`)
    expect(runtimeMock).toHaveBeenCalledWith(expect.objectContaining({ intent: 'login', handle: 'ada' }))

    await act(async () => {
      const close = dialogState.sessionProps?.onOpenChange as (open: boolean) => void
      close(false)
    })
    lookupMode = 'signup'
    await changeInput('#handle', 'other')
    await finishHandleLookup()
    await changeInput('#name', 'Other Writer')
    await act(async () => {
      container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await Promise.resolve()
    })
    await act(async () => {
      const verify = dialogState.sessionProps?.handleVerify as (result: Record<string, unknown>) => Promise<void>
      await verify({ session_id: 'session_existing' })
    })

    expect(container.textContent).toContain('Connected @ada')
    expect(container.textContent).toContain('Connected as @ada')
    expect(container.querySelector<HTMLTextAreaElement>('section textarea')?.value).toBe('Captured essay')
  })
})

describe('automatic page following', () => {
  const session = {
    user: { id: 7, subject: 'world-id-session:ada', handle: 'ada' },
    expiresAt: '2099-01-01T00:00:00.000Z',
  }

  function pushStorageChange(
    changes: Record<string, { newValue?: unknown }>,
    areaName: 'local' | 'session' = 'session'
  ): Promise<void> {
    return act(async () => {
      storageListeners.forEach((listener) => listener(changes, areaName))
    })
  }

  function mockState(followPages: boolean): void {
    runtimeMock.mockImplementation(async (message: Record<string, unknown>) => {
      if (message.type === 'LIBRO_GET_SIGNING_STATE') {
        return {
          success: true,
          session,
          capture: { tabId: 4, operationId: 'op-1', text: 'Captured essay', canReplace: true },
          job: null,
          autoCapture: null,
          followPages,
        }
      }
      if (message.type === 'LIBRO_AUTH_SESSION') return { success: true, ...session }
      if (message.type === 'LIBRO_SET_AUTO_CAPTURE') {
        return { success: true, autoCapture: { enabled: message.enabled, tabId: 4 } }
      }
      throw new Error(`Unexpected extension message: ${String(message.type)}`)
    })
  }

  function toggle(): HTMLInputElement {
    return container.querySelector<HTMLInputElement>('.follow-toggle input')!
  }

  it('arms the remembered preference on open, then pauses on a local edit and reports a navigation', async () => {
    mockState(true)
    await renderApp()
    await act(async () => { await Promise.resolve() })

    expect(container.textContent).toContain('Review text')
    // Following is armed per panel, so opening it has to re-arm what the preference remembered.
    expect(runtimeMock).toHaveBeenCalledWith({ type: 'LIBRO_SET_AUTO_CAPTURE', enabled: true })
    expect(toggle().checked).toBe(true)
    expect(container.textContent).toContain('Following this page.')

    await pushStorageChange({
      libroSigningCapture: {
        newValue: { tabId: 4, operationId: 'op-2', text: 'From another editor', canReplace: true },
      },
    })
    expect(container.querySelector<HTMLTextAreaElement>('section textarea')?.value).toBe('From another editor')

    await changeInput('section textarea', 'Rewritten by hand')
    await pushStorageChange({
      libroSigningCapture: {
        newValue: { tabId: 4, operationId: 'op-3', text: 'From a third editor', canReplace: true },
      },
    })

    // The panel edit outranks the page, and the pause is visible rather than silent.
    expect(container.querySelector<HTMLTextAreaElement>('section textarea')?.value).toBe('Rewritten by hand')
    expect(container.textContent).toContain('Following paused because you edited here.')

    await pushStorageChange({
      libroAutoCapture: { newValue: { enabled: false, tabId: 4, reason: 'navigated' } },
    }, 'local')
    expect(container.textContent).toContain('Following stopped because the page navigated.')
    expect(toggle().checked).toBe(false)
  })

  it('leaves following off when the preference was turned off, and remembers turning it back on', async () => {
    mockState(false)
    await renderApp()
    await act(async () => { await Promise.resolve() })

    expect(toggle().checked).toBe(false)
    expect(container.textContent).not.toContain('Following this page.')
    expect(runtimeMock).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'LIBRO_SET_AUTO_CAPTURE' }))

    await act(async () => {
      toggle().click()
      await Promise.resolve()
    })

    expect(runtimeMock).toHaveBeenCalledWith({ type: 'LIBRO_SET_AUTO_CAPTURE', enabled: true, remember: true })
    expect(container.textContent).toContain('Following this page.')
  })

  it('counts and enforces the server-normalized 500-character limit', async () => {
    mockState(false)
    await renderApp()
    await act(async () => { await Promise.resolve() })

    await changeInput('section textarea', 'a     b')
    expect(container.textContent).toContain('3 / 500 normalized characters')
    expect(container.querySelector<HTMLButtonElement>('button.primary')?.disabled).toBe(false)

    await changeInput('section textarea', 'x'.repeat(501))
    expect(container.textContent).toContain('501 / 500 normalized characters')
    expect(container.querySelector<HTMLButtonElement>('button.primary')?.disabled).toBe(true)
  })
})

describe('session-bound author signing', () => {
  it('uses the login author and sends no selectable author id', async () => {
    const primary = { id: 'author-1', name: 'Ada', handle: 'ada', bio: null, isPrimary: true }
    const session = {
      user: { id: 7, subject: 'world-id-session:ada', handle: 'ada' },
      author: primary,
      authors: [primary],
      expiresAt: '2099-01-01T00:00:00.000Z',
    }
    runtimeMock.mockImplementation(async (message: Record<string, unknown>) => {
      if (message.type === 'LIBRO_GET_SIGNING_STATE') return {
        success: true,
        session,
        selectedAuthorId: null,
        capture: { tabId: 4, text: 'Captured essay', canReplace: true },
        job: null,
        autoCapture: null,
        followPages: false,
      }
      if (message.type === 'LIBRO_AUTH_SESSION') return { success: true, ...session }
      if (message.type === 'LIBRO_CREATE_SIGNATURE') return {
        success: true,
        job: {
          version: 1,
          draftId: 'draft-2',
          signingId: 'draft-2',
          challengeId: 'challenge-2',
          normalizedText: 'Captured essay',
          author: primary,
          context: { signalText: 'signal' },
          stage: 'proof',
        },
      }
      throw new Error(`Unexpected extension message: ${String(message.type)}`)
    })

    await renderApp()
    await act(async () => { await Promise.resolve() })

    expect(container.textContent).toContain('Publishing as Ada (@ada)')
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button.primary')?.click()
      await Promise.resolve()
    })
    expect(runtimeMock).toHaveBeenCalledWith({
      type: 'LIBRO_CREATE_SIGNATURE',
      text: 'Captured essay',
    })
  })
})
