import type { IDKitResult } from '@worldcoin/idkit'
import { hashPublicationSignal } from '@libro/core'
import { pool } from './db'
import { browserIdentityId } from './session'
import { issueRpContext, SPONSORSHIP_ACTION, verifyWithWorld } from './world-id'
import { assertWritesEnabled, ServiceError } from './errors'

async function identity(): Promise<string> {
  const id = await browserIdentityId()
  if (!id) throw new ServiceError('AUTH_REQUIRED', 'Sign in to Libro before requesting sponsorship', 401)
  return id
}

export async function sponsorshipContext(request: Request) {
  assertWritesEnabled()
  const identityId = await identity()
  const signal = `libro:sponsorship:${identityId}`
  return {
    ...(await issueRpContext({
      request,
      purpose: 'sponsorship',
      identityId,
      objectId: identityId,
      signalHash: hashPublicationSignal(signal),
    })),
    action: SPONSORSHIP_ACTION,
    signal,
  }
}

export async function verifySponsorship(payload: unknown): Promise<void> {
  assertWritesEnabled()
  const identityId = await identity()
  const result = payload as IDKitResult & { action?: string; responses?: Array<{ nullifier?: string; signal_hash?: string }> }
  if (!result || result.protocol_version !== '4.0' || result.action !== SPONSORSHIP_ACTION || !Array.isArray(result.responses) || !result.responses[0]?.nullifier) {
    throw new ServiceError('INVALID_PROOF', 'Libro sponsorship requires a World ID uniqueness proof', 400)
  }
  const signalHash = hashPublicationSignal(`libro:sponsorship:${identityId}`)
  if (result.responses.some((response) => response.signal_hash?.toLowerCase() !== signalHash.toLowerCase())) {
    throw new ServiceError('SIGNAL_MISMATCH', 'Sponsorship proof is not bound to this Libro identity', 400)
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const context = await client.query(
      `SELECT id FROM libro_rp_contexts WHERE nonce = $1 AND purpose = 'sponsorship'
       AND identity_id = $2 AND object_id = $2 AND expected_signal_hash = $3
       AND consumed_at IS NULL AND expires_at > CURRENT_TIMESTAMP FOR UPDATE`,
      [result.nonce.toLowerCase(), identityId, signalHash.toLowerCase()],
    )
    if (!context.rows[0]) throw new ServiceError('INVALID_CONTEXT', 'Sponsorship context is expired or consumed', 400)
    await verifyWithWorld(result)
    let nullifier: string
    try {
      nullifier = BigInt(result.responses[0].nullifier!).toString()
    } catch {
      throw new ServiceError('INVALID_PROOF', 'Sponsorship nullifier is not a uint256', 400)
    }
    const binding = await client.query(
      `INSERT INTO libro_sponsorship_bindings (identity_id, action, nullifier)
       VALUES ($1, $2, $3)
       ON CONFLICT (identity_id) DO UPDATE SET verified_at = CURRENT_TIMESTAMP
       WHERE libro_sponsorship_bindings.action = EXCLUDED.action
         AND libro_sponsorship_bindings.nullifier = EXCLUDED.nullifier
       RETURNING identity_id`,
      [identityId, SPONSORSHIP_ACTION, nullifier],
    )
    if (!binding.rows[0]) {
      throw new ServiceError('SPONSORSHIP_IDENTITY_DRIFT', 'This Libro identity is already bound to a different uniqueness proof', 409)
    }
    await client.query('UPDATE libro_rp_contexts SET consumed_at = CURRENT_TIMESTAMP WHERE id = $1', [context.rows[0].id])
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    if ((error as { code?: string }).code === '23505') {
      throw new ServiceError('NULLIFIER_REUSED', 'This World ID sponsorship proof is already bound to another identity', 409)
    }
    throw error
  } finally {
    client.release()
  }
}
