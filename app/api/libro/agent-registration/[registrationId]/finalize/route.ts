import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { isHex } from 'viem'
import { pool } from '@/lib/db'
import {
  configureLibroWriteTransaction,
  describeDatabaseFailure,
  rollbackAndRelease,
} from '@/lib/db/resilience'
import { getAuthenticatedUser } from '@/lib/auth-user'
import { getLibroAgentServerConfig } from '@/lib/libro/config'
import { verifyLibroAgentRegistered } from '@/lib/libro/server'

type FinalizeAgentRegistrationRequest = {
  userOpHash?: string
  transactionHash?: string
}

function failureResponse(error: unknown, stage: string): NextResponse {
  const failure = describeDatabaseFailure(error)
  if (failure.retryable || stage === 'chain_verify' || stage === 'pool_connect') {
    return NextResponse.json({
      success: false,
      code: 'FINALIZE_RETRYABLE',
      retryable: true,
      message: 'Agent registration finalization is temporarily busy. Please retry.',
    }, { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '1' } })
  }
  return NextResponse.json({
    success: false,
    message: 'Failed to finalize agent registration',
    error: failure.message,
  }, { status: 500 })
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ registrationId: string }> }
): Promise<NextResponse> {
  const requestId = randomUUID()
  const startedAt = Date.now()
  let authenticatedUser
  try {
    authenticatedUser = await getAuthenticatedUser()
  } catch (error) {
    const failure = describeDatabaseFailure(error)
    console.error('Failed to authenticate Libro agent registration finalization', {
      requestId,
      stage: 'authenticate',
      durationMs: Date.now() - startedAt,
      code: failure.code,
      message: failure.message,
      retryable: failure.retryable,
    })
    return failureResponse(error, 'authenticate')
  }

  if (!authenticatedUser) {
    return NextResponse.json({ success: false, message: 'Authentication required' }, { status: 401 })
  }

  let agentConfig
  try {
    agentConfig = getLibroAgentServerConfig()
  } catch (error) {
    return NextResponse.json({
      success: false,
      message: error instanceof Error ? error.message : 'Libro agent configuration is invalid',
    }, { status: 500 })
  }

  const { registrationId } = await params
  const { userOpHash, transactionHash } = await req.json().catch(() => ({})) as FinalizeAgentRegistrationRequest

  if (!userOpHash || !transactionHash || !isHex(userOpHash) || !isHex(transactionHash)) {
    return NextResponse.json({
      success: false,
      message: 'User operation and transaction hash must be 0x-prefixed hex strings',
    }, { status: 400 })
  }

  let stage = 'lookup'
  try {
    const registrationResult = await pool.query(
      `SELECT registration_hash, finalized_at, transaction_hash
       FROM libro_agent_registrations
       WHERE id = $1 AND "userId" = $2`,
      [registrationId, authenticatedUser.id]
    )

    if (registrationResult.rows.length === 0) {
      return NextResponse.json({ success: false, message: 'Agent registration not found' }, { status: 404 })
    }

    const pending = registrationResult.rows[0]
    if (pending.finalized_at) {
      const { rows } = await pool.query(
        `SELECT id, registration_hash, agent_address
         FROM libro_agent_registrations
         WHERE id = $1 AND "userId" = $2`,
        [registrationId, authenticatedUser.id]
      )
      return NextResponse.json({ success: true, registration: rows[0] })
    }

    stage = 'chain_verify'
    const isRegistered = await verifyLibroAgentRegistered(pending.registration_hash, agentConfig)
    if (!isRegistered) {
      return NextResponse.json({
        success: false,
        message: 'Libro agent registry does not contain this registration yet',
      }, { status: 400 })
    }

    stage = 'pool_connect'
    const client = await pool.connect()
    let clientReleased = false
    let transactionOpen = false
    try {
      stage = 'begin'
      await client.query('BEGIN')
      transactionOpen = true
      await configureLibroWriteTransaction(client)

      stage = 'lock_registration'
      const locked = await client.query(
        `SELECT finalized_at
         FROM libro_agent_registrations
         WHERE id = $1 AND "userId" = $2
         FOR UPDATE`,
        [registrationId, authenticatedUser.id]
      )
      if (locked.rows.length === 0) {
        clientReleased = await rollbackAndRelease(
          client,
          new Error('Agent registration not found'),
          transactionOpen
        )
        transactionOpen = false
        return NextResponse.json({ success: false, message: 'Agent registration not found' }, { status: 404 })
      }

      stage = 'write_registration'
      const { rows } = await client.query(
        `UPDATE libro_agent_registrations
         SET user_op_hash = COALESCE(user_op_hash, $1),
             transaction_hash = COALESCE(transaction_hash, $2),
             finalized_at = COALESCE(finalized_at, CURRENT_TIMESTAMP)
         WHERE id = $3 AND "userId" = $4
         RETURNING id, registration_hash, agent_address`,
        [userOpHash.toLowerCase(), transactionHash.toLowerCase(), registrationId, authenticatedUser.id]
      )

      stage = 'commit'
      await client.query('COMMIT')
      transactionOpen = false
      console.info('Finalized Libro agent registration', {
        requestId,
        registrationId,
        durationMs: Date.now() - startedAt,
      })
      return NextResponse.json({ success: true, registration: rows[0] })
    } catch (error) {
      clientReleased = await rollbackAndRelease(client, error, transactionOpen)
      throw error
    } finally {
      if (!clientReleased) client.release()
    }
  } catch (error) {
    const failure = describeDatabaseFailure(error)
    console.error('Failed to finalize Libro agent registration', {
      requestId,
      registrationId,
      stage,
      durationMs: Date.now() - startedAt,
      code: failure.code,
      message: failure.message,
      retryable: failure.retryable || stage === 'chain_verify' || stage === 'pool_connect',
    })
    return failureResponse(error, stage)
  }
}
