import { persistRevisionProjection, validatePublicationRevision } from './revisions'
import { isV2Publication, libroRegistryV2Abi, v2PublicationCommitment, LIBRO_AGENT_PROTOCOL_VERSION_V2 } from '@libro/core'
import {
  LIBRO_AGENT_PUBLICATION_SCHEMA_V1,
  LIBRO_AGENT_PUBLICATION_SCHEMA_V2,
  LIBRO_AGENT_PROTOCOL_VERSION,
  canonicalPublicationSignal,
  createLibroAgentDocumentFinalizationTypedData,
  createLibroAgentDocumentTypedData,
  hashPublicationSignal,
  parseLibroAuthorReference,
  parseLibroPublication,
  prepareLibroAgentDocumentTransaction,
  recoverLibroAgentDocumentFinalizationSigner,
  recoverLibroAgentDocumentSigner,
  type LibroAgentPublicationPayload,
} from '@libro/core'
import { encodeFunctionData, isHex, type Hex } from 'viem'
import { pool } from './db'
import { chainConfig, verifyDocumentRegistration } from './chain'
import { assertWritesEnabled, ServiceError } from './errors'
import { deliverPendingEvents, enqueueServiceEvent } from './events'
import { publicationExcerpt } from './publications'

function freshTimestamp(value: number): boolean {
  const now = Math.floor(Date.now() / 1000)
  return Number.isInteger(value) && value <= now + 60 && value >= now - 10 * 60
}

function agentPublication(value: unknown): LibroAgentPublicationPayload {
  let parsed
  try {
    parsed = parseLibroPublication(value)
  } catch (error) {
    throw new ServiceError('INVALID_PUBLICATION', error instanceof Error ? error.message : 'Agent publication is invalid', 400)
  }
  if (parsed.publication_schema !== LIBRO_AGENT_PUBLICATION_SCHEMA_V1 && parsed.publication_schema !== LIBRO_AGENT_PUBLICATION_SCHEMA_V2 && parsed.publication_schema !== 'libro-agent-publication-v3') {
    throw new ServiceError('INVALID_PUBLICATION', 'An agent publication schema is required', 400)
  }
  return parsed
}

function matchesFrozenAuthor(publication: LibroAgentPublicationPayload, registration: Record<string, unknown>): boolean {
  if (publication.publication_schema === LIBRO_AGENT_PUBLICATION_SCHEMA_V1) {
    return publication.author_id_libro === registration.author_id
  }
  const expected = registration.author_reference
    ? parseLibroAuthorReference(registration.author_reference)
    : undefined
  const actual = publication.author_reference
    ? parseLibroAuthorReference(publication.author_reference)
    : undefined
  return Boolean(expected && actual && expected.namespace === actual.namespace && expected.id === actual.id)
}

