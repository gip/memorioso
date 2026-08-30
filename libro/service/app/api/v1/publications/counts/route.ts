import { errorResponse } from '@/lib/errors'
import { pool } from '@/lib/db'
import { authenticateServiceClient } from '@/lib/service-auth'

export async function GET(request: Request): Promise<Response> {
  try {
    const authorId = new URL(request.url).searchParams.get('authorId')
    if (!authorId) return Response.json({ error: { code: 'INVALID_REQUEST', message: 'authorId is required', retryable: false } }, { status: 400 })
    const originClientId = await authenticateServiceClient(request)
    const result = await pool.query(
      `SELECT COUNT(*) FILTER (WHERE NULLIF(BTRIM(title), '') IS NOT NULL)::int AS article,
        COUNT(*) FILTER (WHERE NULLIF(BTRIM(title), '') IS NULL)::int AS short
       FROM libro_publications WHERE author_id = $1 AND origin_client_id = $2`,
      [authorId, originClientId],
    )
    return Response.json({ article: Number(result.rows[0]?.article || 0), short: Number(result.rows[0]?.short || 0) })
  } catch (error) {
    return errorResponse(error)
  }
}
