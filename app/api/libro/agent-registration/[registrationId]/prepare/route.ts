import { NextRequest, NextResponse } from 'next/server'
import type { IDKitResult } from '@worldcoin/idkit'
import { pool } from '@/lib/db'
import { getAuthenticatedUser } from '@/lib/auth-user'
import { getLibroAgentServerConfig } from '@/lib/libro/config'
import { createAgentRegistrationPayload, prepareAgentRegistration, type AgentRegistrationPayload } from '@/lib/libro/agent'
import { getWorldIdServerConfig } from '@/lib/world-id/server'
import { validateCredentialResponses, validateWorldIdV4Result } from '@/lib/world-id/proof'

type PrepareAgentRegistrationRequest = {
  idkitResult?: IDKitResult
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ registrationId: string }> }
): Promise<NextResponse> {
  const authenticatedUser = await getAuthenticatedUser()

  if (!authenticatedUser) {
    return NextResponse.json({ success: false, message: 'Authentication required' }, { status: 401 })
  }

  let worldIdConfig
  let agentConfig
  try {
    worldIdConfig = getWorldIdServerConfig()
    agentConfig = getLibroAgentServerConfig()
  } catch (error) {
    return NextResponse.json({
      success: false,
      message: error instanceof Error ? error.message : 'Libro agent configuration is invalid',
    }, { status: 500 })
  }

  const { registrationId } = await params
  const body = await req.json().catch(() => null) as PrepareAgentRegistrationRequest | null
  if (!body?.idkitResult) {
    return NextResponse.json({ success: false, message: 'World ID result is required' }, { status: 400 })
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
       WHERE id = $1 AND "userId" = $2
       FOR UPDATE`,
      [registrationId, authenticatedUser.id]
    )

    if (registrationResult.rows.length === 0) {
      return await fail('Agent registration not found', 404)
    }

    const registrationRow = registrationResult.rows[0]
    if (registrationRow.finalized_at) {
      return await fail('Agent registration is already finalized')
    }

    const payload = registrationRow.payload as AgentRegistrationPayload
    let recreated
    try {
      recreated = createAgentRegistrationPayload({
        action: registrationRow.action,
        principalAuthorHash: registrationRow.principal_author_hash,
        controllerAddress: registrationRow.controller_address,
        agentAddress: registrationRow.agent_address,
        scope: BigInt(registrationRow.scope),
        validFrom: registrationRow.valid_from,
        expiresAt: registrationRow.expires_at,
        salt: payload.nonce,
        chainId: registrationRow.chain_id,
        registryAddress: registrationRow.registry_address,
      })

      if (
        recreated.registrationHash.toLowerCase() !== registrationRow.registration_hash.toLowerCase() ||
        recreated.signal.toLowerCase() !== registrationRow.signal.toLowerCase() ||
        recreated.signalHash.toLowerCase() !== registrationRow.signal_hash.toLowerCase()
      ) {
        throw new Error('Agent registration payload changed')
      }
    } catch (error) {
      return await fail(error instanceof Error ? error.message : 'Agent registration payload is invalid')
    }

    let validatedResult
    let credentialIdentifiers: string[]
    try {
      validatedResult = validateWorldIdV4Result(body.idkitResult, {
        action: registrationRow.action,
        nonce: registrationRow.nonce,
        environment: worldIdConfig.environment,
        signalHash: registrationRow.signal_hash,
      })
      if (validatedResult.action !== agentConfig.action) {
        throw new Error('World ID proof context does not match this agent registration')
      }
      credentialIdentifiers = validateCredentialResponses(validatedResult.responses, registrationRow.signal_hash)
    } catch (error) {
      return await fail(error instanceof Error ? error.message : 'Invalid World ID agent registration proof')
    }

    const transaction = prepareAgentRegistration(validatedResult, recreated.contractRegistration, agentConfig)
    const proof = {
      protocol_version: '4.0',
      action: registrationRow.action,
      nonce: registrationRow.nonce,
      signal: registrationRow.signal,
      signal_hash: registrationRow.signal_hash,
      registration_hash: registrationRow.registration_hash,
      payload,
      credential_identifier: credentialIdentifiers[0],
      credential_identifiers: credentialIdentifiers,
      idkit_result: validatedResult,
      verify_response: {
        success: true,
        verifier: 'libro_agent_onchain_pending',
      },
    }

    await client.query(
      `UPDATE libro_agent_registrations
       SET proof = $1, transaction = $2
       WHERE id = $3`,
      [proof, transaction, registrationId]
    )

    await client.query('COMMIT')

    return NextResponse.json({
      success: true,
      registrationId,
      registrationHash: registrationRow.registration_hash,
      transaction,
    })
  } catch (error) {
    await client.query('ROLLBACK')
    return NextResponse.json({
      success: false,
      message: 'Failed to prepare agent registration',
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 })
  } finally {
    client.release()
  }
}
