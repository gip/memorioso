import { randomUUID } from 'node:crypto'
import type { IDKitResultSession } from '@worldcoin/idkit'
import { hashLibroHandle, hashPublicationSignal } from '@libro/core'
import type { Hex } from 'viem'
import { pool, type DatabaseClient } from './db'
import type { OAuthPrincipal } from './oauth'
import { assertWritesEnabled, ServiceError } from './errors'
import { deriveCapability, sha256 } from './crypto'
import { browserUrl, signingCapabilitySecret } from './config'
import { browserIdentityId } from './session'
import { assertSessionResult, issueRpContext, sessionCommitment, verifyWithWorld } from './world-id'
import { prepareHandleClaim, relayRegistration, verifyHandleClaim, waitForRegistration, type HumanRegistrationTransaction } from './chain'

export async function createHandleClaimChallenge(principal: OAuthPrincipal) {
  assertWritesEnabled()
  const claimed = await pool.query('SELECT * FROM libro_handle_claims WHERE identity_id = $1', [principal.identityId])
  if (claimed.rows[0]) {
    if (claimed.rows[0].handle !== principal.handle) throw new ServiceError('HANDLE_DRIFT', 'OAuth handle differs from the immutable on-chain claim', 409)
    return { finalized: true, handle: principal.handle, transactionHash: claimed.rows[0].transaction_hash }
  }
  const pending = await pool.query(
    `SELECT id FROM libro_handle_claim_requests WHERE identity_id = $1 AND finalized_at IS NULL
     ORDER BY created_at DESC LIMIT 1`,
    [principal.identityId],
  )
  const id = pending.rows[0]?.id || randomUUID()
  const capability = deriveCapability(id, signingCapabilitySecret())
  const signalText = `libro-handle-claim-v1:${principal.handle}`
  if (!pending.rows[0]) await pool.query(
    `INSERT INTO libro_handle_claim_requests
      (id, identity_id, origin_client_id, handle, handle_hash, signal_text, signal_hash, signing_capability_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [id, principal.identityId, principal.clientId, principal.handle, hashLibroHandle(principal.handle),
      signalText, hashPublicationSignal(signalText), sha256(capability)],
  )
  return { finalized: false, requestId: id, handle: principal.handle, signingUrl: browserUrl(`/claim/${capability}`) }
}

export async function getHandleClaimSigningRequest(capability: string) {
  const result = await pool.query(
    `SELECT q.*, i.world_id_session_id, i.session_commitment, a.name
     FROM libro_handle_claim_requests q JOIN libro_identities i ON i.id = q.identity_id
     JOIN libro_authors a ON a.identity_id = i.id WHERE q.signing_capability_hash = $1`,
    [sha256(capability)],
  )
  const row = result.rows[0]
  if (!row) throw new ServiceError('INVALID_CAPABILITY', 'Handle claim request is invalid', 404)
  return row
}

async function browserRequest(capability: string) {
  const identityId = await browserIdentityId()
  if (!identityId) throw new ServiceError('AUTH_REQUIRED', 'Sign in before claiming a handle', 401)
  const row = await getHandleClaimSigningRequest(capability)
  if (row.identity_id !== identityId) throw new ServiceError('IDENTITY_MISMATCH', 'Handle claim belongs to another identity', 403)
  return row
}

export async function handleClaimContext(request: Request, capability: string) {
  assertWritesEnabled()
  const row = await browserRequest(capability)
  const context = await issueRpContext({
    request, purpose: 'claim_handle', identityId: row.identity_id, objectId: row.id,
    signalHash: row.signal_hash, expectedCommitment: row.session_commitment,
  })
  return { ...context, handle: row.handle, signal: row.signal_text, existingSessionId: row.world_id_session_id }
}

function validate(result: IDKitResultSession, row: Record<string, unknown>) {
  const environment = process.env.NEXT_PUBLIC_WORLD_ID_ENVIRONMENT === 'staging' ? 'staging' : 'production'
  if (result.environment !== environment || result.session_id !== row.world_id_session_id
    || sessionCommitment(result.session_id) !== String(row.session_commitment).toLowerCase()) {
    throw new ServiceError('IDENTITY_MISMATCH', 'World ID session does not match this handle claim', 403)
  }
  if (result.responses.some((item) => item.identifier !== 'proof_of_human'
    || item.signal_hash?.toLowerCase() !== String(row.signal_hash).toLowerCase())) {
    throw new ServiceError('SIGNAL_MISMATCH', 'World ID proof is not bound to this handle claim', 400)
  }
}

export async function prepareHandleSigning(capability: string, payload: unknown) {
  assertWritesEnabled()
  const expected = await browserRequest(capability)
  if (expected.transaction) return { requestId: expected.id, transaction: expected.transaction, transactionHash: expected.transaction_hash }
  const result = assertSessionResult(payload)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const locked = await client.query(
      `SELECT q.*, i.world_id_session_id, i.session_commitment FROM libro_handle_claim_requests q
       JOIN libro_identities i ON i.id = q.identity_id WHERE q.id = $1 FOR UPDATE OF q`,
      [expected.id],
    )
    const row = locked.rows[0]
    const context = await client.query(
      `SELECT id FROM libro_rp_contexts WHERE nonce = $1 AND purpose = 'claim_handle'
       AND identity_id = $2 AND object_id = $3 AND expected_signal_hash = $4
       AND consumed_at IS NULL AND expires_at > CURRENT_TIMESTAMP FOR UPDATE`,
      [result.nonce.toLowerCase(), row.identity_id, row.id, row.signal_hash.toLowerCase()],
    )
    if (!context.rows[0]) throw new ServiceError('INVALID_CONTEXT', 'Handle claim context is invalid or expired', 400)
    validate(result, row)
    await verifyWithWorld(result)
    const prepared = prepareHandleClaim({ result, sessionCommitment: row.session_commitment, handle: row.handle })
    const proof = {
      proof_type: 'session', signal: row.signal_text, signal_hash: row.signal_hash,
      credential_identifier: result.responses[0].identifier,
      credential_identifiers: result.responses.map((item) => item.identifier),
      idkit_result: { protocol_version: result.protocol_version, nonce: result.nonce, environment: result.environment, responses: result.responses },
      session_nullifier: prepared.sessionNullifier,
    }
    await client.query('UPDATE libro_handle_claim_requests SET proof = $2, transaction = $3 WHERE id = $1', [row.id, proof, prepared.transaction])
    await client.query('UPDATE libro_rp_contexts SET consumed_at = CURRENT_TIMESTAMP WHERE id = $1', [context.rows[0].id])
    await client.query('COMMIT')
    return { requestId: row.id, transaction: prepared.transaction, transactionHash: null }
  } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}

export async function relayHandleSigning(capability: string) {
  assertWritesEnabled()
  const expected = await browserRequest(capability)
  const client = await pool.connect()
  let hash: Hex
  try {
    await client.query('BEGIN')
    const row = (await client.query('SELECT * FROM libro_handle_claim_requests WHERE id = $1 FOR UPDATE', [expected.id])).rows[0]
    if (!row.transaction) throw new ServiceError('NOT_PREPARED', 'Handle claim has not been prepared', 409)
    if (row.transaction_hash) hash = row.transaction_hash
    else {
      if (!(await client.query('SELECT 1 FROM libro_sponsorship_bindings WHERE identity_id = $1', [row.identity_id])).rows[0]) {
        throw new ServiceError('SPONSORSHIP_REQUIRED', 'Sponsorship proof is required for relayed gas', 402)
      }
      await client.query('SELECT pg_advisory_xact_lock($1)', [480001])
      hash = await relayRegistration(row.transaction as HumanRegistrationTransaction)
      await client.query('UPDATE libro_handle_claim_requests SET transaction_hash = $2 WHERE id = $1', [row.id, hash.toLowerCase()])
    }
    await client.query('COMMIT')
  } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
  await waitForRegistration(hash)
  return { transactionHash: hash.toLowerCase() }
}

export async function finalizeHandleSigning(capability: string, transactionHash: string) {
  assertWritesEnabled()
  const row = await browserRequest(capability)
  if (row.finalized_at) return { handle: row.handle, transactionHash: row.transaction_hash }
  if (!/^0x[0-9a-f]{64}$/i.test(transactionHash)) throw new ServiceError('INVALID_TRANSACTION', 'Transaction hash is invalid', 400)
  if (!await verifyHandleClaim({
    transactionHash: transactionHash as Hex,
    handleHash: row.handle_hash as Hex,
    sessionCommitment: row.session_commitment as Hex,
  })) throw new ServiceError('REGISTRATION_PENDING', 'Handle claim is not indexed yet', 409, true)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `INSERT INTO libro_handle_claims
        (identity_id, handle, handle_hash, session_commitment, transaction_hash, finalized_at)
       VALUES ($1,$2,$3,$4,$5,CURRENT_TIMESTAMP) ON CONFLICT (identity_id) DO NOTHING`,
      [row.identity_id, row.handle, row.handle_hash, row.session_commitment, transactionHash.toLowerCase()],
    )
    await client.query('UPDATE libro_handle_claim_requests SET transaction_hash = $2, finalized_at = CURRENT_TIMESTAMP WHERE id = $1', [row.id, transactionHash.toLowerCase()])
    await client.query('COMMIT')
    return { handle: row.handle, transactionHash: transactionHash.toLowerCase() }
  } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}

export async function handleClaimStatus(principal: OAuthPrincipal, requestId: string) {
  const result = await pool.query(
    `SELECT id, handle, transaction_hash, finalized_at FROM libro_handle_claim_requests
     WHERE id = $1 AND identity_id = $2 AND origin_client_id = $3`,
    [requestId, principal.identityId, principal.clientId],
  )
  if (!result.rows[0]) throw new ServiceError('NOT_FOUND', 'Handle claim was not found', 404)
  return { requestId, handle: result.rows[0].handle, state: result.rows[0].finalized_at ? 'finalized' : 'awaiting_signature', transactionHash: result.rows[0].transaction_hash }
}

export async function recordHandleClaim(client: DatabaseClient, input: {
  identityId: string; handle: string; handleHash: string; sessionCommitment: string; transactionHash: string
}): Promise<void> {
  await client.query(
    `INSERT INTO libro_handle_claims
      (identity_id, handle, handle_hash, session_commitment, transaction_hash, finalized_at)
     VALUES ($1,$2,$3,$4,$5,CURRENT_TIMESTAMP) ON CONFLICT (identity_id) DO NOTHING`,
    [input.identityId, input.handle, input.handleHash, input.sessionCommitment, input.transactionHash.toLowerCase()],
  )
}
