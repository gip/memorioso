import { randomUUID } from 'node:crypto'
import { createPublicClient, http, encodeFunctionData, parseEventLogs, type Hex } from 'viem'
import { configuredLibroRegistries, hashLibroHandle, hashPublicationSignal, libroRegistryV2Abi } from '@libro/core'
import { pool } from '@/lib/db'
import type { AuthenticatedUser } from '@/lib/auth-user'
import { createRpContext, getWorldIdServerConfig, verifyWorldIdProof } from '@/lib/world-id/server'
import { sessionIdToCommitment, validateWorldIdSessionResult } from '@/lib/world-id/proof'
import { getLibroServerConfig, getLibroRelayerConfig } from './config'
import { mapWorldIdSessionProof } from './proof'
import { sendRelayedLibroRegistration, waitForRelayedLibroRegistration } from './relay'

export async function ensureLocalHandleClaim(user: AuthenticatedUser, database: Pick<import('pg').PoolClient, 'query'> = pool) {
  const config = getLibroServerConfig()
  if (!user.handle) throw new Error('Choose a handle before publishing')
  const bindings = await Promise.allSettled(config.rpcUrls.map(async url => {
    const rpc = createPublicClient({ transport: http(url, { timeout: 5000, retryCount: 0 }) })
    if (await rpc.getChainId() !== 480) throw new Error('Wrong chain')
    return rpc.readContract({ address: configuredLibroRegistries().v1, abi: libroRegistryV2Abi,
      functionName: 'handleSessionCommitments', args: [hashLibroHandle(user.handle!)] })
  }))
  const values = bindings.flatMap(value => value.status === 'fulfilled' ? [value.value] : [])
  if (!values.length) throw new Error('Could not confirm handle ownership on World Chain')
  const commitment = BigInt(sessionIdToCommitment(user.worldIdSessionId))
  const claimed = values.find(value => value !== BigInt(0))
  if (claimed !== undefined) {
    if (claimed !== commitment) throw new Error('The handle belongs to another World ID session')
    return null
  }
  const signal = `libro-handle-claim-v1:${user.handle}`
  const pending = await database.query(`SELECT id FROM libro_handle_claim_requests WHERE "userId" = $1 AND handle = $2
    AND registry_address = $3 AND finalized_at IS NULL ORDER BY created_at DESC LIMIT 1`, [user.id, user.handle, config.registryAddress])
  if (pending.rows[0]) return { capability: pending.rows[0].id as string, signal }
  const capability = randomUUID()
  await database.query(`INSERT INTO libro_handle_claim_requests (id,"userId",handle,registry_address,signal_hash) VALUES ($1,$2,$3,$4,$5)`,
    [capability, user.id, user.handle, config.registryAddress, hashPublicationSignal(signal)])
  return { capability, signal }
}

export async function localHandleClaim(user: AuthenticatedUser, tool: string, args: Record<string, unknown>) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const row = (await client.query('SELECT * FROM libro_handle_claim_requests WHERE id = $1 AND "userId" = $2 FOR UPDATE', [args.capability, user.id])).rows[0]
    if (!row || row.handle !== user.handle) throw new Error('Handle claim not found')
    const config = getLibroServerConfig()
    if (config.registryAddress !== row.registry_address) throw new Error('Handle claim targets a different registry')
    let output: unknown
    if (tool === 'handle_signing_context') {
      if (row.transaction) { await client.query('COMMIT'); return { prepared: { requestId: row.id, transaction: row.transaction, transactionHash: row.transaction_hash } } }
      const world = getWorldIdServerConfig()
      const rpContext = createRpContext(world)
      await client.query('UPDATE libro_handle_claim_requests SET nonce = $2, expires_at = to_timestamp($3) WHERE id = $1', [row.id, rpContext.nonce, rpContext.expires_at])
      output = { appId: world.appId, environment: world.environment, rpContext, existingSessionId: user.worldIdSessionId, signal: `libro-handle-claim-v1:${row.handle}` }
    } else if (tool === 'handle_signing_prepare') {
      if (row.transaction) output = { requestId: row.id, transaction: row.transaction, transactionHash: row.transaction_hash }
      else {
        if (!row.nonce || new Date(row.expires_at).getTime() <= Date.now()) throw new Error('Handle claim context expired')
        const world = getWorldIdServerConfig()
        const result = validateWorldIdSessionResult(args.idkitResult as import("@worldcoin/idkit").IDKitResultSession, { nonce: row.nonce, environment: world.environment,
          signalHash: row.signal_hash, expectedSessionId: user.worldIdSessionId, requireUserPresence: true })
        if (!(await verifyWorldIdProof(result, world.rpId)).ok) throw new Error('World ID rejected the handle claim')
        const transaction = { chainId: 480, transactions: [{ to: config.registryAddress, value: '0x0' as const,
          data: encodeFunctionData({ abi: libroRegistryV2Abi, functionName: 'claimHandle', args: [row.handle, mapWorldIdSessionProof(result)] }) }] }
        await client.query('UPDATE libro_handle_claim_requests SET transaction = $2 WHERE id = $1', [row.id, transaction])
        output = { requestId: row.id, transaction }
      }
    } else if (tool === 'handle_signing_relay') {
      if (!row.transaction) throw new Error('Handle claim is not prepared')
      let transactionHash = row.transaction_hash as Hex | null
      if (!transactionHash) {
        await client.query('SELECT pg_advisory_xact_lock($1)', [480001])
        transactionHash = await sendRelayedLibroRegistration(row.transaction, config, getLibroRelayerConfig())
        await client.query('UPDATE libro_handle_claim_requests SET transaction_hash = $2 WHERE id = $1', [row.id, transactionHash])
      }
      // Persist the broadcast before waiting, so an interrupted request can resume it.
      await client.query('COMMIT')
      await waitForRelayedLibroRegistration(transactionHash, config)
      return { transactionHash }
    } else if (tool === 'handle_signing_finalize') {
      if (!row.transaction || typeof args.transactionHash !== 'string' || !/^0x[\da-f]{64}$/i.test(args.transactionHash)) throw new Error('Prepared claim and transaction hash are required')
      if (row.transaction_hash && row.transaction_hash !== args.transactionHash.toLowerCase()) throw new Error('Claim transaction mismatch')
      if (!row.finalized_at) {
        const outcomes = await Promise.allSettled(config.rpcUrls.map(async url => {
          const rpc = createPublicClient({ transport: http(url, { timeout: 5000, retryCount: 0 }) })
          if (await rpc.getChainId() !== 480) return false
          const receipt = await rpc.getTransactionReceipt({ hash: args.transactionHash as Hex })
          return receipt.status === 'success' && parseEventLogs({ abi: libroRegistryV2Abi, eventName: 'HandleClaimed', logs: receipt.logs }).some(event =>
            event.address.toLowerCase() === config.registryAddress && event.args.handleHash === hashLibroHandle(row.handle) &&
            event.args.sessionCommitment === BigInt(sessionIdToCommitment(user.worldIdSessionId)))
        }))
        if (!outcomes.some(outcome => outcome.status === 'fulfilled' && outcome.value)) throw new Error('Matching handle claim is not confirmed')
        await client.query('UPDATE libro_handle_claim_requests SET finalized_at = CURRENT_TIMESTAMP, transaction_hash = $2 WHERE id = $1', [row.id, args.transactionHash.toLowerCase()])
      }
      output = { success: true, requestId: row.id }
    } else throw new Error('Unknown handle claim operation')
    await client.query('COMMIT')
    return output
  } catch (error) { await client.query('ROLLBACK'); throw error }
  finally { client.release() }
}
