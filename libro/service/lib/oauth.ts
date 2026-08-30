import { createHash, randomBytes } from 'node:crypto'
import { pool, type DatabaseClient } from './db'
import { ACCESS_TOKEN_TTL_SECONDS, REFRESH_TOKEN_TTL_SECONDS, WRITE_GRANT_MAX_AGE_SECONDS } from './config'
import { randomToken, sha256, verifySecret } from './crypto'
import { ServiceError } from './errors'

export const WRITE_SCOPES = new Set(['publish', 'claim_handle', 'register_agent', 'import'])
const ALLOWED_SCOPES = new Set(['openid', 'profile', 'publish', 'claim_handle', 'register_agent', 'import'])

export type OAuthPrincipal = {
  identityId: string
  authorId: string
  handle: string
  name: string
  bio: string
  sessionCommitment: string
  clientId: string
  resource: string
  scope: string[]
  authorNamespace: string | null
}

export function normalizeScope(value: string | null | undefined): string[] {
  const scopes = [...new Set((value || 'openid profile').split(/\s+/).filter(Boolean))]
  if (scopes.some((scope) => !ALLOWED_SCOPES.has(scope))) {
    throw new ServiceError('invalid_scope', 'One or more requested scopes are unsupported', 400)
  }
  return scopes
}

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}

function validRedirectUri(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return url.username === '' && url.password === '' && url.hash === '' &&
      (url.protocol === 'https:' || (url.protocol === 'http:' && isLoopback(url.hostname)))
  } catch {
    return false
  }
}

function clientMetadataUrl(clientId: string): URL | null {
  try {
    const url = new URL(clientId)
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || isLoopback(url.hostname)) return null
    if (/^(?:10|127|169\.254|192\.168)\./.test(url.hostname) || /^172\.(?:1[6-9]|2\d|3[01])\./.test(url.hostname)) return null
    return url
  } catch {
    return null
  }
}

async function discoverClientMetadata(clientId: string): Promise<Record<string, unknown> | null> {
  const url = clientMetadataUrl(clientId)
  if (!url) return null
  let response: Response
  try {
    response = await fetch(url, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(5_000),
    })
  } catch {
    throw new ServiceError('invalid_client', 'Client metadata document could not be fetched', 400)
  }
  if (!response.ok || !(response.headers.get('content-type') || '').toLowerCase().includes('application/json')) {
    throw new ServiceError('invalid_client', 'Client metadata document must return JSON', 400)
  }
  const metadata = await response.json().catch(() => null) as Record<string, unknown> | null
  const redirects = metadata && Array.isArray(metadata.redirect_uris) && metadata.redirect_uris.every(validRedirectUri)
    ? metadata.redirect_uris as string[]
    : null
  if (!metadata || metadata.client_id !== clientId || !redirects?.length ||
      (metadata.token_endpoint_auth_method !== undefined && metadata.token_endpoint_auth_method !== 'none') ||
      (Array.isArray(metadata.grant_types) && !metadata.grant_types.includes('authorization_code')) ||
      (Array.isArray(metadata.response_types) && !metadata.response_types.includes('code'))) {
    throw new ServiceError('invalid_client', 'Client metadata document is incompatible with Libro OAuth', 400)
  }
  const resource = new URL('/mcp', process.env.LIBRO_SERVICE_URL || url.origin).toString()
  await pool.query(
    `INSERT INTO libro_oauth_clients
      (id, client_type, redirect_uris, resource, display_name, author_namespace,
       namespace_verified_at, dynamically_registered)
     VALUES ($1, 'public', $2, $3, $4, NULL, NULL, TRUE)
     ON CONFLICT (id) DO NOTHING`,
    [clientId, redirects, resource, typeof metadata.client_name === 'string' ? metadata.client_name.slice(0, 120) : null],
  )
  const stored = await pool.query('SELECT * FROM libro_oauth_clients WHERE id = $1', [clientId])
  return stored.rows[0] || null
}

export async function getClient(clientId: string) {
  const result = await pool.query('SELECT * FROM libro_oauth_clients WHERE id = $1', [clientId])
  if (result.rows[0]) return result.rows[0]
  const discovered = await discoverClientMetadata(clientId)
  if (!discovered) throw new ServiceError('invalid_client', 'OAuth client is not registered', 400)
  return discovered
}

export function assertRedirectUri(client: Record<string, unknown>, redirectUri: string): void {
  const allowed = Array.isArray(client.redirect_uris) ? client.redirect_uris : []
  if (!allowed.includes(redirectUri)) {
    throw new ServiceError('invalid_request', 'OAuth redirect_uri is not registered', 400)
  }
}

