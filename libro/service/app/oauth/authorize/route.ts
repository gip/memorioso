import { cookies } from 'next/headers'
import { browserIdentityId, identitySessionCookieOptions } from '@/lib/session'
import { assertRedirectUri, getClient, issueAuthorizationCode, normalizeScope, WRITE_SCOPES } from '@/lib/oauth'
import { errorResponse, ServiceError } from '@/lib/errors'
import { mcpStateSecret, serviceOrigin, WRITE_GRANT_MAX_AGE_SECONDS } from '@/lib/config'
import { randomToken, signState, verifyState } from '@/lib/crypto'
import { pool } from '@/lib/db'

const CONSENT_COOKIE = 'libro_oauth_consent'
type Consent = { identityId: string; requestUrl: string; nonce: string; expiresAt: number }
const headers = {
  'Cache-Control': 'no-store',
  'Content-Type': 'text/html; charset=utf-8',
  'Content-Security-Policy': "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  'Referrer-Policy': 'no-referrer',
}
const escape = (text: string) => text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!))

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
    const input = await authorization(url)
    const identityId = await currentIdentity(input.scope)
    if (!identityId) {
      const login = new URL('/identity', serviceOrigin())
      login.searchParams.set('continue', url.toString())
      return Response.redirect(login)
    }
    const nonce = randomToken()
    const token = signState({ identityId, requestUrl: url.toString(), nonce, expiresAt: Date.now() + 600_000 } satisfies Consent, mcpStateSecret())
    const store = await cookies()
    store.set(CONSENT_COOKIE, nonce, { ...identitySessionCookieOptions, maxAge: 600 })
    return new Response(`<!doctype html><html><head><title>Authorize application</title></head><body><main>
      <h1>Connect to ${escape(String(input.client.display_name || input.clientId))}?</h1>
      <p>Client: ${escape(input.clientId)}</p><p>Resource: ${escape(input.resource)}</p>
      <p>Requested permissions: ${escape(input.scope.join(', '))}</p>
      <p>Only approve an application you intended to connect. Human publications still require your signature.</p>
      <form method="post" action="/oauth/authorize"><input type="hidden" name="consent" value="${escape(token)}">
      <button name="decision" value="approve">Allow access</button> <button name="decision" value="deny">Cancel</button></form>
      </main></body></html>`, { headers })
  } catch (error) { return errorResponse(error) }
}

export async function POST(request: Request): Promise<Response> {
  try {
    if (request.headers.get('origin') !== serviceOrigin()) throw new ServiceError('invalid_request', 'Invalid consent origin', 403)
    const form = new URLSearchParams(await request.text())
    const consent = verifyState<Consent>(form.get('consent') || '', mcpStateSecret())
    const store = await cookies()
    if (!consent || !Number.isFinite(consent.expiresAt) || consent.expiresAt <= Date.now() || consent.nonce !== store.get(CONSENT_COOKIE)?.value) {
      throw new ServiceError('invalid_request', 'Consent expired; start authorization again', 400)
    }
    const url = new URL(consent.requestUrl)
    const input = await authorization(url)
    const identityId = await currentIdentity(input.scope)
    if (!identityId || identityId !== consent.identityId) throw new ServiceError('AUTH_REQUIRED', 'Verify your identity again before authorizing', 401)
    const decision = form.get('decision')
    if (decision !== 'approve' && decision !== 'deny') throw new ServiceError('invalid_request', 'Consent decision is required', 400)
    store.set(CONSENT_COOKIE, '', { ...identitySessionCookieOptions, maxAge: 0 })
    const destination = new URL(input.redirectUri)
    if (decision === 'approve') destination.searchParams.set('code', await issueAuthorizationCode({ ...input, identityId }))
    else destination.searchParams.set('error', 'access_denied')
    destination.searchParams.set('iss', serviceOrigin())
    const state = url.searchParams.get('state')
    if (state) destination.searchParams.set('state', state)
    return new Response(null, { status: 303, headers: { Location: destination.toString(), 'Cache-Control': 'no-store' } })
  } catch (error) { return errorResponse(error) }
}
