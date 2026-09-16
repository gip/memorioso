import { afterEach, expect, it, vi } from 'vitest'
import { libroOAuthMetadata } from './oauth-metadata'

afterEach(() => vi.unstubAllEnvs())

it('advertises a Memorioso issuer and endpoints for the Libro MCP resource', () => {
  vi.stubEnv('LIBRO_SERVICE_URL', 'https://libro.test')
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://memorioso.test')
  const { authorizationServer, protectedResource } = libroOAuthMetadata()
  expect(authorizationServer.issuer).toBe('https://memorioso.test/libro')
  for (const field of ['authorization_endpoint', 'token_endpoint', 'registration_endpoint', 'revocation_endpoint'] as const) {
    expect(new URL(authorizationServer[field]).origin).toBe('https://memorioso.test')
  }
  expect(protectedResource.resource).toBe('https://libro.test/mcp')
  expect(protectedResource.authorization_servers).toEqual([authorizationServer.issuer])
})
