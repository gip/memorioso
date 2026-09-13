import { assertWritesEnabled } from '@/lib/errors'
import { authenticateBearer } from '@/lib/oauth'
import { pool } from '@/lib/db'
import { deliverPendingEvents, enqueueServiceEvent } from '@/lib/events'
import { ServiceError } from '@/lib/errors'
import { mcpResource } from '@/lib/config'
import { z } from 'zod'

export const schema = z.object({ name: z.string().min(1).max(255), bio: z.string().max(10000).optional() })

export async function execute(args: z.infer<typeof schema>, request: Request) {
  assertWritesEnabled()
  const resource = mcpResource()
  const principal = await authenticateBearer(request, 'profile', resource)
  const body = args
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const bio = typeof body.bio === 'string' ? body.bio.trim() : ''
  if (!name || name.length > 255 || bio.length > 10_000) {
    throw new ServiceError('INVALID_PROFILE', 'Name is required and profile fields are too long', 400)
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const updated = await client.query(
      `UPDATE libro_authors SET name = $2, bio = NULLIF($3, ''), modified_at = CURRENT_TIMESTAMP
       WHERE id = $1 RETURNING id, identity_id, handle, name, bio, modified_at`,
      [principal.authorId, name, bio],
    )
    const author = updated.rows[0]
    if (!author) throw new Error('Libro author projection is missing')
    await enqueueServiceEvent(client, {
      type: 'author.updated',
      aggregateId: author.id,
      data: {
        identityId: author.identity_id,
        authorId: author.id,
        handle: author.handle,
        name: author.name,
        bio: author.bio,
        modifiedAt: new Date(author.modified_at).toISOString(),
      },
    })
    await client.query('COMMIT')
    await deliverPendingEvents(25).catch(() => undefined)
    return { author }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
