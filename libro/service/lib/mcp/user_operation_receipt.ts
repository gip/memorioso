import { parseLibroRpcUrls } from '@libro/core'
import { ServiceError } from '@/lib/errors'
import { z } from 'zod'

export const schema = z.object({ userOpHash: z.string().regex(/^0x[0-9a-f]{64}$/i) })

export async function execute(args: z.infer<typeof schema>) {
  const { userOpHash } = args
  if (!/^0x[0-9a-f]{64}$/i.test(userOpHash)) throw new ServiceError('INVALID_REQUEST', 'Invalid user operation hash', 400)
  for (const url of parseLibroRpcUrls(process.env.LIBRO_RPC_URL)) {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getUserOperationReceipt', params: [userOpHash] }),
      cache: 'no-store',
    })
    const result = await response.json() as { result?: { receipt?: { transactionHash?: string } } | null }
    if (result.result?.receipt?.transactionHash) return { transactionHash: result.result.receipt.transactionHash }
  } catch {
    // Every configured endpoint is attempted; a missing index on one is not definitive.
  }
  }
  return { pending: true }
}
