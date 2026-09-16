import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createLibroMcpClient } from '@libro/core'

const mocks = vi.hoisted(() => ({ issue: vi.fn(), exchange: vi.fn(), refresh: vi.fn(), revoke: vi.fn(), verifiedAt: new Date() }))
vi.mock('@/lib/db', () => ({ pool: { query: async () => ({ rows: [{ verified_at: mocks.verifiedAt }] }) } }))
vi.mock('@/lib/session', () => ({ browserIdentityId: async () => 'owner', identitySessionCookieOptions: {
  maxAge: 86400, path: '/', httpOnly: true, sameSite: 'lax', secure: true,
} }))
vi.mock('next/headers', async () => {
  const { currentMcpRequest } = await import('@/lib/mcp/context')
  return { cookies: async () => ({ get: (name: string) => {
    const cookie = currentMcpRequest().headers.get('cookie')?.split('; ').find((part) => part.startsWith(`${name}=`))
    return cookie ? { value: cookie.slice(name.length + 1) } : undefined
  } }) }
})
vi.mock('@/lib/oauth', async (original) => ({ ...await original<object>(),
  getClient: async () => ({ id: 'client', redirect_uris: ['https://client.test/callback'], resource: 'https://libro.test/mcp' }),
  issueAuthorizationCode: mocks.issue,
  exchangeAuthorizationCode: mocks.exchange,
  exchangeRefreshToken: mocks.refresh,
  revokeOAuthToken: mocks.revoke,
}))

import { POST } from './route'

function client(origin = 'https://libro.test', authorization?: string) {
  const cookies = new Map<string, string>()
  const responses: Response[] = []
  return { cookies, responses, mcp: createLibroMcpClient('https://libro.test/mcp', {
    headers: { Origin: origin, ...(authorization ? { Authorization: authorization } : {}) },
    fetch: async (url, options) => {
      const headers = new Headers(options?.headers)
      if (cookies.size) headers.set('Cookie', [...cookies].map(([key, value]) => `${key}=${value}`).join('; '))
      const response = await POST(new Request(String(url), { ...options, headers }))
      for (const cookie of response.headers.getSetCookie()) {
        const pair = cookie.split(';')[0]
        const separator = pair.indexOf('=')
        cookies.set(pair.slice(0, separator), pair.slice(separator + 1))
      }
      responses.push(response.clone())
      return response
    },
  }) }
}
const query = () => new URLSearchParams({ client_id: 'client', response_type: 'code', redirect_uri: 'https://client.test/callback',
  resource: 'https://libro.test/mcp', code_challenge: 'a'.repeat(43), code_challenge_method: 'S256', scope: 'profile publish', state: 'bound-state' }).toString()

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('LIBRO_SERVICE_URL', 'https://libro.test')
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://memorioso.test')
  vi.stubEnv('LIBRO_MCP_STATE_SECRET', 'test-mcp-secret-at-least-thirty-two-bytes')
  mocks.verifiedAt = new Date()
  mocks.issue.mockResolvedValue('single-use-code')
})

describe('OAuth over Libro MCP', () => {
  it('delivers the binding cookie, completes authorization, and reports the Memorioso issuer', async () => {
    const value = client()
    const context = await value.mcp.callTool<{ consent: string }>('oauth_authorization_context', { query: query() })
    expect(value.cookies.get('libro_oauth_consent')).toBeTruthy()
    const result = await value.mcp.callTool<{ redirectUrl: string }>('oauth_authorize', { consent: context.consent })
    const url = new URL(result.redirectUrl)
    expect(url.origin).toBe('https://client.test')
    expect(url.searchParams.get('iss')).toBe('https://memorioso.test/libro')
    expect(url.searchParams.get('state')).toBe('bound-state')
    expect(url.searchParams.get('code')).toBe('single-use-code')
    await expect(value.mcp.callTool('oauth_authorize', { consent: context.consent })).rejects.toMatchObject({ code: 'invalid_request' })
    expect(mocks.issue).toHaveBeenCalledTimes(1)
  })

  it('rejects cross-origin authorization and a missing binding cookie', async () => {
    await expect(client('https://attacker.test').mcp.callTool('oauth_authorization_context', { query: query() })).rejects.toMatchObject({ status: 403 })
    const value = client()
    const context = await value.mcp.callTool<{ consent: string }>('oauth_authorization_context', { query: query() })
    value.cookies.clear()
    await expect(value.mcp.callTool('oauth_authorize', { consent: context.consent })).rejects.toMatchObject({ code: 'invalid_request' })
    expect(mocks.issue).not.toHaveBeenCalled()
  })

  it('preserves PKCE validation and recent-verification requirements', async () => {
    const invalid = new URLSearchParams(query())
    invalid.set('code_challenge_method', 'plain')
    await expect(client().mcp.callTool('oauth_authorization_context', { query: invalid.toString() })).rejects.toMatchObject({ code: 'invalid_request' })
    mocks.verifiedAt = new Date(Date.now() - 25 * 3600000)
    const value = client()
    await expect(value.mcp.callTool('oauth_authorization_context', { query: query() })).rejects.toMatchObject({ status: 401 })
    expect(value.responses[2].headers.get('WWW-Authenticate')).toContain('https://memorioso.test/.well-known/oauth-protected-resource/libro')
  })

  it('passes the actual transport credentials and grant to existing token verification', async () => {
    mocks.exchange.mockResolvedValue({ accessToken: 'access', refreshToken: 'refresh', scope: 'profile' })
    const value = client('https://libro.test', 'Basic Y2xpZW50OnNlY3JldA==')
    expect(await value.mcp.callTool('oauth_token', { form: { grant_type: 'authorization_code', code: 'bound-code', code_verifier: 'verifier' } }))
      .toMatchObject({ access_token: 'access', refresh_token: 'refresh' })
    const [request, form] = mocks.exchange.mock.calls[0]
    expect(request.headers.get('Authorization')).toBe('Basic Y2xpZW50OnNlY3JldA==')
    expect(form.get('code_verifier')).toBe('verifier')
    expect(mocks.refresh).not.toHaveBeenCalled()
  })
})
