import { pool } from '@/lib/db'
import { isValidHandle, normalizeHandle } from '@/lib/handles'
import { z } from 'zod'

export const schema = z.object({ handle: z.string() })

export async function execute(args: z.infer<typeof schema>) {
  const handle = normalizeHandle(args.handle)
  if (!isValidHandle(handle)) {
    return { success: true, valid: false, exists: false, canLogin: false }
  }
  const result = await pool.query(
    `SELECT i.id AS identity_id FROM libro_authors a
     LEFT JOIN libro_identities i ON i.id = a.identity_id AND i.revoked_at IS NULL
     WHERE a.handle = $1`,
    [handle],
  )
  return { success: true, valid: true, exists: result.rows.length > 0,
    canLogin: Boolean(result.rows[0]?.identity_id) }
}
