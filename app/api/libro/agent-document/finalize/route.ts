import { randomUUID } from 'crypto'
import { revalidateTag } from 'next/cache'
import { NextRequest, NextResponse } from 'next/server'
import { isHex } from 'viem'
import { pool } from '@/lib/db'
import {
  authorPublicationCountsCacheTag,
  publicationCacheTag,
  publicationHashCacheTag,
  sitemapCacheTag,
} from '@/lib/db/publication-cache'
import {
  configureLibroWriteTransaction,
  describeDatabaseFailure,
  rollbackAndRelease,
} from '@/lib/db/resilience'
import {
  createAgentDocumentFinalizationTypedData,
  recoverAgentDocumentFinalizationSigner,
} from '@/lib/libro/agent'
import { getLibroAgentServerConfig } from '@/lib/libro/config'
import { verifyLibroAgentDocumentRegistered } from '@/lib/libro/server'
import type { LibroAgentProofV1, LibroAgentPublicationV1 } from '@/types'
import { publicationKindFromTitle } from '@/lib/publication-kind'

type FinalizeAgentDocumentRequest = {
  documentRegistrationId?: string
  userOpHash?: string
  transactionHash?: string
  signedAt?: number
  signature?: string
}

function isFreshSignedAt(signedAt: number): boolean {
  const now = Math.floor(Date.now() / 1000)
  return Number.isInteger(signedAt) && signedAt <= now + 60 && signedAt >= now - 10 * 60
}

