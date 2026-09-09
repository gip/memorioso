// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { WorldIdSessionWidget } from './WorldIdSessionWidget'
import { createMobileRequest } from '@/lib/world-id/mobile-bridge'
import { canUseMobileFlow } from '@/lib/world-id/mobile-store'

vi.mock('@/lib/world-id/mobile-store', async (original) => ({ ...await original<object>(), canUseMobileFlow: vi.fn() }))
vi.mock('@/lib/world-id/mobile-bridge', () => ({ createMobileRequest: vi.fn(), signalHashes: () => ({ proof_of_human: 'hashed-signal' }) }))
vi.mock('@worldcoin/idkit', () => ({ IDKitSessionWidget: () => <p>Standard widget</p> }))
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); localStorage.clear() })

it('creates and saves the connector before navigation, without persisting draft titles or original signals', async () => {
  vi.stubGlobal('React', React)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubEnv('NEXT_PUBLIC_APP_URL', window.location.origin)
  vi.mocked(canUseMobileFlow).mockReturnValue(true)
  vi.mocked(createMobileRequest).mockResolvedValue('https://world.org/verify?i=request&k=key')
  const navigate = vi.spyOn(window.location, 'assign').mockImplementation(() => undefined)
  const container = document.createElement('div')
  const root = createRoot(container)
  try {
    await act(async () => root.render(<WorldIdSessionWidget open onOpenChange={() => undefined} onSuccess={() => undefined}
      app_id="app_test" constraints={{ type: 'proof_of_human', signal: '{"title":"Private draft title"}' }}
      rp_context={{ rp_id: 'rp_test', nonce: 'nonce', signature: 'sig', created_at: Date.now() / 1000, expires_at: Date.now() / 1000 + 300 }}
      mobileOperation={{ kind: 'signing', capability: 'cap' }} />))
    expect(createMobileRequest).toHaveBeenCalledTimes(1)
    expect(navigate).toHaveBeenCalledTimes(1)
    const record = localStorage.getItem(Object.keys(localStorage)[0])!
    expect(record).not.toContain('Private draft title')
    expect(record).not.toContain('constraints')
    expect(JSON.parse(record)).toMatchObject({ signalHashes: { proof_of_human: 'hashed-signal' }, connectorURI: 'https://world.org/verify?i=request&k=key' })
    expect(navigate.mock.calls[0][0]).toContain('/world-id/return?flow=')
  } finally { await act(async () => root.unmount()) }
})

it('does not navigate away from another page if request creation finishes after the widget unmounts', async () => {
  vi.stubGlobal('React', React)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubEnv('NEXT_PUBLIC_APP_URL', window.location.origin)
  vi.mocked(canUseMobileFlow).mockReturnValue(true)
  let finish!: (connector: string) => void
  vi.mocked(createMobileRequest).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  const navigate = vi.spyOn(window.location, 'assign').mockImplementation(() => undefined)
  const root = createRoot(document.createElement('div'))
  await act(async () => root.render(<WorldIdSessionWidget open onOpenChange={() => undefined} onSuccess={() => undefined}
    app_id="app_test" constraints={{ type: 'proof_of_human' }}
    rp_context={{ rp_id: 'rp_test', nonce: 'nonce', signature: 'sig', created_at: 1, expires_at: 2 }}
    mobileOperation={{ kind: 'identity', handle: 'alice', intent: 'login' }} />))
  await act(async () => root.unmount())
  await act(async () => finish('https://world.org/verify?i=request&k=key'))
  expect(navigate).not.toHaveBeenCalled()
  expect(localStorage.length).toBe(0)
})
