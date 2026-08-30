import type { IDKitResultSession } from '@worldcoin/idkit'
import { hashLibroHandle } from '@libro/core'
import type { Hex } from 'viem'
import { pool } from './db'
import { issueRpContext, assertSessionResult, sessionCommitment, verifyWithWorld } from './world-id'
import { getSigningChallenge } from './human-publications'
import { assertWritesEnabled, ServiceError } from './errors'
import { browserIdentityId } from './session'
import {
  chainConfig,
  prepareHumanRegistration,
  relayRegistration,
  verifyHumanRegistration,
  waitForRegistration,
  type HumanRegistrationTransaction,
} from './chain'
import { deliverPendingEvents, enqueueServiceEvent } from './events'

async function authenticatedChallenge(capability: string) {
  const identityId = await browserIdentityId()
  if (!identityId) throw new ServiceError('AUTH_REQUIRED', 'Sign in to Libro before signing', 401)
  const challenge = await getSigningChallenge(capability)
  const identity = await pool.query(
    `SELECT i.id, i.world_id_session_id, i.session_commitment, a.id AS author_id,
       a.name, a.handle, COALESCE(a.bio, '') AS bio
     FROM libro_identities i JOIN libro_authors a ON a.identity_id = i.id
     WHERE i.id = $1`,
    [identityId],
  )
  if (!identity.rows[0] || identity.rows[0].id !== challenge.identity_id && challenge.identity_id) {
    throw new ServiceError('IDENTITY_MISMATCH', 'This signing request belongs to another Libro identity', 403)
  }
  return { challenge, identity: identity.rows[0] }
}

export async function signingContext(request: Request, capability: string) {
  assertWritesEnabled()
  const { challenge, identity } = await authenticatedChallenge(capability)
  const context = await issueRpContext({
    request,
    purpose: 'publish',
    identityId: identity.id,
    objectId: challenge.id,
    signalHash: challenge.signal_hash,
    expectedCommitment: identity.session_commitment,
  })
  await pool.query('UPDATE libro_publish_challenges SET nonce = $2 WHERE id = $1', [challenge.id, context.rpContext.nonce.toLowerCase()])
  return {
    ...context,
    challengeId: challenge.id,
    signalHash: challenge.signal_hash,
    publication: challenge.publication,
    existingSessionId: identity.world_id_session_id,
  }
}

function validatePublicationResult(result: IDKitResultSession, row: Record<string, unknown>): void {
  if (result.nonce.toLowerCase() !== String(row.nonce).toLowerCase()) throw new ServiceError('INVALID_PROOF', 'World ID nonce does not match the signing request', 400)
  if (result.environment !== (process.env.NEXT_PUBLIC_WORLD_ID_ENVIRONMENT === 'staging' ? 'staging' : 'production')) {
    throw new ServiceError('INVALID_PROOF', 'World ID environment does not match Libro', 400)
  }
  if (result.session_id !== row.world_id_session_id || sessionCommitment(result.session_id) !== String(row.session_commitment).toLowerCase()) {
    throw new ServiceError('IDENTITY_MISMATCH', 'World ID session does not match the Libro identity', 403)
  }
  for (const response of result.responses) {
    if (response.identifier !== 'proof_of_human' || response.signal_hash?.toLowerCase() !== String(row.signal_hash).toLowerCase()) {
      throw new ServiceError('SIGNAL_MISMATCH', 'World ID proof is not bound to this publication signal', 400)
    }
  }
}

