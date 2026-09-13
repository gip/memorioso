import { afterEach, describe, expect, it, vi } from 'vitest'
import { browserUrl, mcpResource, oauthIssuer, oauthResourceMetadataUrl } from './config'

describe('headless Libro browser destinations', () => {
  afterEach(() => { vi.unstubAllEnvs() })
  it('keeps MCP on Libro and OAuth and signing destinations on Memorioso', async () => {
    vi.stubEnv('LIBRO_SERVICE_URL', 'https://libro.test')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://memorioso.test')
    expect(oauthIssuer()).toBe('https://memorioso.test/libro')
    expect(oauthResourceMetadataUrl()).toBe('https://memorioso.test/.well-known/oauth-protected-resource/libro')
    expect(mcpResource()).toBe('https://libro.test/mcp')
    for (const path of ['/sign/cap', '/sign-agent/cap', '/claim/cap']) {
      expect(browserUrl(path)).toBe(`https://memorioso.test/libro${path}`)
    }
  })
  it('requires an explicit Memorioso origin', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '')
    expect(() => browserUrl('/sign/cap')).toThrow('NEXT_PUBLIC_APP_URL is required')
  })
})
