import { NextRequest, NextResponse } from 'next/server'
import { AUTH_SESSION_COOKIE, createAuthSessionToken, getAuthSessionCookieOptions } from '@/lib/auth-session'
import { normalizeUserHandle } from '@/lib/handle'
import {
  WORLD_ID_AUTH_NONCE_COOKIE,
  WORLD_ID_SESSION_HINT_COOKIE,
  WORLD_ID_SESSION_HINT_MAX_AGE_SECONDS,
} from '@/lib/world-id/constants'
import {
  verifyAndCreateOrConnectAuthor,
  WorldIdAuthorAuthError,
  type WorldIdAuthorAuthIntent,
} from '@/lib/world-id/author-auth'

type VerifyRequestBody = {
  payload?: unknown
  nonce?: unknown
  handle?: unknown
  intent?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export async function POST(request: NextRequest) {
  const cookieNonce = request.cookies.get(WORLD_ID_AUTH_NONCE_COOKIE)?.value
  const body = await request.json().catch(() => null) as VerifyRequestBody | null
  const payload = isRecord(body) && 'payload' in body ? body.payload : body
  const nonce = typeof body?.nonce === 'string'
    ? body.nonce
    : isRecord(payload) && typeof payload.nonce === 'string'
      ? payload.nonce
      : null
  const intent = body?.intent === 'login' || body?.intent === 'signup'
    ? body.intent as WorldIdAuthorAuthIntent
    : null

  if (!payload || !nonce || !cookieNonce || nonce !== cookieNonce || !intent) {
    return NextResponse.json({
      success: false,
      message: 'World ID login context is invalid',
    }, { status: 400 })
  }

  const signupHandle = typeof body?.handle === 'string'
    ? normalizeUserHandle(body.handle)
    : ''

  try {
    const result = await verifyAndCreateOrConnectAuthor({
      idkitResult: payload,
      nonce,
      intent,
      profile: intent === 'signup'
        ? { handle: signupHandle, name: signupHandle, bio: '' }
        : undefined,
    })
    const { user } = result
    const response = NextResponse.json({
      success: true,
      authenticated: true,
      user,
    })

    response.cookies.set(
      AUTH_SESSION_COOKIE,
      createAuthSessionToken(user.id, user.worldIdSessionId),
      getAuthSessionCookieOptions()
    )
    response.cookies.set(WORLD_ID_AUTH_NONCE_COOKIE, '', {
      ...getAuthSessionCookieOptions(0),
      expires: new Date(0),
    })
    response.cookies.set(WORLD_ID_SESSION_HINT_COOKIE, user.worldIdSessionId, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: WORLD_ID_SESSION_HINT_MAX_AGE_SECONDS,
    })

    return response
  } catch (error) {
    if (error instanceof WorldIdAuthorAuthError) {
      return NextResponse.json({
        success: false,
        message: error.message,
        ...(error.verifierResponse === undefined
          ? {}
          : { verifierResponse: error.verifierResponse }),
      }, { status: error.status })
    }
    return NextResponse.json({
      success: false,
      message: 'World ID login failed',
    }, { status: 500 })
  }
}
