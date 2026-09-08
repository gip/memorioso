import { afterEach, describe, expect, it, vi } from 'vitest'
import { browserUrl, mcpResource } from './config'
import { GET } from '../app/.well-known/oauth-authorization-server/route'
import { GET as oldSigningLink } from '../app/sign/[capability]/route'

describe('headless Libro browser destinations', () => {
  afterEach(() => { vi.unstubAllEnvs() })
  it('keeps issuer and MCP on Libro while directing authorization and signing to Memorioso', async () => {
    vi.stubEnv('LIBRO_SERVICE_URL', 'https://libro.test')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://memorioso.test')
    const metadata = await GET(new Request('https://libro.test/.well-known/oauth-authorization-server')).json()
    expect(metadata.issuer).toBe('https://libro.test')
    expect(metadata.authorization_endpoint).toBe('https://memorioso.test/libro/authorize')
    expect(metadata.token_endpoint).toBe('https://libro.test/oauth/token')
    expect(mcpResource()).toBe('https://libro.test/mcp')
    expect((await oldSigningLink(new Request('https://libro.test/sign/cap'), { params: Promise.resolve({ capability: 'cap' }) })).headers.get('location')).toBe('https://memorioso.test/libro/sign/cap')
    for (const path of ['/sign/cap', '/sign-agent/cap', '/claim/cap']) {
      expect(browserUrl(path)).toBe(`https://memorioso.test/libro${path}`)
    }
  })
  it('requires an explicit Memorioso origin', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '')
    expect(() => browserUrl('/sign/cap')).toThrow('NEXT_PUBLIC_APP_URL is required')
  })
})
