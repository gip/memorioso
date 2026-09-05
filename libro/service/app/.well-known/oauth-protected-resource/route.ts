export function GET(request: Request): Response {
  const issuer = new URL(request.url).origin
  return Response.json({
    resource: `${issuer}/mcp`,
    authorization_servers: [issuer],
    bearer_methods_supported: ['header'],
    scopes_supported: ['openid', 'profile', 'publish', 'claim_handle', 'register_agent', 'import', 'revoke_agent'],
  }, { headers: { 'Cache-Control': 'public, max-age=3600' } })
}
