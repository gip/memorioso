import { MiniKit } from '@worldcoin/minikit-js'
import { CommandUnavailableError } from '@worldcoin/minikit-js/commands'

export async function sendSponsoredWorldTransaction(transaction: {
  chainId: number
  transactions: Array<{ to: string; data: string; value: string }>
}): Promise<string | null> {
  if (!MiniKit.isInstalled()) return null
  try {
    const sent = await MiniKit.sendTransaction(transaction)
    if (sent.executedWith !== 'minikit') throw new Error('Unexpected wallet submission; check its status before retrying')
    return sent.data.userOpHash
  } catch (error) {
    if (error instanceof CommandUnavailableError) return null
    // These failures happen before submission; Libro can sponsor the prepared transaction.
    if (error instanceof Error && 'code' in error &&
      (error.code === 'daily_tx_limit_reached' || error.code === 'invalid_contract')) return null
    throw error
  }
}
