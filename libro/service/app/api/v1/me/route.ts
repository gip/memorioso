import { assertWritesEnabled, errorResponse } from '@/lib/errors'
import { authenticateBearer } from '@/lib/oauth'
import { pool } from '@/lib/db'
import { deliverPendingEvents, enqueueServiceEvent } from '@/lib/events'

export async function GET(request: Request): Promise<Response> {
  try {
    const resource = new URL('/api/v1', request.url).toString()
    const principal = await authenticateBearer(request, 'profile', resource)
    return Response.json({
      identityId: principal.identityId,
      authorId: principal.authorId,
      handle: principal.handle,
      name: principal.name,
      bio: principal.bio,
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    assertWritesEnabled()
    const resource = new URL('/api/v1', request.url).toString()
    const principal = await authenticateBearer(request, 'profile', resource)
    const body = await request.json() as { name?: unknown; bio?: unknown }
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const bio = typeof body.bio === 'string' ? body.bio.trim() : ''
    if (!name || name.length > 255 || bio.length > 10_000) {
      return Response.json({ error: { code: 'INVALID_PROFILE', message: 'Name is required and profile fields are too long', retryable: false } }, { status: 400 })
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
      return Response.json({ author }, { headers: { 'Cache-Control': 'no-store' } })
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  } catch (error) {
    return errorResponse(error)
  }
}
