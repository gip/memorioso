import { NextRequest, NextResponse } from 'next/server'
import type { IDKitResult } from '@worldcoin/idkit'
import { pool } from '@/lib/db'
import { getAuthenticatedUser } from '@/lib/auth-user'
import { canonicalPublicationSignal, createPublicationV2, hashPublicationSignal } from '@/lib/world-id/publication'
import { getWorldIdServerConfig, verifyWorldIdProof } from '@/lib/world-id/server'
import { validateCredentialResponses, validateWorldIdV4Result } from '@/lib/world-id/proof'
import { isJsonEqual } from '@/lib/json'
import type { ContentOrHtml, PublicationV2, WorldIdProofV4 } from '@/types'

type PublishRequest = {
  challengeId?: string
  idkitResult?: IDKitResult
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ draftId: string }> }
): Promise<NextResponse> {
  const authenticatedUser = await getAuthenticatedUser()

  if (!authenticatedUser) {
    return NextResponse.json({ success: false, message: "Authentication required" }, { status: 401 })
  }

  let config
  try {
    config = getWorldIdServerConfig()
  } catch (error) {
    return NextResponse.json({
      success: false,
      message: error instanceof Error ? error.message : "World ID configuration is invalid",
    }, { status: 500 })
  }

  const { challengeId, idkitResult } = await req.json() as PublishRequest
  const { draftId } = await params

  if (!challengeId || !idkitResult) {
    return NextResponse.json({ success: false, message: "Challenge and World ID result are required" }, { status: 400 })
  }

  const client = await pool.connect()

  try {
    await client.query('BEGIN')

    const fail = async (message: string, status: number = 400) => {
      await client.query('ROLLBACK')
      return NextResponse.json({ success: false, message }, { status })
    }

    const challengeResult = await client.query(
      `SELECT *
       FROM world_id_publish_challenges
       WHERE id = $1 AND "draftId" = $2 AND "userId" = $3
       FOR UPDATE`,
      [challengeId, draftId, authenticatedUser.id]
    )

    if (challengeResult.rows.length === 0) {
      return await fail("Publish challenge not found", 404)
    }

    const challenge = challengeResult.rows[0]

    if (challenge.consumed_at) {
      return await fail("Publish challenge has already been used")
    }

    if (new Date(challenge.expires_at) < new Date()) {
      return await fail("Publish challenge has expired")
    }

    let validatedResult
    let credentialIdentifiers: string[]
    try {
      validatedResult = validateWorldIdV4Result(idkitResult, {
        action: challenge.action,
        nonce: challenge.nonce,
        environment: config.environment,
        signalHash: challenge.signal_hash,
      })
      if (validatedResult.action !== config.publishAction) {
        throw new Error('World ID proof context does not match this publication')
      }
      credentialIdentifiers = validateCredentialResponses(validatedResult.responses, challenge.signal_hash)
    } catch (error) {
      return await fail(error instanceof Error ? error.message : "Invalid World ID credential response")
    }

    const draftResult = await client.query(
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
       WHERE d.id = $1 AND d."userId" = $2
       FOR UPDATE`,
      [draftId, authenticatedUser.id]
    )

    if (draftResult.rows.length === 0) {
      return await fail("Draft not found or does not belong to the user", 404)
    }

    const draft = draftResult.rows[0]

    if (draft.status !== 'editing') {
      return await fail("Only editing drafts can be published")
    }

    const storedPublication = challenge.publication as PublicationV2
    const expectedPublication = createPublicationV2({
      author: {
        id: draft.authorId,
        name: draft.author_name,
        handle: draft.author_handle,
        bio: draft.author_bio || '',
      },
      title: draft.title,
      subtitle: draft.subtitle || '',
      content: draft.content as ContentOrHtml,
      publicationDate: storedPublication.publication_date,
      action: challenge.action,
    })
    const expectedSignalText = canonicalPublicationSignal(expectedPublication)
    const expectedSignalHash = hashPublicationSignal(expectedSignalText)

    if (
      expectedSignalText !== challenge.signal_text ||
      expectedSignalHash !== challenge.signal_hash ||
      !isJsonEqual(storedPublication, expectedPublication)
    ) {
      return await fail("Draft, author, or publication content changed after proof challenge creation")
    }

    const publicationDate = new Date(storedPublication.publication_date)
    const now = new Date()
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000)
    if (publicationDate > now || publicationDate < fiveMinutesAgo) {
      return await fail("Invalid publication date")
    }

    const verifyRes = await verifyWorldIdProof(validatedResult, config.rpId)

    if (!verifyRes.ok) {
      return await fail("Invalid World ID proof")
    }

    const proof: WorldIdProofV4 = {
      protocol_version: '4.0',
      action: challenge.action,
      nonce: challenge.nonce,
      signal_text: challenge.signal_text,
      signal_hash: challenge.signal_hash,
      credential_identifier: credentialIdentifiers[0],
      credential_identifiers: credentialIdentifiers,
      idkit_result: validatedResult as unknown as WorldIdProofV4['idkit_result'],
      verify_response: verifyRes.body as WorldIdProofV4['verify_response'],
    }

    const articleResult = await client.query(
      `INSERT INTO publications
        ("userId", "authorId", proof, signal, content, version, title, subtitle, date,
         world_id_protocol_version, world_id_action, world_id_signal_text, world_id_signal_hash,
         world_id_credential_identifier, world_id_verify_response, world_id_challenge_nonce)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       RETURNING id`,
      [
        authenticatedUser.id,
        storedPublication.author_id_libro,
        proof,
        storedPublication,
        draft.content,
        '2',
        storedPublication.publication_title,
        storedPublication.publication_subtitle,
        storedPublication.publication_date,
        '4.0',
        challenge.action,
        challenge.signal_text,
        challenge.signal_hash,
        credentialIdentifiers[0],
        verifyRes.body,
        challenge.nonce,
      ]
    )

    await client.query(
      'UPDATE drafts SET status = $1 WHERE id = $2',
      ['published', draftId]
    )

    await client.query(
      'UPDATE world_id_publish_challenges SET consumed_at = CURRENT_TIMESTAMP WHERE id = $1',
      [challengeId]
    )

    await client.query('COMMIT')

    return NextResponse.json({
      success: true,
      publicationId: articleResult.rows[0].id,
    })
  } catch (error) {
    await client.query('ROLLBACK')
    return NextResponse.json({
      success: false,
      message: "Failed to publish draft",
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 })
  } finally {
    client.release()
  }
}
