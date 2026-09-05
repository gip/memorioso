import { encodeFunctionData, type Hex } from 'viem'
import { libroRegistryAbi } from '@libro/core'
import { pool } from './db'
import { assertWritesEnabled, ServiceError } from './errors'
import { assertPrincipalScope, type OAuthPrincipal } from './oauth'
import { verifyAgentRevocation } from './chain'

export async function revokeAgent(principal: OAuthPrincipal, registrationId: string, transactionHash?: string) {
  assertWritesEnabled()
  assertPrincipalScope(principal, 'revoke_agent')
  const result = await pool.query(`SELECT * FROM libro_agent_registrations
    WHERE id = $1 AND identity_id = $2 AND finalized_at IS NOT NULL`, [registrationId, principal.identityId])
  const row = result.rows[0]
  if (!row) throw new ServiceError('NOT_FOUND', 'Agent registration not found', 404)
  if (row.revoked_at) return { revoked: true, registration: { id: row.id, registration_hash: row.registration_hash } }
  if (transactionHash !== undefined) {
    if (!/^0x[0-9a-f]{64}$/i.test(transactionHash)) throw new ServiceError('INVALID_TRANSACTION', 'Invalid transaction hash', 400)
    if (!await verifyAgentRevocation({ transactionHash: transactionHash as Hex, registrationHash: row.registration_hash,
      handleHash: row.handle_hash, registryAddress: row.registry_address })) {
      throw new ServiceError('REGISTRATION_PENDING', 'A matching on-chain revocation has not been confirmed', 409, true)
    }
    await pool.query('UPDATE libro_agent_registrations SET revoked_at = CURRENT_TIMESTAMP WHERE id = $1 AND revoked_at IS NULL', [row.id])
    return { revoked: true, registration: { id: row.id, registration_hash: row.registration_hash } }
  }
  return { revoked: false, controllerAddress: row.controller_address, transaction: {
    chainId: row.chain_id, transactions: [{ to: row.registry_address, value: '0x0',
      data: encodeFunctionData({ abi: libroRegistryAbi, functionName: 'revokeAgent', args: [row.registration_hash] }),
    }],
  } }
}
