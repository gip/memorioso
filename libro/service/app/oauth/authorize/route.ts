import { browserIdentityId } from '@/lib/session'
import { assertRedirectUri, getClient, issueAuthorizationCode, normalizeScope } from '@/lib/oauth'
import { errorResponse, ServiceError } from '@/lib/errors'
import { serviceOrigin } from '@/lib/config'

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url)
    const clientId = url.searchParams.get('client_id') || ''
    const redirectUri = url.searchParams.get('redirect_uri') || ''
    const resource = url.searchParams.get('resource') || ''
    const codeChallenge = url.searchParams.get('code_challenge') || ''
    const state = url.searchParams.get('state')
    if (url.searchParams.get('response_type') !== 'code' || url.searchParams.get('code_challenge_method') !== 'S256' || !codeChallenge) {
      throw new ServiceError('invalid_request', 'OAuth authorization requires response_type=code and PKCE S256', 400)
    }
    const client = await getClient(clientId)
    assertRedirectUri(client, redirectUri)
    if (resource !== client.resource) {
      throw new ServiceError('invalid_target', 'OAuth resource does not match the registered MCP server', 400)
    }
    const identityId = await browserIdentityId()
    if (!identityId) {
      const login = new URL('/identity', serviceOrigin())
      login.searchParams.set('continue', url.toString())
      return Response.redirect(login)
    }
    const code = await issueAuthorizationCode({
      clientId,
      identityId,
      redirectUri,
      resource,
      scope: normalizeScope(url.searchParams.get('scope')),
      codeChallenge,
    })
    const destination = new URL(redirectUri)
    destination.searchParams.set('code', code)
    destination.searchParams.set('iss', serviceOrigin())
    if (state) destination.searchParams.set('state', state)
    return Response.redirect(destination)
  } catch (error) {
    return errorResponse(error)
  }
}
