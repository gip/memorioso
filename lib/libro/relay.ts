import { createPublicClient, createWalletClient, http, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { worldchain } from 'viem/chains'
import type { LibroServerConfig, LibroRelayerConfig } from './config'
import type { LibroRegistrationTransaction } from './proof'

export function assertRelayTransaction(
  transaction: LibroRegistrationTransaction,
  config: LibroServerConfig
): void {
  if (transaction.chainId !== config.chainId || transaction.transactions.length !== 1) {
    throw new Error('Invalid Libro relay transaction')
  }

  const call = transaction.transactions[0]
  if (call.to.toLowerCase() !== config.registryAddress.toLowerCase() || call.value !== '0x0') {
    throw new Error('Libro relay transaction does not target the configured registry')
  }
}

export async function sendRelayedLibroRegistration(
  transaction: LibroRegistrationTransaction,
  config: LibroServerConfig,
  relayerConfig: LibroRelayerConfig
): Promise<Hex> {
  assertRelayTransaction(transaction, config)

  const account = privateKeyToAccount(relayerConfig.privateKey)
  const walletClient = createWalletClient({
    account,
    chain: worldchain,
    transport: http(config.rpcUrl),
  })
  const call = transaction.transactions[0]

  return walletClient.sendTransaction({
    account,
    chain: worldchain,
    to: call.to,
    data: call.data,
    value: BigInt(call.value),
  })
}

export async function waitForRelayedLibroRegistration(
  transactionHash: Hex,
  config: LibroServerConfig
): Promise<void> {
  const publicClient = createPublicClient({
    chain: worldchain,
    transport: http(config.rpcUrl),
  })
  const receipt = await publicClient.waitForTransactionReceipt({ hash: transactionHash })

  if (receipt.status !== 'success') {
    throw new Error('Sponsored Libro registration reverted')
  }
}
