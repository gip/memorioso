import { NextResponse } from 'next/server'
import { AUTH_SESSION_COOKIE, getAuthSessionCookieOptions } from '@/lib/auth-session'
import { getAuthenticatedUser } from '@/lib/auth-user'
import { clearLibroTokens } from '@/lib/libro-service/token-store'

export async function POST() {
  if (process.env.LIBRO_SERVICE_WRITES_ENABLED === '1') {
    const user = await getAuthenticatedUser().catch(() => null)
    if (user) await clearLibroTokens(user.id).catch(() => undefined)
  }
  const response = NextResponse.json({
    success: true,
  })

  response.cookies.set(AUTH_SESSION_COOKIE, '', {
    ...getAuthSessionCookieOptions(0),
    expires: new Date(0),
  })

  // Keep the non-authenticating hint for the next "Continue as" login.
  for (const name of ['libro_identity_session', 'libro_oauth_consent']) {
    response.cookies.set(name, '', { ...getAuthSessionCookieOptions(0), path: '/api/libro/browser', expires: new Date(0) })
  }
  return response
}
