import { getAuthSessionPayload } from '@/lib/auth-session'
import { pool } from '@/lib/db'
import type { WorldIdSessionUser } from '@/lib/auth-types'

export type AuthenticatedUser = WorldIdSessionUser

export async function getAuthenticatedUser(): Promise<AuthenticatedUser | null> {
  const session = await getAuthSessionPayload()
  if (!session) {
    return null
  }

  const client = await pool.connect()

  try {
    const { rows } = await client.query(
      `SELECT id, name, world_id_session_id, world_id_credential_identifier
       FROM users
       WHERE id = $1 AND world_id_session_id = $2`,
      [session.userId, session.worldIdSessionId]
    )

    if (rows.length === 0) {
      return null
    }

    return {
      id: rows[0].id,
      subject: rows[0].name,
      worldIdSessionId: rows[0].world_id_session_id,
      worldIdCredentialIdentifier: rows[0].world_id_credential_identifier,
    }
  } finally {
    client.release()
  }
}
