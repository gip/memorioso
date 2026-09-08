import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, POST } from './route'

const fetcher = vi.fn()
function request(path: string, method = 'GET', origin = 'https://memorioso.test') {
  return new NextRequest(`https://memorioso.test/api/libro/browser/${path}`, { method,
    headers: { Origin: origin, Cookie: 'memorioso_session=private; libro_identity_session=identity; libro_oauth_consent=nonce',
      Authorization: 'Bearer private-token', 'Content-Type': 'application/json' },
    ...(method === 'GET' ? {} : { body: '{}' }) })
}
function context(path: string) { return { params: Promise.resolve({ path: path.split('/') }) } }

describe('Memorioso browser bridge', () => {
  beforeEach(() => {
    vi.stubEnv('LIBRO_SERVICE_URL', 'https://libro.test')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://memorioso.test')
    fetcher.mockReset()
    vi.stubGlobal('fetch', fetcher)
  })
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

  it('forwards only Libro cookies and scopes returned session cookies to the browser bridge', async () => {
    fetcher.mockResolvedValue(new Response('{}', { headers: {
      'Set-Cookie': 'libro_identity_session=new-session; Path=/; HttpOnly; SameSite=Lax; Domain=libro.test',
    } }))
    const path = 'api/v1/identity/verify'
    const response = await POST(request(path, 'POST'), context(path))
    const [url, options] = fetcher.mock.calls[0]
    expect(url.toString()).toBe('https://libro.test/api/v1/identity/verify')
    expect(options.headers.get('Cookie')).toBe('libro_identity_session=identity; libro_oauth_consent=nonce')
    expect(options.headers.get('Authorization')).toBeNull()
    expect(options.headers.get('Origin')).toBe('https://libro.test')
    expect(options.redirect).toBe('manual')
    expect(response.headers.get('Set-Cookie')).toContain('Path=/api/libro/browser')
    expect(response.headers.get('Set-Cookie')).not.toContain('Domain=')
  })

  it('rejects cross-origin writes before contacting Libro', async () => {
    const path = 'oauth/authorize'
    expect((await POST(request(path, 'POST', 'https://attacker.test'), context(path))).status).toBe(403)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it.each(['oauth/token', 'api/v1/me', 'api/internal/events/deliver', '../oauth/token', 'api/v1/signing/cap/relay'])('does not proxy arbitrary GET operations: %s', async (path) => {
    expect((await GET(request(path), context(path))).status).toBe(404)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('does not install unrelated cookies from the backend', async () => {
    fetcher.mockResolvedValue(new Response('{}', { headers: { 'Set-Cookie': 'memorioso_session=other; Path=/' } }))
    const path = 'api/v1/identity/hint'
    const response = await GET(request(path), context(path))
    expect(response.headers.get('Set-Cookie')).toBeNull()
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })
})
