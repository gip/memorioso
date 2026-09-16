import { browserMcp } from './browser-mcp'

export async function waitForUserOperation(hash: string): Promise<string> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const body = await browserMcp<{ pending?: boolean; transactionHash?: string }>('user_operation_receipt', { userOpHash: hash })
    if (!body.pending) {
      if (!body.transactionHash || !/^0x[0-9a-f]{64}$/i.test(body.transactionHash)) throw new Error('World wallet returned an invalid transaction hash')
      return body.transactionHash
    }
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }
  throw new Error('World wallet registration is still pending; retry this signing link shortly')
}
