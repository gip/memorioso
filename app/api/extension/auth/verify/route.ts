import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'
import {
  createExtensionToken,
  cleanupExpiredExtensionData,
  EXTENSION_SESSION_MAX_AGE_SECONDS,
  EXTENSION_AUTH_VERIFY_LIMIT,
  hashExtensionToken,
} from '@/lib/extension-auth'
import {
  verifyAndCreateOrConnectAuthor,
  WorldIdAuthorAuthError,
  type WorldIdAuthorAuthIntent,
} from '@/lib/world-id/author-auth'

type VerifyBody = {
  attemptId?: unknown
  idkitResult?: unknown
  profile?: unknown
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await request.json().catch(() => null) as VerifyBody | null
  if (typeof body?.attemptId !== 'string' || !body.idkitResult) {
    return NextResponse.json({ success: false, message: 'Login attempt and World ID result are required' }, { status: 400 })
  }

  try {
    await cleanupExpiredExtensionData()
  } catch {
    return NextResponse.json({
      success: false,
      message: 'Extension abuse controls are unavailable',
    }, { status: 500 })
  }
  const attemptResult = await pool.query(
    `SELECT
       a.id,
       a."userId",
       a.intent,
       a.requested_handle,
       a.verification_attempts,
       a.nonce,
       a.expires_at,
       a.consumed_at,
       u.world_id_session_id
     FROM libro_extension_auth_attempts a
     LEFT JOIN users u ON u.id = a."userId"
     WHERE a.id = $1`,
    [body.attemptId]
  )
  if (attemptResult.rows.length === 0) {
    return NextResponse.json({ success: false, message: 'Extension login attempt was not found' }, { status: 404 })
  }

  const attempt = attemptResult.rows[0]
  if (attempt.consumed_at || new Date(attempt.expires_at) <= new Date()) {
    return NextResponse.json({ success: false, message: 'Extension login attempt has expired or was already used' }, { status: 400 })
  }
  if (Number(attempt.verification_attempts || 0) >= EXTENSION_AUTH_VERIFY_LIMIT) {
    return NextResponse.json({
      success: false,
      message: 'Too many verification attempts. Start a new extension login.',
    }, { status: 429, headers: { 'Retry-After': '600' } })
  }

  const incremented = await pool.query(
    `UPDATE libro_extension_auth_attempts
     SET verification_attempts = verification_attempts + 1
     WHERE id = $1
       AND consumed_at IS NULL
       AND expires_at > CURRENT_TIMESTAMP
       AND verification_attempts < $2
     RETURNING id`,
    [attempt.id, EXTENSION_AUTH_VERIFY_LIMIT]
  )
  if (incremented.rows.length === 0) {
    return NextResponse.json({
      success: false,
      message: 'Too many verification attempts or the login attempt expired.',
    }, { status: 429, headers: { 'Retry-After': '600' } })
  }

  const intent: WorldIdAuthorAuthIntent = attempt.intent === 'signup' ? 'signup' : 'login'
  const token = createExtensionToken()

  try {
    const result = await verifyAndCreateOrConnectAuthor<{
      expiresAt: string
    }>({
      idkitResult: body.idkitResult,
      nonce: attempt.nonce,
      intent,
      profile: body.profile,
      expectedHandle: intent === 'signup' ? attempt.requested_handle : undefined,
      expectedUserId: intent === 'login' ? attempt.userId : undefined,
      expectedWorldIdSessionId: intent === 'login'
        ? attempt.world_id_session_id
        : undefined,
    }, {
      beforeAccountWrite: async (client) => {
        const consumed = await client.query(
          `UPDATE libro_extension_auth_attempts
           SET consumed_at = CURRENT_TIMESTAMP
           WHERE id = $1 AND consumed_at IS NULL AND expires_at > CURRENT_TIMESTAMP
           RETURNING id`,
          [attempt.id]
        )
        if (consumed.rows.length === 0) {
          throw new WorldIdAuthorAuthError(
            'Extension login attempt was already used',
            409,
            'ATTEMPT_CONSUMED',
          )
        }
      },
      afterAccountWrite: async (client, account) => {
        const sessionResult = await client.query(
          `INSERT INTO libro_extension_sessions ("userId", token_hash, expires_at, last_used_at)
           VALUES ($1, $2, CURRENT_TIMESTAMP + ($3 * INTERVAL '1 second'), CURRENT_TIMESTAMP)
           RETURNING expires_at`,
          [account.user.id, hashExtensionToken(token), EXTENSION_SESSION_MAX_AGE_SECONDS]
        )
        return {
          expiresAt: new Date(sessionResult.rows[0].expires_at).toISOString(),
        }
      },
    })

    return NextResponse.json({
      success: true,
      token,
      created: result.created,
      expiresAt: result.transport.expiresAt,
      user: result.user,
      author: result.author,
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (error instanceof WorldIdAuthorAuthError) {
      return NextResponse.json({
        success: false,
        message: error.message,
      }, { status: error.status })
    }
    return NextResponse.json({
      success: false,
      message: 'Failed to create extension session',
    }, { status: 500 })
  }
}
