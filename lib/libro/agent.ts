import type { IDKitResult, ResponseItemV4 } from '@worldcoin/idkit'
import {
  encodeAbiParameters,
  encodeFunctionData,
  isAddress,
  keccak256,
  recoverTypedDataAddress,
  toBytes,
  type Address,
  type Hex,
  type TypedDataDomain,
} from 'viem'
import {
  LIBRO_AGENT_AUTHORSHIP_CLAIM,
  LIBRO_AGENT_PROTOCOL_VERSION,
  LIBRO_AGENT_PUBLICATION_SCHEMA_V1,
  LIBRO_AGENT_REGISTRATION_SCHEMA_V1,
  libroAgentRegistryAbi,
} from './contract'
import type { LibroAgentServerConfig } from './config'
import { hexToUint256, normalizeHex, parseUint256 } from './encoding'
import {
  canonicalPublicationSignal,
  hashPublicationSignal,
  type PublicationDraftInput,
} from '../world-id/publication'
import type { WorldIdV4UniquenessResult } from '../world-id/proof'
import type { LibroAgentPublicationV1, PublicationContent } from '../../types'
import { hasMeaningfulPublicationBody, normalizeOptionalPublicationText } from '@libro/core'

export const LIBRO_AGENT_PUBLISH_DOCUMENT_SCOPE = BigInt(1)
export const LIBRO_AGENT_REGISTRATION_TYPE =
  'LibroAgentRegistration(bytes32 principalAuthorHash,address controllerAddress,address agentAddress,uint256 scope,uint64 validFrom,uint64 expiresAt,bytes32 salt,uint256 chainId,address registryAddress)' as const
export const LIBRO_AGENT_DOCUMENT_TYPE =
  'AgentDocument(bytes32 registrationHash,uint256 documentSignalHash,bytes32 documentNonce,uint64 signedAt)' as const
export const LIBRO_AGENT_REGISTRATION_TYPEHASH = keccak256(toBytes(LIBRO_AGENT_REGISTRATION_TYPE))

export type AgentRegistrationPayload = {
  schema: typeof LIBRO_AGENT_REGISTRATION_SCHEMA_V1
  protocol_version: typeof LIBRO_AGENT_PROTOCOL_VERSION
  world_id_action: string
  principal_author_hash: Hex
  controller_address: Address
  agent_address: Address
  scope: string
  valid_from: string
  expires_at: string
  nonce: Hex
  chain_id: number
  registry_address: Address
}

export type AgentRegistrationContractInput = {
  principalAuthorHash: Hex
  controllerAddress: Address
  agentAddress: Address
  scope: bigint
  validFrom: bigint
  expiresAt: bigint
  salt: Hex
}

export type AgentDocumentTypedDataMessage = {
  registrationHash: Hex
  documentSignalHash: bigint
  documentNonce: Hex
  signedAt: bigint
}

export type AgentDocumentTypedData = {
  domain: TypedDataDomain
  types: {
    AgentDocument: [
      { name: 'registrationHash'; type: 'bytes32' },
      { name: 'documentSignalHash'; type: 'uint256' },
      { name: 'documentNonce'; type: 'bytes32' },
      { name: 'signedAt'; type: 'uint64' },
    ]
  }
  primaryType: 'AgentDocument'
  message: AgentDocumentTypedDataMessage
}

export type AgentRegistrationTransaction = {
  chainId: number
  transactions: [{
    to: Address
    data: Hex
    value: '0x0'
  }]
}

type ResponseItemV4WithGenesis = ResponseItemV4 & {
  credential_genesis_issued_at_min?: number
}

function assertAddress(value: string, fieldName: string): Address {
  if (!isAddress(value)) {
    throw new Error(`${fieldName} must be a valid EVM address`)
  }
  return value as Address
}

function assertBytes32(value: string, fieldName: string): Hex {
  const normalized = normalizeHex(value, fieldName)
  if (normalized.length !== 66) {
    throw new Error(`${fieldName} must be 32 bytes`)
  }
  return normalized
}

function seconds(date: string | Date): bigint {
  const timestamp = Math.floor(new Date(date).getTime() / 1000)
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    throw new Error('Invalid timestamp')
  }
  return BigInt(timestamp)
}

function hashToWorldSignalField(encodedSignal: Hex): Hex {
  const shifted = BigInt(keccak256(encodedSignal)) >> BigInt(8)
  return `0x${shifted.toString(16).padStart(64, '0')}` as Hex
}

