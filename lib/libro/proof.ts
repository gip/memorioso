import type { IDKitResult, ResponseItemV4 } from '@worldcoin/idkit'
import { encodeFunctionData, type Address, type Hex } from 'viem'
import { libroProofRegistryAbi } from './contract'
import type { LibroServerConfig } from './config'
import { actionHashToUint256, hexToUint256, normalizeHex, parseUint256 } from './encoding'
import type { WorldIdV4UniquenessResult } from '@/lib/world-id/proof'

export type LibroContractProof = {
  nullifier: bigint
  nonce: bigint
  expiresAtMin: bigint
  issuerSchemaId: bigint
  credentialGenesisIssuedAtMin: bigint
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
  actionHash: string
  proof: {
    nullifier: string
    nonce: string
    expiresAtMin: string
    issuerSchemaId: string
    credentialGenesisIssuedAtMin: string
    zeroKnowledgeProof: [string, string, string, string, string]
  }
  transaction: LibroRegistrationTransaction
}

type ResponseItemV4WithGenesis = ResponseItemV4 & {
  credential_genesis_issued_at_min?: number
}

function getPrimaryResponse(result: WorldIdV4UniquenessResult): ResponseItemV4WithGenesis {
  const response = result.responses?.[0]

  if (!response) {
    throw new Error('World ID result does not contain a credential response')
  }

  return response as ResponseItemV4WithGenesis
}

function mapProofValues(response: ResponseItemV4WithGenesis, nonce: string): LibroContractProof {
  if (response.proof.length !== 5) {
    throw new Error('World ID v4 contract proof must contain exactly 5 elements')
  }

  return {
    nullifier: hexToUint256(response.nullifier, 'responses[0].nullifier'),
    nonce: hexToUint256(nonce, 'nonce'),
    expiresAtMin: BigInt(response.expires_at_min),
    issuerSchemaId: BigInt(response.issuer_schema_id),
    credentialGenesisIssuedAtMin: BigInt(response.credential_genesis_issued_at_min || 0),
    zeroKnowledgeProof: response.proof.map((value, index) =>
      parseUint256(value, `responses[0].proof[${index}]`)
    ) as [bigint, bigint, bigint, bigint, bigint],
  }
}

export function prepareLibroRegistration(
  result: WorldIdV4UniquenessResult,
  signalHash: string,
  config: LibroServerConfig
): PreparedLibroRegistration {
  const normalizedSignalHash = normalizeHex(signalHash, 'signal_hash')
  const signalHashUint256 = hexToUint256(normalizedSignalHash, 'signal_hash')
  const actionHash = actionHashToUint256(result.action)
  const contractProof = mapProofValues(getPrimaryResponse(result), result.nonce)

  const data = encodeFunctionData({
    abi: libroProofRegistryAbi,
    functionName: 'register',
    args: [signalHashUint256, actionHash, contractProof],
  })

  return {
    signalHash: normalizedSignalHash,
    signalHashUint256: signalHashUint256.toString(),
    actionHash: actionHash.toString(),
    proof: {
      nullifier: contractProof.nullifier.toString(),
      nonce: contractProof.nonce.toString(),
      expiresAtMin: contractProof.expiresAtMin.toString(),
      issuerSchemaId: contractProof.issuerSchemaId.toString(),
      credentialGenesisIssuedAtMin: contractProof.credentialGenesisIssuedAtMin.toString(),
      zeroKnowledgeProof: contractProof.zeroKnowledgeProof.map((value) =>
        value.toString()
      ) as [string, string, string, string, string],
    },
    transaction: {
      chainId: config.chainId,
      transactions: [{
        to: config.registryAddress,
        data,
        value: '0x0',
      }],
    },
  }
}

export function getLibroActionHash(action: string): string {
  return actionHashToUint256(action).toString()
}

export function isUniquenessResultWithResponses(result: IDKitResult): result is WorldIdV4UniquenessResult {
  return result.protocol_version === '4.0' && 'action' in result && Array.isArray(result.responses)
}
