import { createWalletClient, fallback, getAddress, http, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { worldchain } from 'viem/chains'
import { createLibroPublicClient } from '@libro/core'
import { getLibroServerConfig } from '@/lib/libro/config'
import { getPublicationAccessConfig, getX402RelayerConfig } from '@/lib/access/config'
import { eip3009Abi } from './eip3009'
import type { PaymentPayload } from './types'

/**
 * World Chain has no public x402 facilitator, so Memorioso settles the authorization
 * itself: the payer signs, the existing sponsor relayer submits and pays the gas.
 */
export async function settlePayment(payload: PaymentPayload): Promise<Hex> {
  const { asset } = getPublicationAccessConfig()
  const serverConfig = getLibroServerConfig()
  const account = privateKeyToAccount(getX402RelayerConfig().privateKey)

  const walletClient = createWalletClient({
    account,
    chain: worldchain,
    transport: fallback(serverConfig.rpcUrls.map((url) => http(url))),
  })

  const { authorization, signature } = payload.payload
  const transactionHash = await walletClient.writeContract({
    account,
    chain: worldchain,
    address: asset,
    abi: eip3009Abi,
    functionName: 'transferWithAuthorization',
    args: [
      getAddress(authorization.from),
      getAddress(authorization.to),
      BigInt(authorization.value),
      BigInt(authorization.validAfter),
      BigInt(authorization.validBefore),
      authorization.nonce,
      signature,
    ],
  })

  const publicClient = createLibroPublicClient(serverConfig.rpcUrls)
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: transactionHash,
    timeout: 60_000,
  })
  if (receipt.status !== 'success') {
    throw new Error('x402 settlement transaction reverted')
  }

  return transactionHash
}
