import { randomUUID } from 'node:crypto'
import type { IDKitResultSession } from '@worldcoin/idkit'
import {
  LIBRO_AGENT_PROTOCOL_VERSION,
  LIBRO_AGENT_PUBLISH_DOCUMENT_SCOPE,
  createLibroAgentRegistration,
  hashLibroHandle,
  type LibroAuthorReference,
} from '@libro/core'
import { isAddress, type Address, type Hex } from 'viem'
import { pool } from './db'
import { assertWritesEnabled, ServiceError } from './errors'
import type { OAuthPrincipal } from './oauth'
import { chainConfig, prepareAgentAuthorization, relayRegistration, verifyAgentRegistration, waitForRegistration, type HumanRegistrationTransaction } from './chain'
import { deriveCapability, randomHex, sha256 } from './crypto'
import { defaultAuthorNamespace, serviceOrigin, signingCapabilitySecret } from './config'
import { browserIdentityId } from './session'
import { assertSessionResult, issueRpContext, sessionCommitment, verifyWithWorld } from './world-id'

function reference(principal: OAuthPrincipal): LibroAuthorReference {
  return { namespace: principal.authorNamespace || defaultAuthorNamespace(), id: principal.authorId }
}

export async function createAgentRegistrationChallenge(input: {
  principal: OAuthPrincipal
  controllerAddress: string
  agentAddress: string
  expiresAt: string
}) {
  assertWritesEnabled()
  if (!isAddress(input.controllerAddress) || !isAddress(input.agentAddress)) {
    throw new ServiceError('INVALID_ADDRESS', 'Controller and agent must be EVM addresses', 400)
  }
  const expiry = new Date(input.expiresAt)
  const now = new Date()
  if (!Number.isFinite(expiry.getTime()) || expiry <= now || expiry.getTime() > now.getTime() + 366 * 24 * 60 * 60_000) {
    throw new ServiceError('INVALID_EXPIRY', 'Agent expiry must be within the next year', 400)
  }
  const id = randomUUID()
  const capability = deriveCapability(id, signingCapabilitySecret())
  const config = chainConfig()
  const salt = randomHex()
  const validFrom = new Date(Math.floor(Date.now() / 1000) * 1000)
  const created = createLibroAgentRegistration({
    handleHash: hashLibroHandle(input.principal.handle),
    controllerAddress: input.controllerAddress,
    agentAddress: input.agentAddress,
    scope: LIBRO_AGENT_PUBLISH_DOCUMENT_SCOPE,
    validFrom,
    expiresAt: expiry,
    salt,
    chainId: config.chainId,
    registryAddress: config.registryAddress,
  })
  const authorReference = reference(input.principal)
  const payload = {
    schema: 'libro-agent-registration-v1',
    protocol_version: LIBRO_AGENT_PROTOCOL_VERSION,
    world_id_proof_type: 'session',
    handle_hash: hashLibroHandle(input.principal.handle),
    controller_address: input.controllerAddress.toLowerCase(),
    agent_address: input.agentAddress.toLowerCase(),
    scope: LIBRO_AGENT_PUBLISH_DOCUMENT_SCOPE.toString(),
    valid_from: validFrom.toISOString(),
    expires_at: expiry.toISOString(),
    nonce: salt,
    chain_id: config.chainId,
    registry_address: config.registryAddress,
    author_reference: authorReference,
  }
  await pool.query(
    `INSERT INTO libro_agent_registrations
      (id, identity_id, author_id, origin_client_id, author_reference,
       registration_hash, handle_hash, session_commitment, controller_address,
       agent_address, scope, valid_from, expires_at, nonce, signal, signal_hash,
       payload, signing_capability_hash, chain_id, registry_address)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
    [id, input.principal.identityId, input.principal.authorId, input.principal.clientId,
      authorReference, created.registrationHash, payload.handle_hash, input.principal.sessionCommitment,
      payload.controller_address, payload.agent_address, payload.scope, payload.valid_from,
      payload.expires_at, salt, created.signal, created.signalHash, payload, sha256(capability),
      config.chainId, config.registryAddress],
  )
  return {
    registrationId: id,
    registrationHash: created.registrationHash,
    signingUrl: new URL(`/sign-agent/${capability}`, serviceOrigin()).toString(),
    payload,
  }
}

export async function getAgentRegistrationSigningChallenge(capability: string) {
  const result = await pool.query(
    `SELECT r.*, i.world_id_session_id, a.name, a.handle
     FROM libro_agent_registrations r
     JOIN libro_identities i ON i.id = r.identity_id
     JOIN libro_authors a ON a.id = r.author_id
     WHERE r.signing_capability_hash = $1`,
    [sha256(capability)],
  )
  const row = result.rows[0]
  if (!row || row.revoked_at || new Date(row.expires_at).getTime() <= Date.now()) {
    throw new ServiceError('INVALID_CAPABILITY', 'Agent authorization request is invalid or expired', 404)
  }
  return row
}

async function browserChallenge(capability: string) {
  const identityId = await browserIdentityId()
  if (!identityId) throw new ServiceError('AUTH_REQUIRED', 'Sign in to Libro before authorizing an agent', 401)
  const row = await getAgentRegistrationSigningChallenge(capability)
  if (row.identity_id !== identityId) throw new ServiceError('IDENTITY_MISMATCH', 'Agent request belongs to another identity', 403)
  return row
}

export async function agentSigningContext(request: Request, capability: string) {
  assertWritesEnabled()
  const row = await browserChallenge(capability)
  const context = await issueRpContext({
    request,
    purpose: 'agent_registration',
    clientId: row.origin_client_id,
    identityId: row.identity_id,
    objectId: row.id,
    signalHash: row.signal_hash,
    expectedCommitment: row.session_commitment,
  })
  return { ...context, registrationId: row.id, registrationHash: row.registration_hash, payload: row.payload, existingSessionId: row.world_id_session_id }
}

function validateResult(result: IDKitResultSession, row: Record<string, unknown>): void {
  const expectedEnvironment = process.env.NEXT_PUBLIC_WORLD_ID_ENVIRONMENT === 'staging' ? 'staging' : 'production'
  if (result.environment !== expectedEnvironment || result.session_id !== row.world_id_session_id
    || sessionCommitment(result.session_id) !== String(row.session_commitment).toLowerCase()) {
    throw new ServiceError('IDENTITY_MISMATCH', 'World ID session does not match this agent authorization', 403)
  }
  if (result.responses.some((item) => item.identifier !== 'proof_of_human'
    || item.signal_hash?.toLowerCase() !== String(row.signal_hash).toLowerCase())) {
    throw new ServiceError('SIGNAL_MISMATCH', 'World ID proof is not bound to this agent authorization', 400)
  }
}

export async function prepareAgentSigning(capability: string, payload: unknown) {
  assertWritesEnabled()
  const expected = await browserChallenge(capability)
  if (expected.transaction) return { registrationId: expected.id, transaction: expected.transaction, transactionHash: expected.transaction_hash }
  const result = assertSessionResult(payload)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const locked = await client.query(
      `SELECT r.*, i.world_id_session_id, a.handle FROM libro_agent_registrations r
       JOIN libro_identities i ON i.id = r.identity_id JOIN libro_authors a ON a.id = r.author_id
       WHERE r.id = $1 AND r.finalized_at IS NULL AND r.revoked_at IS NULL FOR UPDATE OF r`,
      [expected.id],
    )
    const row = locked.rows[0]
    if (!row) throw new ServiceError('NOT_FOUND', 'Pending agent authorization was not found', 404)
    const context = await client.query(
      `SELECT id FROM libro_rp_contexts WHERE nonce = $1 AND purpose = 'agent_registration'
       AND identity_id = $2 AND object_id = $3 AND expected_signal_hash = $4
       AND expected_session_commitment = $5 AND consumed_at IS NULL
       AND expires_at > CURRENT_TIMESTAMP FOR UPDATE`,
      [result.nonce.toLowerCase(), row.identity_id, row.id, row.signal_hash.toLowerCase(), row.session_commitment.toLowerCase()],
    )
    if (!context.rows[0]) throw new ServiceError('INVALID_CONTEXT', 'Agent authorization context is invalid or expired', 400)
    validateResult(result, row)
    await verifyWithWorld(result)
    const recreated = createLibroAgentRegistration({
      handleHash: row.handle_hash,
      controllerAddress: row.controller_address,
      agentAddress: row.agent_address,
      scope: BigInt(row.scope),
      validFrom: row.valid_from,
      expiresAt: row.expires_at,
      salt: row.nonce,
      chainId: row.chain_id,
      registryAddress: row.registry_address,
    })
    if (recreated.registrationHash.toLowerCase() !== row.registration_hash.toLowerCase()) {
      throw new ServiceError('REGISTRATION_MISMATCH', 'Stored agent authorization is inconsistent', 500)
    }
    const claim = await client.query('SELECT 1 FROM libro_handle_claims WHERE identity_id = $1', [row.identity_id])
    const prepared = prepareAgentAuthorization({
      result,
      sessionCommitment: row.session_commitment,
      handle: row.handle,
      claimHandle: claim.rows.length === 0,
      registration: recreated.contractRegistration,
    })
    const proof = {
      proof_type: 'session',
      signal: row.signal,
      signal_hash: row.signal_hash,
      registration_hash: row.registration_hash,
      handle_hash: row.handle_hash,
      payload: row.payload,
      credential_identifier: result.responses[0].identifier,
      credential_identifiers: result.responses.map((item) => item.identifier),
      idkit_result: { protocol_version: result.protocol_version, nonce: result.nonce, environment: result.environment, responses: result.responses },
      session_nullifier: prepared.sessionNullifier,
    }
    await client.query('UPDATE libro_agent_registrations SET proof = $2, transaction = $3 WHERE id = $1', [row.id, proof, prepared.transaction])
    await client.query('UPDATE libro_rp_contexts SET consumed_at = CURRENT_TIMESTAMP WHERE id = $1', [context.rows[0].id])
    await client.query('COMMIT')
    return { registrationId: row.id, transaction: prepared.transaction, transactionHash: null }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function relayAgentSigning(capability: string) {
  assertWritesEnabled()
  const expected = await browserChallenge(capability)
  const client = await pool.connect()
  let hash: Hex
  try {
    await client.query('BEGIN')
    const result = await client.query('SELECT * FROM libro_agent_registrations WHERE id = $1 FOR UPDATE', [expected.id])
    const row = result.rows[0]
    if (!row?.transaction) throw new ServiceError('NOT_PREPARED', 'Agent authorization has not been prepared', 409)
    if (row.transaction_hash) hash = row.transaction_hash
    else {
      const sponsor = await client.query('SELECT 1 FROM libro_sponsorship_bindings WHERE identity_id = $1', [row.identity_id])
      if (!sponsor.rows[0]) throw new ServiceError('SPONSORSHIP_REQUIRED', 'Sponsorship proof is required for relayed gas', 402)
      await client.query('SELECT pg_advisory_xact_lock($1)', [480001])
      hash = await relayRegistration(row.transaction as HumanRegistrationTransaction)
      await client.query('UPDATE libro_agent_registrations SET transaction_hash = $2 WHERE id = $1', [row.id, hash.toLowerCase()])
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

export async function finalizeAgentSigning(capability: string, input: { transactionHash: string; userOpHash?: string }) {
  assertWritesEnabled()
  const row = await browserChallenge(capability)
  if (!/^0x[0-9a-f]{64}$/i.test(input.transactionHash)) throw new ServiceError('INVALID_TRANSACTION', 'Transaction hash is invalid', 400)
  if (row.finalized_at) return { registrationId: row.id, registrationHash: row.registration_hash }
  const registered = await verifyAgentRegistration({
    transactionHash: input.transactionHash as Hex,
    registrationHash: row.registration_hash as Hex,
    handleHash: row.handle_hash as Hex,
    agentAddress: row.agent_address as Address,
  })
  if (!registered) throw new ServiceError('REGISTRATION_PENDING', 'Agent authorization is not indexed yet', 409, true)
  await pool.query(
    `UPDATE libro_agent_registrations SET user_op_hash = $2, transaction_hash = $3,
       finalized_at = CURRENT_TIMESTAMP WHERE id = $1 AND finalized_at IS NULL`,
    [row.id, input.userOpHash || null, input.transactionHash.toLowerCase()],
  )
  return { registrationId: row.id, registrationHash: row.registration_hash }
}

export async function agentRegistrationStatus(principal: OAuthPrincipal, registrationId: string) {
  const result = await pool.query(
    `SELECT id, registration_hash, transaction_hash, finalized_at, revoked_at
     FROM libro_agent_registrations
     WHERE id = $1 AND identity_id = $2 AND origin_client_id = $3`,
    [registrationId, principal.identityId, principal.clientId],
  )
  const row = result.rows[0]
  if (!row) throw new ServiceError('NOT_FOUND', 'Agent authorization was not found', 404)
  return {
    registrationId: row.id,
    registrationHash: row.registration_hash,
    state: row.revoked_at ? 'revoked' : row.finalized_at ? 'finalized' : row.transaction_hash ? 'submitted' : 'awaiting_signature',
    transactionHash: row.transaction_hash || null,
  }
}
