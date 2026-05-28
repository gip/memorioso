import { NextResponse } from 'next/server'
import { DEFAULT_WORLD_ID_LOGIN_ACTION, WORLD_ID_AUTH_NONCE_COOKIE } from '@/lib/world-id/constants'
import { createRpContext, getWorldIdServerConfig } from '@/lib/world-id/server'

export async function GET() {
  const action = DEFAULT_WORLD_ID_LOGIN_ACTION
  let rpContext
  try {
    const config = getWorldIdServerConfig()
    rpContext = createRpContext(config, action)
  } catch (error) {
    return NextResponse.json({
      message: error instanceof Error ? error.message : 'World ID configuration is invalid',
    }, { status: 500 })
  }

  const response = NextResponse.json({
    action,
    rpContext,
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
