import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import type { PoolClient } from 'pg'
import { pool } from '@/lib/db'

function key(): Buffer {
  const secret = process.env.LIBRO_OAUTH_TOKEN_ENCRYPTION_KEY
  if (!secret || Buffer.byteLength(secret) < 32) {
    throw new Error('LIBRO_OAUTH_TOKEN_ENCRYPTION_KEY must be at least 32 bytes')
  }
  return createHash('sha256').update(`memorioso:libro-oauth:${secret}`).digest()
}

function encrypt(value: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString('base64url')).join('.')
}

function decrypt(value: string): string {
  const [iv, tag, ciphertext] = value.split('.').map((part) => Buffer.from(part, 'base64url'))
  if (!iv || !tag || !ciphertext) throw new Error('Stored Libro OAuth token is invalid')
  const decipher = createDecipheriv('aes-256-gcm', key(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}

export async function storeLibroTokens(client: PoolClient, input: {
  userId: number
  accessToken: string
  refreshToken: string
  expiresIn: number
  scope: string
}): Promise<void> {
  await client.query(
    `INSERT INTO libro_oauth_sessions
      ("userId", access_token_ciphertext, refresh_token_ciphertext,
       access_expires_at, refresh_expires_at, scope)
     VALUES ($1,$2,$3,CURRENT_TIMESTAMP + ($4 * INTERVAL '1 second'),
       CURRENT_TIMESTAMP + INTERVAL '7 days',$5)
     ON CONFLICT ("userId") DO UPDATE SET
       access_token_ciphertext = EXCLUDED.access_token_ciphertext,
       refresh_token_ciphertext = EXCLUDED.refresh_token_ciphertext,
       access_expires_at = EXCLUDED.access_expires_at,
       refresh_expires_at = EXCLUDED.refresh_expires_at,
       scope = EXCLUDED.scope, modified_at = CURRENT_TIMESTAMP`,
    [input.userId, encrypt(input.accessToken), encrypt(input.refreshToken), input.expiresIn, input.scope.split(/\s+/)],
  )
}

export async function getLibroAccessToken(userId: number, requiredScope?: string): Promise<string> {
  const result = await pool.query(
    `SELECT * FROM libro_oauth_sessions WHERE "userId" = $1
       AND refresh_expires_at > CURRENT_TIMESTAMP`,
    [userId],
  )
  const row = result.rows[0]
  if (!row || requiredScope && !row.scope.includes(requiredScope)) throw new Error('Libro authorization is missing or expired')
  if (new Date(row.access_expires_at).getTime() > Date.now() + 30_000) return decrypt(row.access_token_ciphertext)
  const serviceUrl = process.env.LIBRO_SERVICE_URL
  const clientId = process.env.LIBRO_OAUTH_CLIENT_ID
  const clientSecret = process.env.LIBRO_OAUTH_CLIENT_SECRET
  if (!serviceUrl || !clientId || !clientSecret) throw new Error('Libro OAuth configuration is incomplete')
  const resource = new URL('/api/v1', serviceUrl).toString()
  const form = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: decrypt(row.refresh_token_ciphertext),
    client_id: clientId,
    resource,
  })
  const response = await fetch(new URL('/oauth/token', serviceUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body: form,
    cache: 'no-store',
  })
  const body = await response.json().catch(() => null) as {
    access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string
  } | null
  if (!response.ok || !body?.access_token || !body.refresh_token) throw new Error(body?.error || 'Libro token refresh failed')
  await pool.query(
    `UPDATE libro_oauth_sessions SET access_token_ciphertext = $2,
       refresh_token_ciphertext = $3, access_expires_at = CURRENT_TIMESTAMP + ($4 * INTERVAL '1 second'),
       scope = $5, modified_at = CURRENT_TIMESTAMP WHERE "userId" = $1`,
    [userId, encrypt(body.access_token), encrypt(body.refresh_token), body.expires_in || 900, (body.scope || row.scope.join(' ')).split(/\s+/)],
  )
  return body.access_token
}

export async function clearLibroTokens(userId: number): Promise<void> {
  const result = await pool.query(
    `DELETE FROM libro_oauth_sessions WHERE "userId" = $1 RETURNING refresh_token_ciphertext`,
    [userId],
  )
  const encrypted = result.rows[0]?.refresh_token_ciphertext
  const serviceUrl = process.env.LIBRO_SERVICE_URL
  const clientId = process.env.LIBRO_OAUTH_CLIENT_ID
  const clientSecret = process.env.LIBRO_OAUTH_CLIENT_SECRET
  if (!encrypted || !serviceUrl || !clientId || !clientSecret) return
  await fetch(new URL('/oauth/revoke', serviceUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body: new URLSearchParams({ token: decrypt(encrypted), client_id: clientId }),
    cache: 'no-store',
  }).catch(() => undefined)
}
