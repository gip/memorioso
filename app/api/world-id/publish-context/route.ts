import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'
import { getAuthenticatedUser } from '@/lib/auth-user'
import { createLibroPublicationV1, canonicalPublicationSignal, hashPublicationSignal } from '@/lib/world-id/publication'
import { createPublishAction, createRpContext, getWorldIdServerConfig } from '@/lib/world-id/server'
import { WORLD_ID_ALLOWED_CREDENTIALS, WORLD_ID_CREDENTIAL_POLICY } from '@/lib/world-id/constants'
import { getLibroServerConfig } from '@/lib/libro/config'
import type { PublicationContent } from '@/types'
import { hasPublishablePublication } from '@libro/core'

export async function POST(req: NextRequest): Promise<NextResponse> {
  const authenticatedUser = await getAuthenticatedUser()

  if (!authenticatedUser) {
    return NextResponse.json({ success: false, message: "Authentication required" }, { status: 401 })
  }

  let config
  try {
    config = getWorldIdServerConfig()
    getLibroServerConfig()
  } catch (error) {
    return NextResponse.json({
      success: false,
      message: error instanceof Error ? error.message : "World ID or Libro configuration is invalid",
    }, { status: 500 })
  }

  const { draftId } = await req.json()

  if (!draftId) {
    return NextResponse.json({ success: false, message: "Draft ID is required" }, { status: 400 })
  }

  const client = await pool.connect()

  try {
    const { rows } = await client.query(
      `SELECT
        d.id,
        d.title,
        d.subtitle,
        d.content,
        d.status,
        d."authorId",
        a.name AS author_name,
        a.handle AS author_handle,
        a.bio AS author_bio
       FROM drafts d
       INNER JOIN authors a ON a.id = d."authorId"
       WHERE d.id = $1 AND d."userId" = $2 AND d.status = $3`,
      [draftId, authenticatedUser.id, 'editing']
    )

    if (rows.length === 0) {
      return NextResponse.json({ success: false, message: "Draft not found or not ready to publish" }, { status: 404 })
    }

    const draft = rows[0]

    if (!draft.authorId) {
      return NextResponse.json({ success: false, message: "Author is required" }, { status: 400 })
    }

    if (!hasPublishablePublication(draft.title, draft.content)) {
      return NextResponse.json({ success: false, message: "Publication must include a title or readable content" }, { status: 400 })
    }

    const challengeId = crypto.randomUUID()
    const publishAction = createPublishAction(challengeId, config.publishActionPrefix)
    const publicationDate = new Date().toISOString()
    const publication = createLibroPublicationV1({
      author: {
        id: draft.authorId,
        name: draft.author_name,
        handle: draft.author_handle,
        bio: draft.author_bio || '',
      },
      title: draft.title,
      subtitle: draft.subtitle || '',
      content: draft.content as PublicationContent,
      publicationDate,
      action: publishAction,
    })
    const signalText = canonicalPublicationSignal(publication)
    const signalHash = hashPublicationSignal(signalText)
    const rpContext = createRpContext(config, publishAction)

    await client.query(
      `INSERT INTO world_id_publish_challenges
        (id, "userId", "draftId", action, nonce, signal_text, signal_hash, publication, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, to_timestamp($9))`,
      [
        challengeId,
        authenticatedUser.id,
        draftId,
        publishAction,
        rpContext.nonce,
        signalText,
        signalHash,
        publication,
        rpContext.expires_at,
      ]
    )

    return NextResponse.json({
      success: true,
      challengeId,
      appId: config.appId,
      action: publishAction,
      environment: config.environment,
      rpContext,
      signalText,
      signalHash,
      credentialPolicy: WORLD_ID_CREDENTIAL_POLICY,
      allowedCredentials: WORLD_ID_ALLOWED_CREDENTIALS,
    })
  } finally {
    client.release()
  }
}
