import { NextRequest, NextResponse } from 'next/server'
import type { IDKitResult } from '@worldcoin/idkit'
import { pool } from '@/lib/db'
import { getAuthenticatedUser } from '@/lib/auth-user'
import { getWorldIdServerConfig } from '@/lib/world-id/server'
import { validateCredentialResponses, validateWorldIdV4Result } from '@/lib/world-id/proof'
import { getLibroServerConfig } from '@/lib/libro/config'
import { prepareLibroRegistration } from '@/lib/libro/proof'
import {
  assertChallengeCanBeUsed,
  assertDraftCanBePublished,
  assertDraftMatchesChallenge,
  assertPublicationDateIsFresh,
  getLockedDraftForPublish,
  getLockedPublishChallenge,
} from '@/lib/publish-validation'
import type { WorldIdProofV4 } from '@/types'

type PrepareRequest = {
  challengeId?: string
  idkitResult?: IDKitResult
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ draftId: string }> }
): Promise<NextResponse> {
  const authenticatedUser = await getAuthenticatedUser()

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
    return NextResponse.json({ success: false, message: 'Challenge and World ID result are required' }, { status: 400 })
  }

  const client = await pool.connect()

  try {
    await client.query('BEGIN')

    const fail = async (message: string, status: number = 400) => {
      await client.query('ROLLBACK')
      return NextResponse.json({ success: false, message }, { status })
    }

    const challenge = await getLockedPublishChallenge(client, {
      challengeId,
      draftId,
      userId: authenticatedUser.id,
    })

    if (!challenge) {
      return await fail('Publish challenge not found', 404)
    }

    try {
      assertChallengeCanBeUsed(challenge, true)
    } catch (error) {
      return await fail(error instanceof Error ? error.message : 'Publish challenge is invalid')
    }

    let validatedResult
    let credentialIdentifiers: string[]
    try {
      validatedResult = validateWorldIdV4Result(idkitResult, {
        action: challenge.action,
        nonce: challenge.nonce,
        environment: worldIdConfig.environment,
        signalHash: challenge.signal_hash,
      })
      credentialIdentifiers = validateCredentialResponses(validatedResult.responses, challenge.signal_hash)
    } catch (error) {
      return await fail(error instanceof Error ? error.message : 'Invalid World ID credential response')
    }

    const draft = await getLockedDraftForPublish(client, draftId, authenticatedUser.id)

    if (!draft) {
      return await fail('Draft not found or does not belong to the user', 404)
    }

    let storedPublication
    try {
      assertDraftCanBePublished(draft)
      storedPublication = assertDraftMatchesChallenge(draft, challenge)
      assertPublicationDateIsFresh(storedPublication)
    } catch (error) {
      return await fail(error instanceof Error ? error.message : 'Draft is not ready to publish')
    }

    let preparedRegistration
    try {
      preparedRegistration = prepareLibroRegistration(validatedResult, challenge.signal_hash, libroConfig)
      console.info('Prepared Libro registration transaction', {
        draftId,
        chainId: preparedRegistration.transaction.chainId,
        targets: preparedRegistration.transaction.transactions.map((item) => item.to),
        dataBytes: preparedRegistration.transaction.transactions.map((item) => Math.max(0, (item.data.length - 2) / 2)),
      })
    } catch (error) {
      return await fail(error instanceof Error ? error.message : 'Failed to prepare Libro registration')
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
      verify_response: {
        success: true,
        verifier: 'libro_onchain_pending',
      },
    }

    const registrationResult = await client.query(
      `INSERT INTO libro_publish_registrations
        ("userId", "draftId", "challengeId", signal_hash, contract_signal_hash, action_hash, chain_id, registry_address, proof, transaction)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT ("challengeId")
       DO UPDATE SET
         signal_hash = EXCLUDED.signal_hash,
         contract_signal_hash = EXCLUDED.contract_signal_hash,
         action_hash = EXCLUDED.action_hash,
         chain_id = EXCLUDED.chain_id,
         registry_address = EXCLUDED.registry_address,
         proof = EXCLUDED.proof,
         transaction = EXCLUDED.transaction,
         user_op_hash = NULL,
         transaction_hash = NULL,
         finalized_at = NULL,
         created_at = CURRENT_TIMESTAMP
       RETURNING id`,
      [
        authenticatedUser.id,
        draftId,
        challenge.id,
        preparedRegistration.signalHash,
        preparedRegistration.signalHashUint256,
        preparedRegistration.actionHash,
        libroConfig.chainId,
        libroConfig.registryAddress,
        proof,
        preparedRegistration.transaction,
      ]
    )

    await client.query('COMMIT')

    return NextResponse.json({
      success: true,
      registrationId: registrationResult.rows[0].id,
      signalHash: preparedRegistration.signalHash,
      actionHash: preparedRegistration.actionHash,
      chainId: libroConfig.chainId,
      registryAddress: libroConfig.registryAddress,
      transaction: preparedRegistration.transaction,
      publicationSchema: storedPublication.publication_schema,
    })
  } catch (error) {
    await client.query('ROLLBACK')
    console.error('Failed to prepare Libro registration', {
      draftId,
      error,
    })
    return NextResponse.json({
      success: false,
      message: 'Internal error',
    }, { status: 500 })
  } finally {
    client.release()
  }
}
