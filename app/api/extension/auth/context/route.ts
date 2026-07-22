import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'
import { isValidUserHandle, normalizeUserHandle } from '@/lib/handle'
import { createRpContext, getWorldIdServerConfig } from '@/lib/world-id/server'
import { isWorldIdSessionId, WORLD_ID_ALLOWED_CREDENTIALS } from '@/lib/world-id/constants'

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await request.json().catch(() => null) as { handle?: unknown } | null
  const handle = typeof body?.handle === 'string' ? normalizeUserHandle(body.handle) : ''
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

  const rpContext = createRpContext(config)
  const attemptId = randomUUID()
  await pool.query(
    `INSERT INTO libro_extension_auth_attempts (id, "userId", nonce, expires_at)
     VALUES ($1, $2, $3, to_timestamp($4))`,
    [attemptId, rows[0].id, rpContext.nonce, rpContext.expires_at]
  )

  return NextResponse.json({
    success: true,
    attemptId,
    appId: config.appId,
    environment: config.environment,
    rpContext,
    existingSessionId: rows[0].world_id_session_id,
    allowedCredentials: WORLD_ID_ALLOWED_CREDENTIALS,
  }, { headers: { 'Cache-Control': 'no-store' } })
}
