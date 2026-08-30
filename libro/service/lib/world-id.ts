import { createHmac } from 'node:crypto'
import { signRequest } from '@worldcoin/idkit/signing'
import type { IDKitResult, IDKitResultSession, RpContext } from '@worldcoin/idkit'
import { pool } from './db'
import { RP_CONTEXT_TTL_SECONDS, worldIdConfig } from './config'
import { ServiceError } from './errors'
import { isValidHandle, normalizeHandle } from './handles'
import { deliverPendingEvents, enqueueServiceEvent } from './events'

export const SPONSORSHIP_ACTION = 'libro-sponsored-v1'
const SESSION_ID = /^session_([0-9a-fA-F]{64})[0-9a-fA-F]{64}$/

export type RpPurpose = 'login' | 'signup' | 'publish' | 'claim_handle' | 'agent_registration' | 'sponsorship'

export function sessionCommitment(sessionId: string): `0x${string}` {
  const match = SESSION_ID.exec(sessionId)
  if (!match) throw new ServiceError('INVALID_PROOF', 'World ID session id is invalid', 400)
  return `0x${match[1].toLowerCase()}`
}

function requestIpHash(request: Request): string | null {
  const address = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')?.trim()
  if (!address) return null
  const secret = process.env.LIBRO_ABUSE_SECRET
  if (!secret) throw new ServiceError('CONFIG_ERROR', 'LIBRO_ABUSE_SECRET is required', 500)
  return createHmac('sha256', secret).update(`libro-auth-ip:${address}`).digest('hex')
}

export async function issueRpContext(input: {
  request: Request
  purpose: RpPurpose
  clientId?: string | null
  identityId?: string | null
  objectId?: string | null
  signalHash?: string | null
  expectedCommitment?: string | null
}): Promise<{ appId: string; environment: string; rpContext: RpContext }> {
  const config = worldIdConfig()
  const signature = signRequest({
    signingKeyHex: config.signingKeyHex,
    action: input.purpose === 'sponsorship' ? SPONSORSHIP_ACTION : undefined,
    ttl: RP_CONTEXT_TTL_SECONDS,
  })
  const ipHash = requestIpHash(input.request)
  const limit = await pool.query(
    `SELECT COUNT(*)::int AS count FROM libro_rp_contexts
     WHERE request_ip_hash = $1 AND created_at > CURRENT_TIMESTAMP - INTERVAL '10 minutes'`,
    [ipHash],
  )
  if (ipHash && Number(limit.rows[0]?.count || 0) >= 20) {
    throw new ServiceError('RATE_LIMITED', 'Too many World ID requests', 429, true)
  }
  await pool.query(
    `INSERT INTO libro_rp_contexts
      (nonce, purpose, client_id, identity_id, object_id, expected_signal_hash,
       expected_session_commitment, request_ip_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, to_timestamp($9))`,
    [
      signature.nonce.toLowerCase(), input.purpose, input.clientId || null, input.identityId || null,
      input.objectId || null, input.signalHash?.toLowerCase() || null,
      input.expectedCommitment?.toLowerCase() || null, ipHash, signature.expiresAt,
    ],
  )
  return {
    appId: config.appId,
    environment: config.environment,
    rpContext: {
      rp_id: config.rpId,
      nonce: signature.nonce,
      created_at: signature.createdAt,
      expires_at: signature.expiresAt,
      signature: signature.sig,
    },
  }
}

export function assertSessionResult(value: unknown): IDKitResultSession {
  const result = value as Partial<IDKitResultSession>
  if (
    !result || result.protocol_version !== '4.0' || typeof result.session_id !== 'string'
    || 'action' in result || !Array.isArray(result.responses) || result.responses.length === 0
  ) {
    throw new ServiceError('INVALID_PROOF', 'World ID session proof is required', 400)
  }
  for (const response of result.responses) {
    if (
      response.identifier !== 'proof_of_human' || !Array.isArray(response.proof)
      || !Array.isArray(response.session_nullifier) || response.session_nullifier.length < 2
    ) {
      throw new ServiceError('INVALID_PROOF', 'Proof of Human session credential is required', 400)
    }
  }
  return result as IDKitResultSession
}

