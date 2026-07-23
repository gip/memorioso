import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'
import { isValidUserHandle, normalizeUserHandle } from '@/lib/handle'
import { createRpContext, getWorldIdServerConfig } from '@/lib/world-id/server'
import { isWorldIdSessionId, WORLD_ID_ALLOWED_CREDENTIALS } from '@/lib/world-id/constants'

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await request.json().catch(() => null) as { handle?: unknown, intent?: unknown } | null
  const handle = typeof body?.handle === 'string' ? normalizeUserHandle(body.handle) : ''
  const intent = body?.intent === undefined ? 'login' : body.intent

  if (intent !== 'login' && intent !== 'signup') {
    return NextResponse.json({ success: false, message: 'A valid extension auth intent is required' }, { status: 400 })
  }

  if (!isValidUserHandle(handle)) {
    return NextResponse.json({ success: false, message: 'A valid Memorioso handle is required' }, { status: 400 })
  }

  let config
  try {
    config = getWorldIdServerConfig()
  } catch (error) {
    return NextResponse.json({
      success: false,
      message: error instanceof Error ? error.message : 'World ID configuration is invalid',
    }, { status: 500 })
  }

  let userId: number | null = null
  let existingSessionId: string | null = null

  if (intent === 'login') {
    const { rows } = await pool.query(
      `SELECT u.id, u.world_id_session_id
       FROM users u
       INNER JOIN authors a ON a."userId" = u.id
       WHERE u.handle = $1 AND a.handle = $1`,
      [handle]
    )
    if (rows.length === 0 || !isWorldIdSessionId(rows[0].world_id_session_id)) {
      return NextResponse.json({
        success: false,
        message: 'No World ID login is linked to that Memorioso handle',
      }, { status: 404 })
    }
    userId = rows[0].id
    existingSessionId = rows[0].world_id_session_id
  } else {
    const { rows } = await pool.query(
      `SELECT
         EXISTS (SELECT 1 FROM users WHERE handle = $1)
           OR EXISTS (SELECT 1 FROM authors WHERE handle = $1) AS taken`,
      [handle]
    )
    if (rows[0]?.taken === true) {
      return NextResponse.json({
        success: false,
        message: 'That handle is already taken',
      }, { status: 409 })
    }
  }

  const rpContext = createRpContext(config)
  const attemptId = randomUUID()
  await pool.query(
    `INSERT INTO libro_extension_auth_attempts (id, "userId", intent, nonce, expires_at)
     VALUES ($1, $2, $3, $4, to_timestamp($5))`,
    [attemptId, userId, intent, rpContext.nonce, rpContext.expires_at]
  )

  return NextResponse.json({
    success: true,
    intent,
    attemptId,
    appId: config.appId,
    environment: config.environment,
    rpContext,
    existingSessionId,
    allowedCredentials: WORLD_ID_ALLOWED_CREDENTIALS,
  }, { headers: { 'Cache-Control': 'no-store' } })
}
