// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { completeMobileFlow } from './mobile-complete'
import { callbackUrl, clearMobileFlows, readMobileFlow, safeReturnPath, saveMobileFlow, type MobileFlow } from './mobile-store'

const id = '12345678-1234-4123-8123-123456789abc'
const fetcher = vi.fn()
const makeFlow = (): MobileFlow => ({ version: 1, id, expiresAt: Date.now() + 300_000, returnPath: '/draft/123',
  config: { app_id: 'app_test', rp_context: { rp_id: 'rp_test', nonce: 'nonce', signature: 'sig', created_at: 1, expires_at: 2 } },
  signalHashes: {}, operation: { kind: 'signing', capability: 'cap' },
  result: { protocol_version: '4.0', nonce: 'nonce', session_id: 'session_test', environment: 'staging', responses: [] },
  connectorURI: 'https://world.org/verify?k=secret',
})

beforeEach(() => { localStorage.clear(); fetcher.mockReset(); vi.stubGlobal('fetch', fetcher) })
afterEach(() => vi.unstubAllGlobals())

describe('durable mobile completion', () => {
  it('retains the proof when a successful HTTP response lacks a prepared registration', async () => {
    const flow = makeFlow()
    saveMobileFlow(flow)
    fetcher.mockResolvedValue(Response.json({}))
    await expect(completeMobileFlow(flow, 'https://memorioso.xyz')).rejects.toThrow('prepared registration')
    expect(readMobileFlow(id)?.result).toEqual(flow.result)
    expect(readMobileFlow(id)?.prepared).toBeUndefined()
  })
  it('checkpoints prepare and broadcast, then retries only finalization after a reload', async () => {
    const flow = makeFlow()
    fetcher.mockResolvedValueOnce(Response.json({ registrationId: 'reg' }))
      .mockResolvedValueOnce(Response.json({ transactionHash: '0xabc' }))
      .mockRejectedValueOnce(new Error('offline'))
    await expect(completeMobileFlow(flow, 'https://memorioso.xyz')).rejects.toThrow('offline')
    const restored = readMobileFlow(id)!
    expect(restored.prepared).toEqual({ registrationId: 'reg', transactionHash: '0xabc' })
    expect(restored.result).toBeUndefined()
    expect(restored.connectorURI).toBeUndefined()
    expect(restored.expiresAt).toBeGreaterThan(Date.now() + 300_000)
    fetcher.mockReset().mockResolvedValue(Response.json({ publicationId: 'pub' }))
    await completeMobileFlow(restored, 'https://memorioso.xyz')
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0][0]).toBe('/api/libro/browser/api/v1/signing/cap/finalize')
    expect(readMobileFlow(id)?.completed?.message).toContain('published')
    expect(readMobileFlow(id)).not.toHaveProperty('operation')
    expect(readMobileFlow(id)).not.toHaveProperty('config')
  })

  it('keeps failed login proofs for retry and never treats a callback as authentication', async () => {
    const flow = makeFlow()
    flow.operation = { kind: 'login', handle: 'alice', intent: 'login', destination: '//evil.example' }
    saveMobileFlow(flow)
    fetcher.mockResolvedValueOnce(Response.json({ success: false, message: 'Invalid proof' }, { status: 400 }))
    await expect(completeMobileFlow(flow, 'https://memorioso.xyz')).rejects.toThrow('Invalid proof')
    expect(readMobileFlow(id)?.completed).toBeUndefined()
    fetcher.mockResolvedValueOnce(Response.json({ success: true, authenticated: true }))
    await completeMobileFlow(readMobileFlow(id)!, 'https://memorioso.xyz')
    expect(readMobileFlow(id)?.completed?.destination).toBe('/')
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ payload: flow.result, handle: 'alice', intent: 'login' })
  })

  it('uses the legacy challenge and relayer for draft publishing', async () => {
    const flow = makeFlow()
    flow.operation = { kind: 'draft', draftId: 'draft', challengeId: 'challenge', publicationKind: 'short' }
    fetcher.mockResolvedValueOnce(Response.json({ success: true, registrationId: 'reg' }))
      .mockResolvedValueOnce(Response.json({ success: true, transactionHash: '0xabc' }))
      .mockResolvedValueOnce(Response.json({ success: true, publicationId: 'pub' }))
    await completeMobileFlow(flow, 'https://memorioso.xyz')
    expect(JSON.parse(fetcher.mock.calls[0][1].body).challengeId).toBe('challenge')
    expect(JSON.parse(fetcher.mock.calls[2][1].body).submissionMethod).toBe('memorioso_relayer')
    expect(readMobileFlow(id)?.completed?.destination).toBe('/short/pub?signed=1')
  })

  it('expires bridge secrets, clears them on sign-out, and keeps callback links free of credentials', () => {
    const flow = makeFlow()
    saveMobileFlow({ ...flow, expiresAt: Date.now() - 1 })
    expect(readMobileFlow(id)).toBeNull()
    expect(localStorage.length).toBe(0)
    saveMobileFlow(flow)
    clearMobileFlows()
    expect(readMobileFlow(id)).toBeNull()
    expect(callbackUrl(id, 'https://memorioso.xyz')).toBe(`https://memorioso.xyz/world-id/return?flow=${id}`)
    expect(safeReturnPath('javascript:alert(1)', 'https://memorioso.xyz')).toBe('/')
    expect(safeReturnPath('/world-id/return?flow=x', 'https://memorioso.xyz')).toBe('/')
  })
})
