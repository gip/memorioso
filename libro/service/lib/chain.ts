import {
  LIBRO_PROTOCOL_VERSION,
  LIBRO_WORLD_CHAIN_ID,
  assertLibroRegistrationReceipt,
  createLibroPublicClient,
  libroRegistryAbi,
  normalizeUint256Hex,
  parseLibroRpcUrls,
  type LibroRegistrationReference,
} from '@libro/core'
import type { IDKitResultSession } from '@worldcoin/idkit'
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  fallback,
  http,
  isAddress,
  parseEventLogs,
  TransactionReceiptNotFoundError,
  type Address,
  type Hex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { worldchain } from 'viem/chains'

export type HumanRegistrationTransaction = {
  chainId: typeof LIBRO_WORLD_CHAIN_ID
  transactions: [{ to: Address; data: Hex; value: '0x0' }]
}

export function chainConfig() {
  const address = process.env.NEXT_PUBLIC_LIBRO_REGISTRY_ADDRESS
  if (!address || !isAddress(address) || /^0x0{40}$/i.test(address)) {
    throw new Error('NEXT_PUBLIC_LIBRO_REGISTRY_ADDRESS must be a non-zero address')
  }
  const chainId = Number(process.env.NEXT_PUBLIC_LIBRO_CHAIN_ID || LIBRO_WORLD_CHAIN_ID)
  if (chainId !== LIBRO_WORLD_CHAIN_ID) throw new Error(`NEXT_PUBLIC_LIBRO_CHAIN_ID must be ${LIBRO_WORLD_CHAIN_ID}`)
  return {
    protocolVersion: LIBRO_PROTOCOL_VERSION,
    chainId: LIBRO_WORLD_CHAIN_ID,
    registryAddress: address,
    rpcUrls: parseLibroRpcUrls(process.env.LIBRO_RPC_URL),
  }
}

function primaryResponse(result: IDKitResultSession) {
  const response = result.responses[0]
  if (!response || response.proof.length !== 5 || response.session_nullifier.length !== 2) {
    throw new Error('World ID session contract proof has an invalid shape')
  }
  return response
}

export function sessionContractProof(result: IDKitResultSession, commitment: Hex) {
  const response = primaryResponse(result)
  return {
    sessionCommitment: BigInt(commitment),
    nonce: BigInt(result.nonce),
    expiresAtMin: BigInt(response.expires_at_min),
    issuerSchemaId: BigInt(response.issuer_schema_id),
    credentialGenesisIssuedAtMin: 0n,
    sessionNullifier: response.session_nullifier.map(BigInt) as [bigint, bigint],
    zeroKnowledgeProof: response.proof.map(BigInt) as [bigint, bigint, bigint, bigint, bigint],
  }
}

export function prepareHumanRegistration(input: {
  result: IDKitResultSession
  signalHash: Hex
  handle: string
  handleHash: Hex
  sessionCommitment: Hex
  claimHandle: boolean
}) {
  const config = chainConfig()
  const contractProof = sessionContractProof(input.result, input.sessionCommitment)
  const signal = BigInt(input.signalHash)
  const data = input.claimHandle
    ? encodeFunctionData({
      abi: libroRegistryAbi,
      functionName: 'claimHandleAndRegisterHumanDocument',
      args: [input.handle, signal, contractProof],
    })
    : encodeFunctionData({
      abi: libroRegistryAbi,
      functionName: 'registerHumanDocument',
      args: [input.handleHash, signal, contractProof],
    })
  const transaction: HumanRegistrationTransaction = {
    chainId: config.chainId,
    transactions: [{ to: config.registryAddress, data, value: '0x0' }],
  }
  return {
    config,
    transaction,
    sessionNullifier: contractProof.sessionNullifier[0].toString(),
    contractProof: {
      sessionCommitment: contractProof.sessionCommitment.toString(),
      nonce: contractProof.nonce.toString(),
      expiresAtMin: contractProof.expiresAtMin.toString(),
      issuerSchemaId: contractProof.issuerSchemaId.toString(),
      credentialGenesisIssuedAtMin: '0',
      sessionNullifier: contractProof.sessionNullifier.map(String),
      zeroKnowledgeProof: contractProof.zeroKnowledgeProof.map(String),
    },
  }
}

