import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const tokens = vi.hoisted(() => ({ getLibroAccessToken: vi.fn() }))
vi.mock('./token-store', () => tokens)

const fetcher = vi.fn<typeof fetch>()
const methods = () => fetcher.mock.calls.map(([, options]) => JSON.parse(String(options?.body)).method)

describe('server Libro MCP reuse', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('LIBRO_SERVICE_URL', 'https://libro.test')
    vi.stubEnv('LIBRO_OAUTH_CLIENT_ID', 'memorioso')
    vi.stubEnv('LIBRO_OAUTH_CLIENT_SECRET', 'service-secret')
    tokens.getLibroAccessToken.mockReset().mockImplementation(async (id) => `token-${id}`)
    fetcher.mockReset().mockImplementation(async (_url, options) => {
      const rpc = JSON.parse(String(options?.body))
      if (rpc.method === 'notifications/initialized') return new Response(null, { status: 202 })
      return Response.json({ jsonrpc: '2.0', id: rpc.id,
        result: rpc.method === 'initialize' ? { protocolVersion: '2025-06-18' } : { structuredContent: { id: '1' } } })
    })
    vi.stubGlobal('fetch', fetcher)
  })
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers() })

  it('initializes once for concurrent and subsequent public reads', async () => {
    const client = await import('./client')
    await Promise.all([client.getServicePublication('1'), client.getServicePublication('2')])
    await client.getServicePublication('3')
    expect(methods()).toEqual(['initialize', 'notifications/initialized', 'tools/call', 'tools/call', 'tools/call'])
  })

  it('isolates public, service, user, and rotated credentials', async () => {
    const client = await import('./client')
    await client.getServicePublication('1')
    await client.listServicePublications({ limit: 5, offset: 0, kind: 'article' })
    await client.serviceUserRequest(1, undefined, 'whoami')
    await client.serviceUserRequest(2, undefined, 'whoami')
    await client.serviceUserRequest(1, undefined, 'whoami')
    tokens.getLibroAccessToken.mockResolvedValue('rotated-token')
    await client.serviceUserRequest(1, undefined, 'whoami')
    const initializations = fetcher.mock.calls.filter(([, options]) => JSON.parse(String(options?.body)).method === 'initialize')
    expect(initializations.map(([, options]) => new Headers(options?.headers).get('Authorization')))
      .toEqual([null, 'Service memorioso.service-secret', 'Bearer token-1', 'Bearer token-2', 'Bearer rotated-token'])
  })

  it('never replays a failed mutation, and reconnects on the next explicit call', async () => {
    const client = await import('./client')
    const transport = fetcher.getMockImplementation()!
    let fail = true
    fetcher.mockImplementation(async (url, options) => {
      if (JSON.parse(String(options?.body)).method === 'tools/call' && fail) {
        fail = false
        throw new Error('Response lost')
      }
      return transport(url, options)
    })
    await expect(client.serviceUserRequest(1, undefined, 'create_human_publication')).rejects.toThrow('could not be reached')
    expect(methods()).toEqual(['initialize', 'notifications/initialized', 'tools/call'])
    await client.serviceUserRequest(1, undefined, 'publication_status')
    expect(methods()).toEqual(['initialize', 'notifications/initialized', 'tools/call', 'initialize', 'notifications/initialized', 'tools/call'])
  })

  it('expires idle clients and bounds the credential cache', async () => {
    vi.useFakeTimers()
    const client = await import('./client')
    await client.serviceUserRequest(1, undefined, 'whoami')
    vi.setSystemTime(Date.now() + 5 * 60_000)
    await client.serviceUserRequest(1, undefined, 'whoami')
    expect(methods().filter((method) => method === 'initialize')).toHaveLength(2)
    for (let id = 2; id <= 33; id++) await client.serviceUserRequest(id, undefined, 'whoami')
    await client.serviceUserRequest(1, undefined, 'whoami')
    expect(methods().filter((method) => method === 'initialize')).toHaveLength(35)
  })
})
