import { NextResponse } from 'next/server'
import { AUTH_SESSION_COOKIE, getAuthSessionCookieOptions } from '@/lib/auth-session'

export async function POST() {
  const response = NextResponse.json({
    success: true,
  })

  response.cookies.set(AUTH_SESSION_COOKIE, '', {
    ...getAuthSessionCookieOptions(0),
    expires: new Date(0),
  })

  return response
}
