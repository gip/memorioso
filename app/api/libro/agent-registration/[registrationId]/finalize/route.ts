import { NextRequest, NextResponse } from 'next/server'
import { isHex } from 'viem'
import { pool } from '@/lib/db'
import { getAuthenticatedUser } from '@/lib/auth-user'
import { getLibroAgentServerConfig } from '@/lib/libro/config'
import { verifyLibroAgentRegistered } from '@/lib/libro/server'

type FinalizeAgentRegistrationRequest = {
  userOpHash?: string
  transactionHash?: string
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ registrationId: string }> }
): Promise<NextResponse> {
  const authenticatedUser = await getAuthenticatedUser()

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

  const client = await pool.connect()

  try {
    const registrationResult = await client.query(
      `SELECT registration_hash
       FROM libro_agent_registrations
       WHERE id = $1 AND "userId" = $2`,
      [registrationId, authenticatedUser.id]
    )

    if (registrationResult.rows.length === 0) {
      return NextResponse.json({ success: false, message: 'Agent registration not found' }, { status: 404 })
    }

    const registrationHash = registrationResult.rows[0].registration_hash
    const isRegistered = await verifyLibroAgentRegistered(registrationHash, agentConfig)
    if (!isRegistered) {
      return NextResponse.json({
        success: false,
        message: 'Libro agent registry does not contain this registration yet',
      }, { status: 400 })
    }

    const { rows } = await client.query(
      `UPDATE libro_agent_registrations
       SET user_op_hash = $1, transaction_hash = $2, finalized_at = CURRENT_TIMESTAMP
       WHERE id = $3 AND "userId" = $4
       RETURNING id, registration_hash, agent_address`,
      [userOpHash.toLowerCase(), transactionHash.toLowerCase(), registrationId, authenticatedUser.id]
    )

    return NextResponse.json({
      success: true,
      registration: rows[0],
    })
  } finally {
    client.release()
  }
}
