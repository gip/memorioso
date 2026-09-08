import { browserUrl } from '@/lib/config'

export function GET(request: Request): Response {
  const issuer = new URL(request.url).origin
  return Response.json({
    issuer,
    authorization_endpoint: browserUrl('/authorize'),
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    revocation_endpoint: `${issuer}/oauth/revoke`,
    response_types_supported: ['code'],
    client_id_metadata_document_supported: true,
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_basic', 'client_secret_post'],
    scopes_supported: ['openid', 'profile', 'publish', 'claim_handle', 'register_agent', 'import', 'revoke_agent'],
  }, { headers: { 'Cache-Control': 'public, max-age=3600' } })
}
