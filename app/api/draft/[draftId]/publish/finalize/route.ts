import { randomUUID } from 'crypto'
import { revalidatePath, revalidateTag } from 'next/cache'
import { NextRequest, NextResponse } from 'next/server'
import { isHex } from 'viem'
import { pool } from '@/lib/db'
import {
  authorPublicationCountsCacheTag,
  latestPublicationsCacheTag,
  publicationCacheTag,
  publicationHashCacheTag,
  sitemapCacheTag,
} from '@/lib/db/publication-cache'
import {
  configureLibroWriteTransaction,
  describeDatabaseFailure,
  rollbackAndRelease,
} from '@/lib/db/resilience'
import { getAuthenticatedUser } from '@/lib/auth-user'
import { getLibroServerConfig } from '@/lib/libro/config'
import { getMemoriosoAuthorReference } from '@/lib/libro/author-reference'
import {
  LibroRegistrationReceiptMismatchError,
  verifyLibroRegistrationTransaction,
} from '@/lib/libro/server'
import {
  assertChallengeCanBeUsed,
  assertDraftCanBePublished,
  assertChallengeMatchesAuthor,
  getLockedDraftForPublish,
  getLockedPublishChallenge,
} from '@/lib/publish-validation'
import type { WorldIdProofV4 } from '@/types'

type FinalizeRequest = {
  registrationId?: string
  submissionMethod?: 'world_wallet' | 'memorioso_relayer'
  userOpHash?: string
  transactionHash?: string
}

type FinalizeStage =
  | 'authenticate'
  | 'lookup'
  | 'chain_verify'
  | 'pool_connect'
  | 'begin'
  | 'configure_transaction'
  | 'lock_registration'
  | 'lock_challenge'
  | 'lock_draft'
  | 'check_existing_publication'
  | 'write_publication'
  | 'commit'
  | 'rollback'

function retryableFinalizeResponse(): NextResponse {
  return NextResponse.json({
    success: false,
    code: 'FINALIZE_RETRYABLE',
    retryable: true,
    message: 'Publication finalization is temporarily busy. Please retry.',
  }, {
    status: 503,
    headers: {
      'Cache-Control': 'no-store',
      'Retry-After': '1',
    },
  })
}

