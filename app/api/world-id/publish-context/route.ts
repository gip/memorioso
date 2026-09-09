import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'
import { getAuthenticatedUser } from '@/lib/auth-user'
import { createLibroPublicationV2, canonicalPublicationSignal, hashPublicationSignal } from '@/lib/world-id/publication'
import { createRpContext, getWorldIdServerConfig } from '@/lib/world-id/server'
import { WORLD_ID_ALLOWED_CREDENTIALS, WORLD_ID_CREDENTIAL_POLICY } from '@/lib/world-id/constants'
import { getLibroServerConfig } from '@/lib/libro/config'
import type { PublicationContent } from '@/types'
import { validatePublicationForKind } from '@/lib/publication-kind'
import { cleanupFinishedPublishChallenges } from '@/lib/publish-validation'
import { getMemoriosoAuthorNamespace, getMemoriosoAuthorReference } from '@/lib/libro/author-reference'
import { createServiceHumanPublication, LibroServiceUnavailableError } from '@/lib/libro-service/client'

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    return await createPublishContext(req)
  } catch (error) {
    if (error instanceof LibroServiceUnavailableError) {
      return NextResponse.json({ success: false, message: error.message, code: error.code }, { status: error.status })
    }
    console.error('Failed to create publication context', error)
    return NextResponse.json({ success: false, message: 'Failed to start publication signing' }, { status: 500 })
  }
}

async function createPublishContext(req: NextRequest): Promise<NextResponse> {
  const authenticatedUser = await getAuthenticatedUser()

  if (!authenticatedUser) {
    return NextResponse.json({ success: false, message: "Authentication required" }, { status: 401 })
  }

  const serviceWrites = process.env.LIBRO_SERVICE_WRITES_ENABLED === '1'
  let config: ReturnType<typeof getWorldIdServerConfig> | undefined
  try {
    getMemoriosoAuthorNamespace()
    if (!serviceWrites) {
      config = getWorldIdServerConfig()
      getLibroServerConfig()
    }
  } catch (error) {
    return NextResponse.json({
      success: false,
      message: error instanceof Error ? error.message : "World ID or Libro configuration is invalid",
    }, { status: 500 })
  }

  // The draft itself is encrypted, so its prose arrives here from the browser
  // that just decrypted it. There is nothing on the server to check it against,
  // and nothing that needs checking: the author is publishing their own words
  // under their own session, and the challenge built from them is exactly what
  // the World ID proof then commits to.
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ success: false, message: 'Publication request must be valid JSON' }, { status: 400 })
  }
  const { draftId, title, subtitle, content } = body

  if (!draftId) {
    return NextResponse.json({ success: false, message: "Draft ID is required" }, { status: 400 })
  }

  if (typeof title !== 'string' || (subtitle !== null && subtitle !== undefined && typeof subtitle !== 'string')) {
    return NextResponse.json({ success: false, message: "Publication title and subtitle must be text" }, { status: 400 })
  }

  if (typeof content !== 'object' || content === null || typeof (content as PublicationContent).html !== 'string') {
    return NextResponse.json({ success: false, message: "Publication content is required" }, { status: 400 })
  }

  const client = await pool.connect()

  try {
    // The rows this removes are the last readable copies of draft prose in the
    // database. Failing to sweep them must not fail the publish.
    await cleanupFinishedPublishChallenges(client).catch(() => {})

    const recentResult = await client.query(
      `SELECT COUNT(*)::int AS count
       FROM world_id_publish_challenges
       WHERE "userId" = $1 AND created_at > CURRENT_TIMESTAMP - INTERVAL '10 minutes'`,
      [authenticatedUser.id]
    )
    if (Number(recentResult.rows[0]?.count || 0) >= 20) {
      return NextResponse.json({ success: false, message: 'Too many publication proof attempts' }, { status: 429 })
    }

    const { rows } = await client.query(
      `SELECT
        d.id,
        d.status,
        d.publication_type AS "publicationType",
        d.access,
        d."authorId",
        a.name AS author_name,
        a.handle AS author_handle,
        a.bio AS author_bio,
        u.world_id_session_id,
        u.world_id_session_commitment
       FROM drafts d
       INNER JOIN authors a ON a.id = d."authorId" AND a."userId" = d."userId"
       INNER JOIN users u ON u.id = d."userId" AND u.handle = a.handle
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

    const normalizedSubtitle = typeof subtitle === 'string' ? subtitle : ''
    const validationError = validatePublicationForKind({
      kind: draft.publicationType,
      title,
      subtitle: normalizedSubtitle,
      content: content as PublicationContent,
    })
    if (validationError) {
      return NextResponse.json({ success: false, message: validationError }, { status: 400 })
    }

    const challengeId = crypto.randomUUID()
    const publicationDate = new Date().toISOString()
    const publication = createLibroPublicationV2({
      author: {
        id: draft.authorId,
        name: draft.author_name,
        handle: draft.author_handle,
        bio: draft.author_bio || '',
      },
      title: draft.publicationType === 'short' ? '' : title,
      subtitle: draft.publicationType === 'short' ? '' : normalizedSubtitle,
      content: content as PublicationContent,
      publicationDate,
      authorReference: getMemoriosoAuthorReference(draft.authorId),
    })
    const signalText = canonicalPublicationSignal(publication)
    const signalHash = hashPublicationSignal(signalText)

    if (serviceWrites) {
      const clientReference = `memorioso:${draftId}:${signalHash.toLowerCase()}`
      const challenge = await createServiceHumanPublication({
        userId: authenticatedUser.id,
        publication,
        clientReference,
      })
      await client.query(
        `INSERT INTO pending_libro_publications
          (service_challenge_id, client_reference, "userId", "authorId", "draftId",
           signal_hash, access)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (service_challenge_id) DO UPDATE SET
           signal_hash = EXCLUDED.signal_hash, access = EXCLUDED.access`,
        [challenge.challengeId, clientReference, authenticatedUser.id, draft.authorId,
          draftId, challenge.signalHash.toLowerCase(), draft.access],
      )
      return NextResponse.json({
        success: true,
        challengeId: challenge.challengeId,
        signalText,
        signalHash: challenge.signalHash,
        externalSigningUrl: challenge.signingUrl,
      })
    }

    const rpContext = createRpContext(config!)

    await client.query(
      `INSERT INTO world_id_publish_challenges
        (id, "userId", "draftId", nonce, session_commitment, signal_text, signal_hash, publication, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, to_timestamp($9))`,
      [
        challengeId,
        authenticatedUser.id,
        draftId,
        rpContext.nonce,
        draft.world_id_session_commitment,
        signalText,
        signalHash,
        publication,
        rpContext.expires_at,
      ]
    )

    return NextResponse.json({
      success: true,
      challengeId,
      appId: config!.appId,
      environment: config!.environment,
      rpContext,
      existingSessionId: draft.world_id_session_id,
      signalText,
      signalHash,
      credentialPolicy: WORLD_ID_CREDENTIAL_POLICY,
      allowedCredentials: WORLD_ID_ALLOWED_CREDENTIALS,
    })
  } finally {
    client.release()
  }
}
