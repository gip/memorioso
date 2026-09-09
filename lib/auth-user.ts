import { getAuthSessionPayload } from '@/lib/auth-session'
import { pool } from '@/lib/db'
import type { WorldIdSessionUser } from '@/lib/auth-types'
import type { NextRequest } from 'next/server'
import {
  getExtensionSession,
  hasAuthorizationHeader,
} from '@/lib/extension-auth'

export type AuthenticatedUser = WorldIdSessionUser

export async function getAuthenticatedUser(request?: NextRequest): Promise<AuthenticatedUser | null> {
  if (request && hasAuthorizationHeader(request)) {
    return (await getExtensionSession(request))?.user || null
  }

  const session = await getAuthSessionPayload()
  if (!session) {
    return null
  }

  const client = await pool.connect()

  try {
    const { rows } = session.v === 1
      ? await client.query(
        `SELECT id, name, handle, world_id_session_id, world_id_credential_identifier, libro_identity_id
         FROM users WHERE id = $1 AND world_id_session_id = $2`,
        [session.userId, session.worldIdSessionId]
      )
      : await client.query(
        `SELECT id, name, handle, world_id_session_id, world_id_credential_identifier, libro_identity_id
         FROM users WHERE id = $1 AND libro_identity_id = $2`,
        [session.userId, session.libroIdentityId]
      )

    if (rows.length === 0) {
      return null
    }

    return {
      id: rows[0].id,
      subject: rows[0].name,
      handle: rows[0].handle,
      worldIdSessionId: rows[0].world_id_session_id || `libro_identity_${rows[0].libro_identity_id}`,
      worldIdCredentialIdentifier: rows[0].world_id_credential_identifier,
    }
  } finally {
    client.release()
  }
}