function failureResponse(error: unknown, stage: string): NextResponse {
  const failure = describeDatabaseFailure(error)
  if (failure.retryable || stage === 'chain_verify' || stage === 'pool_connect') {
    return NextResponse.json({
      success: false,
      code: 'FINALIZE_RETRYABLE',
      retryable: true,
      message: 'Agent publication finalization is temporarily busy. Please retry.',
    }, { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '1' } })
  }
  return NextResponse.json({
    success: false,
    message: 'Failed to finalize agent publication',
    error: failure.message,
  }, { status: 500 })
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  const requestId = randomUUID()
  const startedAt = Date.now()
  let agentConfig
  try {
    agentConfig = getLibroAgentServerConfig()
  } catch (error) {
    return NextResponse.json({
      success: false,
      message: error instanceof Error ? error.message : 'Libro agent configuration is invalid',
    }, { status: 500 })
  }

  const { documentRegistrationId, userOpHash, transactionHash, signedAt, signature } =
    await req.json().catch(() => ({})) as FinalizeAgentDocumentRequest

  if (!documentRegistrationId || !userOpHash || !transactionHash) {
    return NextResponse.json({
      success: false,
      message: 'Document registration, user operation, and transaction hash are required',
    }, { status: 400 })
  }

  if (!isHex(userOpHash) || !isHex(transactionHash)) {
    return NextResponse.json({
      success: false,
      message: 'User operation and transaction hash must be 0x-prefixed hex strings',
    }, { status: 400 })
  }

  if (transactionHash.length !== 66) {
    return NextResponse.json({
      success: false,
      message: 'Transaction hash must be a 32-byte hex string',
    }, { status: 400 })
  }

  if (typeof signedAt !== 'number' || !signature || !isHex(signature)) {
    return NextResponse.json({
      success: false,
      message: 'Agent finalization signature and signed timestamp are required',
    }, { status: 401 })
  }

  if (!isFreshSignedAt(signedAt)) {
    return NextResponse.json({
      success: false,
      message: 'Agent finalization signature is stale',
    }, { status: 401 })
  }

  let stage = 'lookup'
  try {
    const pendingResult = await pool.query(
      `SELECT d.document_signal_hash, d.handle_hash, d.finalized_at, d."publicationId",
              d.registration_hash, d.document_nonce, d.agent_address, p.signal
       FROM libro_agent_document_registrations d
       LEFT JOIN publications p ON p.id = d."publicationId"
       WHERE d.id = $1`,
      [documentRegistrationId]
    )

    if (pendingResult.rows.length === 0) {
      return NextResponse.json({ success: false, message: 'Agent document registration not found' }, { status: 404 })
    }

    // Finalize writes a publication, so it must prove possession of the same agent key that
    // signed the document at prepare time. Knowing the registration id is not authority.
    stage = 'verify_agent_signature'
    const pending = pendingResult.rows[0]
    let finalizationSigner: string
    try {
      finalizationSigner = await recoverAgentDocumentFinalizationSigner({
        typedData: createAgentDocumentFinalizationTypedData({
          chainId: agentConfig.chainId,
          registryAddress: agentConfig.registryAddress,
          registrationHash: pending.registration_hash,
          documentSignalHash: pending.document_signal_hash,
          documentNonce: pending.document_nonce,
          transactionHash,
          signedAt,
        }),
        signature,
      })
    } catch {
      return NextResponse.json({
        success: false,
        message: 'Agent finalization signature is invalid',
      }, { status: 401 })
    }
    if (finalizationSigner.toLowerCase() !== String(pending.agent_address).toLowerCase()) {
      return NextResponse.json({
        success: false,
        message: 'Agent finalization signature does not match the registered agent',
      }, { status: 401 })
    }

    stage = 'lookup'
    if (pendingResult.rows[0].finalized_at && pendingResult.rows[0].publicationId) {
      return NextResponse.json({
        success: true,
        publicationId: pendingResult.rows[0].publicationId,
        publicationType: publicationKindFromTitle(pendingResult.rows[0].signal?.publication_title),
      })
    }

    stage = 'chain_verify'
    const isRegistered = await verifyLibroAgentDocumentRegistered(
      pendingResult.rows[0].document_signal_hash,
      pendingResult.rows[0].handle_hash,
      agentConfig,
      transactionHash
    )
    if (!isRegistered) {
      return NextResponse.json({
        success: false,
        message: 'Libro agent registry does not contain this document yet',
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
      await configureLibroWriteTransaction(client)

      stage = 'lock_document'
      const documentResult = await client.query(
        `SELECT d.*, r."userId", r."authorId", r.revoked_at, r.expires_at
         FROM libro_agent_document_registrations d
         INNER JOIN libro_agent_registrations r ON r.id = d."registrationId"
         WHERE d.id = $1
         FOR UPDATE`,
        [documentRegistrationId]
      )

      const fail = async (message: string, status: number = 400) => {
        clientReleased = await rollbackAndRelease(client, new Error(message), transactionOpen)
        transactionOpen = false
        return NextResponse.json({ success: false, message }, { status })
      }

      if (documentResult.rows.length === 0) {
        return await fail('Agent document registration not found', 404)
      }

      const documentRegistration = documentResult.rows[0]
      if (String(documentRegistration.agent_address).toLowerCase() !== finalizationSigner.toLowerCase()) {
        return await fail('Agent finalization signature does not match the registered agent', 401)
      }
      if (documentRegistration.finalized_at) {
        if (documentRegistration.publicationId) {
          await client.query('COMMIT')
          transactionOpen = false
          const finalizedPublication = documentRegistration.publication as LibroAgentPublicationV1
          return NextResponse.json({
            success: true,
            publicationId: documentRegistration.publicationId,
            publicationType: publicationKindFromTitle(finalizedPublication.publication_title),
          })
        }
        return await fail('Finalized agent document registration is incomplete', 409)
      }
      if (documentRegistration.revoked_at) return await fail('Agent registration has been revoked')
      if (new Date(documentRegistration.expires_at) < new Date(documentRegistration.signed_at)) {
        return await fail('Agent registration expired before the document was signed')
      }

      const registeredAt = new Date().toISOString()
      const publication = documentRegistration.publication as LibroAgentPublicationV1
      const proof: LibroAgentProofV1 = {
        ...(documentRegistration.proof as LibroAgentProofV1),
        agent_document_signature: {
          ...(documentRegistration.proof as LibroAgentProofV1).agent_document_signature,
          user_op_hash: userOpHash.toLowerCase(),
          transaction_hash: transactionHash.toLowerCase(),
          registered_at: registeredAt,
        },
      }

      stage = 'write_publication'
      const articleResult = await client.query(
        `INSERT INTO publications
          ("userId", "authorId", proof, signal, content, version, title, subtitle, date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [
          documentRegistration.userId,
          documentRegistration.authorId,
          proof,
          publication,
          publication.publication_content,
          '4',
          publication.publication_title,
          publication.publication_subtitle,
          publication.publication_date,
        ]
      )

      await client.query(
        `UPDATE libro_agent_document_registrations
         SET user_op_hash = $1, transaction_hash = $2, finalized_at = CURRENT_TIMESTAMP, "publicationId" = $3, proof = $4
         WHERE id = $5`,
        [userOpHash.toLowerCase(), transactionHash.toLowerCase(), articleResult.rows[0].id, proof, documentRegistrationId]
      )

      stage = 'commit'
      await client.query('COMMIT')
      transactionOpen = false
      revalidateTag(publicationCacheTag(String(articleResult.rows[0].id)), { expire: 0 })
      revalidateTag(publicationHashCacheTag(pendingResult.rows[0].document_signal_hash), { expire: 0 })
      revalidateTag(authorPublicationCountsCacheTag(String(documentRegistration.authorId)), { expire: 0 })
      revalidateTag(sitemapCacheTag, { expire: 0 })
      console.info('Finalized Libro agent publication', {
        requestId,
        documentRegistrationId,
        publicationId: articleResult.rows[0].id,
        durationMs: Date.now() - startedAt,
      })
      return NextResponse.json({
        success: true,
        publicationId: articleResult.rows[0].id,
        publicationType: publicationKindFromTitle(publication.publication_title),
      })
    } catch (error) {
      clientReleased = await rollbackAndRelease(client, error, transactionOpen)
      throw error
    } finally {
      if (!clientReleased) client.release()
    }
  } catch (error) {
    const failure = describeDatabaseFailure(error)
    console.error('Failed to finalize Libro agent publication', {
      requestId,
      documentRegistrationId,
      stage,
      durationMs: Date.now() - startedAt,
      code: failure.code,
      message: failure.message,
      retryable: failure.retryable || stage === 'chain_verify' || stage === 'pool_connect',
    })
    return failureResponse(error, stage)
  }
}
