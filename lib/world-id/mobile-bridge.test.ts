import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { hashSignal } from '@worldcoin/idkit-core'
import { createMobileRequest, pollMobileRequest, signalHashes } from './mobile-bridge'
import type { MobileFlow } from './mobile-store'

const wasmPath = join(dirname(createRequire(import.meta.url).resolve('@worldcoin/idkit-core')), 'idkit_wasm_bg.wasm')
const requestId = '12345678-1234-4123-8123-123456789abc'
const sessionId = `session_${'00'.repeat(32)}01${'00'.repeat(31)}` as const
const protocolResponse = {
  id: 'proof-request', version: 1, session_id: sessionId,
  responses: [{ identifier: 'proof_of_human', issuer_schema_id: 1,
    proof: '00'.repeat(160), session_nullifier: `snil_${'00'.repeat(32)}02${'00'.repeat(31)}`,
    expires_at_min: 1735689600 }],
}

function flow(): MobileFlow {
  return {
    version: 1, id: crypto.randomUUID(), expiresAt: Date.now() + 300_000,
    returnPath: '/', operation: { kind: 'identity', intent: 'signup', handle: 'alice' },
    config: { app_id: 'app_test', environment: 'staging', rp_context: {
      rp_id: 'rp_1234567890abcdef', nonce: `0x${'01'.repeat(32)}`, created_at: 1735689600,
      expires_at: 1735689900, signature: `0x${'00'.repeat(64)}1b`,
    } },
    signalHashes: { proof_of_human: hashSignal('publication-signal') },
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('IDKit mobile bridge recovery with the real 4.2.4 WASM decoder', () => {
  it('preserves the distinction between no login signal and an explicitly empty signal', () => {
    expect(signalHashes({ any: [{ type: 'proof_of_human' }] })).toEqual({})
    expect(signalHashes({ type: 'proof_of_human', signal: '' })).toEqual({ proof_of_human: hashSignal('') })
  })
  it('carries an HTTPS callback in the SDK request and resumes the encrypted response after serialization', async () => {
    let requestBody: { iv: string; payload: string } | undefined
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input)
      if (url.endsWith('.wasm')) return new Response(await readFile(wasmPath), { headers: { 'Content-Type': 'application/wasm' } })
      expect(url).toBe('https://bridge.worldcoin.org/request')
      requestBody = JSON.parse(await (input as Request).text())
      const response = Response.json({ request_id: requestId })
      Object.defineProperty(response, 'url', { value: url })
      return response
    })
    vi.stubGlobal('fetch', fetcher)
    const original = flow()
    original.connectorURI = await createMobileRequest(original, { type: 'proof_of_human', signal: 'publication-signal' }, 'https://memorioso.xyz')
    const saved = JSON.parse(JSON.stringify(original)) as MobileFlow
    const connector = new URL(saved.connectorURI!)
    expect(connector.searchParams.get('return_to')).toBe(`https://memorioso.xyz/world-id/return?flow=${original.id}`)
    const key = await crypto.subtle.importKey('raw', Buffer.from(connector.searchParams.get('k')!, 'base64'), 'AES-GCM', false, ['encrypt', 'decrypt'])
    const outgoing = JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: Buffer.from(requestBody!.iv, 'base64') }, key, Buffer.from(requestBody!.payload, 'base64'),
    )))
    expect(outgoing.return_to_url).toBe(connector.searchParams.get('return_to'))

    const iv = crypto.getRandomValues(new Uint8Array(12))
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(protocolResponse)))
    fetcher.mockImplementation(async (input) => {
      expect(String(input)).toBe(`https://bridge.worldcoin.org/response/${requestId}`)
      return Response.json({ status: 'completed', response: { iv: Buffer.from(iv).toString('base64'), payload: Buffer.from(ciphertext).toString('base64') } })
    })
    const result = await pollMobileRequest(saved)
    expect(result).toMatchObject({ protocol_version: '4.0', session_id: sessionId, nonce: original.config.rp_context.nonce,
      environment: 'staging', responses: [{ identifier: 'proof_of_human', signal_hash: hashSignal('publication-signal'),
        session_nullifier: [`0x${'00'.repeat(32)}`, `0x02${'00'.repeat(31)}`] }] })
    expect(result?.responses[0].proof).toHaveLength(5)
    expect(result).not.toHaveProperty('action')
    saved.config.require_user_presence = true
    await expect(pollMobileRequest(saved)).rejects.toThrow('user_presence_failed')
    saved.config.require_user_presence = false
    const damaged = new Uint8Array(ciphertext)
    damaged[0] ^= 1
    fetcher.mockResolvedValue(Response.json({ status: 'completed', response: { iv: Buffer.from(iv).toString('base64'), payload: Buffer.from(damaged).toString('base64') } }))
    await expect(pollMobileRequest(saved)).rejects.toThrow()
  })

  it('does not accept pending status as proof or allow saved data to choose an arbitrary bridge', async () => {
    const saved = flow()
    saved.connectorURI = `https://world.org/verify?i=${requestId}&k=${encodeURIComponent(Buffer.alloc(32).toString('base64'))}`
    const fetcher = vi.fn().mockResolvedValue(Response.json({ status: 'retrieved' }))
    vi.stubGlobal('fetch', fetcher)
    expect(await pollMobileRequest(saved)).toBeNull()
    saved.connectorURI += '&b=https://example.com'
    await expect(pollMobileRequest(saved)).rejects.toThrow('Invalid saved')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
