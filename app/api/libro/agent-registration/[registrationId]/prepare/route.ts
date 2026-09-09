import { NextRequest, NextResponse } from 'next/server'
import type { IDKitResultSession } from '@worldcoin/idkit'
import { pool } from '@/lib/db'
import { getAuthenticatedUser } from '@/lib/auth-user'
import { getLibroAgentServerConfig } from '@/lib/libro/config'
import {
  createAgentRegistrationPayload,
  prepareAgentRegistration,
  type AgentRegistrationPayload,
} from '@/lib/libro/agent'
import { getWorldIdServerConfig } from '@/lib/world-id/server'
import {
  sessionIdToCommitment,
  validateSessionCredentialResponses,
  validateWorldIdSessionResult,
} from '@/lib/world-id/proof'
import { retiredLibroWriterResponse } from '@/lib/libro-service/cutover'

type RequestBody = { idkitResult?: IDKitResultSession }

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ registrationId: string }> }
): Promise<NextResponse> {
  const retired = retiredLibroWriterResponse()
  if (retired) return retired
  const user = await getAuthenticatedUser()
  if (!user) return NextResponse.json({ success: false, message: 'Authentication required' }, { status: 401 })

  let worldIdConfig
  let config
  try {
    worldIdConfig = getWorldIdServerConfig()
    config = getLibroAgentServerConfig()
  } catch (error) {
    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : 'Invalid configuration' }, { status: 500 })
  }

  const { registrationId } = await params
  const body = await req.json().catch(() => null) as RequestBody | null
  if (!body?.idkitResult) {
    return NextResponse.json({ success: false, message: 'World ID session result is required' }, { status: 400 })
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const fail = async (message: string, status = 400) => {
      await client.query('ROLLBACK')
      return NextResponse.json({ success: false, message }, { status })
    }
    const result = await client.query(
      `SELECT r.*, a.handle, u.world_id_session_id
       FROM libro_agent_registrations r
       INNER JOIN authors a ON a.id = r."authorId" AND a."userId" = r."userId"
       INNER JOIN users u ON u.id = r."userId" AND u.handle = a.handle
       WHERE r.id = $1 AND r."userId" = $2 FOR UPDATE`,
      [registrationId, user.id]
    )
    if (result.rows.length === 0) return await fail('Agent registration not found', 404)
    const row = result.rows[0]
    if (row.finalized_at) return await fail('Agent registration is already finalized')

    const payload = row.payload as AgentRegistrationPayload
    const recreated = createAgentRegistrationPayload({
      handleHash: row.handle_hash,
      controllerAddress: row.controller_address,
      agentAddress: row.agent_address,
      scope: BigInt(row.scope),
      validFrom: row.valid_from,
      expiresAt: row.expires_at,
      salt: payload.nonce,
      chainId: row.chain_id,
      registryAddress: row.registry_address,
    })
    if (
      recreated.registrationHash.toLowerCase() !== row.registration_hash.toLowerCase() ||
      recreated.signalHash.toLowerCase() !== row.signal_hash.toLowerCase()
    ) return await fail('Agent registration payload changed')

    let validated
    let credentials
    try {
      validated = validateWorldIdSessionResult(body.idkitResult, {
        nonce: row.nonce,
        environment: worldIdConfig.environment,
        signalHash: row.signal_hash,
        expectedSessionId: row.world_id_session_id,
        requireUserPresence: true,
      })
      credentials = validateSessionCredentialResponses(validated.responses, row.signal_hash)
      if (sessionIdToCommitment(validated.session_id) !== row.session_commitment.toLowerCase()) {
        throw new Error('World ID session does not own this handle')
      }
    } catch (error) {
      return await fail(error instanceof Error ? error.message : 'Invalid session proof')
    }

    const claim = await client.query(
      `SELECT id FROM libro_handle_claims
       WHERE "userId" = $1 AND handle_hash = $2 AND session_commitment = $3`,
      [user.id, row.handle_hash, row.session_commitment]
    )
    const transaction = prepareAgentRegistration({
      result: validated,
      contractRegistration: recreated.contractRegistration,
      handle: row.handle,
      claimHandle: claim.rows.length === 0,
      config,
    })
    const proof = {
      protocol_version: '4.0',
      proof_type: 'session',
      nonce: row.nonce,
      signal: row.signal,
      signal_hash: row.signal_hash,
      registration_hash: row.registration_hash,
      handle_hash: row.handle_hash,
      payload,
      credential_identifier: credentials[0],
      credential_identifiers: credentials,
      session_proof: {
        responses: validated.responses,
        environment: validated.environment,
      },
    }
    await client.query(
      'UPDATE libro_agent_registrations SET proof = $1, transaction = $2 WHERE id = $3',
      [proof, transaction, registrationId]
    )
    await client.query('COMMIT')
    return NextResponse.json({ success: true, registrationId, registrationHash: row.registration_hash, transaction })
  } catch (error) {
    await client.query('ROLLBACK')
    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : 'Failed to prepare agent registration' }, { status: 500 })
  } finally {
    client.release()
  }
}
