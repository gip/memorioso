import { NextRequest, NextResponse } from 'next/server'
import { isHex } from 'viem'
import { pool } from '@/lib/db'
import { getLibroAgentServerConfig } from '@/lib/libro/config'
import {
  agentPublicationMatchesAuthor,
  buildAgentPublicationSignal,
  createAgentDocumentTypedData,
  prepareAgentDocumentRegistration,
  recoverAgentDocumentSigner,
} from '@/lib/libro/agent'
import type { LibroAgentPublication, LibroAgentProofV1 } from '@/types'
import {
  LIBRO_AGENT_PUBLICATION_SCHEMA_V1,
  LIBRO_AGENT_PUBLICATION_SCHEMA_V2,
} from '@/lib/libro/contract'
import { getMemoriosoAuthorNamespace, getMemoriosoAuthorReference } from '@/lib/libro/author-reference'
import { parseLibroPublication } from '@libro/core'
import { retiredLibroWriterResponse } from '@/lib/libro-service/cutover'

type PrepareAgentDocumentRequest = {
  publication?: unknown
  documentNonce?: string
  signedAt?: number
  signature?: string
}

function isFreshSignedAt(signedAt: number): boolean {
  const now = Math.floor(Date.now() / 1000)
  return Number.isInteger(signedAt) && signedAt <= now + 60 && signedAt >= now - 10 * 60
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const retired = retiredLibroWriterResponse()
  if (retired) return retired
  let agentConfig
  try {
    agentConfig = getLibroAgentServerConfig()
    getMemoriosoAuthorNamespace()
  } catch (error) {
    return NextResponse.json({
      success: false,
      message: error instanceof Error ? error.message : 'Libro agent configuration is invalid',
    }, { status: 500 })
  }

  const body = await req.json().catch(() => null) as PrepareAgentDocumentRequest | null
  let publication: LibroAgentPublication | null = null
  try {
    const parsed = parseLibroPublication(body?.publication)
    if (
      parsed.publication_schema !== LIBRO_AGENT_PUBLICATION_SCHEMA_V1 &&
      parsed.publication_schema !== LIBRO_AGENT_PUBLICATION_SCHEMA_V2
    ) {
      throw new Error('Agent publication schema is required')
    }
    publication = parsed
  } catch (error) {
    return NextResponse.json({
      success: false,
      message: error instanceof Error ? error.message : 'Agent publication is invalid',
    }, { status: 400 })
  }
  const documentNonce = body?.documentNonce
  const signedAt = body?.signedAt
  const signature = body?.signature

  if (!publication || !documentNonce || typeof signedAt !== 'number' || !signature) {
    return NextResponse.json({
      success: false,
      message: 'Publication, document nonce, signed timestamp, and signature are required',
    }, { status: 400 })
  }

  if (!isHex(documentNonce) || documentNonce.length !== 66 || !isHex(signature)) {
    return NextResponse.json({
      success: false,
      message: 'Document nonce and signature must be 0x-prefixed hex strings',
    }, { status: 400 })
  }

  if (!isFreshSignedAt(signedAt)) {
    return NextResponse.json({ success: false, message: 'Agent document signature is stale' }, { status: 400 })
  }

  const client = await pool.connect()

  try {
    await client.query('BEGIN')

    const fail = async (message: string, status: number = 400) => {
      await client.query('ROLLBACK')
      return NextResponse.json({ success: false, message }, { status })
    }

    const registrationResult = await client.query(
      `SELECT *
       FROM libro_agent_registrations
       WHERE registration_hash = $1
         AND finalized_at IS NOT NULL
         AND revoked_at IS NULL
       FOR UPDATE`,
      [publication.agent_registration_hash.toLowerCase()]
    )

    if (registrationResult.rows.length === 0) {
      return await fail('Active agent registration not found', 404)
    }

    const registration = registrationResult.rows[0]
    if (new Date(registration.expires_at) < new Date()) {
      return await fail('Agent registration has expired')
    }

    if (!registration.proof) {
      return await fail('Agent registration proof is missing')
    }

    const authorMatches = agentPublicationMatchesAuthor(
      publication,
      getMemoriosoAuthorReference(registration.authorId)
    )

    if (
      !authorMatches ||
      publication.agent_address.toLowerCase() !== registration.agent_address.toLowerCase() ||
      publication.author_handle_hash_libro.toLowerCase() !== registration.handle_hash.toLowerCase()
    ) {
      return await fail('Agent publication does not match the registered agent')
    }

    const { signalText, signalHash } = buildAgentPublicationSignal(publication)
    const existing = await client.query(
      'SELECT id FROM libro_agent_document_registrations WHERE document_signal_hash = $1',
      [signalHash]
    )

    if (existing.rows.length > 0) {
      return await fail('Agent document has already been prepared')
    }

    const typedData = createAgentDocumentTypedData({
      chainId: agentConfig.chainId,
      registryAddress: agentConfig.registryAddress,
      registrationHash: registration.registration_hash,
      documentSignalHash: signalHash,
      documentNonce,
      signedAt,
    })
    const signer = await recoverAgentDocumentSigner({ typedData, signature })
    if (signer.toLowerCase() !== registration.agent_address.toLowerCase()) {
      return await fail('Agent signature does not match the registered agent')
    }

    const transaction = prepareAgentDocumentRegistration({
      registrationHash: registration.registration_hash,
      documentSignalHash: signalHash,
      documentNonce,
      signedAt,
      signature,
      config: agentConfig,
    })
    const signedAtIso = new Date(signedAt * 1000).toISOString()
    const proof: LibroAgentProofV1 = {
      proof_type: 'human_authorized_agent_signature',
      protocol_version: agentConfig.protocolVersion,
      agent_registration: {
        ...registration.proof,
        chain_id: registration.chain_id,
        registry_address: registration.registry_address,
        user_op_hash: registration.user_op_hash,
        transaction_hash: registration.transaction_hash,
        registered_at: new Date(registration.finalized_at).toISOString(),
      },
      agent_document_signature: {
        document_signal_text: signalText,
        document_signal_hash: signalHash,
        document_nonce: documentNonce.toLowerCase(),
        signed_at: signedAtIso,
        agent_address: registration.agent_address,
        signature_type: 'eip712',
        signature: signature.toLowerCase(),
        chain_id: agentConfig.chainId,
        registry_address: agentConfig.registryAddress,
        user_op_hash: '',
        transaction_hash: '',
        registered_at: '',
      },
    }

    const { rows } = await client.query(
      `INSERT INTO libro_agent_document_registrations
        ("registrationId", registration_hash, handle_hash, document_signal_hash, document_signal_text,
         document_nonce, signed_at, agent_address, agent_signature, publication, proof,
         chain_id, registry_address, transaction)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING id`,
      [
        registration.id,
        registration.registration_hash,
        registration.handle_hash,
        signalHash,
        signalText,
        documentNonce.toLowerCase(),
        signedAtIso,
        registration.agent_address,
        signature.toLowerCase(),
        publication,
        proof,
        agentConfig.chainId,
        agentConfig.registryAddress,
        transaction,
      ]
    )

    await client.query('COMMIT')

    return NextResponse.json({
      success: true,
      documentRegistrationId: rows[0].id,
      documentSignalHash: signalHash,
      transaction,
    })
  } catch (error) {
    await client.query('ROLLBACK')
    return NextResponse.json({
      success: false,
      message: 'Failed to prepare agent document registration',
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 })
  } finally {
    client.release()
  }
}
