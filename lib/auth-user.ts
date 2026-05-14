import { getServerSession } from 'next-auth'
import type { Session } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { pool } from '@/lib/db'

export type AuthenticatedUser = {
  id: number
  subject: string
  worldIdSessionId: string | null
}

type SessionUserWithWorldId = NonNullable<Session['user']> & {
  worldIdSessionId?: string | null
}

export async function getAuthenticatedUser(session?: Session | null): Promise<AuthenticatedUser | null> {
  const currentSession = session ?? await getServerSession(authOptions)
  const user = currentSession?.user as SessionUserWithWorldId | undefined

  if (!user?.name) {
    return null
  }

  const worldIdSessionId = user.worldIdSessionId || null
  const client = await pool.connect()

  try {
    const { rows } = worldIdSessionId
      ? await client.query(
        'SELECT id, name, world_id_session_id FROM users WHERE world_id_session_id = $1',
        [worldIdSessionId]
      )
      : await client.query(
        'SELECT id, name, world_id_session_id FROM users WHERE name = $1',
        [user.name]
      )

    if (rows.length === 0) {
      return null
    }

    return {
      id: rows[0].id,
      subject: rows[0].name,
      worldIdSessionId: rows[0].world_id_session_id,
    }
  } finally {
    client.release()
  }
}