export async function verifyWithWorld(result: IDKitResult): Promise<void> {
  const config = worldIdConfig()
  let response: Response
  try {
    response = await fetch(`https://developer.world.org/api/v4/verify/${config.rpId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result),
      cache: 'no-store',
    })
  } catch {
    throw new ServiceError('VERIFIER_UNAVAILABLE', 'World ID verifier could not be reached', 502, true)
  }
  if (!response.ok) {
    throw new ServiceError('VERIFIER_REJECTED', 'World ID verifier rejected the proof', 401)
  }
}

export async function verifyIdentity(input: {
  payload: unknown
  purpose: 'login' | 'signup'
  handle?: string
  name?: string
  bio?: string
}): Promise<{ identityId: string; authorId: string; handle: string; created: boolean }> {
  const result = assertSessionResult(input.payload)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const contextResult = await client.query(
      `SELECT * FROM libro_rp_contexts
       WHERE nonce = $1 AND purpose = $2 AND consumed_at IS NULL AND expires_at > CURRENT_TIMESTAMP
       FOR UPDATE`,
      [result.nonce.toLowerCase(), input.purpose],
    )
    if (contextResult.rows.length === 0) {
      throw new ServiceError('INVALID_CONTEXT', 'World ID context is expired, consumed, or has the wrong purpose', 400)
    }
    await verifyWithWorld(result)
    const commitment = sessionCommitment(result.session_id)
    const credential = result.responses[0].identifier
    const existing = await client.query(
      `SELECT i.id AS identity_id, a.id AS author_id, a.handle, a.name, COALESCE(a.bio, '') AS bio
       FROM libro_identities i JOIN libro_authors a ON a.identity_id = i.id
       WHERE i.world_id_session_id = $1 FOR UPDATE OF i, a`,
      [result.session_id],
    )
    let row = existing.rows[0]
    let created = false
    if (!row) {
      if (input.purpose !== 'signup') {
        throw new ServiceError('IDENTITY_NOT_FOUND', 'This World ID session has no Libro identity', 404)
      }
      const handle = normalizeHandle(input.handle || '')
      if (!isValidHandle(handle)) throw new ServiceError('INVALID_HANDLE', 'A valid handle is required', 400)
      const identity = await client.query(
        `INSERT INTO libro_identities
          (world_id_session_id, session_commitment, credential_identifier)
         VALUES ($1, $2, $3) RETURNING id`,
        [result.session_id, commitment, credential],
      )
      const author = await client.query(
        `INSERT INTO libro_authors (identity_id, name, handle, bio)
         VALUES ($1, $2, $3, $4) RETURNING id, handle`,
        [identity.rows[0].id, (input.name || handle).trim().slice(0, 255), handle, (input.bio || '').trim() || null],
      )
      row = {
        identity_id: identity.rows[0].id,
        author_id: author.rows[0].id,
        handle: author.rows[0].handle,
        name: (input.name || handle).trim().slice(0, 255),
        bio: (input.bio || '').trim(),
      }
      created = true
    } else {
      await client.query(
        `UPDATE libro_identities SET verified_at = CURRENT_TIMESTAMP, credential_identifier = $2,
          modified_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [row.identity_id, credential],
      )
    }
    await client.query('UPDATE libro_rp_contexts SET consumed_at = CURRENT_TIMESTAMP WHERE id = $1', [contextResult.rows[0].id])
    await enqueueServiceEvent(client, {
      type: 'author.updated',
      aggregateId: row.author_id,
      data: {
        identityId: row.identity_id,
        authorId: row.author_id,
        handle: row.handle,
        name: row.name,
        bio: row.bio,
      },
    })
    await client.query('COMMIT')
    await deliverPendingEvents(25).catch(() => undefined)
    return { identityId: row.identity_id, authorId: row.author_id, handle: row.handle, created }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
