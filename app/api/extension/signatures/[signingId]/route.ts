import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'
import { getExtensionSession } from '@/lib/extension-auth'

type Params = Promise<{ signingId: string }>

export async function GET(request: NextRequest, { params }: { params: Params }): Promise<NextResponse> {
  const session = await getExtensionSession(request)
  if (!session) {
    return NextResponse.json({ success: false, message: 'Extension authentication required' }, { status: 401 })
  }
  const { signingId } = await params
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
