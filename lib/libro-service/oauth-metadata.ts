export function libroOAuthMetadata() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  const serviceUrl = process.env.LIBRO_SERVICE_URL
  if (!appUrl || !serviceUrl) throw new Error('Libro OAuth configuration is incomplete')
  const appOrigin = new URL(appUrl).origin
  const issuer = new URL('/libro', appOrigin).toString()
  const scopes = ['openid', 'profile', 'publish', 'claim_handle', 'register_agent', 'import', 'revoke_agent']
  return {
    authorizationServer: {
      issuer,
      authorization_endpoint: new URL('/libro/authorize', appOrigin).toString(),
      token_endpoint: new URL('/api/libro/oauth/token', appOrigin).toString(),
      registration_endpoint: new URL('/api/libro/oauth/register', appOrigin).toString(),
      revocation_endpoint: new URL('/api/libro/oauth/revoke', appOrigin).toString(),
      response_types_supported: ['code'], client_id_metadata_document_supported: true,
      grant_types_supported: ['authorization_code', 'refresh_token'], code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none', 'client_secret_basic', 'client_secret_post'], scopes_supported: scopes,
    },
    protectedResource: {
      resource: new URL('/mcp', new URL(serviceUrl).origin).toString(), authorization_servers: [issuer],
      bearer_methods_supported: ['header'], scopes_supported: scopes,
    },
  }
}
