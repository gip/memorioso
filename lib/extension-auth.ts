import { createHash, randomBytes } from 'crypto'
import type { NextRequest } from 'next/server'
import { pool } from '@/lib/db'
import type { WorldIdSessionUser } from '@/lib/auth-types'

export const EXTENSION_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30

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
      worldIdSessionId: row.world_id_session_id,
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
