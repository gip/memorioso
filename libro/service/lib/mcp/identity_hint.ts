import { cookies } from 'next/headers'
import { pool } from '@/lib/db'
import { browserIdentityId, LIBRO_WORLD_SESSION_HINT_COOKIE, verifyWorldSessionHint } from '@/lib/session'
import { z } from 'zod'

export const schema = z.object({})

export async function execute(args: z.infer<typeof schema>) {
  const store = await cookies()
  const hint = verifyWorldSessionHint(store.get(LIBRO_WORLD_SESSION_HINT_COOKIE)?.value)
  const identityId = await browserIdentityId()
  const result = hint || identityId ? await pool.query(
    `SELECT a.handle, i.id FROM libro_authors a JOIN libro_identities i ON i.id = a.identity_id
     WHERE (i.id = $1 OR i.world_id_session_id = $2) AND i.revoked_at IS NULL
     ORDER BY (i.id = $1) DESC NULLS LAST LIMIT 1`, [identityId, hint],
  ) : { rows: [] }
  return { continueAs: result.rows[0]?.handle || null,
    authenticated: Boolean(identityId && result.rows[0]?.id === identityId) }
}
