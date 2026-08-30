import { errorResponse } from '@/lib/errors'
import { issueRpContext } from '@/lib/world-id'
import { pool } from '@/lib/db'
import { isValidHandle, normalizeHandle } from '@/lib/handles'
import { cookies } from 'next/headers'
import { LIBRO_WORLD_SESSION_HINT_COOKIE, verifyWorldSessionHint } from '@/lib/session'
import { assertWritesEnabled } from '@/lib/errors'

export async function POST(request: Request): Promise<Response> {
  try {
    assertWritesEnabled()
    const body = await request.json().catch(() => null) as { purpose?: unknown; clientId?: unknown; handle?: unknown } | null
    if (body?.purpose !== 'login' && body?.purpose !== 'signup') {
      return Response.json({ error: { code: 'INVALID_PURPOSE', message: 'Purpose must be login or signup', retryable: false } }, { status: 400 })
    }
    const context = await issueRpContext({
      request,
      purpose: body.purpose,
      clientId: typeof body.clientId === 'string' ? body.clientId : null,
    })
    let existingSessionId: string | null = null
    if (body.purpose === 'login' && typeof body.handle === 'string') {
      const handle = normalizeHandle(body.handle)
      if (!isValidHandle(handle)) {
        return Response.json({ error: { code: 'INVALID_HANDLE', message: 'A valid handle is required', retryable: false } }, { status: 400 })
      }
      const store = await cookies()
      const hint = verifyWorldSessionHint(store.get(LIBRO_WORLD_SESSION_HINT_COOKIE)?.value)
      const result = hint ? await pool.query(
        `SELECT i.world_id_session_id FROM libro_authors a
         JOIN libro_identities i ON i.id = a.identity_id
         WHERE a.handle = $1 AND i.world_id_session_id = $2`,
        [handle, hint],
      ) : { rows: [] }
      existingSessionId = result.rows[0]?.world_id_session_id || null
      if (!existingSessionId) {
        return Response.json({ error: { code: 'SESSION_HINT_REQUIRED', message: 'Use the browser that created this Libro identity, or recover the World session first', retryable: false } }, { status: 401 })
      }
    }
    return Response.json({ success: true, ...context, existingSessionId }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return errorResponse(error)
  }
}
