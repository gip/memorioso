import { NextRequest, NextResponse } from 'next/server'
import { isHex } from 'viem'
import { pool } from '@/lib/db'
import { getAuthenticatedUser } from '@/lib/auth-user'
import { getLibroServerConfig } from '@/lib/libro/config'
import { verifyLibroSignalRegistered } from '@/lib/libro/server'
import {
  assertChallengeCanBeUsed,
  assertDraftCanBePublished,
  assertDraftMatchesChallenge,
  getLockedDraftForPublish,
  getLockedPublishChallenge,
} from '@/lib/publish-validation'
import type { WorldIdProofV4 } from '@/types'

type FinalizeRequest = {
  registrationId?: string
  userOpHash?: string
  transactionHash?: string
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ draftId: string }> }
): Promise<NextResponse> {
  const authenticatedUser = await getAuthenticatedUser()

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

  const { registrationId, userOpHash, transactionHash } = await req.json() as FinalizeRequest
  const { draftId } = await params

  if (!registrationId || !userOpHash || !transactionHash) {
    return NextResponse.json({
      success: false,
      message: 'Registration, user operation, and transaction hash are required',
    }, { status: 400 })
  }

  if (!isHex(userOpHash) || !isHex(transactionHash)) {
    return NextResponse.json({
      success: false,
      message: 'User operation and transaction hash must be 0x-prefixed hex strings',
    }, { status: 400 })
  }

  const client = await pool.connect()

  try {
    const pendingResult = await client.query(
      `SELECT signal_hash
       FROM libro_publish_registrations
       WHERE id = $1 AND "draftId" = $2 AND "userId" = $3`,
      [registrationId, draftId, authenticatedUser.id]
    )

    if (pendingResult.rows.length === 0) {
      return NextResponse.json({ success: false, message: 'Libro registration not found' }, { status: 404 })
    }

    const isRegistered = await verifyLibroSignalRegistered(pendingResult.rows[0].signal_hash, libroConfig)
    if (!isRegistered) {
      return NextResponse.json({
        success: false,
        message: 'Libro registry does not contain this publication signal yet',
      }, { status: 400 })
    }

    await client.query('BEGIN')

    const fail = async (message: string, status: number = 400) => {
      await client.query('ROLLBACK')
      return NextResponse.json({ success: false, message }, { status })
    }

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
      return await fail('Libro registration has already been finalized')
    }

    if (
      registration.chain_id !== libroConfig.chainId ||
      registration.registry_address.toLowerCase() !== libroConfig.registryAddress.toLowerCase()
    ) {
      return await fail('Libro registration configuration changed after preparation')
    }

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

    const draft = await getLockedDraftForPublish(client, draftId, authenticatedUser.id)
    if (!draft) {
      return await fail('Draft not found or does not belong to the user', 404)
    }

    let storedPublication
    try {
      assertDraftCanBePublished(draft)
      storedPublication = assertDraftMatchesChallenge(draft, challenge)
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
        chain_id: libroConfig.chainId,
        registry_address: libroConfig.registryAddress,
        signal_hash: challenge.signal_hash,
        user_op_hash: userOpHash.toLowerCase(),
        transaction_hash: transactionHash.toLowerCase(),
        registered_at: registeredAt,
      },
    }

    const articleResult = await client.query(
      `INSERT INTO publications
        ("userId", "authorId", proof, signal, content, version, title, subtitle, date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        authenticatedUser.id,
        storedPublication.author_id_libro,
        proof,
        storedPublication,
        draft.content,
        '3',
        storedPublication.publication_title,
        storedPublication.publication_subtitle,
        storedPublication.publication_date,
      ]
    )

    await client.query(
      'UPDATE drafts SET status = $1 WHERE id = $2',
      ['published', draftId]
    )

    await client.query(
      'UPDATE world_id_publish_challenges SET consumed_at = CURRENT_TIMESTAMP WHERE id = $1',
      [challenge.id]
    )

    await client.query(
      `UPDATE libro_publish_registrations
       SET user_op_hash = $1, transaction_hash = $2, finalized_at = CURRENT_TIMESTAMP
       WHERE id = $3`,
      [userOpHash.toLowerCase(), transactionHash.toLowerCase(), registrationId]
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
      message: 'Failed to finalize Libro publication',
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 })
  } finally {
    client.release()
  }
}
