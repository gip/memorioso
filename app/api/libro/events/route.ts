import { createHmac, timingSafeEqual } from 'node:crypto'
import { revalidateTag } from 'next/cache'
import { NextResponse } from 'next/server'
import { pool } from '@/lib/db'
import {
  authorPublicationCountsCacheTag,
  latestPublicationsCacheTag,
  publicationCacheTag,
  publicationHashCacheTag,
  sitemapCacheTag,
} from '@/lib/db/publication-cache'

type LibroEvent = {
  id: string
  type: 'publication.finalized' | 'author.updated'
  occurredAt: string
  originClientId: string | null
  aggregateId: string
  data: Record<string, unknown>
}

function validSignature(timestamp: string, body: string, supplied: string): boolean {
  const secret = process.env.LIBRO_WEBHOOK_SECRET
  if (!secret || !/^v1=[0-9a-f]{64}$/.test(supplied)) return false
  const expected = `v1=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`
  const left = Buffer.from(supplied)
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}

function stringField(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`${name} is required`)
  return value
}

export async function POST(request: Request): Promise<NextResponse> {
  const rawBody = await request.text()
  const timestamp = request.headers.get('x-libro-timestamp') || ''
  const signature = request.headers.get('x-libro-signature') || ''
  const eventId = request.headers.get('x-libro-event-id') || ''
  const timestampMs = Number(timestamp) * 1000
  if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > 5 * 60_000 || !validSignature(timestamp, rawBody, signature)) {
    return NextResponse.json({ error: 'Invalid or stale Libro webhook signature' }, { status: 401 })
  }

  let event: LibroEvent
  try {
    event = JSON.parse(rawBody) as LibroEvent
    if (event.id !== eventId || !/^[0-9a-f-]{36}$/i.test(event.id)) throw new Error('Event id mismatch')
    if (event.type !== 'publication.finalized' && event.type !== 'author.updated') throw new Error('Unsupported event type')
  } catch {
    return NextResponse.json({ error: 'Invalid Libro event' }, { status: 400 })
  }

  const client = await pool.connect()
  let publicationId: string | null = null
  let signalHash: string | null = null
  let authorId: string | null = null
  try {
    await client.query('BEGIN')
    const inserted = await client.query(
      `INSERT INTO processed_libro_events (event_id, event_type, occurred_at)
       VALUES ($1, $2, $3) ON CONFLICT (event_id) DO NOTHING RETURNING event_id`,
      [event.id, event.type, event.occurredAt],
    )
    if (!inserted.rows[0]) {
      await client.query('COMMIT')
      return NextResponse.json({ received: true, duplicate: true })
    }

    if (event.type === 'publication.finalized') {
      const expectedOrigin = process.env.LIBRO_OAUTH_CLIENT_ID
      if (!expectedOrigin || event.originClientId !== expectedOrigin) {
        await client.query('COMMIT')
        return NextResponse.json({ received: true, ignored: true })
      }
      publicationId = stringField(event.data.publicationId, 'publicationId')
      signalHash = stringField(event.data.signalHash, 'signalHash').toLowerCase()
      const clientReference = typeof event.data.clientReference === 'string' ? event.data.clientReference : null
      const pending = clientReference ? await client.query(
        `SELECT * FROM pending_libro_publications WHERE client_reference = $1 FOR UPDATE`,
        [clientReference],
      ) : { rows: [] }
      if (pending.rows[0]) {
        authorId = pending.rows[0].authorId
        if (pending.rows[0].signal_hash.toLowerCase() !== signalHash) throw new Error('Publication signal does not match pending link')
      } else if (event.data.authorshipClass === 'agent') {
        authorId = stringField(event.data.authorId, 'authorId')
        const projected = await client.query(
          `SELECT id FROM authors WHERE id = $1 AND libro_service_managed = TRUE FOR UPDATE`,
          [authorId],
        )
        if (!projected.rows[0]) throw new Error('Agent publication author is not in the local projection')
      } else {
        throw new Error('Pending publication link was not found')
      }
      await client.query(
        `INSERT INTO publication_policies
          (publication_id, signal_hash, "authorId", origin_client_id, access, access_price_usd)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (publication_id) DO UPDATE SET
           signal_hash = EXCLUDED.signal_hash, "authorId" = EXCLUDED."authorId",
           origin_client_id = EXCLUDED.origin_client_id, access = EXCLUDED.access,
           access_price_usd = EXCLUDED.access_price_usd, modified_at = CURRENT_TIMESTAMP`,
        [publicationId, signalHash, authorId, event.originClientId,
          pending.rows[0]?.access || 'public', pending.rows[0]?.access_price_usd || null],
      )
      if (pending.rows[0]) {
        await client.query(
          `INSERT INTO draft_publication_acknowledgements
            ("draftId", publication_id, signal_hash, service_event_id)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT ("draftId") DO UPDATE SET
             publication_id = EXCLUDED.publication_id, signal_hash = EXCLUDED.signal_hash,
             service_event_id = EXCLUDED.service_event_id, acknowledged_at = CURRENT_TIMESTAMP`,
          [pending.rows[0].draftId, publicationId, signalHash, event.id],
        )
        await client.query(
          `UPDATE pending_libro_publications SET acknowledged_at = CURRENT_TIMESTAMP
           WHERE service_challenge_id = $1`,
          [pending.rows[0].service_challenge_id],
        )
        await client.query(`UPDATE drafts SET status = 'published', modified_at = CURRENT_TIMESTAMP WHERE id = $1`, [pending.rows[0].draftId])
      }
    } else {
      const identityId = stringField(event.data.identityId, 'identityId')
      const serviceAuthorId = stringField(event.data.authorId, 'authorId')
      const handle = stringField(event.data.handle, 'handle')
      const name = stringField(event.data.name, 'name')
      const existing = await client.query(
        `SELECT a.id FROM users u JOIN authors a ON a."userId" = u.id
         WHERE u.libro_identity_id = $1 FOR UPDATE OF u, a`,
        [identityId],
      )
      if (existing.rows[0]) {
        authorId = existing.rows[0].id
        if (authorId !== serviceAuthorId) throw new Error('Libro author UUID does not match the local projection')
        const projected = await client.query(`SELECT handle FROM authors WHERE id = $1`, [authorId])
        if (projected.rows[0]?.handle !== handle) {
          throw new Error('Libro handle drift requires explicit projection reconciliation')
        }
        await client.query(
          `UPDATE authors SET name = $2, bio = $3,
             libro_service_managed = TRUE, modified_at = CURRENT_TIMESTAMP WHERE id = $1`,
          [authorId, name, typeof event.data.bio === 'string' ? event.data.bio : null],
        )
        await client.query(`UPDATE users SET name = $2, modified_at = CURRENT_TIMESTAMP WHERE libro_identity_id = $1`, [identityId, name])
      }
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    console.error('Failed to process Libro event', { eventId: event.id, error })
    return NextResponse.json({ error: 'Libro event could not be reconciled' }, { status: 409 })
  } finally {
    client.release()
  }

  if (publicationId && signalHash && authorId) {
    revalidateTag(publicationCacheTag(publicationId), { expire: 0 })
    revalidateTag(publicationHashCacheTag(signalHash), { expire: 0 })
    revalidateTag(authorPublicationCountsCacheTag(authorId), { expire: 0 })
    revalidateTag(sitemapCacheTag, { expire: 0 })
    revalidateTag(latestPublicationsCacheTag, { expire: 0 })
  } else if (authorId) {
    revalidateTag(authorPublicationCountsCacheTag(authorId), { expire: 0 })
    revalidateTag(sitemapCacheTag, { expire: 0 })
  }
  return NextResponse.json({ received: true })
}
