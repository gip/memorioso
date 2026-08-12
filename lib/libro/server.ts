import {
  LIBRO_WORLD_CHAIN_ID,
  assertLibroRegistrationReceipt,
  createLibroPublicClient,
  normalizeUint256Hex,
  type LibroRegistrationReference,
} from '@libro/core'
import { createPublicClient, http, TransactionReceiptNotFoundError } from 'viem'
import {
  getLibroAgentServerConfig,
  getLibroServerConfig,
  type LibroAgentServerConfig,
  type LibroServerConfig,
} from './config'
import { libroAgentRegistryAbi, libroProofRegistryAbi } from './contract'
import { hexToUint256 } from './encoding'

const SERVER_RPC_OPTIONS = {
  timeoutMs: 5_000,
  retryCount: 0,
} as const

export type LibroRegistrationTransactionReference = {
  transactionHash: string
  signalHash: string
  actionHash: string
  registryAddress: string
}

export class LibroRegistrationReceiptMismatchError extends Error {}
export class LibroRegistrationNetworkError extends Error {}

export async function verifyLibroSignalRegistered(
  signalHash: string,
  config: LibroServerConfig = getLibroServerConfig()
): Promise<boolean> {
  const client = createLibroPublicClient(config.rpcUrls, SERVER_RPC_OPTIONS)

  return client.readContract({
    address: config.registryAddress,
    abi: libroProofRegistryAbi,
    functionName: 'verify',
    args: [hexToUint256(signalHash, 'signal_hash')],
  })
}

/** Verifies the exact successful registry event cited by a publication across every trusted RPC. */
export async function verifyLibroRegistrationTransaction(
  reference: LibroRegistrationTransactionReference,
  config: LibroServerConfig = getLibroServerConfig()
): Promise<boolean> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(reference.transactionHash)) {
    throw new Error('Libro transaction hash must be a 32-byte hex string')
  }
  if (reference.registryAddress.toLowerCase() !== config.registryAddress.toLowerCase()) {
    throw new Error('Libro registration targets an unexpected registry')
  }
  const registration: LibroRegistrationReference = {
    chain_id: config.chainId,
    registry_address: config.registryAddress,
    signal_hash: normalizeUint256Hex(reference.signalHash, 'signal_hash'),
    action_hash: normalizeUint256Hex(reference.actionHash, 'action_hash'),
    transaction_hash: reference.transactionHash.toLowerCase() as `0x${string}`,
  }

  const outcomes = await Promise.all(config.rpcUrls.map(async (rpcUrl) => {
    const client = createPublicClient({
      transport: http(rpcUrl, {
        timeout: SERVER_RPC_OPTIONS.timeoutMs,
        retryCount: SERVER_RPC_OPTIONS.retryCount,
      }),
    })
    try {
      const chainId = await client.getChainId()
      if (chainId !== LIBRO_WORLD_CHAIN_ID) {
        return { status: 'mismatch' as const, detail: `RPC reports chain id ${chainId}` }
      }
      const receipt = await client.getTransactionReceipt({ hash: registration.transaction_hash })
      assertLibroRegistrationReceipt(registration, receipt)
      return { status: 'verified' as const, detail: `Registered in block ${receipt.blockNumber}` }
    } catch (error) {
      if (error instanceof TransactionReceiptNotFoundError) {
        return { status: 'unconfirmed' as const, detail: 'Registration transaction was not found' }
      }
      const detail = error instanceof Error ? error.message.split('\n', 1)[0] : 'RPC verification failed'
      if (detail.includes('Registration transaction') || detail.includes('Registration event')) {
        return { status: 'mismatch' as const, detail }
      }
      return { status: 'unavailable' as const, detail }
    }
  }))

  if (outcomes.some((outcome) => outcome.status === 'verified')) return true
  const mismatch = outcomes.find((outcome) => outcome.status === 'mismatch')
  if (mismatch) throw new LibroRegistrationReceiptMismatchError(mismatch.detail)
  if (outcomes.some((outcome) => outcome.status === 'unconfirmed')) return false
  throw new LibroRegistrationNetworkError(outcomes[0]?.detail || 'World Chain could not be reached')
}

export async function verifyLibroAgentRegistered(
  registrationHash: string,
  config: LibroAgentServerConfig = getLibroAgentServerConfig()
): Promise<boolean> {
  const client = createLibroPublicClient(config.rpcUrls, SERVER_RPC_OPTIONS)

  return client.readContract({
    address: config.registryAddress,
    abi: libroAgentRegistryAbi,
    functionName: 'verifyAgent',
    args: [registrationHash as `0x${string}`],
  })
}

export async function verifyLibroAgentDocumentRegistered(
  documentSignalHash: string,
  config: LibroAgentServerConfig = getLibroAgentServerConfig()
): Promise<boolean> {
  const client = createLibroPublicClient(config.rpcUrls, SERVER_RPC_OPTIONS)

  return client.readContract({
    address: config.registryAddress,
    abi: libroAgentRegistryAbi,
    functionName: 'verifyAgentDocument',
    args: [hexToUint256(documentSignalHash, 'document_signal_hash')],
  })
}
