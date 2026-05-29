import { NextRequest, NextResponse } from 'next/server'
import {
  isWorldIdSessionId,
  WORLD_ID_ALLOWED_CREDENTIALS,
  WORLD_ID_AUTH_NONCE_COOKIE,
  WORLD_ID_SESSION_HINT_COOKIE,
} from '@/lib/world-id/constants'
import { createRpContext, getWorldIdServerConfig } from '@/lib/world-id/server'

export async function GET(request: NextRequest) {
  const existingSessionId = request.cookies.get(WORLD_ID_SESSION_HINT_COOKIE)?.value
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