export async function prepareAgentDocument(input: {
  publication: unknown
  documentNonce: string
  signedAt: number
  signature: string
}) {
  assertWritesEnabled()
  const publication = agentPublication(input.publication)
  if (!isHex(input.documentNonce, { strict: true }) || input.documentNonce.length !== 66 || !isHex(input.signature, { strict: true })) {
    throw new ServiceError('INVALID_SIGNATURE', 'Document nonce and signature must be hex strings', 400)
  }
  if (!freshTimestamp(input.signedAt)) throw new ServiceError('STALE_SIGNATURE', 'Agent document signature is stale', 400)
  const signalText = canonicalPublicationSignal(publication)
  const signalHash = hashPublicationSignal(signalText)
  const pending = (await pool.query('SELECT * FROM libro_agent_documents WHERE document_signal_hash = $1', [signalHash])).rows[0]
  if (pending) {
    if (pending.registration_hash !== publication.agent_registration_hash.toLowerCase() || pending.document_nonce !== input.documentNonce.toLowerCase()) throw new ServiceError('IDEMPOTENCY_CONFLICT', 'Prepared document belongs to a different frozen operation', 409)
    const signer = await recoverLibroAgentDocumentSigner(createLibroAgentDocumentTypedData({
      chainId: pending.chain_id, registryAddress: pending.registry_address, registrationHash: pending.registration_hash,
      documentSignalHash: signalHash, documentNonce: input.documentNonce, signedAt: input.signedAt,
    }), input.signature)
    if (signer.toLowerCase() !== pending.agent_address.toLowerCase()) throw new ServiceError('INVALID_SIGNATURE', 'Agent key is required to resume this document', 401)
    return { documentRegistrationId: pending.id, documentSignalHash: signalHash, transaction: pending.transaction, transactionHash: pending.transaction_hash, publicationId: pending.publication_id ? String(pending.publication_id) : null }
  }
  const date = new Date(publication.publication_date).getTime()
  if (!Number.isFinite(date) || date > Date.now() || date < Date.now() - 5 * 60_000) {
    throw new ServiceError('PUBLICATION_DATE_INVALID', 'Publication date must be within the last five minutes', 400)
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const registrationResult = await client.query(
      `SELECT r.*, a.handle FROM libro_agent_registrations r
       JOIN libro_authors a ON a.id = r.author_id
       WHERE r.registration_hash = $1 AND r.finalized_at IS NOT NULL
         AND r.revoked_at IS NULL AND r.valid_from <= CURRENT_TIMESTAMP
         AND r.expires_at > CURRENT_TIMESTAMP FOR UPDATE OF r`,
      [publication.agent_registration_hash.toLowerCase()],
    )
    const registration = registrationResult.rows[0]
    if (!registration) throw new ServiceError('AGENT_NOT_FOUND', 'Active agent registration not found', 404)
    if (
      !matchesFrozenAuthor(publication, registration)
      || publication.agent_address.toLowerCase() !== registration.agent_address.toLowerCase()
      || publication.author_handle_hash_libro.toLowerCase() !== registration.handle_hash.toLowerCase()
    ) throw new ServiceError('AGENT_MISMATCH', 'Publication does not match the registered agent authority', 403)
    await validatePublicationRevision(publication, registration.author_id, true, client)
    if (registration.registry_address.toLowerCase() !== chainConfig().registryAddress.toLowerCase()) throw new ServiceError('AGENT_V2_AUTHORIZATION_REQUIRED', 'The owner must authorize this agent in Libro v2 before publishing', 403)
    const config = chainConfig()
    const typedData = createLibroAgentDocumentTypedData({
      chainId: config.chainId,
      registryAddress: config.registryAddress,
      registrationHash: registration.registration_hash,
      documentSignalHash: signalHash,
      documentNonce: input.documentNonce,
      signedAt: input.signedAt,
    })
    const signer = await recoverLibroAgentDocumentSigner(typedData, input.signature)
    if (signer.toLowerCase() !== registration.agent_address.toLowerCase()) {
      throw new ServiceError('INVALID_SIGNATURE', 'Agent signature does not match the registered key', 401)
    }
    const existing = await client.query('SELECT * FROM libro_agent_documents WHERE document_signal_hash = $1', [signalHash])
    if (existing.rows[0]) {
      await client.query('COMMIT')
      return {
        documentRegistrationId: existing.rows[0].id,
        documentSignalHash: signalHash,
        transaction: existing.rows[0].transaction,
        transactionHash: existing.rows[0].transaction_hash,
        publicationId: existing.rows[0].publication_id ? String(existing.rows[0].publication_id) : null,
      }
    }
    const transaction = isV2Publication(publication) ? { chainId: config.chainId, transactions: [{ to: config.registryAddress, value: '0x0' as const, data: encodeFunctionData({ abi: libroRegistryV2Abi, functionName: 'registerAgentPublication', args: [registration.registration_hash, v2PublicationCommitment(publication), input.documentNonce as Hex, BigInt(input.signedAt), input.signature as Hex] }) }] } : prepareLibroAgentDocumentTransaction({
      chainId: config.chainId,
      registryAddress: config.registryAddress,
      registrationHash: registration.registration_hash,
      documentSignalHash: signalHash,
      documentNonce: input.documentNonce,
      signedAt: input.signedAt,
      signature: input.signature,
    })
    const proof = {
      proof_type: 'human_authorized_agent_signature',
      protocol_version: isV2Publication(publication) ? LIBRO_AGENT_PROTOCOL_VERSION_V2 : LIBRO_AGENT_PROTOCOL_VERSION,
      agent_registration: {
        ...(registration.proof || {}),
        chain_id: registration.chain_id,
        registry_address: registration.registry_address,
        user_op_hash: registration.user_op_hash,
        transaction_hash: registration.transaction_hash,
        registered_at: new Date(registration.finalized_at).toISOString(),
      },
      agent_document_signature: {
        document_signal_text: signalText,
        document_signal_hash: signalHash,
        document_nonce: input.documentNonce.toLowerCase(),
        signed_at: new Date(input.signedAt * 1000).toISOString(),
        agent_address: registration.agent_address,
        signature_type: 'eip712',
        signature: input.signature.toLowerCase(),
        chain_id: config.chainId,
        registry_address: config.registryAddress,
        user_op_hash: '',
        transaction_hash: '',
        registered_at: '',
      },
    }
    const inserted = await client.query(
      `INSERT INTO libro_agent_documents
        (registration_id, registration_hash, handle_hash, document_signal_hash,
         document_signal_text, document_nonce, signed_at, agent_address, agent_signature,
         publication, proof, chain_id, registry_address, transaction)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
      [registration.id, registration.registration_hash, registration.handle_hash, signalHash,
        signalText, input.documentNonce.toLowerCase(), new Date(input.signedAt * 1000),
        registration.agent_address, input.signature.toLowerCase(), publication, proof,
        config.chainId, config.registryAddress, transaction],
    )
    await client.query('COMMIT')
    return { documentRegistrationId: inserted.rows[0].id, documentSignalHash: signalHash, transaction, transactionHash: null, publicationId: null }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function finalizeAgentDocument(input: {
  documentRegistrationId: string
  transactionHash: string
  userOpHash?: string | null
  signedAt: number
  signature: string
}) {
  assertWritesEnabled()
  if (!isHex(input.transactionHash, { strict: true }) || input.transactionHash.length !== 66 || !isHex(input.signature, { strict: true })) {
    throw new ServiceError('INVALID_SIGNATURE', 'Transaction hash and finalization signature must be hex strings', 400)
  }
  if (!freshTimestamp(input.signedAt)) throw new ServiceError('STALE_SIGNATURE', 'Agent finalization signature is stale', 400)
  const pending = await pool.query(
    `SELECT d.*, r.identity_id, r.author_id, r.origin_client_id, r.author_reference,
       r.agent_address AS registered_agent_address
     FROM libro_agent_documents d JOIN libro_agent_registrations r ON r.id = d.registration_id
     WHERE d.id = $1`,
    [input.documentRegistrationId],
  )
  const row = pending.rows[0]
  if (!row) throw new ServiceError('NOT_FOUND', 'Agent document registration not found', 404)
  const typedData = createLibroAgentDocumentFinalizationTypedData({
    chainId: row.chain_id,
    registryAddress: row.registry_address,
    registrationHash: row.registration_hash,
    documentSignalHash: row.document_signal_hash,
    documentNonce: row.document_nonce,
    transactionHash: input.transactionHash,
    signedAt: input.signedAt,
  })
  const signer = await recoverLibroAgentDocumentFinalizationSigner(typedData, input.signature)
  if (signer.toLowerCase() !== row.registered_agent_address.toLowerCase()) {
    throw new ServiceError('INVALID_SIGNATURE', 'Finalization signature does not match the registered agent key', 401)
  }
  if (row.publication_id) return { publicationId: String(row.publication_id), signalHash: row.document_signal_hash }
  const registered = await verifyDocumentRegistration({
    transactionHash: input.transactionHash as Hex,
    signalHash: row.document_signal_hash,
    publication: row.publication,
    handleHash: row.handle_hash,
    registryAddress: row.registry_address,
    authorshipClass: 'agent',
  })
  if (!registered) throw new ServiceError('REGISTRATION_PENDING', 'Agent document is not registered on World Chain yet', 409, true)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const locked = await client.query(
      `SELECT d.*, r.identity_id, r.author_id, r.origin_client_id
       FROM libro_agent_documents d JOIN libro_agent_registrations r ON r.id = d.registration_id
       WHERE d.id = $1 FOR UPDATE OF d`,
      [input.documentRegistrationId],
    )
    const document = locked.rows[0]
    if (document.publication_id) {
      await client.query('COMMIT')
      return { publicationId: String(document.publication_id), signalHash: document.document_signal_hash }
    }
    const registeredAt = new Date().toISOString()
    const proof = {
      ...document.proof,
      agent_document_signature: {
        ...document.proof.agent_document_signature,
        user_op_hash: input.userOpHash || '',
        transaction_hash: input.transactionHash.toLowerCase(),
        registered_at: registeredAt,
        finalization_signature: input.signature.toLowerCase(),
        finalization_signed_at: new Date(input.signedAt * 1000).toISOString(),
      },
    }
    const publication = document.publication
    const inserted = await client.query(
      `INSERT INTO libro_publications
        (author_id, identity_id, origin_client_id, signal_hash, authorship_class,
         signal, proof, version, title, subtitle, date, feed_excerpt)
       VALUES ($1,$2,$3,$4,'agent',$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (signal_hash) DO UPDATE SET signal_hash = EXCLUDED.signal_hash RETURNING id`,
      [document.author_id, document.identity_id, document.origin_client_id,
        document.document_signal_hash.toLowerCase(), publication, proof,
        publication.libro_agent_protocol_version, publication.publication_title,
        publication.publication_subtitle || null, publication.publication_date,
        publicationExcerpt(publication.publication_content.html)],
    )
    const publicationId = String(inserted.rows[0].id)
    const revision = await persistRevisionProjection(client, publicationId, publication)
    await client.query(
      `UPDATE libro_agent_documents SET publication_id = $2, proof = $3,
       user_op_hash = $4, transaction_hash = $5, finalized_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [document.id, publicationId, proof, input.userOpHash || null, input.transactionHash.toLowerCase()],
    )
    await enqueueServiceEvent(client, {
      type: 'publication.finalized',
      additionalClientIds: (await client.query('SELECT DISTINCT origin_client_id FROM libro_publications WHERE root_publication_id = $1 AND origin_client_id IS NOT NULL', [revision.rootPublicationId])).rows.map(member => member.origin_client_id),
      originClientId: document.origin_client_id,
      aggregateId: publicationId,
      data: {
        publicationId,
        revision,
        signalHash: document.document_signal_hash.toLowerCase(),
        authorId: document.author_id,
        clientReference: null,
        authorshipClass: 'agent',
      },
    })
    await client.query('COMMIT')
    await deliverPendingEvents(25).catch(() => undefined)
    return { publicationId, signalHash: document.document_signal_hash.toLowerCase() }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
