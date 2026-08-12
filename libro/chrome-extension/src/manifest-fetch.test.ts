import { describe, expect, it, vi } from 'vitest'
import { MAX_MANIFEST_BYTES, resolveTextManifest, validateManifestUrl } from './manifest-fetch'
import { isPrivateNetworkHostname, normalizeManifestOrigin } from './manifest-access'
import type { LibroCandidate } from './shared'

const API_ORIGIN = 'https://www.memorioso.xyz'

function candidate(url: string): LibroCandidate {
  return {
    blockId: 'text-1',
    kind: 'text',
    innerHtml: 'Signed text',
    readableText: 'Signed text',
    snapshotHtml: 'Signed text',
    declaredHash: `0x${'11'.repeat(32)}`,
    manifestId: null,
    manifestText: null,
    manifestUrl: url,
  }
}

describe('manifest network boundary', () => {
  it('rejects private, loopback, link-local, insecure, and credentialed destinations', () => {
    for (const hostname of [
      'localhost', '127.0.0.1', '10.0.0.8', '169.254.1.2', '192.168.1.1',
      '::1', 'fd00::1', 'fe80::1', '::ffff:7f00:1', '::ffff:127.0.0.1',
    ]) {
      expect(isPrivateNetworkHostname(hostname)).toBe(true)
    }
    expect(() => validateManifestUrl('https://127.0.0.1/manifest', API_ORIGIN)).toThrow('private')
    expect(() => validateManifestUrl('http://public.example/manifest', API_ORIGIN)).toThrow('HTTPS')
    expect(() => normalizeManifestOrigin('https://user:secret@public.example')).toThrow('credentials')
    expect(validateManifestUrl(`${API_ORIGIN}/api/manifest`, API_ORIGIN).origin).toBe(API_ORIGIN)
  })

  it('does not fetch an origin until it is explicitly approved', async () => {
    const fetchImpl = vi.fn()
    const result = await resolveTextManifest(candidate('https://publisher.example/manifest'), {
      apiOrigin: API_ORIGIN,
      approvedOrigins: [],
      fetchImpl,
    })
    expect(result.error).toContain('Permission is required')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('accepts only JSON responses and enforces the byte cap while streaming', async () => {
    const wrongType = await resolveTextManifest(candidate('https://publisher.example/manifest'), {
      apiOrigin: API_ORIGIN,
      approvedOrigins: ['https://publisher.example'],
      fetchImpl: async () => new Response('{}', { headers: { 'Content-Type': 'text/plain' } }),
    })
    expect(wrongType.error).toContain('JSON content type')

    const oversized = await resolveTextManifest(candidate('https://publisher.example/manifest'), {
      apiOrigin: API_ORIGIN,
      approvedOrigins: ['https://publisher.example'],
      fetchImpl: async () => new Response(new Uint8Array(MAX_MANIFEST_BYTES + 1), {
        headers: { 'Content-Type': 'application/libro+json' },
      }),
    })
    expect(oversized.error).toContain('too large')
  })

  it('uses no credentials or redirects and times out a stalled request', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      await new Promise<void>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
      })
      return new Response('{}')
    })
    const result = await resolveTextManifest(candidate('https://publisher.example/manifest'), {
      apiOrigin: API_ORIGIN,
      approvedOrigins: ['https://publisher.example'],
      fetchImpl,
      timeoutMs: 1,
    })
    expect(result.error).toContain('timed out')
    expect(fetchImpl).toHaveBeenCalledWith('https://publisher.example/manifest', expect.objectContaining({
      credentials: 'omit',
      redirect: 'error',
    }))
  })

  it('retrieves an approved Libro JSON manifest', async () => {
    const result = await resolveTextManifest(candidate('https://publisher.example/manifest'), {
      apiOrigin: API_ORIGIN,
      approvedOrigins: ['https://publisher.example'],
      fetchImpl: async () => new Response('{"schema":"libro-embed-v1"}', {
        headers: { 'Content-Type': 'application/libro+json; charset=utf-8' },
      }),
    })
    expect(result.manifestText).toBe('{"schema":"libro-embed-v1"}')
  })
})
