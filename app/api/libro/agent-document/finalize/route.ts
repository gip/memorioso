import { NextRequest, NextResponse } from 'next/server'
import { isHex } from 'viem'
import { pool } from '@/lib/db'
import { getLibroAgentServerConfig } from '@/lib/libro/config'
import { verifyLibroAgentDocumentRegistered } from '@/lib/libro/server'
import type { LibroAgentProofV1, LibroAgentPublicationV1 } from '@/types'

type FinalizeAgentDocumentRequest = {
  documentRegistrationId?: string
  userOpHash?: string
  transactionHash?: string
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  let agentConfig
  try {
    agentConfig = getLibroAgentServerConfig()
  } catch (error) {
    return NextResponse.json({
      success: false,
      message: error instanceof Error ? error.message : 'Libro agent configuration is invalid',
    }, { status: 500 })
  }

  const { documentRegistrationId, userOpHash, transactionHash } =
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

  const client = await pool.connect()

  try {
    const pendingResult = await client.query(
      `SELECT document_signal_hash
       FROM libro_agent_document_registrations
       WHERE id = $1`,
      [documentRegistrationId]
    )

    if (pendingResult.rows.length === 0) {
      return NextResponse.json({ success: false, message: 'Agent document registration not found' }, { status: 404 })
    }

    const isRegistered = await verifyLibroAgentDocumentRegistered(
      pendingResult.rows[0].document_signal_hash,
      agentConfig
    )
    if (!isRegistered) {
      return NextResponse.json({
        success: false,
        message: 'Libro agent registry does not contain this document yet',
      }, { status: 400 })
    }

    await client.query('BEGIN')

    const fail = async (message: string, status: number = 400) => {
      await client.query('ROLLBACK')
      return NextResponse.json({ success: false, message }, { status })
    }

    const documentResult = await client.query(
      `SELECT d.*, r."userId", r."authorId", r.revoked_at, r.expires_at
       FROM libro_agent_document_registrations d
       INNER JOIN libro_agent_registrations r ON r.id = d."registrationId"
       WHERE d.id = $1
       FOR UPDATE`,
      [documentRegistrationId]
    )

    if (documentResult.rows.length === 0) {
      return await fail('Agent document registration not found', 404)
    }

    const documentRegistration = documentResult.rows[0]
    if (documentRegistration.finalized_at) {
      return await fail('Agent document registration has already been finalized')
    }

    if (documentRegistration.revoked_at) {
      return await fail('Agent registration has been revoked')
    }

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

    await client.query('COMMIT')

    return NextResponse.json({
      success: true,
      publicationId: articleResult.rows[0].id,
    })
  } catch (error) {
    await client.query('ROLLBACK')
    return NextResponse.json({
      success: false,
      message: 'Failed to finalize agent publication',
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 })
  } finally {
    client.release()
  }
}
