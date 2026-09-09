import { errorResponse } from '@/lib/errors'
import { issueRpContext } from '@/lib/world-id'
import { pool } from '@/lib/db'
import { isValidHandle, normalizeHandle } from '@/lib/handles'
import { assertWritesEnabled } from '@/lib/errors'

export async function POST(request: Request): Promise<Response> {
  try {
    assertWritesEnabled()
    const body = await request.json().catch(() => null) as { purpose?: unknown; clientId?: unknown; handle?: unknown } | null
    if (body?.purpose !== 'login' && body?.purpose !== 'signup') {
      return Response.json({ error: { code: 'INVALID_PURPOSE', message: 'Purpose must be login or signup', retryable: false } }, { status: 400 })
    }
    let existingSessionId: string | null = null
    let identityId: string | null = null
    let commitment: string | null = null
    if (body.purpose === 'login') {
      const handle = normalizeHandle(typeof body.handle === 'string' ? body.handle : '')
      if (!isValidHandle(handle)) {
        return Response.json({ error: { code: 'INVALID_HANDLE', message: 'A valid handle is required', retryable: false } }, { status: 400 })
      }
      // A session identifier selects the proof request; only a fresh verified proof authenticates it.
      const result = await pool.query(
        `SELECT i.id, i.world_id_session_id, i.session_commitment FROM libro_authors a
         JOIN libro_identities i ON i.id = a.identity_id
         WHERE a.handle = $1 AND i.revoked_at IS NULL`,
        [handle],
      )
      identityId = result.rows[0]?.id || null
      commitment = result.rows[0]?.session_commitment || null
      existingSessionId = result.rows[0]?.world_id_session_id || null
      if (!existingSessionId) {
        return Response.json({ error: { code: 'IDENTITY_NOT_FOUND', message: 'No Libro identity is linked to that handle', retryable: false } }, { status: 401 })
      }
    }
    const context = await issueRpContext({ request, purpose: body.purpose,
      clientId: typeof body.clientId === 'string' ? body.clientId : null,
      identityId, expectedCommitment: commitment,
    })
    return Response.json({ success: true, ...context, existingSessionId }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return errorResponse(error)
  }
}
