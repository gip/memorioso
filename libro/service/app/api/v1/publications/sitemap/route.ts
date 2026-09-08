import { errorResponse } from '@/lib/errors'
import { pool } from '@/lib/db'
import { authenticateServiceClient } from '@/lib/service-auth'

export async function GET(request: Request): Promise<Response> {
  try {
    const value = Number(new URL(request.url).searchParams.get('limit') || 40_000)
    const limit = Math.min(40_000, Math.max(1, Number.isSafeInteger(value) ? value : 40_000))
    const originClientId = await authenticateServiceClient(request)
    const result = await pool.query(
      `SELECT id::text, title, modified_at FROM libro_publications
       WHERE origin_client_id = $1 ORDER BY date DESC LIMIT $2`,
      [originClientId, limit],
    )
    return Response.json({ publications: result.rows.map((row) => ({
      id: row.id,
      kind: String(row.title).trim() ? 'article' : 'short',
      lastModified: new Date(row.modified_at).toISOString(),
    })) })
  } catch (error) {
    return errorResponse(error)
  }
}
