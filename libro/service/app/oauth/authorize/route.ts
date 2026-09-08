import { cookies } from 'next/headers'
import { browserIdentityId, identitySessionCookieOptions } from '@/lib/session'
import { assertRedirectUri, getClient, issueAuthorizationCode, normalizeScope, WRITE_SCOPES } from '@/lib/oauth'
import { errorResponse, ServiceError } from '@/lib/errors'
import { browserUrl, mcpStateSecret, serviceOrigin, WRITE_GRANT_MAX_AGE_SECONDS } from '@/lib/config'
import { randomToken, signState, verifyState } from '@/lib/crypto'
import { pool } from '@/lib/db'

const CONSENT_COOKIE = 'libro_oauth_consent'
type Consent = { identityId: string; requestUrl: string; nonce: string; expiresAt: number }
async function authorization(url: URL) {
  const clientId = url.searchParams.get('client_id') || ''
  const redirectUri = url.searchParams.get('redirect_uri') || ''
  const resource = url.searchParams.get('resource') || ''
  const codeChallenge = url.searchParams.get('code_challenge') || ''
  if (url.searchParams.get('response_type') !== 'code' || url.searchParams.get('code_challenge_method') !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)) {
    throw new ServiceError('invalid_request', 'OAuth authorization requires PKCE S256', 400)
  }
  const client = await getClient(clientId)
  assertRedirectUri(client, redirectUri)
  if (resource !== client.resource) throw new ServiceError('invalid_target', 'OAuth resource does not match the client', 400)
  return { client, clientId, redirectUri, resource, codeChallenge, scope: normalizeScope(url.searchParams.get('scope')) }
}

async function currentIdentity(scope: string[]) {
  const identityId = await browserIdentityId()
  if (!identityId) return null
  const result = await pool.query('SELECT verified_at FROM libro_identities WHERE id = $1 AND revoked_at IS NULL', [identityId])
  if (!result.rows[0]) return null
  if (scope.some((value) => WRITE_SCOPES.has(value)) && new Date(result.rows[0].verified_at).getTime() <= Date.now() - WRITE_GRANT_MAX_AGE_SECONDS * 1000) return null
  return identityId
}

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url)
    if (request.headers.get('accept')?.includes('text/html')) {
      const destination = new URL(browserUrl('/authorize'))
      destination.search = url.search
      return Response.redirect(destination)
    }
    const input = await authorization(url)
    const identityId = await currentIdentity(input.scope)
    if (!identityId) {
      return Response.json({ error: { code: 'AUTH_REQUIRED', message: 'Sign in to continue' } }, { status: 401, headers: { 'Cache-Control': 'no-store' } })
    }
    const nonce = randomToken()
    const token = signState({ identityId, requestUrl: url.toString(), nonce, expiresAt: Date.now() + 600_000 } satisfies Consent, mcpStateSecret())
    const store = await cookies()
    store.set(CONSENT_COOKIE, nonce, { ...identitySessionCookieOptions, maxAge: 600 })
    return Response.json({
      clientId: input.clientId,
      displayName: String(input.client.display_name || input.clientId),
      resource: input.resource,
      scope: input.scope,
      consent: token,
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return errorResponse(error) }
}

export async function POST(request: Request): Promise<Response> {
  try {
    if (request.headers.get('origin') !== serviceOrigin()) throw new ServiceError('invalid_request', 'Invalid authorization origin', 403)
    const form = new URLSearchParams(await request.text())
    const consent = verifyState<Consent>(form.get('consent') || '', mcpStateSecret())
    const store = await cookies()
    if (!consent || !Number.isFinite(consent.expiresAt) || consent.expiresAt <= Date.now() || consent.nonce !== store.get(CONSENT_COOKIE)?.value) {
      throw new ServiceError('invalid_request', 'Authorization expired; start authorization again', 400)
    }
    const url = new URL(consent.requestUrl)
    const input = await authorization(url)
    const identityId = await currentIdentity(input.scope)
    if (!identityId || identityId !== consent.identityId) throw new ServiceError('AUTH_REQUIRED', 'Verify your identity again before authorizing', 401)
    store.set(CONSENT_COOKIE, '', { ...identitySessionCookieOptions, maxAge: 0 })
    const destination = new URL(input.redirectUri)
    // Honor cancellation from browser tabs opened before the consent screen was removed.
    if (form.get('decision') === 'deny') destination.searchParams.set('error', 'access_denied')
    else destination.searchParams.set('code', await issueAuthorizationCode({ ...input, identityId }))
    destination.searchParams.set('iss', serviceOrigin())
    const state = url.searchParams.get('state')
    if (state) destination.searchParams.set('state', state)
    return Response.json({ redirectUrl: destination.toString() }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return errorResponse(error) }
}
