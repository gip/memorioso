import { pool } from '@/lib/db'
import { errorResponse } from '@/lib/errors'
import { isValidHandle, normalizeHandle } from '@/lib/handles'

export async function GET(request: Request): Promise<Response> {
  try {
    const handle = normalizeHandle(new URL(request.url).searchParams.get('handle') || '')
    const headers = { 'Cache-Control': 'no-store' }
    if (!isValidHandle(handle)) {
      return Response.json({ success: true, valid: false, exists: false, canLogin: false }, { headers })
    }
    const result = await pool.query(
      `SELECT i.id AS identity_id FROM libro_authors a
       LEFT JOIN libro_identities i ON i.id = a.identity_id AND i.revoked_at IS NULL
       WHERE a.handle = $1`,
      [handle],
    )
    return Response.json({ success: true, valid: true, exists: result.rows.length > 0,
      canLogin: Boolean(result.rows[0]?.identity_id) }, { headers })
  } catch (error) { return errorResponse(error) }
}
