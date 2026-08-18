import type { IDKitResultSession, ResponseItemSession } from '@worldcoin/idkit'
import { encodeFunctionData, type Address, type Hex } from 'viem'
import { libroRegistryAbi } from './contract'
import type { LibroServerConfig } from './config'
import { hexToUint256, normalizeHex, parseUint256 } from './encoding'
import { sessionIdToCommitment } from '@/lib/world-id/proof'

export type LibroContractSessionProof = {
  sessionCommitment: bigint
  nonce: bigint
  expiresAtMin: bigint
  issuerSchemaId: bigint
  credentialGenesisIssuedAtMin: bigint
  sessionNullifier: readonly [bigint, bigint]
  zeroKnowledgeProof: readonly [bigint, bigint, bigint, bigint, bigint]
}

export type LibroRegistrationTransaction = {
  chainId: number
  transactions: [{
    to: Address
    data: Hex
    value: '0x0'
  }]
}

export type PreparedLibroRegistration = {
  signalHash: Hex
  signalHashUint256: string
  handleHash: Hex
  sessionCommitment: Hex
  sessionNullifier: string
  proof: {
    sessionCommitment: string
    nonce: string
    expiresAtMin: string
    issuerSchemaId: string
    credentialGenesisIssuedAtMin: string
    sessionNullifier: [string, string]
    zeroKnowledgeProof: [string, string, string, string, string]
  }
  transaction: LibroRegistrationTransaction
}

function getPrimaryResponse(result: IDKitResultSession): ResponseItemSession {
  const response = result.responses?.[0]
  if (!response) throw new Error('World ID result does not contain a credential response')
  return response
}

export function mapWorldIdSessionProof(result: IDKitResultSession): LibroContractSessionProof {
  const response = getPrimaryResponse(result)
  if (response.proof.length !== 5) {
    throw new Error('World ID session contract proof must contain exactly 5 elements')
  }
  if (response.session_nullifier.length !== 2) {
    throw new Error('World ID session nullifier must contain exactly 2 elements')
  }

  return {
    sessionCommitment: hexToUint256(sessionIdToCommitment(result.session_id), 'session_commitment'),
    nonce: hexToUint256(result.nonce, 'nonce'),
    expiresAtMin: BigInt(response.expires_at_min),
    issuerSchemaId: BigInt(response.issuer_schema_id),
    credentialGenesisIssuedAtMin: BigInt(0),
    sessionNullifier: response.session_nullifier.map((value, index) =>
      parseUint256(value, `responses[0].session_nullifier[${index}]`)
    ) as [bigint, bigint],
    zeroKnowledgeProof: response.proof.map((value, index) =>
      parseUint256(value, `responses[0].proof[${index}]`)
    ) as [bigint, bigint, bigint, bigint, bigint],
  }
}

export function prepareLibroRegistration(input: {
  result: IDKitResultSession
  signalHash: string
  handle: string
  handleHash: Hex
  config: LibroServerConfig
  claimHandle: boolean
}): PreparedLibroRegistration {
  const normalizedSignalHash = normalizeHex(input.signalHash, 'signal_hash')
  const signalHashUint256 = hexToUint256(normalizedSignalHash, 'signal_hash')
  const contractProof = mapWorldIdSessionProof(input.result)
  const commitment = sessionIdToCommitment(input.result.session_id)

  const data = input.claimHandle
    ? encodeFunctionData({
      abi: libroRegistryAbi,
      functionName: 'claimHandleAndRegisterHumanDocument',
      args: [input.handle, signalHashUint256, contractProof],
    })
    : encodeFunctionData({
      abi: libroRegistryAbi,
      functionName: 'registerHumanDocument',
      args: [input.handleHash, signalHashUint256, contractProof],
    })

  return {
    signalHash: normalizedSignalHash,
    signalHashUint256: signalHashUint256.toString(),
    handleHash: input.handleHash,
    sessionCommitment: commitment,
    sessionNullifier: contractProof.sessionNullifier[0].toString(),
    proof: {
      sessionCommitment: contractProof.sessionCommitment.toString(),
      nonce: contractProof.nonce.toString(),
      expiresAtMin: contractProof.expiresAtMin.toString(),
      issuerSchemaId: contractProof.issuerSchemaId.toString(),
      credentialGenesisIssuedAtMin: contractProof.credentialGenesisIssuedAtMin.toString(),
      sessionNullifier: contractProof.sessionNullifier.map(String) as [string, string],
      zeroKnowledgeProof: contractProof.zeroKnowledgeProof.map(String) as [string, string, string, string, string],
    },
    transaction: {
      chainId: input.config.chainId,
      transactions: [{ to: input.config.registryAddress, data, value: '0x0' }],
    },
  }
}
