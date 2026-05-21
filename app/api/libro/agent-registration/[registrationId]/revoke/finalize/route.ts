import { NextRequest, NextResponse } from 'next/server'
import { isHex } from 'viem'
import { pool } from '@/lib/db'
import { getAuthenticatedUser } from '@/lib/auth-user'

type FinalizeRevokeRequest = {
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

  const { registrationId } = await params
  const { userOpHash, transactionHash } = await req.json().catch(() => ({})) as FinalizeRevokeRequest

  if (!userOpHash || !transactionHash || !isHex(userOpHash) || !isHex(transactionHash)) {
    return NextResponse.json({
      success: false,
      message: 'User operation and transaction hash must be 0x-prefixed hex strings',
    }, { status: 400 })
  }

  const client = await pool.connect()

  try {
    const { rows } = await client.query(
      `UPDATE libro_agent_registrations
       SET revoked_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND "userId" = $2 AND finalized_at IS NOT NULL
       RETURNING id, registration_hash`,
      [registrationId, authenticatedUser.id]
    )

    if (rows.length === 0) {
      return NextResponse.json({ success: false, message: 'Agent registration not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true, registration: rows[0] })
  } finally {
    client.release()
  }
}