function getPrimaryResponse(result: WorldIdV4UniquenessResult): ResponseItemV4WithGenesis {
  const response = result.responses?.[0]

  if (!response) {
    throw new Error('World ID result does not contain a credential response')
  }

  return response as ResponseItemV4WithGenesis
}

function mapProofValues(response: ResponseItemV4WithGenesis, nonce: string) {
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

export function createPrincipalAuthorHash(authorId: string): Hex {
  if (!authorId.trim()) {
    throw new Error('Author id is required')
  }

  return keccak256(toBytes(`libro:author:${authorId}`))
}

export function createAgentRegistrationPayload(input: {
  action: string
  principalAuthorHash: string
  controllerAddress: string
  agentAddress: string
  scope?: bigint
  validFrom: string | Date
  expiresAt: string | Date
  salt: string
  chainId: number
  registryAddress: string
}): {
  payload: AgentRegistrationPayload
  contractRegistration: AgentRegistrationContractInput
  signal: Hex
  signalHash: Hex
  registrationHash: Hex
} {
  const principalAuthorHash = assertBytes32(input.principalAuthorHash, 'principal_author_hash')
  const controllerAddress = assertAddress(input.controllerAddress, 'controller_address')
  const agentAddress = assertAddress(input.agentAddress, 'agent_address')
  const registryAddress = assertAddress(input.registryAddress, 'registry_address')
  const salt = assertBytes32(input.salt, 'nonce')
  const scope = input.scope || LIBRO_AGENT_PUBLISH_DOCUMENT_SCOPE
  const validFrom = seconds(input.validFrom)
  const expiresAt = seconds(input.expiresAt)

  if (validFrom > expiresAt) {
    throw new Error('Agent registration valid_from must be before expires_at')
  }

  const signal = encodeAbiParameters(
    [
      { type: 'bytes32' },
      { type: 'bytes32' },
      { type: 'address' },
      { type: 'address' },
      { type: 'uint256' },
      { type: 'uint64' },
      { type: 'uint64' },
      { type: 'bytes32' },
      { type: 'uint256' },
      { type: 'address' },
    ],
    [
      LIBRO_AGENT_REGISTRATION_TYPEHASH,
      principalAuthorHash,
      controllerAddress,
      agentAddress,
      scope,
      validFrom,
      expiresAt,
      salt,
      BigInt(input.chainId),
      registryAddress,
    ]
  )
  const registrationHash = keccak256(signal)
  const signalHash = hashToWorldSignalField(signal)
  const validFromIso = new Date(Number(validFrom) * 1000).toISOString()
  const expiresAtIso = new Date(Number(expiresAt) * 1000).toISOString()

  return {
    payload: {
      schema: LIBRO_AGENT_REGISTRATION_SCHEMA_V1,
      protocol_version: LIBRO_AGENT_PROTOCOL_VERSION,
      world_id_action: input.action,
      principal_author_hash: principalAuthorHash,
      controller_address: controllerAddress,
      agent_address: agentAddress,
      scope: scope.toString(),
      valid_from: validFromIso,
      expires_at: expiresAtIso,
      nonce: salt,
      chain_id: input.chainId,
      registry_address: registryAddress,
    },
    contractRegistration: {
      principalAuthorHash,
      controllerAddress,
      agentAddress,
      scope,
      validFrom,
      expiresAt,
      salt,
    },
    signal,
    signalHash,
    registrationHash,
  }
}

export function prepareAgentRegistration(
  result: WorldIdV4UniquenessResult,
  contractRegistration: AgentRegistrationContractInput,
  config: LibroAgentServerConfig
): AgentRegistrationTransaction {
  const proof = mapProofValues(getPrimaryResponse(result), result.nonce)
  const data = encodeFunctionData({
    abi: libroAgentRegistryAbi,
    functionName: 'registerAgent',
    args: [contractRegistration, proof],
  })

  return {
    chainId: config.chainId,
    transactions: [{
      to: config.registryAddress,
      data,
      value: '0x0',
    }],
  }
}

export function createLibroAgentPublicationV1(input: PublicationDraftInput & {
  principalAuthorHash: string
  agentAddress: string
  agentRegistrationHash: string
}): LibroAgentPublicationV1 {
  return {
    publication_schema: LIBRO_AGENT_PUBLICATION_SCHEMA_V1,
    libro_agent_protocol_version: LIBRO_AGENT_PROTOCOL_VERSION,
    authorship_claim: LIBRO_AGENT_AUTHORSHIP_CLAIM,
    author_id_libro: input.author.id,
    publication_date: input.publicationDate,
    author_name_libro: input.author.name,
    author_handle_libro: input.author.handle,
    author_bio_libro: input.author.bio || '',
    publication_title: normalizeOptionalPublicationText(input.title),
    publication_content: input.content,
    publication_subtitle: normalizeOptionalPublicationText(input.subtitle),
    principal_author_hash: assertBytes32(input.principalAuthorHash, 'principal_author_hash'),
    agent_address: assertAddress(input.agentAddress, 'agent_address'),
    agent_registration_hash: assertBytes32(input.agentRegistrationHash, 'agent_registration_hash'),
  }
}

export function createAgentDocumentTypedData(input: {
  chainId: number
  registryAddress: string
  registrationHash: string
  documentSignalHash: string
  documentNonce: string
  signedAt: number | bigint
}): AgentDocumentTypedData {
  return {
    domain: {
      name: 'LibroAgentRegistry',
      version: '1',
      chainId: input.chainId,
      verifyingContract: assertAddress(input.registryAddress, 'registry_address'),
    },
    types: {
      AgentDocument: [
        { name: 'registrationHash', type: 'bytes32' },
        { name: 'documentSignalHash', type: 'uint256' },
        { name: 'documentNonce', type: 'bytes32' },
        { name: 'signedAt', type: 'uint64' },
      ],
    },
    primaryType: 'AgentDocument',
    message: {
      registrationHash: assertBytes32(input.registrationHash, 'registration_hash'),
      documentSignalHash: hexToUint256(input.documentSignalHash, 'document_signal_hash'),
      documentNonce: assertBytes32(input.documentNonce, 'document_nonce'),
      signedAt: BigInt(input.signedAt),
    },
  }
}

export async function recoverAgentDocumentSigner(input: {
  typedData: AgentDocumentTypedData
  signature: string
}): Promise<Address> {
  return recoverTypedDataAddress({
    ...input.typedData,
    signature: normalizeHex(input.signature, 'signature'),
  })
}

export function prepareAgentDocumentRegistration(input: {
  registrationHash: string
  documentSignalHash: string
  documentNonce: string
  signedAt: number | bigint
  signature: string
  config: LibroAgentServerConfig
}): AgentRegistrationTransaction {
  const data = encodeFunctionData({
    abi: libroAgentRegistryAbi,
    functionName: 'registerAgentDocument',
    args: [
      assertBytes32(input.registrationHash, 'registration_hash'),
      hexToUint256(input.documentSignalHash, 'document_signal_hash'),
      assertBytes32(input.documentNonce, 'document_nonce'),
      BigInt(input.signedAt),
      normalizeHex(input.signature, 'signature'),
    ],
  })

  return {
    chainId: input.config.chainId,
    transactions: [{
      to: input.config.registryAddress,
      data,
      value: '0x0',
    }],
  }
}

export function buildAgentPublicationSignal(publication: LibroAgentPublicationV1): {
  signalText: string
  signalHash: Hex
} {
  const signalText = canonicalPublicationSignal(publication)
  return {
    signalText,
    signalHash: hashPublicationSignal(signalText) as Hex,
  }
}

export function parseAgentPublicationPayload(value: unknown): {
  title: string
  subtitle: string
  content: PublicationContent
} {
  if (!value || typeof value !== 'object') {
    throw new Error('Publication payload is required')
  }

  const payload = value as Record<string, unknown>
  const title = typeof payload.title === 'string' ? payload.title : ''
  const subtitle = typeof payload.subtitle === 'string' ? payload.subtitle : ''
  const content = payload.content as PublicationContent | undefined

  if (!content || typeof content !== 'object' || typeof content.html !== 'string') {
    throw new Error('Publication content HTML is required')
  }

  if (!hasMeaningfulPublicationBody(content)) {
    throw new Error('Publication body must contain readable text')
  }

  return {
    title: normalizeOptionalPublicationText(title),
    subtitle: normalizeOptionalPublicationText(subtitle),
    content,
  }
}

export function isAgentUniquenessResultWithResponses(result: IDKitResult): result is WorldIdV4UniquenessResult {
  return result.protocol_version === '4.0' && 'action' in result && Array.isArray(result.responses)
}
