import { NextResponse } from 'next/server'
import { encodeFunctionData } from 'viem'
import { pool } from '@/lib/db'
import { getAuthenticatedUser } from '@/lib/auth-user'
import { getLibroAgentServerConfig } from '@/lib/libro/config'
import { libroRegistryAbi } from '@/lib/libro/contract'
import { retiredLibroWriterResponse } from '@/lib/libro-service/cutover'

export async function PUT(
  _req: Request,
  { params }: { params: Promise<{ registrationId: string }> }
): Promise<NextResponse> {
  const retired = retiredLibroWriterResponse()
  if (retired) return retired
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
  const client = await pool.connect()

  try {
    const { rows } = await client.query(
      `SELECT registration_hash, finalized_at, revoked_at
       FROM libro_agent_registrations
       WHERE id = $1 AND "userId" = $2`,
      [registrationId, authenticatedUser.id]
    )

    if (rows.length === 0) {
      return NextResponse.json({ success: false, message: 'Agent registration not found' }, { status: 404 })
    }

    const registration = rows[0]
    if (!registration.finalized_at) {
      return NextResponse.json({ success: false, message: 'Agent registration is not finalized' }, { status: 400 })
    }

    if (registration.revoked_at) {
      return NextResponse.json({ success: false, message: 'Agent registration is already revoked' }, { status: 400 })
    }

    const data = encodeFunctionData({
      abi: libroRegistryAbi,
      functionName: 'revokeAgent',
      args: [registration.registration_hash],
    })

    return NextResponse.json({
      success: true,
      transaction: {
        chainId: agentConfig.chainId,
        transactions: [{
          to: agentConfig.registryAddress,
          data,
          value: '0x0',
        }],
      },
    })
  } finally {
    client.release()
  }
}
