import { setBrowserCookie } from './context'
import {
  createIdentitySession,
  createWorldSessionHint,
  identitySessionCookieOptions,
  LIBRO_SESSION_COOKIE,
  LIBRO_WORLD_SESSION_HINT_COOKIE,
} from '@/lib/session'
import { verifyIdentity } from '@/lib/world-id'
import { assertWritesEnabled } from '@/lib/errors'
import { ServiceError } from '@/lib/errors'
import { z } from 'zod'

export const schema = z.object({
  purpose: z.enum(['login', 'signup']),
  payload: z.unknown(),
  handle: z.string().optional(),
  name: z.string().optional(),
  bio: z.string().optional(),
})

export async function execute(args: z.infer<typeof schema>) {
    assertWritesEnabled()
    const body = args
    if (!body || (body.purpose !== 'login' && body.purpose !== 'signup')) {
      throw new ServiceError('INVALID_REQUEST', 'A login or signup proof is required', 400)
    }
    const result = await verifyIdentity({
      payload: body.payload,
      purpose: body.purpose,
      handle: typeof body.handle === 'string' ? body.handle : undefined,
      name: typeof body.name === 'string' ? body.name : undefined,
      bio: typeof body.bio === 'string' ? body.bio : undefined,
    })
    setBrowserCookie(LIBRO_SESSION_COOKIE, createIdentitySession(result.identityId), identitySessionCookieOptions)
    const sessionId = (body.payload as { session_id?: unknown })?.session_id
    if (typeof sessionId === 'string') {
      setBrowserCookie(LIBRO_WORLD_SESSION_HINT_COOKIE, createWorldSessionHint(sessionId), {
        ...identitySessionCookieOptions,
        // Remember the login name independently of the one-day authenticated session.
        maxAge: 60 * 60 * 24 * 365,
      })
    }
    return { success: true, identity: result }
}
