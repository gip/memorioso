import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'
import { isValidUserHandle, normalizeUserHandle } from '@/lib/handle'
import {
  isWorldIdSessionId,
  WORLD_ID_ALLOWED_CREDENTIALS,
  WORLD_ID_AUTH_NONCE_COOKIE,
  WORLD_ID_SESSION_HINT_COOKIE,
} from '@/lib/world-id/constants'
import { createRpContext, getWorldIdServerConfig } from '@/lib/world-id/server'

async function findSessionIdByHandle(handle: string): Promise<string | null> {
  const client = await pool.connect()

  try {
    const { rows } = await client.query(
      `SELECT world_id_session_id FROM users WHERE handle = $1`,
      [handle]
    )
    return rows.length > 0 ? rows[0].world_id_session_id : null
  } finally {
    client.release()
  }
}

export async function GET(request: NextRequest) {
  const rawHandle = request.nextUrl.searchParams.get('handle')
  const cookieSessionId = request.cookies.get(WORLD_ID_SESSION_HINT_COOKIE)?.value
  let existingSessionId: string | null | undefined = cookieSessionId

  if (rawHandle !== null) {
    const handle = normalizeUserHandle(rawHandle)
    if (!isValidUserHandle(handle)) {
      return NextResponse.json({
        message: 'That name is not a valid handle',
      }, { status: 400 })
    }

    existingSessionId = await findSessionIdByHandle(handle)
    if (!isWorldIdSessionId(existingSessionId)) {
      return NextResponse.json({
        message: 'No World ID login is linked to that name',
      }, { status: 404 })
    }
  }

  let rpContext
  let config
  try {
    config = getWorldIdServerConfig()
    rpContext = createRpContext(config)
  } catch (error) {
    return NextResponse.json({
      message: error instanceof Error ? error.message : 'World ID configuration is invalid',
    }, { status: 500 })
  }

  const response = NextResponse.json({
    success: true,
    appId: config.appId,
    environment: config.environment,
    rpContext,
    existingSessionId: isWorldIdSessionId(existingSessionId) ? existingSessionId : null,
    allowedCredentials: WORLD_ID_ALLOWED_CREDENTIALS,
  })
  response.cookies.set(WORLD_ID_AUTH_NONCE_COOKIE, rpContext.nonce, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: new Date(rpContext.expires_at * 1000),
  })

  return response
}
