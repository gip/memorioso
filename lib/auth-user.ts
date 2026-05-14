import { getServerSession } from 'next-auth'
import type { Session } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { pool } from '@/lib/db'

export type AuthenticatedUser = {
  id: number
  subject: string
  walletAddress: string | null
}

type SessionUserWithWorldWallet = NonNullable<Session['user']> & {
  walletAddress?: string | null
}

export async function getAuthenticatedUser(session?: Session | null): Promise<AuthenticatedUser | null> {
  const currentSession = session ?? await getServerSession(authOptions)
  const user = currentSession?.user as SessionUserWithWorldWallet | undefined

  if (!user?.name) {
    return null
  }

  const walletAddress = user.walletAddress?.toLowerCase() || null
  const client = await pool.connect()

  try {
    const { rows } = walletAddress
      ? await client.query(
        'SELECT id, name, wallet_address FROM users WHERE wallet_address = $1',
        [walletAddress]
      )
      : await client.query(
        'SELECT id, name, wallet_address FROM users WHERE name = $1',
        [user.name]
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
