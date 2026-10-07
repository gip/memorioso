import { createHash, randomBytes } from 'crypto'
import { pool } from '@/lib/db'

export const ACCESS_TOKEN_HEADER = 'x-memorioso-access-token'

export const accessCookieName = (publicationId: string) => `memorioso_access_${publicationId}`

export async function publicationAccessFamily(publicationId: string): Promise<{ rootId: string; ids: string[] }> {
  const rows = (await pool.query(`SELECT publication_id::text AS id, COALESCE(root_publication_id,publication_id)::text AS root_id
    FROM publication_policies WHERE COALESCE(root_publication_id,publication_id) =
    (SELECT COALESCE(root_publication_id,publication_id) FROM publication_policies WHERE publication_id = $1)`, [publicationId])).rows;
  if (rows.length) return { rootId: rows[0].root_id, ids: rows.map(row => row.id) };
  const local = (await pool.query(`SELECT id::text, COALESCE(root_publication_id,id)::text AS root_id FROM publications
    WHERE COALESCE(root_publication_id,id) = (SELECT COALESCE(root_publication_id,id) FROM publications WHERE id = $1)`, [publicationId])).rows;
  return { rootId: local[0]?.root_id || publicationId, ids: local.length ? local.map(row => row.id) : [publicationId] };
}

export type AccessGrantReservation = {
  publicationId: string
  payerAddress: string
  scheme: string
  network: string
  assetAddress: string
  amount: bigint
  validBefore: bigint
  authorizationNonce: string
}

export type AccessGrant = {
  id: string
  payerAddress: string
  transactionHash: string | null
}

/** Same shape as libro_extension_sessions tokens: 32 random bytes, stored as sha256. */
export function createAccessToken(): string {
  return randomBytes(32).toString('base64url')
}

export function hashAccessToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export async function findSettledGrantByToken(
  publicationId: string,
  token: string
): Promise<AccessGrant | null> {
  const family = await publicationAccessFamily(publicationId)
  const client = await pool.connect()

  try {
    const { rows } = await client.query(
      `SELECT id, payer_address, transaction_hash
       FROM publication_access_grants
       WHERE "publicationId" = ANY($1::bigint[]) AND token_hash = $2 AND settled_at IS NOT NULL`,
      [family.ids, hashAccessToken(token)]
    )

    if (rows.length === 0) return null

    return {
      id: rows[0].id,
      payerAddress: rows[0].payer_address,
      transactionHash: rows[0].transaction_hash,
    }
  } finally {
    client.release()
  }
}

/**
 * A payer who already unlocked this publication is handed a fresh token rather than
 * charged again, which is what makes access persistent instead of per-request.
 */
export async function refreshTokenForSettledPayer(
  publicationId: string,
  payerAddress: string
): Promise<string | null> {
  const token = createAccessToken()
  const family = await publicationAccessFamily(publicationId)
  const client = await pool.connect()

  try {
    const { rows } = await client.query(
      `UPDATE publication_access_grants
       SET token_hash = $3
       WHERE id = (SELECT id FROM publication_access_grants WHERE "publicationId" = ANY($1::bigint[])
         AND LOWER(payer_address) = $2 AND settled_at IS NOT NULL ORDER BY settled_at DESC LIMIT 1)
       RETURNING id`,
      [family.ids, payerAddress.toLowerCase(), hashAccessToken(token)]
    )

    return rows.length > 0 ? token : null
  } finally {
    client.release()
  }
}

/**
 * Claims the authorization nonce before anything is broadcast. A null return means
 * the nonce is already spoken for, so this is a replay and must not reach the chain.
 */
export async function reserveAccessGrant(
  input: AccessGrantReservation
): Promise<{ grantId: string; token: string } | null> {
  const token = createAccessToken()
  const client = await pool.connect()

  try {
    const { rows } = await client.query(
      `INSERT INTO publication_access_grants
        ("publicationId", payer_address, scheme, network, asset_address, amount,
         valid_before, authorization_nonce, token_hash)
       VALUES ($1, $2, $3, $4, $5, $6, to_timestamp($7), $8, $9)
       ON CONFLICT (authorization_nonce) DO NOTHING
       RETURNING id`,
      [
        input.publicationId,
        input.payerAddress.toLowerCase(),
        input.scheme,
        input.network,
        input.assetAddress.toLowerCase(),
        input.amount.toString(),
        input.validBefore.toString(),
        input.authorizationNonce.toLowerCase(),
        hashAccessToken(token),
      ]
    )

    return rows.length > 0 ? { grantId: rows[0].id, token } : null
  } finally {
    client.release()
  }
}

export async function completeAccessGrant(
  grantId: string,
  transactionHash: string
): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query(
      `UPDATE publication_access_grants
       SET settled_at = CURRENT_TIMESTAMP, transaction_hash = $2
       WHERE id = $1`,
      [grantId, transactionHash.toLowerCase()]
    )
  } finally {
    client.release()
  }
}

export async function failAccessGrant(grantId: string): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query(
      'UPDATE publication_access_grants SET failed_at = CURRENT_TIMESTAMP WHERE id = $1',
      [grantId]
    )
  } finally {
    client.release()
  }
}
