import { NextRequest, NextResponse } from 'next/server'
import {
  AUTH_SESSION_COOKIE,
  createLibroAuthSessionToken,
  getAuthSessionCookieOptions,
} from '@/lib/auth-session'
import { pool } from '@/lib/db'
import { LIBRO_OAUTH_FLOW_COOKIE, readLibroOAuthFlow } from '@/lib/libro-service/oauth-state'
import { storeLibroTokens } from '@/lib/libro-service/token-store'

type TokenResponse = {
  access_token: string
  refresh_token: string
  expires_in: number
  scope: string
}

type Profile = {
  identityId: string
  authorId: string
  handle: string
  name: string
  bio: string
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const flow = readLibroOAuthFlow(request.cookies.get(LIBRO_OAUTH_FLOW_COOKIE)?.value)
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const issuer = url.searchParams.get('iss')
  const serviceUrl = process.env.LIBRO_SERVICE_URL
  const clientId = process.env.LIBRO_OAUTH_CLIENT_ID
  const clientSecret = process.env.LIBRO_OAUTH_CLIENT_SECRET
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (!flow || !code || state !== flow.state || !serviceUrl || !clientId || !clientSecret || !appUrl || issuer !== new URL(serviceUrl).origin) {
    return NextResponse.json({ error: 'Libro OAuth callback is invalid or expired' }, { status: 400 })
  }
  const redirectUri = new URL('/api/auth/libro/callback', appUrl).toString()
  const resource = new URL('/api/v1', serviceUrl).toString()
  const tokenResponse = await fetch(new URL('/oauth/token', serviceUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code', code, client_id: clientId,
      redirect_uri: redirectUri, resource, code_verifier: flow.verifier,
    }),
    cache: 'no-store',
  })
  const tokens = await tokenResponse.json().catch(() => null) as TokenResponse | null
  if (!tokenResponse.ok || !tokens?.access_token || !tokens.refresh_token) {
    return NextResponse.json({ error: 'Libro OAuth token exchange failed' }, { status: 502 })
  }
  const profileResponse = await fetch(new URL('/api/v1/me', serviceUrl), {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
    cache: 'no-store',
  })
  const profile = await profileResponse.json().catch(() => null) as Profile | null
  if (!profileResponse.ok || !profile?.identityId || !profile.authorId) {
    return NextResponse.json({ error: 'Libro profile lookup failed' }, { status: 502 })
  }

  const client = await pool.connect()
  let userId: number
  try {
    await client.query('BEGIN')
    const existing = await client.query(
      `SELECT u.id, u.handle AS user_handle, a.id AS author_id, a.handle AS author_handle FROM users u
       LEFT JOIN authors a ON a."userId" = u.id
       WHERE u.libro_identity_id = $1 OR a.id = $2
       ORDER BY (u.libro_identity_id = $1) DESC LIMIT 1 FOR UPDATE OF u`,
      [profile.identityId, profile.authorId],
    )
    if (existing.rows[0]) {
      userId = existing.rows[0].id
      if (existing.rows[0].author_id && existing.rows[0].author_id !== profile.authorId) throw new Error('Libro author UUID does not match the local projection')
      if (existing.rows[0].user_handle !== profile.handle || existing.rows[0].author_handle !== profile.handle) {
        throw new Error('Libro handle does not match the local projection')
      }
      await client.query(
        `UPDATE users SET libro_identity_id = $2, name = $3,
         modified_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [userId, profile.identityId, profile.name],
      )
      await client.query(
        `UPDATE authors SET name = $2, bio = $3,
         libro_service_managed = TRUE, modified_at = CURRENT_TIMESTAMP WHERE "userId" = $1`,
        [userId, profile.name, profile.bio || null],
      )
    } else {
      const inserted = await client.query(
        `INSERT INTO users (name, handle, libro_identity_status, libro_identity_id)
         VALUES ($1, $2, 'legacy', $3) RETURNING id`,
        [profile.name, profile.handle, profile.identityId],
      )
      userId = inserted.rows[0].id
      await client.query(
        `INSERT INTO authors (id, "userId", name, handle, bio, libro_service_managed)
         VALUES ($1, $2, $3, $4, $5, TRUE)`,
        [profile.authorId, userId, profile.name, profile.handle, profile.bio || null],
      )
    }
    await storeLibroTokens(client, {
      userId,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresIn: tokens.expires_in || 900,
      scope: tokens.scope || 'openid profile',
    })
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    console.error('Failed to reconcile Libro OAuth identity', { error })
    return NextResponse.json({ error: 'Libro identity conflicts with the local projection' }, { status: 409 })
  } finally {
    client.release()
  }

  const response = NextResponse.redirect(new URL(flow.returnTo, appUrl))
  response.cookies.set(AUTH_SESSION_COOKIE, createLibroAuthSessionToken(userId, profile.identityId), getAuthSessionCookieOptions())
  response.cookies.set(LIBRO_OAUTH_FLOW_COOKIE, '', { ...getAuthSessionCookieOptions(0), expires: new Date(0) })
  return response
}
