import { NextRequest, NextResponse } from 'next/server'
import type { IDKitResultSession } from '@worldcoin/idkit'
import { pool } from '@/lib/db'
import { getAuthenticatedUser } from '@/lib/auth-user'
import { getWorldIdServerConfig } from '@/lib/world-id/server'
import {
  sessionIdToCommitment,
  validateSessionCredentialResponses,
  validateWorldIdSessionResult,
} from '@/lib/world-id/proof'
import { getLibroServerConfig } from '@/lib/libro/config'
import { prepareLibroRegistration } from '@/lib/libro/proof'
import {
  assertChallengeCanBeUsed,
  assertDraftCanBePublished,
  assertChallengeMatchesAuthor,
  assertPublicationDateIsFresh,
  getLockedDraftForPublish,
  getLockedPublishChallenge,
} from '@/lib/publish-validation'
import type { WorldIdProofV4 } from '@/types'
import { isLibroHumanPublication } from '@/lib/world-id/publication'
import { getMemoriosoAuthorReference } from '@/lib/libro/author-reference'
import { retiredLibroWriterResponse } from '@/lib/libro-service/cutover'

type PrepareRequest = {
  challengeId?: string
  idkitResult?: IDKitResultSession
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ draftId: string }> }
): Promise<NextResponse> {
  const retired = retiredLibroWriterResponse()
  if (retired) return retired
  const authenticatedUser = await getAuthenticatedUser(req)
  if (!authenticatedUser) {
    return NextResponse.json({ success: false, message: 'Authentication required' }, { status: 401 })
  }

  let worldIdConfig
  let libroConfig
  try {
    worldIdConfig = getWorldIdServerConfig()
    libroConfig = getLibroServerConfig()
  } catch (error) {
    return NextResponse.json({
      success: false,
      message: error instanceof Error ? error.message : 'Libro or World ID configuration is invalid',
    }, { status: 500 })
  }

  const { challengeId, idkitResult } = await req.json() as PrepareRequest
  const { draftId } = await params
  if (!challengeId || !idkitResult) {
    return NextResponse.json({ success: false, message: 'Challenge and World ID session result are required' }, { status: 400 })
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const fail = async (message: string, status: number = 400) => {
      await client.query('ROLLBACK')
      return NextResponse.json({ success: false, message }, { status })
    }

    const challenge = await getLockedPublishChallenge(client, {
      challengeId, draftId, userId: authenticatedUser.id,
    })
    if (!challenge) return await fail('Publish challenge not found', 404)

    const existingResult = await client.query(
      `SELECT id, signal_hash, handle_hash, chain_id, registry_address, transaction, "publicationId"
       FROM libro_publish_registrations
       WHERE "challengeId" = $1 AND "draftId" = $2 AND "userId" = $3`,
      [challenge.id, draftId, authenticatedUser.id]
    )
    if (existingResult.rows.length > 0) {
      await client.query('COMMIT')
      const existing = existingResult.rows[0]
      return NextResponse.json({
        success: true,
        registrationId: existing.id,
        signalHash: existing.signal_hash,
        handleHash: existing.handle_hash,
        chainId: existing.chain_id,
        registryAddress: existing.registry_address,
        transaction: existing.transaction,
        publicationId: existing.publicationId || undefined,
        publicationSchema: challenge.publication.publication_schema,
      })
    }

    try {
      assertChallengeCanBeUsed(challenge, true)
    } catch (error) {
      return await fail(error instanceof Error ? error.message : 'Publish challenge is invalid')
    }

    let validatedResult: IDKitResultSession
    let credentialIdentifiers: string[]
    try {
      validatedResult = validateWorldIdSessionResult(idkitResult, {
        nonce: challenge.nonce,
        environment: worldIdConfig.environment,
        signalHash: challenge.signal_hash,
        expectedSessionId: authenticatedUser.worldIdSessionId,
      })
      credentialIdentifiers = validateSessionCredentialResponses(validatedResult.responses, challenge.signal_hash)
      if (sessionIdToCommitment(validatedResult.session_id) !== challenge.session_commitment.toLowerCase()) {
        throw new Error('World ID session commitment does not match this login')
      }
    } catch (error) {
      return await fail(error instanceof Error ? error.message : 'Invalid World ID session response')
    }

    const draft = await getLockedDraftForPublish(client, draftId, authenticatedUser.id)
    if (!draft) return await fail('Draft not found or does not belong to the user', 404)

    let storedPublication
    try {
      assertDraftCanBePublished(draft)
      storedPublication = assertChallengeMatchesAuthor(
        draft,
        challenge,
        getMemoriosoAuthorReference(draft.authorId)
      )
      assertPublicationDateIsFresh(storedPublication)
      if (!isLibroHumanPublication(storedPublication)) {
        throw new Error('Legacy publication challenges are not supported')
      }
      if (storedPublication.author_handle_libro !== authenticatedUser.handle) {
        throw new Error('Publication handle does not match this login')
      }
    } catch (error) {
      return await fail(error instanceof Error ? error.message : 'Draft is not ready to publish')
    }

    const handleHash = storedPublication.author_handle_hash_libro as `0x${string}`
    const claimResult = await client.query(
      `SELECT id FROM libro_handle_claims
       WHERE "userId" = $1 AND handle_hash = $2 AND session_commitment = $3`,
      [authenticatedUser.id, handleHash, challenge.session_commitment]
    )
    const needsClaim = claimResult.rows.length === 0

    let prepared
    try {
      prepared = prepareLibroRegistration({
        result: validatedResult,
        signalHash: challenge.signal_hash,
        handle: storedPublication.author_handle_libro,
        handleHash,
        config: libroConfig,
        claimHandle: needsClaim,
      })
    } catch (error) {
      return await fail(error instanceof Error ? error.message : 'Failed to prepare Libro registration')
    }

    const proof: WorldIdProofV4 = {
      protocol_version: '4.0',
      proof_type: 'session',
      nonce: challenge.nonce,
      signal_text: challenge.signal_text,
      signal_hash: challenge.signal_hash,
      credential_identifier: credentialIdentifiers[0],
      credential_identifiers: credentialIdentifiers,
      idkit_result: {
        protocol_version: '4.0',
        nonce: validatedResult.nonce,
        environment: validatedResult.environment,
        responses: validatedResult.responses,
      } as unknown as WorldIdProofV4['idkit_result'],
      verify_response: { success: true, verifier: 'libro_onchain_pending' },
    }

    const registrationResult = await client.query(
      `INSERT INTO libro_publish_registrations
        ("userId", "draftId", "challengeId", signal_hash, contract_signal_hash, handle_hash,
         session_commitment, session_nullifier, chain_id, registry_address, proof, transaction)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT ("challengeId") DO UPDATE
       SET "challengeId" = libro_publish_registrations."challengeId"
       RETURNING id, signal_hash, handle_hash, chain_id, registry_address, transaction, "publicationId"`,
      [
        authenticatedUser.id, draftId, challenge.id, prepared.signalHash,
        prepared.signalHashUint256, prepared.handleHash, prepared.sessionCommitment,
        prepared.sessionNullifier, libroConfig.chainId, libroConfig.registryAddress, proof,
        prepared.transaction,
      ]
    )
    await client.query('COMMIT')

    const registration = registrationResult.rows[0]
    return NextResponse.json({
      success: true,
      registrationId: registration.id,
      signalHash: registration.signal_hash,
      handleHash: registration.handle_hash,
      chainId: registration.chain_id,
      registryAddress: registration.registry_address,
      transaction: registration.transaction,
      publicationId: registration.publicationId || undefined,
      publicationSchema: storedPublication.publication_schema,
    })
  } catch (error) {
    await client.query('ROLLBACK')
    console.error('Failed to prepare Libro registration', { draftId, error })
    return NextResponse.json({ success: false, message: 'Internal error' }, { status: 500 })
  } finally {
    client.release()
  }
}
