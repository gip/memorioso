import { pool } from './db'
import { sha256, verifySecret } from './crypto'
import { ServiceError } from './errors'

export async function authenticateServiceClient(request: Request): Promise<string> {
  const match = /^Service ([A-Za-z0-9._~-]+)\.([A-Za-z0-9_-]{32,})$/.exec(request.headers.get('authorization') || '')
  if (!match) throw new ServiceError('AUTH_REQUIRED', 'Service client credentials are required', 401)
  const result = await pool.query(
    `SELECT id, secret_hash FROM libro_oauth_clients
     WHERE id = $1 AND client_type = 'confidential' AND dynamically_registered = FALSE`,
    [match[1]],
  )
  if (!result.rows[0] || !verifySecret(match[2], result.rows[0].secret_hash)) {
    throw new ServiceError('INVALID_CLIENT', 'Service client credentials are invalid', 401)
  }
  return result.rows[0].id
}

export function serviceSecretHash(secret: string): string {
  return sha256(secret)
}