export async function issueAuthorizationCode(input: {
  clientId: string
  identityId: string
  redirectUri: string
  resource: string
  scope: string[]
  codeChallenge: string
}): Promise<string> {
  const code = randomToken()
  await pool.query(
    `INSERT INTO libro_oauth_codes
      (code_hash, client_id, identity_id, redirect_uri, resource, scope, code_challenge, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP + INTERVAL '10 minutes')`,
    [sha256(code), input.clientId, input.identityId, input.redirectUri, input.resource, input.scope, input.codeChallenge],
  )
  return code
}

function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

export async function authenticateClient(request: Request, form: URLSearchParams, client: Record<string, unknown>): Promise<void> {
  if (client.client_type === 'public') return
  const authorization = request.headers.get('authorization')
  let supplied: string | null = null
  if (authorization?.startsWith('Basic ')) {
    const decoded = Buffer.from(authorization.slice(6), 'base64').toString('utf8')
    const separator = decoded.indexOf(':')
    if (separator >= 0 && decoded.slice(0, separator) === client.id) supplied = decoded.slice(separator + 1)
  }
  supplied ||= form.get('client_secret')
  if (!supplied || !verifySecret(supplied, client.secret_hash as string | null)) {
    throw new ServiceError('invalid_client', 'OAuth client authentication failed', 401)
  }
}

async function tokensForGrant(connection: DatabaseClient, grantId: string, resource: string) {
  const accessToken = randomToken()
  const refreshToken = randomToken()
  await connection.query(
    `INSERT INTO libro_oauth_tokens (grant_id, token_type, token_hash, resource, expires_at)
     VALUES
       ($1, 'access', $2, $4, CURRENT_TIMESTAMP + ($5 * INTERVAL '1 second')),
       ($1, 'refresh', $3, $4, CURRENT_TIMESTAMP + ($6 * INTERVAL '1 second'))`,
    [grantId, sha256(accessToken), sha256(refreshToken), resource, ACCESS_TOKEN_TTL_SECONDS, REFRESH_TOKEN_TTL_SECONDS],
  )
  return { accessToken, refreshToken }
}

export async function exchangeAuthorizationCode(request: Request, form: URLSearchParams) {
  const code = form.get('code')
  const clientId = form.get('client_id')
  const redirectUri = form.get('redirect_uri')
  const resource = form.get('resource')
  const verifier = form.get('code_verifier')
  if (!code || !clientId || !redirectUri || !resource || !verifier) {
    throw new ServiceError('invalid_request', 'Authorization code exchange is incomplete', 400)
  }
  const client = await getClient(clientId)
  await authenticateClient(request, form, client)
  const connection = await pool.connect()
  try {
    await connection.query('BEGIN')
    const codeResult = await connection.query(
      `SELECT c.*, i.session_commitment, a.handle
       FROM libro_oauth_codes c
       JOIN libro_identities i ON i.id = c.identity_id
       JOIN libro_authors a ON a.identity_id = i.id
       WHERE c.code_hash = $1 AND c.consumed_at IS NULL AND c.expires_at > CURRENT_TIMESTAMP
       FOR UPDATE OF c`,
      [sha256(code)],
    )
    const stored = codeResult.rows[0]
    if (!stored || stored.client_id !== clientId || stored.redirect_uri !== redirectUri || stored.resource !== resource) {
      throw new ServiceError('invalid_grant', 'Authorization code is invalid or expired', 400)
    }
    if (pkceChallenge(verifier) !== stored.code_challenge) {
      throw new ServiceError('invalid_grant', 'PKCE verification failed', 400)
    }
    await connection.query('UPDATE libro_oauth_codes SET consumed_at = CURRENT_TIMESTAMP WHERE code_hash = $1', [sha256(code)])
    const grant = await connection.query(
      `INSERT INTO libro_oauth_grants
        (client_id, identity_id, session_commitment, handle, resource, scope, verified_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP,
         CURRENT_TIMESTAMP + ($7 * INTERVAL '1 second'))
       RETURNING id`,
      [clientId, stored.identity_id, stored.session_commitment, stored.handle, resource, stored.scope, REFRESH_TOKEN_TTL_SECONDS],
    )
    const issued = await tokensForGrant(connection, grant.rows[0].id, resource)
    await connection.query('COMMIT')
    return { ...issued, scope: (stored.scope as string[]).join(' ') }
  } catch (error) {
    await connection.query('ROLLBACK')
    throw error
  } finally {
    connection.release()
  }
}