export async function prepareSigning(capability: string, payload: unknown) {
  assertWritesEnabled()
  const { challenge, identity } = await authenticatedChallenge(capability)
  const result = assertSessionResult(payload)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const locked = await client.query(
      `SELECT c.*, i.world_id_session_id, a.handle
       FROM libro_publish_challenges c
       JOIN libro_identities i ON i.id = c.identity_id
       JOIN libro_authors a ON a.id = c.author_id
       WHERE c.id = $1 AND c.identity_id = $2 AND c.consumed_at IS NULL
         AND c.expires_at > CURRENT_TIMESTAMP FOR UPDATE OF c`,
      [challenge.id, identity.id],
    )
    const row = locked.rows[0]
    if (!row) throw new ServiceError('CHALLENGE_EXPIRED', 'Publication challenge is expired or consumed', 409)
    const existing = await client.query('SELECT * FROM libro_human_registrations WHERE challenge_id = $1', [row.id])
    if (existing.rows[0]) {
      await client.query('COMMIT')
      return {
        registrationId: existing.rows[0].id,
        transaction: existing.rows[0].transaction,
        transactionHash: existing.rows[0].transaction_hash,
        publicationId: existing.rows[0].publication_id ? String(existing.rows[0].publication_id) : null,
      }
    }
    const context = await client.query(
      `SELECT id FROM libro_rp_contexts WHERE nonce = $1 AND purpose = 'publish'
       AND identity_id = $2 AND object_id = $3 AND expected_signal_hash = $4
       AND expected_session_commitment = $5 AND consumed_at IS NULL
       AND expires_at > CURRENT_TIMESTAMP FOR UPDATE`,
      [result.nonce.toLowerCase(), row.identity_id, row.id, row.signal_hash.toLowerCase(), row.session_commitment.toLowerCase()],
    )
    if (!context.rows[0]) throw new ServiceError('INVALID_CONTEXT', 'World ID signing context is invalid or expired', 400)
    validatePublicationResult(result, row)
    await verifyWithWorld(result)
    const handleHash = hashLibroHandle(row.handle)
    const claim = await client.query(
      `SELECT 1 FROM libro_handle_claims WHERE identity_id = $1 AND handle_hash = $2
       AND session_commitment = $3`,
      [row.identity_id, handleHash, row.session_commitment],
    )
    const prepared = prepareHumanRegistration({
      result,
      signalHash: row.signal_hash as Hex,
      handle: row.handle,
      handleHash,
      sessionCommitment: row.session_commitment as Hex,
      claimHandle: claim.rows.length === 0,
    })
    const proof = {
      protocol_version: '4.0',
      proof_type: 'session',
      nonce: row.nonce,
      signal_text: row.signal_text,
      signal_hash: row.signal_hash,
      credential_identifier: result.responses[0].identifier,
      credential_identifiers: result.responses.map((item) => item.identifier),
      idkit_result: {
        protocol_version: result.protocol_version,
        nonce: result.nonce,
        environment: result.environment,
        responses: result.responses,
      },
      verify_response: { success: true, verifier: 'libro_onchain_pending' },
      contract_proof: prepared.contractProof,
    }
    const inserted = await client.query(
      `INSERT INTO libro_human_registrations
        (challenge_id, signal_hash, handle_hash, session_commitment, session_nullifier,
         chain_id, registry_address, proof, transaction)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [row.id, row.signal_hash, handleHash, row.session_commitment, prepared.sessionNullifier,
        prepared.config.chainId, prepared.config.registryAddress, proof, prepared.transaction],
    )
    await client.query('UPDATE libro_rp_contexts SET consumed_at = CURRENT_TIMESTAMP WHERE id = $1', [context.rows[0].id])
    await client.query('COMMIT')
    return { registrationId: inserted.rows[0].id, transaction: prepared.transaction, transactionHash: null, publicationId: null }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function relaySigning(capability: string, registrationId: string) {
  assertWritesEnabled()
  const { challenge, identity } = await authenticatedChallenge(capability)
  const client = await pool.connect()
  let hash: Hex
  try {
    await client.query('BEGIN')
    const result = await client.query(
      `SELECT r.* FROM libro_human_registrations r
       JOIN libro_publish_challenges c ON c.id = r.challenge_id
       WHERE r.id = $1 AND c.id = $2 AND c.identity_id = $3 FOR UPDATE OF r`,
      [registrationId, challenge.id, identity.id],
    )
    const row = result.rows[0]
    if (!row) throw new ServiceError('NOT_FOUND', 'Publication registration was not found', 404)
    if (row.transaction_hash) {
      hash = row.transaction_hash
    } else {
      const sponsor = await client.query('SELECT 1 FROM libro_sponsorship_bindings WHERE identity_id = $1', [identity.id])
      if (!sponsor.rows[0]) throw new ServiceError('SPONSORSHIP_REQUIRED', 'A fixed Libro sponsorship proof is required before sponsored gas', 402)
      await client.query('SELECT pg_advisory_xact_lock($1)', [480001])
      hash = await relayRegistration(row.transaction as HumanRegistrationTransaction)
      await client.query('UPDATE libro_human_registrations SET transaction_hash = $2, submission_method = $3 WHERE id = $1', [row.id, hash.toLowerCase(), 'libro_relayer'])
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
  await waitForRegistration(hash)
  return { transactionHash: hash.toLowerCase() }
}

export async function finalizeSigning(capability: string, input: {
  registrationId: string
  submissionMethod: 'world_wallet' | 'libro_relayer'
  transactionHash: Hex
  userOpHash?: string | null
}) {
  assertWritesEnabled()
  const { challenge, identity } = await authenticatedChallenge(capability)
  const pending = await pool.query(
    `SELECT r.*, c.publication, c.signal_text, c.origin_client_id, c.client_reference,
       c.author_id, c.identity_id
     FROM libro_human_registrations r JOIN libro_publish_challenges c ON c.id = r.challenge_id
     WHERE r.id = $1 AND c.id = $2 AND c.identity_id = $3`,
    [input.registrationId, challenge.id, identity.id],
  )
  const found = pending.rows[0]
  if (!found) throw new ServiceError('NOT_FOUND', 'Publication registration was not found', 404)
  if (found.publication_id) return { publicationId: String(found.publication_id), signalHash: found.signal_hash }
  if (input.submissionMethod === 'libro_relayer' && found.transaction_hash?.toLowerCase() !== input.transactionHash.toLowerCase()) {
    throw new ServiceError('TRANSACTION_MISMATCH', 'Relayed transaction does not match the stored registration', 400)
  }
  const registered = await verifyHumanRegistration({
    transactionHash: input.transactionHash,
    signalHash: found.signal_hash,
    handleHash: found.handle_hash,
    registryAddress: found.registry_address,
  })
  if (!registered) throw new ServiceError('REGISTRATION_PENDING', 'Libro registry has not indexed this transaction yet', 409, true)

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const locked = await client.query(
      `SELECT r.*, c.publication, c.origin_client_id, c.client_reference, c.author_id, c.identity_id
       FROM libro_human_registrations r JOIN libro_publish_challenges c ON c.id = r.challenge_id
       WHERE r.id = $1 AND c.id = $2 FOR UPDATE OF r, c`,
      [input.registrationId, challenge.id],
    )
    const row = locked.rows[0]
    if (row.publication_id) {
      await client.query('COMMIT')
      return { publicationId: String(row.publication_id), signalHash: row.signal_hash }
    }
    const registeredAt = new Date().toISOString()
    const proof = {
      ...row.proof,
      verify_response: { success: true, verifier: 'libro_onchain' },
      libro_registration: {
        protocol_version: chainConfig().protocolVersion,
        submission_method: input.submissionMethod,
        chain_id: row.chain_id,
        registry_address: row.registry_address,
        signal_hash: row.signal_hash,
        handle_hash: row.handle_hash,
        authorship_class: 'human',
        ...(input.userOpHash ? { user_op_hash: input.userOpHash } : {}),
        transaction_hash: input.transactionHash.toLowerCase(),
        registered_at: registeredAt,
      },
    }
    const publication = row.publication
    const inserted = await client.query(
      `INSERT INTO libro_publications
        (author_id, identity_id, origin_client_id, client_reference, signal_hash,
         authorship_class, signal, proof, version, title, subtitle, date)
       VALUES ($1,$2,$3,$4,$5,'human',$6,$7,$8,$9,$10,$11)
       ON CONFLICT (signal_hash) DO UPDATE SET signal_hash = EXCLUDED.signal_hash
       RETURNING id`,
      [row.author_id, row.identity_id, row.origin_client_id, row.client_reference,
        row.signal_hash.toLowerCase(), publication, proof, publication.libro_protocol_version,
        publication.publication_title, publication.publication_subtitle || null, publication.publication_date],
    )
    const publicationId = String(inserted.rows[0].id)
    await client.query(
      `UPDATE libro_human_registrations SET submission_method = $2, user_op_hash = $3,
       transaction_hash = $4, publication_id = $5, finalized_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [row.id, input.submissionMethod, input.userOpHash || null, input.transactionHash.toLowerCase(), publicationId],
    )
    await client.query('UPDATE libro_publish_challenges SET consumed_at = CURRENT_TIMESTAMP WHERE id = $1', [row.challenge_id])
    await enqueueServiceEvent(client, {
      type: 'publication.finalized',
      originClientId: row.origin_client_id,
      aggregateId: publicationId,
      data: {
        publicationId,
        signalHash: row.signal_hash.toLowerCase(),
        authorId: row.author_id,
        clientReference: row.client_reference,
        authorshipClass: 'human',
      },
    })
    await client.query('COMMIT')
    await deliverPendingEvents(25).catch(() => undefined)
    return { publicationId, signalHash: row.signal_hash.toLowerCase() }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
