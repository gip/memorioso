// @vitest-environment happy-dom
import React, { act, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SigningClient } from './SigningClient'

const widget = vi.hoisted(() => ({ props: null as null | { open: boolean; onOpenChange: (open: boolean) => void } }))
vi.mock('@worldcoin/idkit', () => ({
  CredentialRequest: () => ({}),
  IDKitSessionWidget: (props: typeof widget.props) => { widget.props = props; return null },
}))
vi.mock('@/lib/libro-service/sponsored-transaction', () => ({ sendSponsoredWorldTransaction: vi.fn() }))
vi.mock('@/lib/libro-service/wallet-receipt', () => ({ waitForUserOperation: vi.fn() }))

let container: HTMLDivElement
let root: Root
const fetcher = vi.fn()
const context = { appId: 'app_test', environment: 'staging', rpContext: {}, signalText: '{}', existingSessionId: 'session_test' }

beforeEach(() => {
  vi.stubGlobal('React', React)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('fetch', fetcher)
  fetcher.mockReset()
  widget.props = null
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

async function mount() {
  await act(async () => { root.render(<StrictMode><SigningClient capability="test-capability" /></StrictMode>) })
}

describe('automatic publication signing', () => {
  it('opens World ID on mount without a button and starts once under Strict Mode', async () => {
    fetcher.mockResolvedValue(Response.json(context))
    await mount()
    expect(fetcher).toHaveBeenCalledExactlyOnceWith('/api/libro/browser/api/v1/signing/test-capability/context', { method: 'POST' })
    expect(widget.props?.open).toBe(true)
    expect(container.querySelector('button')).toBeNull()
  })
  it('automatically resumes a prepared registration and finalizes without another proof', async () => {
    fetcher.mockResolvedValueOnce(Response.json({ prepared: { registrationId: 'registration', transactionHash: '0xabc', submissionMethod: 'libro_relayer' } }))
      .mockResolvedValueOnce(Response.json({ publicationId: 'publication' }))
    await mount()
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher.mock.calls[1][0]).toBe('/api/libro/browser/api/v1/signing/test-capability/finalize')
    expect(widget.props).toBeNull()
    expect(container.textContent).toContain('signed and published')
    expect(container.querySelector('button')).toBeNull()
  })
  it('shows retry only after an error and restarts when requested', async () => {
    fetcher.mockRejectedValueOnce(new Error('Service unavailable')).mockResolvedValueOnce(Response.json(context))
    await mount()
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Service unavailable')
    await act(async () => { container.querySelector('button')!.click() })
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(widget.props?.open).toBe(true)
    expect(container.querySelector('button')).toBeNull()
  })
  it('does not automatically reopen verification after cancellation', async () => {
    fetcher.mockResolvedValue(Response.json(context))
    await mount()
    await act(async () => { widget.props!.onOpenChange(false) })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(widget.props?.open).toBe(false)
    expect(container.querySelector('button')?.textContent).toBe('Try again')
  })
})
