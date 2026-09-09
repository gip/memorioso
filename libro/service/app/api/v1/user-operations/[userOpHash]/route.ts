import { parseLibroRpcUrls } from '@libro/core'

export async function GET(_request: Request, context: { params: Promise<{ userOpHash: string }> }): Promise<Response> {
  const { userOpHash } = await context.params
  if (!/^0x[0-9a-f]{64}$/i.test(userOpHash)) return Response.json({ error: 'Invalid user operation hash' }, { status: 400 })
  for (const url of parseLibroRpcUrls(process.env.LIBRO_RPC_URL)) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getUserOperationReceipt', params: [userOpHash] }),
        cache: 'no-store',
      })
      const result = await response.json() as { result?: { receipt?: { transactionHash?: string } } | null }
      if (result.result?.receipt?.transactionHash) return Response.json({ transactionHash: result.result.receipt.transactionHash })
    } catch {
      // Every configured endpoint is attempted; a missing index on one is not definitive.
    }
  }
  return Response.json({ pending: true }, { status: 202, headers: { 'Retry-After': '2', 'Cache-Control': 'no-store' } })
}
