import { getAuthSessionPayload } from '@/lib/auth-session'
import { pool } from '@/lib/db'
import type { WalletSessionUser } from '@/lib/auth-types'

export type AuthenticatedUser = WalletSessionUser

export async function getAuthenticatedUser(): Promise<AuthenticatedUser | null> {
  const session = await getAuthSessionPayload()
  if (!session) {
    return null
  }

  const client = await pool.connect()

  try {
    const { rows } = await client.query(
      `SELECT id, name, wallet_address
       FROM users
       WHERE id = $1 AND wallet_address = $2`,
      [session.userId, session.walletAddress.toLowerCase()]
    )

    if (rows.length === 0) {
      return null
    }

    return {
      id: rows[0].id,
      subject: rows[0].name,
      walletAddress: rows[0].wallet_address,
    }
  } finally {
    client.release()
  }
}
