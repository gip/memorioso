import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { pool } from '@/lib/db'
import { getExtensionSession } from '@/lib/extension-auth'
import { getServiceHumanPublicationStatus } from '@/lib/libro-service/client'
import {
  authorPublicationCountsCacheTag,
  latestPublicationsCacheTag,
  publicationCacheTag,
  publicationHashCacheTag,
  sitemapCacheTag,
} from '@/lib/db/publication-cache'

type Params = Promise<{ signingId: string }>

export async function GET(request: NextRequest, { params }: { params: Params }): Promise<NextResponse> {
  const session = await getExtensionSession(request)
  if (!session) {
    return NextResponse.json({ success: false, message: 'Extension authentication required' }, { status: 401 })
  }
  const { signingId } = await params
  if (process.env.LIBRO_SERVICE_WRITES_ENABLED === '1') {
    const pending = await pool.query(
      `SELECT p.*, d.publication_type FROM pending_libro_publications p
       JOIN drafts d ON d.id = p."draftId"
       WHERE p."draftId" = $1 AND p."userId" = $2 ORDER BY p.created_at DESC LIMIT 1`,
      [signingId, session.user.id],
    )
    const row = pending.rows[0]
    if (!row) return NextResponse.json({ success: false, message: 'Inline signing request was not found' }, { status: 404 })
    try {
      const status = await getServiceHumanPublicationStatus({ userId: session.user.id, challengeId: row.service_challenge_id })
      if (status.state === 'finalized' && status.publicationId) {
        await pool.query(
          `INSERT INTO publication_policies
            (publication_id, signal_hash, "authorId", origin_client_id, access, access_price_usd)
           VALUES ($1,$2,$3,$4,'public',NULL)
           ON CONFLICT (publication_id) DO UPDATE SET signal_hash = EXCLUDED.signal_hash,
             modified_at = CURRENT_TIMESTAMP`,
          [status.publicationId, status.signalHash, row.authorId, process.env.LIBRO_OAUTH_CLIENT_ID],
        )
        await pool.query(`UPDATE drafts SET status = 'published', modified_at = CURRENT_TIMESTAMP WHERE id = $1`, [signingId])
        revalidateTag(publicationCacheTag(status.publicationId), { expire: 0 })
        revalidateTag(publicationHashCacheTag(status.signalHash), { expire: 0 })
        revalidateTag(authorPublicationCountsCacheTag(row.authorId), { expire: 0 })
        revalidateTag(sitemapCacheTag, { expire: 0 })
        revalidateTag(latestPublicationsCacheTag, { expire: 0 })
      }
      return NextResponse.json({
        success: true,
        signingId,
        draftId: signingId,
        challengeId: row.service_challenge_id,
        stage: status.state === 'finalized' ? 'finalized' : 'external',
        transactionHash: status.transactionHash,
        publicationId: status.publicationId,
      }, { headers: { 'Cache-Control': 'no-store' } })
    } catch (error) {
      return NextResponse.json({ success: false, message: error instanceof Error ? error.message : 'Libro signing status failed' }, { status: 502 })
    }
  }
  const { rows } = await pool.query(
    `SELECT
       d.id AS draft_id,
       d.status,
       c.id AS challenge_id,
       r.id AS registration_id,
       r.transaction_hash,
       r.finalized_at,
       r."publicationId" AS publication_id
     FROM drafts d
     LEFT JOIN LATERAL (
       SELECT id FROM world_id_publish_challenges
       WHERE "draftId" = d.id
       ORDER BY created_at DESC LIMIT 1
     ) c ON true
     LEFT JOIN libro_publish_registrations r ON r."challengeId" = c.id
     WHERE d.id = $1 AND d."userId" = $2`,
    [signingId, session.user.id]
  )
  if (rows.length === 0) {
    return NextResponse.json({ success: false, message: 'Inline signing request was not found' }, { status: 404 })
  }

  const row = rows[0]
  const stage = row.publication_id
    ? 'finalized'
    : row.transaction_hash
      ? 'registered'
      : row.registration_id
        ? 'prepared'
        : 'challenge'
  return NextResponse.json({
    success: true,
    signingId: row.draft_id,
    draftId: row.draft_id,
    challengeId: row.challenge_id,
    registrationId: row.registration_id,
    transactionHash: row.transaction_hash,
    publicationId: row.publication_id,
    stage,
  }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function DELETE(request: NextRequest, { params }: { params: Params }): Promise<NextResponse> {
  const session = await getExtensionSession(request)
  if (!session) {
    return NextResponse.json({ success: false, message: 'Extension authentication required' }, { status: 401 })
  }
  const { signingId } = await params
  const result = await pool.query(
    `DELETE FROM drafts d
     WHERE d.id = $1
       AND d."userId" = $2
       AND d.status = 'editing'
       AND NOT EXISTS (
         SELECT 1 FROM libro_publish_registrations r WHERE r."draftId" = d.id
       )
     RETURNING d.id`,
    [signingId, session.user.id]
  )
  if (result.rows.length === 0) {
    return NextResponse.json({
      success: false,
      message: 'Signing request cannot be cancelled after registration preparation',
    }, { status: 409 })
  }
  return NextResponse.json({ success: true })
}