export async function exchangeRefreshToken(request: Request, form: URLSearchParams) {
  const refreshToken = form.get('refresh_token')
  const clientId = form.get('client_id')
  const resource = form.get('resource')
  if (!refreshToken || !clientId || !resource) throw new ServiceError('invalid_request', 'Refresh request is incomplete', 400)
  const client = await getClient(clientId)
  await authenticateClient(request, form, client)
  const connection = await pool.connect()
  try {
    await connection.query('BEGIN')
    const result = await connection.query(
      `UPDATE libro_oauth_tokens t SET revoked_at = CURRENT_TIMESTAMP, last_used_at = CURRENT_TIMESTAMP
       FROM libro_oauth_grants g
       WHERE t.token_hash = $1 AND t.token_type = 'refresh' AND t.grant_id = g.id
         AND g.client_id = $2 AND t.resource = $3 AND t.revoked_at IS NULL
         AND t.expires_at > CURRENT_TIMESTAMP AND g.revoked_at IS NULL AND g.expires_at > CURRENT_TIMESTAMP
       RETURNING g.id, g.scope`,
      [sha256(refreshToken), clientId, resource],
    )
    if (!result.rows[0]) throw new ServiceError('invalid_grant', 'Refresh token is invalid or expired', 400)
    const issued = await tokensForGrant(connection, result.rows[0].id, resource)
    await connection.query('COMMIT')
    return { ...issued, scope: (result.rows[0].scope as string[]).join(' ') }
  } catch (error) {
    await connection.query('ROLLBACK')
    throw error
  } finally {
    connection.release()
  }
}

export async function authenticateBearer(
  request: Request,
  requiredScope?: string,
  expectedResource = new URL(request.url).origin + '/mcp',
): Promise<OAuthPrincipal> {
  const match = /^Bearer ([A-Za-z0-9_-]{32,})$/.exec(request.headers.get('authorization') || '')
  if (!match) throw new ServiceError('invalid_token', 'Bearer token is required', 401)
  const result = await pool.query(
    `UPDATE libro_oauth_tokens t SET last_used_at = CURRENT_TIMESTAMP
     FROM libro_oauth_grants g, libro_identities i, libro_authors a, libro_oauth_clients c
     WHERE t.token_hash = $1 AND t.token_type = 'access'
       AND t.grant_id = g.id AND g.identity_id = i.id AND a.identity_id = i.id AND c.id = g.client_id
       AND t.revoked_at IS NULL AND t.expires_at > CURRENT_TIMESTAMP
       AND g.revoked_at IS NULL AND g.expires_at > CURRENT_TIMESTAMP
       AND t.resource = g.resource AND g.resource = $2
       AND i.revoked_at IS NULL AND i.session_commitment = g.session_commitment AND a.handle = g.handle
       AND ($3::text IS NULL OR $3 = ANY(g.scope))
       AND ($3::text IS NULL OR NOT ($3 = ANY($4::text[]))
         OR g.verified_at > CURRENT_TIMESTAMP - ($5 * INTERVAL '1 second'))
     RETURNING i.id AS identity_id, a.id AS author_id, a.handle, a.name, COALESCE(a.bio, '') AS bio, i.session_commitment,
       g.client_id, g.resource, g.scope, c.author_namespace`,
    [sha256(match[1]), expectedResource, requiredScope || null, [...WRITE_SCOPES], WRITE_GRANT_MAX_AGE_SECONDS],
  )
  const row = result.rows[0]
  if (!row) throw new ServiceError('invalid_token', 'Bearer token is invalid, expired, or lacks scope', 401)
  return {
    identityId: row.identity_id,
    authorId: row.author_id,
    handle: row.handle,
    name: row.name,
    bio: row.bio,
    sessionCommitment: row.session_commitment,
    clientId: row.client_id,
    resource: row.resource,
    scope: row.scope,
    authorNamespace: row.author_namespace,
  }
}

export function createDynamicClientId(): string {
  return `client_${randomBytes(18).toString('base64url')}`
}

export async function revokeOAuthToken(request: Request, form: URLSearchParams): Promise<void> {
  const token = form.get('token')
  const clientId = form.get('client_id')
  if (!token || !clientId) throw new ServiceError('invalid_request', 'token and client_id are required', 400)
  const client = await getClient(clientId)
  await authenticateClient(request, form, client)
  await pool.query(
    `UPDATE libro_oauth_tokens t SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP)
     FROM libro_oauth_grants g
     WHERE t.token_hash = $1 AND t.grant_id = g.id AND g.client_id = $2`,
    [sha256(token), clientId],
  )
}
