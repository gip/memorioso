import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from './route'

const fetcher = vi.fn<typeof fetch>()
const context = (operation: string) => ({ params: Promise.resolve({ operation }) })
function request(body: string, authorization?: string) {
  return new Request('https://memorioso.test/api/libro/oauth/token', { method: 'POST', body,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: 'memorioso_session=private; libro_identity_session=private',
      ...(authorization ? { Authorization: authorization } : {}) } })
}
function respond(result: unknown) {
  fetcher.mockImplementation(async (_url, options) => {
    const rpc = JSON.parse(String(options?.body))
    if (rpc.method === 'notifications/initialized') return new Response(null, { status: 202 })
    return Response.json({ jsonrpc: '2.0', id: rpc.id, result: rpc.method === 'initialize'
      ? { protocolVersion: '2025-06-18' } : { structuredContent: result } })
  })
}

beforeEach(() => {
  vi.stubEnv('LIBRO_SERVICE_URL', 'https://libro.test')
  vi.stubGlobal('fetch', fetcher)
  fetcher.mockReset()
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('Memorioso OAuth facade over MCP', () => {
  it('exchanges tokens over MCP while preserving Basic client authentication and stripping cookies', async () => {
    const result = { access_token: 'access', refresh_token: 'refresh', token_type: 'Bearer', expires_in: 900 }
    respond(result)
    const response = await POST(request('grant_type=authorization_code&code=code&client_id=client&code_verifier=verifier', 'Basic Y2xpZW50OnNlY3JldA=='), context('token'))
    expect(await response.json()).toEqual(result)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    for (const [url, options] of fetcher.mock.calls) {
      expect(String(url)).toBe('https://libro.test/mcp')
      const headers = new Headers(options?.headers)
      expect(headers.get('Cookie')).toBeNull()
      expect(headers.get('Authorization')).toBe('Basic Y2xpZW50OnNlY3JldA==')
    }
    expect(JSON.parse(String(fetcher.mock.calls[2][1]?.body)).params).toEqual({ name: 'oauth_token', arguments: {
      form: { grant_type: 'authorization_code', code: 'code', client_id: 'client', code_verifier: 'verifier' },
    } })
  })

  it('registers public clients and returns the required HTTP 201', async () => {
    respond({ client_id: 'public-client' })
    const response = await POST(request(JSON.stringify({ redirect_uris: ['https://client.test/callback'] })), context('register'))
    expect(response.status).toBe(201)
    expect(JSON.parse(String(fetcher.mock.calls[2][1]?.body)).params.name).toBe('oauth_register')
  })

  it('returns an empty success response after MCP revocation', async () => {
    respond({ revoked: true })
    const response = await POST(request('token=token&client_id=client'), context('revoke'))
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('')
  })

  it('retains OAuth error codes without disclosing unrelated server errors', async () => {
    fetcher.mockImplementation(async (_url, options) => {
      const rpc = JSON.parse(String(options?.body))
      if (rpc.method === 'notifications/initialized') return new Response(null, { status: 202 })
      return Response.json({ jsonrpc: '2.0', id: rpc.id, result: rpc.method === 'initialize'
        ? { protocolVersion: '2025-06-18' }
        : { isError: true, structuredContent: { error: { code: 'invalid_grant', message: 'Code expired', status: 400 } } } })
    })
    const response = await POST(request('grant_type=authorization_code'), context('token'))
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'invalid_grant', error_description: 'Code expired' })
  })

  it.each(['health', 'deliver_events', 'authorize'])('rejects operations outside the OAuth facade (%s)', async (operation) => {
    expect((await POST(request(''), context(operation))).status).toBe(404)
    expect(fetcher).not.toHaveBeenCalled()
  })
})
