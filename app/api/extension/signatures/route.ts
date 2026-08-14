import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'
import {
  cleanupExpiredExtensionData,
  enforceExtensionSignatureRateLimit,
  ExtensionRateLimitError,
  getExtensionSession,
} from '@/lib/extension-auth'
import {
  inlineTextToHtml,
  MAX_INLINE_TEXT_LENGTH,
  normalizeInlineSigningText,
} from '@/lib/libro/inline'
import { createLibroPublicationV1, canonicalPublicationSignal, hashPublicationSignal } from '@/lib/world-id/publication'
import { createPublishAction, createRpContext, getWorldIdServerConfig } from '@/lib/world-id/server'
import { WORLD_ID_ALLOWED_CREDENTIALS, WORLD_ID_CREDENTIAL_POLICY } from '@/lib/world-id/constants'
import { getLibroServerConfig } from '@/lib/libro/config'
import { normalizedUnicodeLength } from '@libro/core'

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getExtensionSession(request)
  if (!session) {
    return NextResponse.json({ success: false, message: 'Extension authentication required' }, { status: 401 })
  }

  try {
    await cleanupExpiredExtensionData()
    await enforceExtensionSignatureRateLimit(session.user.id)
  } catch (error) {
    if (error instanceof ExtensionRateLimitError) {
      return NextResponse.json({ success: false, message: error.message }, {
        status: 429,
        headers: { 'Retry-After': '600' },
      })
    }
    return NextResponse.json({
      success: false,
      message: 'Extension abuse controls are unavailable',
    }, { status: 500 })
  }

  const body = await request.json().catch(() => null) as { text?: unknown, authorId?: unknown } | null
  const normalizedText = typeof body?.text === 'string' ? normalizeInlineSigningText(body.text) : ''
  if (!normalizedText) {
    return NextResponse.json({ success: false, message: 'Text is required' }, { status: 400 })
  }
  if (normalizedUnicodeLength(normalizedText) > MAX_INLINE_TEXT_LENGTH) {
    return NextResponse.json({
      success: false,
      message: `Inline signatures are limited to ${MAX_INLINE_TEXT_LENGTH.toLocaleString()} characters`,
    }, { status: 400 })
  }
  if (body?.authorId !== undefined && body.authorId !== null && typeof body.authorId !== 'string') {
    return NextResponse.json({ success: false, message: 'Author ID must be a string' }, { status: 400 })
  }
  const authorId = typeof body?.authorId === 'string' ? body.authorId : null

  let worldIdConfig
  try {
    worldIdConfig = getWorldIdServerConfig()
    getLibroServerConfig()
  } catch (error) {
    return NextResponse.json({
      success: false,
      message: error instanceof Error ? error.message : 'World ID or Libro configuration is invalid',
    }, { status: 500 })
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const authorResult = await client.query(
      `SELECT a.id, a.name, a.handle, a.bio
       FROM authors a
       INNER JOIN users u ON u.id = a."userId"
       WHERE a."userId" = $1
         AND ($2::text IS NULL OR a.id::text = $2)
       ORDER BY (a.handle = u.handle) DESC, a.created_at ASC
       LIMIT 1
       FOR SHARE OF a`,
      [session.user.id, authorId]
    )
    if (authorResult.rows.length === 0) {
      await client.query('ROLLBACK')
      return NextResponse.json({
        success: false,
        message: authorId ? 'Author not found' : 'This Memorioso account has no author',
      }, { status: authorId ? 400 : 409 })
    }

    const author = authorResult.rows[0]
    const content = { html: inlineTextToHtml(body?.text as string) }
    const draftResult = await client.query(
      `INSERT INTO drafts ("userId", status, publication_type, title, subtitle, content, history, "authorId")
       VALUES ($1, 'editing', 'short', '', '', $2, $3, $4)
       RETURNING id`,
      [session.user.id, content, { source: 'chrome_extension' }, author.id]
    )
    const draftId = draftResult.rows[0].id as string
    const challengeId = randomUUID()
    const action = createPublishAction(challengeId, worldIdConfig.publishActionPrefix)
    const publicationDate = new Date().toISOString()
    const publication = createLibroPublicationV1({
      author: {
        id: author.id,
        name: author.name,
        handle: author.handle,
        bio: author.bio || '',
      },
      title: '',
      subtitle: '',
      content,
      publicationDate,
      action,
    })
    const signalText = canonicalPublicationSignal(publication)
    const signalHash = hashPublicationSignal(signalText)
    const rpContext = createRpContext(worldIdConfig, action)

    await client.query(
      `INSERT INTO world_id_publish_challenges
        (id, "userId", "draftId", action, nonce, signal_text, signal_hash, publication, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, to_timestamp($9))`,
      [
        challengeId,
        session.user.id,
        draftId,
        action,
        rpContext.nonce,
        signalText,
        signalHash,
        publication,
        rpContext.expires_at,
      ]
    )
    await client.query('COMMIT')

    return NextResponse.json({
      success: true,
      signingId: draftId,
      draftId,
      challengeId,
      normalizedText,
      author: { id: author.id, name: author.name, handle: author.handle },
      appId: worldIdConfig.appId,
      action,
      environment: worldIdConfig.environment,
      rpContext,
      signalText,
      signalHash,
      credentialPolicy: WORLD_ID_CREDENTIAL_POLICY,
      allowedCredentials: WORLD_ID_ALLOWED_CREDENTIALS,
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    await client.query('ROLLBACK')
    return NextResponse.json({
      success: false,
      message: error instanceof Error ? error.message : 'Failed to create inline signing request',
    }, { status: 500 })
  } finally {
    client.release()
  }
}
