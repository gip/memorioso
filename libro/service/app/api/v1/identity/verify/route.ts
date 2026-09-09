import { cookies } from 'next/headers'
import { errorResponse } from '@/lib/errors'
import {
  createIdentitySession,
  createWorldSessionHint,
  identitySessionCookieOptions,
  LIBRO_SESSION_COOKIE,
  LIBRO_WORLD_SESSION_HINT_COOKIE,
} from '@/lib/session'
import { verifyIdentity } from '@/lib/world-id'
import { assertWritesEnabled } from '@/lib/errors'

export async function POST(request: Request): Promise<Response> {
  try {
    assertWritesEnabled()
    const body = await request.json().catch(() => null) as {
      payload?: unknown
      purpose?: unknown
      handle?: unknown
      name?: unknown
      bio?: unknown
    } | null
    if (!body || (body.purpose !== 'login' && body.purpose !== 'signup')) {
      return Response.json({ error: { code: 'INVALID_REQUEST', message: 'A login or signup proof is required', retryable: false } }, { status: 400 })
    }
    const result = await verifyIdentity({
      payload: body.payload,
      purpose: body.purpose,
      handle: typeof body.handle === 'string' ? body.handle : undefined,
      name: typeof body.name === 'string' ? body.name : undefined,
      bio: typeof body.bio === 'string' ? body.bio : undefined,
    })
    const store = await cookies()
    store.set(LIBRO_SESSION_COOKIE, createIdentitySession(result.identityId), identitySessionCookieOptions)
    const sessionId = (body.payload as { session_id?: unknown })?.session_id
    if (typeof sessionId === 'string') {
      store.set(LIBRO_WORLD_SESSION_HINT_COOKIE, createWorldSessionHint(sessionId), {
        ...identitySessionCookieOptions,
        // Remember the login name independently of the one-day authenticated session.
        maxAge: 60 * 60 * 24 * 365,
      })
    }
    return Response.json({ success: true, identity: result }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return errorResponse(error)
  }
}
