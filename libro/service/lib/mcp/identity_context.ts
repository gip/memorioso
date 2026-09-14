import { issueRpContext } from '@/lib/world-id'
import { pool } from '@/lib/db'
import { isValidHandle, normalizeHandle } from '@/lib/handles'
import { assertWritesEnabled } from '@/lib/errors'
import { ServiceError } from '@/lib/errors'
import { z } from 'zod'

export const schema = z.object({
  purpose: z.enum(['login', 'signup']),
  clientId: z.string().optional(),
  handle: z.string().optional(),
})

export async function execute(args: z.infer<typeof schema>, request: Request) {
  assertWritesEnabled()
  const body = args
  if (body?.purpose !== 'login' && body?.purpose !== 'signup') {
    throw new ServiceError('INVALID_PURPOSE', 'Purpose must be login or signup', 400)
  }
  let existingSessionId: string | null = null
  let identityId: string | null = null
  let commitment: string | null = null
  if (body.purpose === 'login') {
    const handle = normalizeHandle(typeof body.handle === 'string' ? body.handle : '')
    if (!isValidHandle(handle)) {
      throw new ServiceError('INVALID_HANDLE', 'A valid handle is required', 400)
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
      throw new ServiceError('IDENTITY_NOT_FOUND', 'No Libro identity is linked to that handle', 401)
    }
  }
  const context = await issueRpContext({ request, purpose: body.purpose,
    clientId: typeof body.clientId === 'string' ? body.clientId : null,
    identityId, expectedCommitment: commitment,
  })
  return { success: true, ...context, existingSessionId }
}
