import { pool } from '@/lib/db'
import { authenticateServiceClient } from '@/lib/service-auth'
import { z } from 'zod'

export const schema = z.object({ limit: z.number().int().min(1).max(40000).default(40000) })

export async function execute(args: z.infer<typeof schema>, request: Request) {
  const value = args.limit
  const limit = Math.min(40_000, Math.max(1, Number.isSafeInteger(value) ? value : 40_000))
  const originClientId = await authenticateServiceClient(request)
  const result = await pool.query(
    `SELECT id::text, title, modified_at FROM libro_publications
     WHERE origin_client_id = $1 ORDER BY date DESC LIMIT $2`,
    [originClientId, limit],
  )
  return { publications: result.rows.map((row) => ({
    id: row.id,
    kind: String(row.title).trim() ? 'article' : 'short',
    lastModified: new Date(row.modified_at).toISOString(),
  })) }
}