export function prepareAgentAuthorization(input: {
  result: IDKitResultSession
  sessionCommitment: Hex
  handle: string
  claimHandle: boolean
  registration: {
    handleHash: Hex
    controllerAddress: Address
    agentAddress: Address
    scope: bigint
    validFrom: bigint
    expiresAt: bigint
    salt: Hex
  }
}) {
  const config = chainConfig()
  const proof = sessionContractProof(input.result, input.sessionCommitment)
  const data = input.claimHandle
    ? encodeFunctionData({
      abi: libroRegistryAbi,
      functionName: 'claimHandleAndRegisterAgent',
      args: [input.handle, input.registration, proof],
    })
    : encodeFunctionData({
      abi: libroRegistryAbi,
      functionName: 'registerAgent',
      args: [input.registration, proof],
    })
  return {
    transaction: { chainId: config.chainId, transactions: [{ to: config.registryAddress, data, value: '0x0' as const }] },
    sessionNullifier: proof.sessionNullifier[0].toString(),
  }
}

export function prepareHandleClaim(input: {
  result: IDKitResultSession
  sessionCommitment: Hex
  handle: string
}) {
  const config = chainConfig()
  const proof = sessionContractProof(input.result, input.sessionCommitment)
  const data = encodeFunctionData({ abi: libroRegistryAbi, functionName: 'claimHandle', args: [input.handle, proof] })
  return {
    transaction: { chainId: config.chainId, transactions: [{ to: config.registryAddress, data, value: '0x0' as const }] },
    sessionNullifier: proof.sessionNullifier[0].toString(),
  }
}

export async function relayRegistration(transaction: HumanRegistrationTransaction): Promise<Hex> {
  const config = chainConfig()
  const privateKey = process.env.LIBRO_RELAYER_PRIVATE_KEY
  if (!privateKey || !/^0x[0-9a-f]{64}$/i.test(privateKey) || /^0x0{64}$/i.test(privateKey)) {
    throw new Error('LIBRO_RELAYER_PRIVATE_KEY must be a non-zero private key')
  }
  if (transaction.chainId !== config.chainId || transaction.transactions.length !== 1) throw new Error('Invalid relay transaction')
  const call = transaction.transactions[0]
  if (call.to.toLowerCase() !== config.registryAddress.toLowerCase() || call.value !== '0x0') throw new Error('Relay transaction targets an unexpected registry')
  const account = privateKeyToAccount(privateKey as Hex)
  const wallet = createWalletClient({ account, chain: worldchain, transport: fallback(config.rpcUrls.map((url) => http(url))) })
  return wallet.sendTransaction({ account, chain: worldchain, to: call.to, data: call.data, value: 0n })
}

export async function waitForRegistration(transactionHash: Hex): Promise<void> {
  const receipt = await createLibroPublicClient(chainConfig().rpcUrls).waitForTransactionReceipt({ hash: transactionHash })
  if (receipt.status !== 'success') throw new Error('Libro registration reverted')
}

export async function verifyDocumentRegistration(input: {
  transactionHash: Hex
  signalHash: string
  handleHash: string
  registryAddress: string
  authorshipClass: 'human' | 'agent'
}): Promise<boolean> {
  const config = chainConfig()
  if (input.registryAddress.toLowerCase() !== config.registryAddress.toLowerCase()) throw new Error('Unexpected Libro registry')
  const registration: LibroRegistrationReference = {
    chain_id: config.chainId,
    registry_address: config.registryAddress,
    signal_hash: normalizeUint256Hex(input.signalHash, 'signal_hash'),
    handle_hash: normalizeUint256Hex(input.handleHash, 'handle_hash'),
    authorship_class: input.authorshipClass,
    transaction_hash: input.transactionHash,
  }
  const outcomes = await Promise.all(config.rpcUrls.map(async (url) => {
    const client = createPublicClient({ chain: worldchain, transport: http(url, { timeout: 5_000, retryCount: 0 }) })
    try {
      if (await client.getChainId() !== config.chainId) return 'mismatch'
      const receipt = await client.getTransactionReceipt({ hash: input.transactionHash })
      assertLibroRegistrationReceipt(registration, receipt)
      return 'verified'
    } catch (error) {
      if (error instanceof TransactionReceiptNotFoundError) return 'unconfirmed'
      const message = error instanceof Error ? error.message : ''
      return message.includes('Registration') ? 'mismatch' : 'unavailable'
    }
  }))
  if (outcomes.includes('verified')) return true
  if (outcomes.includes('mismatch')) throw new Error('Libro registration receipt does not match the publication')
  if (outcomes.includes('unconfirmed')) return false
  throw new Error('Every configured World Chain RPC is unavailable')
}

