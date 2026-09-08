import { revalidateTag } from 'next/cache'
import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedUser } from '@/lib/auth-user'
import { pool } from '@/lib/db'
import {
  authorPublicationCountsCacheTag,
  latestPublicationsCacheTag,
  publicationCacheTag,
  publicationHashCacheTag,
  sitemapCacheTag,
} from '@/lib/db/publication-cache'
import { getServiceHumanPublicationStatus } from '@/lib/libro-service/client'

export async function GET(request: NextRequest, context: { params: Promise<{ draftId: string }> }): Promise<NextResponse> {
  const user = await getAuthenticatedUser(request)
  if (!user) return NextResponse.json({ success: false, message: 'Authentication required' }, { status: 401 })
  const { draftId } = await context.params
  const pending = await pool.query(
    `SELECT p.*, d.publication_type FROM pending_libro_publications p
     JOIN drafts d ON d.id = p."draftId"
     WHERE p."draftId" = $1 AND p."userId" = $2
     ORDER BY p.created_at DESC LIMIT 1`,
    [draftId, user.id],
  )
  const row = pending.rows[0]
  if (!row) return NextResponse.json({ success: false, message: 'Pending Libro publication not found' }, { status: 404 })
  try {
    const status = await getServiceHumanPublicationStatus({ userId: user.id, challengeId: row.service_challenge_id })
    if (status.state === 'finalized' && status.publicationId) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        await client.query(
          `INSERT INTO publication_policies
            (publication_id, signal_hash, "authorId", origin_client_id, access, access_price_usd)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (publication_id) DO UPDATE SET
             signal_hash = EXCLUDED.signal_hash, access = EXCLUDED.access,
             access_price_usd = EXCLUDED.access_price_usd, modified_at = CURRENT_TIMESTAMP`,
          [status.publicationId, status.signalHash, row.authorId, process.env.LIBRO_OAUTH_CLIENT_ID,
            row.access, row.access_price_usd],
        )
        await client.query(`UPDATE drafts SET status = 'published', modified_at = CURRENT_TIMESTAMP WHERE id = $1`, [draftId])
        await client.query('UPDATE pending_libro_publications SET acknowledged_at = CURRENT_TIMESTAMP WHERE service_challenge_id = $1', [row.service_challenge_id])
        await client.query('COMMIT')
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      } finally {
        client.release()
      }
      revalidateTag(publicationCacheTag(status.publicationId), { expire: 0 })
      revalidateTag(publicationHashCacheTag(status.signalHash), { expire: 0 })
      revalidateTag(authorPublicationCountsCacheTag(row.authorId), { expire: 0 })
      revalidateTag(sitemapCacheTag, { expire: 0 })
      revalidateTag(latestPublicationsCacheTag, { expire: 0 })
      return NextResponse.json({
        success: true,
        state: status.state,
        publicationId: status.publicationId,
        publicationType: row.publication_type,
      })
    }
    return NextResponse.json({ success: true, ...status })
  } catch (error) {
    return NextResponse.json({
      success: false,
      message: error instanceof Error ? error.message : 'Libro status lookup failed',
    }, { status: 502 })
  }
}
