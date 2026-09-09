import { createHash, createHmac, randomBytes } from 'crypto'
import type { NextRequest } from 'next/server'
import { pool } from '@/lib/db'
import type { WorldIdSessionUser } from '@/lib/auth-types'

export const EXTENSION_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30
export const EXTENSION_AUTH_HANDLE_LIMIT = 8
export const EXTENSION_AUTH_IP_LIMIT = 20
export const EXTENSION_AUTH_VERIFY_LIMIT = 5
export const EXTENSION_SIGNATURE_TEN_MINUTE_LIMIT = 20
export const EXTENSION_SIGNATURE_DAILY_LIMIT = 100

export class ExtensionRateLimitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ExtensionRateLimitError'
  }
}

export type ExtensionSession = {
  id: string
  user: WorldIdSessionUser
  expiresAt: string
}

export function createExtensionToken(): string {
  return randomBytes(32).toString('base64url')
}

export function hashExtensionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function getExtensionRequestIpHash(request: NextRequest): string | null {
  const forwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  const address = forwardedFor || request.headers.get('x-real-ip')?.trim()
  if (!address) return null

  const secret = process.env.SESSION_SECRET
  if (!secret) {
    throw new Error('SESSION_SECRET is required to protect extension abuse-control metadata')
  }
  return createHmac('sha256', secret)
    .update(`libro-extension-ip:${address}`)
    .digest('hex')
}

export async function cleanupExpiredExtensionData(): Promise<void> {
  await pool.query(
    `WITH removed_attempts AS (
       DELETE FROM libro_extension_auth_attempts
       WHERE expires_at < CURRENT_TIMESTAMP - INTERVAL '1 day'
          OR consumed_at < CURRENT_TIMESTAMP - INTERVAL '1 day'
       RETURNING id
     ), removed_sessions AS (
       DELETE FROM libro_extension_sessions
       WHERE expires_at < CURRENT_TIMESTAMP
          OR revoked_at < CURRENT_TIMESTAMP - INTERVAL '1 day'
       RETURNING id
     ), removed_drafts AS (
       DELETE FROM drafts d
       WHERE d.status = 'editing'
         AND d.history->>'source' = 'chrome_extension'
         AND d.created_at < CURRENT_TIMESTAMP - INTERVAL '1 day'
         AND NOT EXISTS (
           SELECT 1 FROM libro_publish_registrations r WHERE r."draftId" = d.id
         )
       RETURNING id
     )
     SELECT
       (SELECT COUNT(*) FROM removed_attempts) AS attempts,
       (SELECT COUNT(*) FROM removed_sessions) AS sessions,
       (SELECT COUNT(*) FROM removed_drafts) AS drafts`
  )
}

export async function enforceExtensionAuthContextRateLimit(
  requestedHandle: string,
  requestIpHash: string | null,
): Promise<void> {
  const { rows } = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE requested_handle = $1)::integer AS handle_count,
       COUNT(*) FILTER (WHERE request_ip_hash = $2)::integer AS ip_count
     FROM libro_extension_auth_attempts
     WHERE created_at > CURRENT_TIMESTAMP - INTERVAL '10 minutes'`,
    [requestedHandle, requestIpHash]
  )
  if (
    Number(rows[0]?.handle_count || 0) >= EXTENSION_AUTH_HANDLE_LIMIT ||
    (requestIpHash !== null && Number(rows[0]?.ip_count || 0) >= EXTENSION_AUTH_IP_LIMIT)
  ) {
    throw new ExtensionRateLimitError('Too many extension login attempts. Please try again later.')
  }
}

export async function enforceExtensionSignatureRateLimit(userId: number): Promise<void> {
  const { rows } = await pool.query(
    `SELECT
       COUNT(*) FILTER (
         WHERE created_at > CURRENT_TIMESTAMP - INTERVAL '10 minutes'
       )::integer AS recent_count,
       COUNT(*)::integer AS daily_count
     FROM drafts
     WHERE "userId" = $1
       AND history->>'source' = 'chrome_extension'
       AND created_at > CURRENT_TIMESTAMP - INTERVAL '1 day'`,
    [userId]
  )
  if (
    Number(rows[0]?.recent_count || 0) >= EXTENSION_SIGNATURE_TEN_MINUTE_LIMIT ||
    Number(rows[0]?.daily_count || 0) >= EXTENSION_SIGNATURE_DAILY_LIMIT
  ) {
    throw new ExtensionRateLimitError('Too many extension signing requests. Please try again later.')
  }
}

export function getBearerToken(request: NextRequest): string | null {
  const authorization = request.headers.get('authorization')
  if (!authorization) return null
  const match = /^Bearer ([A-Za-z0-9_-]{32,})$/.exec(authorization)
  return match?.[1] || null
}

export function hasAuthorizationHeader(request: NextRequest): boolean {
  return request.headers.has('authorization')
}

export async function getExtensionSession(request: NextRequest): Promise<ExtensionSession | null> {
  const token = getBearerToken(request)
  if (!token) return null

  const { rows } = await pool.query(
    `UPDATE libro_extension_sessions s
     SET last_used_at = CURRENT_TIMESTAMP
     FROM users u
     WHERE s.token_hash = $1
       AND s."userId" = u.id
       AND s.revoked_at IS NULL
       AND s.expires_at > CURRENT_TIMESTAMP
     RETURNING
       s.id,
       s.expires_at,
       u.id AS user_id,
       u.name,
       u.handle,
       u.world_id_session_id,
       u.libro_identity_id,
       u.world_id_credential_identifier`,
    [hashExtensionToken(token)]
  )

  if (rows.length === 0) return null
  const row = rows[0]
  return {
    id: row.id,
    expiresAt: new Date(row.expires_at).toISOString(),
    user: {
      id: row.user_id,
      subject: row.name,
      handle: row.handle,
      worldIdSessionId: row.world_id_session_id || `libro_identity_${row.libro_identity_id}`,
      worldIdCredentialIdentifier: row.world_id_credential_identifier,
    },
  }
}

export async function revokeExtensionSession(request: NextRequest): Promise<boolean> {
  const token = getBearerToken(request)
  if (!token) return false
  const result = await pool.query(
    `UPDATE libro_extension_sessions
     SET revoked_at = CURRENT_TIMESTAMP
     WHERE token_hash = $1 AND revoked_at IS NULL`,
    [hashExtensionToken(token)]
  )
  return (result.rowCount || 0) > 0
}

export async function revokeExtensionSessionAndCancelDrafts(
  request: NextRequest,
): Promise<{ revoked: boolean, cancelledDrafts: number }> {
  const token = getBearerToken(request)
  if (!token) return { revoked: false, cancelledDrafts: 0 }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const sessionResult = await client.query(
      `UPDATE libro_extension_sessions
       SET revoked_at = CURRENT_TIMESTAMP
       WHERE token_hash = $1 AND revoked_at IS NULL
       RETURNING "userId"`,
      [hashExtensionToken(token)]
    )
    if (sessionResult.rows.length === 0) {
      await client.query('COMMIT')
      return { revoked: false, cancelledDrafts: 0 }
    }

    const draftResult = await client.query(
      `DELETE FROM drafts d
       WHERE d."userId" = $1
         AND d.status = 'editing'
         AND d.history->>'source' = 'chrome_extension'
         AND NOT EXISTS (
           SELECT 1 FROM libro_publish_registrations r WHERE r."draftId" = d.id
         )
       RETURNING d.id`,
      [sessionResult.rows[0].userId]
    )
    await client.query('COMMIT')
    return {
      revoked: true,
      cancelledDrafts: draftResult.rows.length,
    }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
