import { NextResponse } from 'next/server'
import { WORLD_ID_ALLOWED_CREDENTIALS, WORLD_ID_AUTH_NONCE_COOKIE } from '@/lib/world-id/constants'
import { createRpContext, getWorldIdServerConfig } from '@/lib/world-id/server'

export async function POST() {
  let config
  try {
    config = getWorldIdServerConfig()
  } catch (error) {
    return NextResponse.json({
      success: false,
      message: error instanceof Error ? error.message : "World ID configuration is invalid",
    }, { status: 500 })
  }

  const rpContext = createRpContext(config)
  const response = NextResponse.json({
    success: true,
    appId: config.appId,
    environment: config.environment,
    rpContext,
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