function finalizeErrorResponse(error: unknown, stage: FinalizeStage): NextResponse {
  const failure = describeDatabaseFailure(error)
  if (failure.retryable || stage === 'chain_verify' || stage === 'pool_connect') {
    return retryableFinalizeResponse()
  }

  return NextResponse.json({
    success: false,
    message: 'Failed to finalize Libro publication',
    error: failure.message,
  }, { status: 500 })
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ draftId: string }> }
): Promise<NextResponse> {
  const requestId = randomUUID()
  const startedAt = Date.now()
  let authenticatedUser
  try {
    authenticatedUser = await getAuthenticatedUser(req)
  } catch (error) {
    const failure = describeDatabaseFailure(error)
    console.error('Failed to authenticate Libro publication finalization', {
      requestId,
      stage: 'authenticate',
      durationMs: Date.now() - startedAt,
      code: failure.code,
      message: failure.message,
      retryable: failure.retryable,
    })
    return finalizeErrorResponse(error, 'authenticate')
  }

  if (!authenticatedUser) {
    return NextResponse.json({ success: false, message: 'Authentication required' }, { status: 401 })
  }

  let libroConfig
  try {
    libroConfig = getLibroServerConfig()
  } catch (error) {
    return NextResponse.json({
      success: false,
      message: error instanceof Error ? error.message : 'Libro configuration is invalid',
    }, { status: 500 })
  }

  const { registrationId, submissionMethod, userOpHash, transactionHash } =
    await req.json().catch(() => ({})) as FinalizeRequest
  const { draftId } = await params

  if (!registrationId || !submissionMethod || !transactionHash) {
    return NextResponse.json({
      success: false,
      message: 'Registration, submission method, and transaction hash are required',
    }, { status: 400 })
  }

  if (!/^0x[0-9a-fA-F]{64}$/.test(transactionHash) ||
      (submissionMethod === 'world_wallet' && (!userOpHash || !isHex(userOpHash)))) {
    return NextResponse.json({
      success: false,
      message: 'Required transaction identifiers must be 0x-prefixed hex strings',
    }, { status: 400 })
  }

  if (submissionMethod !== 'world_wallet' && submissionMethod !== 'memorioso_relayer') {
    return NextResponse.json({ success: false, message: 'Invalid submission method' }, { status: 400 })
  }

  let stage: FinalizeStage = 'lookup'

  try {
    const pendingResult = await pool.query(
      `SELECT
         r.signal_hash,
         r.handle_hash,
         r.session_commitment,
         r.chain_id,
         r.registry_address,
         r.transaction_hash,
         r.finalized_at,
         r."publicationId",
         d.publication_type AS "publicationType",
         (
           SELECT finalized."publicationId"
           FROM libro_publish_registrations finalized
           WHERE finalized."draftId" = r."draftId"
             AND finalized."userId" = r."userId"
             AND finalized.finalized_at IS NOT NULL
             AND finalized."publicationId" IS NOT NULL
           ORDER BY finalized.finalized_at ASC
           LIMIT 1
         ) AS existing_publication_id
       FROM libro_publish_registrations r
       INNER JOIN drafts d ON d.id = r."draftId"
       WHERE r.id = $1 AND r."draftId" = $2 AND r."userId" = $3`,
      [registrationId, draftId, authenticatedUser.id]
    )

    if (pendingResult.rows.length === 0) {
      return NextResponse.json({ success: false, message: 'Libro registration not found' }, { status: 404 })
    }

    const pending = pendingResult.rows[0]
    const existingPublicationId = pending.publicationId || pending.existing_publication_id
    if (existingPublicationId) {
      return NextResponse.json({
        success: true,
        publicationId: existingPublicationId,
        publicationType: pending.publicationType,
      })
    }

    if (
      submissionMethod === 'memorioso_relayer' &&
      pending.transaction_hash?.toLowerCase() !== transactionHash.toLowerCase()
    ) {
      return NextResponse.json({
        success: false,
        message: 'Sponsored transaction does not match the stored Libro registration',
      }, { status: 400 })
    }

    if (
      pending.chain_id !== libroConfig.chainId ||
      pending.registry_address.toLowerCase() !== libroConfig.registryAddress.toLowerCase()
    ) {
      return NextResponse.json({
        success: false,
        message: 'Libro registration configuration changed after preparation',
      }, { status: 400 })
    }

    stage = 'chain_verify'
    let isRegistered
    try {
      isRegistered = await verifyLibroRegistrationTransaction({
        transactionHash,
        signalHash: pending.signal_hash,
        handleHash: pending.handle_hash,
        registryAddress: pending.registry_address,
      }, libroConfig)
    } catch (error) {
      if (error instanceof LibroRegistrationReceiptMismatchError) {
        return NextResponse.json({
          success: false,
          message: error.message,
        }, { status: 400 })
      }
      throw error
    }
    if (!isRegistered) {
      return NextResponse.json({
        success: false,
        message: 'Libro registry does not contain this publication signal yet',
      }, { status: 400 })
    }

    stage = 'pool_connect'
    const client = await pool.connect()
    let clientReleased = false
    let transactionOpen = false

    try {
      stage = 'begin'
      await client.query('BEGIN')
      transactionOpen = true

      stage = 'configure_transaction'
      await configureLibroWriteTransaction(client)

      const fail = async (message: string, status: number = 400) => {
        stage = 'rollback'
        clientReleased = await rollbackAndRelease(client, new Error(message), transactionOpen)
        transactionOpen = false
        return NextResponse.json({ success: false, message }, { status })
      }

      stage = 'lock_registration'
      const registrationResult = await client.query(
        `SELECT *
         FROM libro_publish_registrations
         WHERE id = $1 AND "draftId" = $2 AND "userId" = $3
         FOR UPDATE`,
        [registrationId, draftId, authenticatedUser.id]
      )

      if (registrationResult.rows.length === 0) {
        return await fail('Libro registration not found', 404)
      }

      const registration = registrationResult.rows[0]
      if (registration.finalized_at) {
        if (registration.publicationId) {
          stage = 'commit'
          await client.query('COMMIT')
          transactionOpen = false
          return NextResponse.json({
            success: true,
            publicationId: registration.publicationId,
            publicationType: pending.publicationType,
          })
        }
        return await fail('Finalized Libro registration is incomplete', 409)
      }

      if (
        registration.chain_id !== libroConfig.chainId ||
        registration.registry_address.toLowerCase() !== libroConfig.registryAddress.toLowerCase()
      ) {
        return await fail('Libro registration configuration changed after preparation')
      }

      stage = 'lock_challenge'
      const challenge = await getLockedPublishChallenge(client, {
        challengeId: registration.challengeId,
        draftId,
        userId: authenticatedUser.id,
      })

      if (!challenge) {
        return await fail('Publish challenge not found', 404)
      }

      try {
        assertChallengeCanBeUsed(challenge, false)
      } catch (error) {
        return await fail(error instanceof Error ? error.message : 'Publish challenge is invalid')
      }

      if (registration.signal_hash.toLowerCase() !== challenge.signal_hash.toLowerCase()) {
        return await fail('Libro registration signal does not match the publish challenge')
      }

      stage = 'lock_draft'
      const draft = await getLockedDraftForPublish(client, draftId, authenticatedUser.id)
      if (!draft) {
        return await fail('Draft not found or does not belong to the user', 404)
      }

      stage = 'check_existing_publication'
      const finalizedResult = await client.query(
        `SELECT "publicationId"
         FROM libro_publish_registrations
         WHERE "draftId" = $1
           AND "userId" = $2
           AND finalized_at IS NOT NULL
           AND "publicationId" IS NOT NULL
         ORDER BY finalized_at ASC
         LIMIT 1`,
        [draftId, authenticatedUser.id]
      )
      if (finalizedResult.rows[0]?.publicationId) {
        stage = 'commit'
        await client.query('COMMIT')
        transactionOpen = false
        return NextResponse.json({
          success: true,
          publicationId: finalizedResult.rows[0].publicationId,
          publicationType: draft.publicationType,
        })
      }

      let storedPublication
      try {
        assertDraftCanBePublished(draft)
        storedPublication = assertChallengeMatchesAuthor(
          draft,
          challenge,
          getMemoriosoAuthorReference(draft.authorId)
        )
      } catch (error) {
        return await fail(error instanceof Error ? error.message : 'Draft is not ready to publish')
      }

      const registeredAt = new Date().toISOString()
      const proof: WorldIdProofV4 = {
        ...(registration.proof as WorldIdProofV4),
        verify_response: {
          success: true,
          verifier: 'libro_onchain',
        },
        libro_registration: {
          protocol_version: libroConfig.protocolVersion,
          submission_method: submissionMethod,
          chain_id: libroConfig.chainId,
          registry_address: libroConfig.registryAddress,
          signal_hash: challenge.signal_hash,
          handle_hash: registration.handle_hash,
          authorship_class: 'human',
          ...(userOpHash ? { user_op_hash: userOpHash.toLowerCase() } : {}),
          transaction_hash: transactionHash.toLowerCase(),
          registered_at: registeredAt,
        },
      }

      stage = 'write_publication'
      const articleResult = await client.query(
        `INSERT INTO publications
          ("userId", "authorId", proof, signal, content, version, title, subtitle, date, access)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id`,
        [
          authenticatedUser.id,
          draft.authorId,
          proof,
          storedPublication,
          // The draft row is encrypted; the signed payload is the readable copy,
          // and it is the one the on-chain signal hash was taken over.
          storedPublication.publication_content,
          '3',
          storedPublication.publication_title,
          storedPublication.publication_subtitle,
          storedPublication.publication_date,
          draft.access,
        ]
      )

      await client.query('UPDATE drafts SET status = $1 WHERE id = $2', ['published', draftId])
      await client.query(
        'UPDATE world_id_publish_challenges SET consumed_at = CURRENT_TIMESTAMP WHERE id = $1',
        [challenge.id]
      )
      await client.query(
        `UPDATE libro_publish_registrations
         SET user_op_hash = $1, transaction_hash = $2, finalized_at = CURRENT_TIMESTAMP, "publicationId" = $3
         WHERE id = $4`,
        [userOpHash?.toLowerCase() || null, transactionHash.toLowerCase(), articleResult.rows[0].id, registrationId]
      )

      await client.query(
        `INSERT INTO libro_handle_claims
          ("userId", handle, handle_hash, session_commitment, transaction_hash, finalized_at)
         VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
         ON CONFLICT ("userId") DO NOTHING`,
        [
          authenticatedUser.id,
          storedPublication.author_handle_libro,
          registration.handle_hash,
          registration.session_commitment,
          transactionHash.toLowerCase(),
        ]
      )

      stage = 'commit'
      await client.query('COMMIT')
      transactionOpen = false
      revalidateTag(publicationCacheTag(String(articleResult.rows[0].id)), { expire: 0 })
      revalidateTag(publicationHashCacheTag(challenge.signal_hash), { expire: 0 })
      revalidateTag(authorPublicationCountsCacheTag(draft.authorId), { expire: 0 })
      revalidateTag(sitemapCacheTag, { expire: 0 })
      revalidateTag(latestPublicationsCacheTag, { expire: 0 })
      revalidatePath('/')
      revalidatePath('/latest')

      console.info('Finalized Libro publication', {
        requestId,
        draftId,
        registrationId,
        publicationId: articleResult.rows[0].id,
        durationMs: Date.now() - startedAt,
      })

      return NextResponse.json({
        success: true,
        publicationId: articleResult.rows[0].id,
        publicationType: draft.publicationType,
      })
    } catch (error) {
      clientReleased = await rollbackAndRelease(client, error, transactionOpen)
      const failure = describeDatabaseFailure(error)
      const retryable = failure.retryable || stage === 'pool_connect'
      console.error('Failed to finalize Libro publication', {
        requestId,
        draftId,
        registrationId,
        stage,
        durationMs: Date.now() - startedAt,
        code: failure.code,
        message: failure.message,
        retryable,
      })
      return finalizeErrorResponse(error, stage)
    } finally {
      if (!clientReleased) client.release()
    }
  } catch (error) {
    const failure = describeDatabaseFailure(error)
    const retryable = failure.retryable || stage === 'chain_verify' || stage === 'pool_connect'
    console.error('Failed to finalize Libro publication', {
      requestId,
      draftId,
      registrationId,
      stage,
      durationMs: Date.now() - startedAt,
      code: failure.code,
      message: failure.message,
      retryable,
    })
    return finalizeErrorResponse(error, stage)
  }
}
