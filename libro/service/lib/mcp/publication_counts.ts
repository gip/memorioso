import { pool } from '@/lib/db'
import { authenticateServiceClient } from '@/lib/service-auth'
import { ServiceError } from '@/lib/errors'
import { z } from 'zod'

export const schema = z.object({ authorId: z.string().uuid() })

export async function execute(args: z.infer<typeof schema>, request: Request) {
  const authorId = args.authorId
  if (!authorId) throw new ServiceError('INVALID_REQUEST', 'authorId is required', 400)
  const originClientId = await authenticateServiceClient(request)
  const result = await pool.query(
    `SELECT COUNT(*) FILTER (WHERE NULLIF(BTRIM(title), '') IS NOT NULL)::int AS article,
      COUNT(*) FILTER (WHERE NULLIF(BTRIM(title), '') IS NULL)::int AS short
     FROM libro_publications WHERE author_id = $1 AND origin_client_id = $2`,
    [authorId, originClientId],
  )
  return { article: Number(result.rows[0]?.article || 0), short: Number(result.rows[0]?.short || 0) }
}
