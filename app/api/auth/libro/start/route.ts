import { NextResponse } from 'next/server'
import { beginLibroOAuthFlow, LIBRO_OAUTH_FLOW_COOKIE } from '@/lib/libro-service/oauth-state'
import { getAuthSessionCookieOptions } from '@/lib/auth-session'

export async function GET(request: Request): Promise<NextResponse> {
  const serviceUrl = process.env.LIBRO_SERVICE_URL
  const clientId = process.env.LIBRO_OAUTH_CLIENT_ID
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (!serviceUrl || !clientId || !appUrl) return NextResponse.json({ error: 'Libro OAuth configuration is incomplete' }, { status: 500 })
  const requestUrl = new URL(request.url)
  const { flow, cookie, challenge } = beginLibroOAuthFlow(requestUrl.searchParams.get('returnTo') || '/')
  const redirectUri = new URL('/api/auth/libro/callback', appUrl).toString()
  const resource = new URL('/api/v1', serviceUrl).toString()
  const destination = new URL('/oauth/authorize', serviceUrl)
  destination.search = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    resource,
    scope: 'openid profile publish claim_handle register_agent import',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: flow.state,
  }).toString()
  const response = NextResponse.redirect(destination)
  response.cookies.set(LIBRO_OAUTH_FLOW_COOKIE, cookie, getAuthSessionCookieOptions(10 * 60))
  return response
}