export function verifyHumanRegistration(input: {
  transactionHash: Hex
  signalHash: string
  handleHash: string
  registryAddress: string
}): Promise<boolean> {
  return verifyDocumentRegistration({ ...input, authorshipClass: 'human' })
}

export async function verifyAgentRegistration(input: {
  transactionHash: Hex
  registrationHash: Hex
  handleHash: Hex
  agentAddress: Address
}): Promise<boolean> {
  const config = chainConfig()
  const outcomes = await Promise.all(config.rpcUrls.map(async (url) => {
    const client = createPublicClient({ chain: worldchain, transport: http(url, { timeout: 5_000, retryCount: 0 }) })
    try {
      if (await client.getChainId() !== config.chainId) return 'mismatch'
      const receipt = await client.getTransactionReceipt({ hash: input.transactionHash })
      if (receipt.status !== 'success') return 'mismatch'
      const matches = parseEventLogs({ abi: libroRegistryAbi, eventName: 'AgentRegistered', logs: receipt.logs, strict: true })
        .some((event) => event.address.toLowerCase() === config.registryAddress.toLowerCase()
          && event.args.registrationHash.toLowerCase() === input.registrationHash.toLowerCase()
          && event.args.handleHash.toLowerCase() === input.handleHash.toLowerCase()
          && event.args.agentAddress.toLowerCase() === input.agentAddress.toLowerCase())
      return matches ? 'verified' : 'mismatch'
    } catch (error) {
      return error instanceof TransactionReceiptNotFoundError ? 'unconfirmed' : 'unavailable'
    }
  }))
  if (outcomes.includes('verified')) return true
  if (outcomes.includes('mismatch')) throw new Error('Agent registration event does not match the authorization')
  if (outcomes.includes('unconfirmed')) return false
  throw new Error('Every configured World Chain RPC is unavailable')
}

export async function verifyHandleClaim(input: {
  transactionHash: Hex
  handleHash: Hex
  sessionCommitment: Hex
}): Promise<boolean> {
  const config = chainConfig()
  const outcomes = await Promise.all(config.rpcUrls.map(async (url) => {
    const client = createPublicClient({ chain: worldchain, transport: http(url, { timeout: 5_000, retryCount: 0 }) })
    try {
      const receipt = await client.getTransactionReceipt({ hash: input.transactionHash })
      if (receipt.status !== 'success') return 'mismatch'
      const matches = parseEventLogs({ abi: libroRegistryAbi, eventName: 'HandleClaimed', logs: receipt.logs, strict: true })
        .some((event) => event.address.toLowerCase() === config.registryAddress.toLowerCase()
          && event.args.handleHash.toLowerCase() === input.handleHash.toLowerCase()
          && event.args.sessionCommitment === BigInt(input.sessionCommitment))
      return matches ? 'verified' : 'mismatch'
    } catch (error) {
      return error instanceof TransactionReceiptNotFoundError ? 'unconfirmed' : 'unavailable'
    }
  }))
  if (outcomes.includes('verified')) return true
  if (outcomes.includes('mismatch')) throw new Error('Handle claim event does not match the Libro identity')
  if (outcomes.includes('unconfirmed')) return false
  throw new Error('Every configured World Chain RPC is unavailable')
}

export async function verifyAgentRevocation(input: { transactionHash: Hex; registrationHash: string; handleHash: string; registryAddress: string }): Promise<boolean> {
  const config = chainConfig()
  if (input.registryAddress.toLowerCase() !== config.registryAddress.toLowerCase()) throw new Error('Unexpected Libro registry')
  const outcomes = await Promise.all(config.rpcUrls.map(async (url) => {
    const client = createPublicClient({ chain: worldchain, transport: http(url, { timeout: 5_000, retryCount: 0 }) })
    try {
      if (await client.getChainId() !== config.chainId) return false
      const receipt = await client.getTransactionReceipt({ hash: input.transactionHash })
      return receipt.status === 'success' && parseEventLogs({ abi: libroRegistryAbi, eventName: 'AgentRevoked', logs: receipt.logs, strict: true }).some((event) =>
        event.address.toLowerCase() === input.registryAddress.toLowerCase()
        && event.args.registrationHash.toLowerCase() === input.registrationHash.toLowerCase()
        && event.args.handleHash.toLowerCase() === input.handleHash.toLowerCase())
    } catch { return false }
  }))
  return outcomes.some(Boolean)
}
