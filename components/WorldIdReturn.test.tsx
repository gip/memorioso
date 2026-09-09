// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorldIdReturn } from './WorldIdReturn'
import { readMobileFlow, saveMobileFlow, type MobileFlow } from '@/lib/world-id/mobile-store'
import { createMobileRequest, pollMobileRequest } from '@/lib/world-id/mobile-bridge'
import { completeMobileFlow } from '@/lib/world-id/mobile-complete'

vi.mock('@/lib/world-id/mobile-bridge', () => ({ createMobileRequest: vi.fn(), pollMobileRequest: vi.fn() }))
vi.mock('@/lib/world-id/mobile-complete', () => ({ completeMobileFlow: vi.fn() }))

const id = '12345678-1234-4123-8123-123456789abc'
let root: Root
let container: HTMLDivElement
let locked = false
const saved = (): MobileFlow => ({ version: 1, id, expiresAt: Date.now() + 300_000, returnPath: '/',
  config: { app_id: 'app_test', rp_context: { rp_id: 'rp_test', nonce: 'nonce', signature: 'sig', created_at: 1, expires_at: 2 } },
  signalHashes: {}, operation: { kind: 'identity', handle: 'alice', intent: 'login' },
  connectorURI: 'https://world.org/verify?i=saved-request&k=saved-key',
})
beforeEach(() => {
  vi.stubGlobal('React', React)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: async (_name: string, _options: unknown, callback: (lock: object | null) => Promise<void>) => {
    if (locked) return callback(null)
    locked = true
    try { await callback({}) } finally { locked = false }
  } } })
  window.history.replaceState(null, '', `/world-id/return?flow=${id}&success=true&proof=fake`)
  localStorage.clear()
  vi.mocked(createMobileRequest).mockReset()
  vi.mocked(pollMobileRequest).mockReset().mockResolvedValue(null)
  vi.mocked(completeMobileFlow).mockReset()
  vi.spyOn(window.location, 'assign').mockImplementation(() => undefined)
  vi.spyOn(window.location, 'replace').mockImplementation(() => undefined)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('mobile return page', () => {
  it('resumes the saved request on reload and focus, ignoring callback success/proof parameters', async () => {
    saveMobileFlow(saved())
    await act(async () => root.render(<WorldIdReturn />))
    expect(createMobileRequest).not.toHaveBeenCalled()
    expect(pollMobileRequest).toHaveBeenCalledTimes(1)
    expect(completeMobileFlow).not.toHaveBeenCalled()
    expect(container.querySelector('a')).toBeNull()
    expect(window.location.assign).not.toHaveBeenCalled()
    await act(async () => { window.dispatchEvent(new Event('focus')) })
    expect(pollMobileRequest).toHaveBeenCalledTimes(2)
  })

  it('automatically opens the saved connector once and resumes on return without reopening World App', async () => {
    saveMobileFlow(saved())
    window.history.replaceState(null, '', `/world-id/return?flow=${id}&launch=1`)
    await act(async () => root.render(<React.StrictMode><WorldIdReturn /></React.StrictMode>))
    expect(window.location.assign).toHaveBeenCalledExactlyOnceWith(saved().connectorURI)
    expect(window.location.search).not.toContain('launch')
    expect(container.querySelector('button')).toBeNull()
    await act(async () => { window.dispatchEvent(new Event('pageshow')) })
    expect(pollMobileRequest).toHaveBeenCalled()
    expect(window.location.assign).toHaveBeenCalledTimes(1)
  })

  it('offers a delayed manual fallback if the browser does not open World App', async () => {
    vi.useFakeTimers()
    saveMobileFlow(saved())
    window.history.replaceState(null, '', `/world-id/return?flow=${id}&launch=1`)
    await act(async () => root.render(<WorldIdReturn />))
    expect(container.querySelector('a')).toBeNull()
    await act(async () => { await vi.advanceTimersByTimeAsync(4000) })
    expect(container.querySelector('a')?.href).toBe(saved().connectorURI)
  })

  it.each([false, true])('automatically returns to the destination, including a previously completed flow (%s)', async (alreadyCompleted) => {
    const completed = { message: 'You are signed in.', destination: '/draft/123' }
    saveMobileFlow({ ...saved(), ...(alreadyCompleted ? { completed } : {}) })
    vi.mocked(pollMobileRequest).mockResolvedValue({ protocol_version: '4.0', nonce: 'nonce', environment: 'staging', session_id: 'session_test', responses: [] })
    vi.mocked(completeMobileFlow).mockImplementation(async (flow) => {
      saveMobileFlow({ ...flow, completed })
    })
    await act(async () => root.render(<WorldIdReturn />))
    expect(window.location.replace).toHaveBeenCalledExactlyOnceWith('/draft/123')
    expect(completeMobileFlow).toHaveBeenCalledTimes(alreadyCompleted ? 0 : 1)
    expect(container.textContent).not.toContain('Continue')
  })

  it('does not create a replacement proof when an unknown or expired callback arrives', async () => {
    saveMobileFlow({ ...saved(), expiresAt: Date.now() - 1 })
    await act(async () => root.render(<WorldIdReturn />))
    expect(createMobileRequest).not.toHaveBeenCalled()
    expect(pollMobileRequest).not.toHaveBeenCalled()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('expired')
  })

  it('releases a pending bridge read on backgrounding and resumes without reporting cancellation as failure', async () => {
    saveMobileFlow(saved())
    vi.mocked(pollMobileRequest).mockImplementationOnce((_flow, signal) => new Promise((_resolve, reject) => {
      signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
    }))
    await act(async () => root.render(<WorldIdReturn />))
    expect(locked).toBe(true)
    await act(async () => { window.dispatchEvent(new Event('pagehide')) })
    expect(locked).toBe(false)
    expect(container.querySelector('[role="alert"]')).toBeNull()
    await act(async () => { window.dispatchEvent(new Event('pageshow')) })
    expect(pollMobileRequest).toHaveBeenCalledTimes(2)
  })

  it('serializes two tabs and observes the completed receipt without submitting twice', async () => {
    saveMobileFlow(saved())
    vi.mocked(pollMobileRequest).mockResolvedValue({ protocol_version: '4.0', nonce: 'nonce', environment: 'staging', session_id: 'session_test', responses: [] })
    vi.mocked(completeMobileFlow).mockImplementation(async (flow) => {
      flow.completed = { message: 'Done' }
      saveMobileFlow(flow)
    })
    await act(async () => root.render(<><WorldIdReturn /><WorldIdReturn /></>))
    await act(async () => { window.dispatchEvent(new Event('focus')) })
    expect(completeMobileFlow).toHaveBeenCalledTimes(1)
    expect(readMobileFlow(id)?.completed).toEqual({ message: 'Done' })
    expect(container.textContent).toContain('Done')
  })
})
