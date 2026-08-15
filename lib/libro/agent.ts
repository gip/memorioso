import type { IDKitResultSession } from '@worldcoin/idkit'
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
  libroRegistryAbi,
} from './contract'
import type { LibroAgentServerConfig } from './config'
import { hexToUint256, normalizeHex } from './encoding'
import { mapWorldIdSessionProof } from './proof'
import {
  canonicalPublicationSignal,
  hashPublicationSignal,
  type PublicationDraftInput,
} from '../world-id/publication'
import type { LibroAgentPublicationV1, PublicationContent } from '../../types'
import { hashLibroHandle, normalizeOptionalPublicationText } from '@libro/core'
import { publicationKindFromTitle, validatePublicationForKind } from '../publication-kind'

export const LIBRO_AGENT_PUBLISH_DOCUMENT_SCOPE = BigInt(1)
export const LIBRO_AGENT_REGISTRATION_TYPE =
  'LibroAgentRegistration(bytes32 handleHash,address controllerAddress,address agentAddress,uint256 scope,uint64 validFrom,uint64 expiresAt,bytes32 salt,uint256 chainId,address registryAddress)' as const
export const LIBRO_AGENT_DOCUMENT_TYPE =
  'AgentDocument(bytes32 registrationHash,uint256 documentSignalHash,bytes32 documentNonce,uint64 signedAt)' as const
export const LIBRO_AGENT_REGISTRATION_TYPEHASH = keccak256(toBytes(LIBRO_AGENT_REGISTRATION_TYPE))

export type AgentRegistrationPayload = {
  schema: typeof LIBRO_AGENT_REGISTRATION_SCHEMA_V1
  protocol_version: typeof LIBRO_AGENT_PROTOCOL_VERSION
  world_id_proof_type: 'session'
  handle_hash: Hex
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
  handleHash: Hex
  controllerAddress: Address
  agentAddress: Address
  scope: bigint
  validFrom: bigint
  expiresAt: bigint
  salt: Hex
}

export type AgentDocumentTypedData = {
  domain: TypedDataDomain
  types: { AgentDocument: [
    { name: 'registrationHash'; type: 'bytes32' },
    { name: 'documentSignalHash'; type: 'uint256' },
    { name: 'documentNonce'; type: 'bytes32' },
    { name: 'signedAt'; type: 'uint64' },
  ] }
  primaryType: 'AgentDocument'
  message: {
    registrationHash: Hex
    documentSignalHash: bigint
    documentNonce: Hex
    signedAt: bigint
  }
}

export type AgentRegistrationTransaction = {
  chainId: number
  transactions: [{ to: Address; data: Hex; value: '0x0' }]
}

function assertAddress(value: string, fieldName: string): Address {
  if (!isAddress(value)) throw new Error(`${fieldName} must be a valid EVM address`)
  return value as Address
}

function assertBytes32(value: string, fieldName: string): Hex {
  const normalized = normalizeHex(value, fieldName)
  if (normalized.length !== 66) throw new Error(`${fieldName} must be 32 bytes`)
  return normalized
}

function seconds(date: string | Date): bigint {
  const timestamp = Math.floor(new Date(date).getTime() / 1000)
  if (!Number.isFinite(timestamp) || timestamp <= 0) throw new Error('Invalid timestamp')
  return BigInt(timestamp)
}

export function createPrincipalAuthorHash(authorId: string): Hex {
  if (!authorId.trim()) throw new Error('Author id is required')
  return keccak256(toBytes(`libro:author:${authorId}`))
}

export function createAgentRegistrationPayload(input: {
  handleHash: string
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
  const handleHash = assertBytes32(input.handleHash, 'handle_hash')
  const controllerAddress = assertAddress(input.controllerAddress, 'controller_address')
  const agentAddress = assertAddress(input.agentAddress, 'agent_address')
  const registryAddress = assertAddress(input.registryAddress, 'registry_address')
  const salt = assertBytes32(input.salt, 'nonce')
  const scope = input.scope || LIBRO_AGENT_PUBLISH_DOCUMENT_SCOPE
  const validFrom = seconds(input.validFrom)
  const expiresAt = seconds(input.expiresAt)
  if (validFrom > expiresAt) throw new Error('Agent registration valid_from must be before expires_at')

  const encoded = encodeAbiParameters(
    [
      { type: 'bytes32' }, { type: 'bytes32' }, { type: 'address' }, { type: 'address' },
      { type: 'uint256' }, { type: 'uint64' }, { type: 'uint64' }, { type: 'bytes32' },
      { type: 'uint256' }, { type: 'address' },
    ],
    [
      LIBRO_AGENT_REGISTRATION_TYPEHASH, handleHash, controllerAddress, agentAddress,
      scope, validFrom, expiresAt, salt, BigInt(input.chainId), registryAddress,
    ]
  )
  const registrationHash = keccak256(encoded)
  const signal = registrationHash
  const signalHash = hashPublicationSignal(signal) as Hex

  return {
    payload: {
      schema: LIBRO_AGENT_REGISTRATION_SCHEMA_V1,
      protocol_version: LIBRO_AGENT_PROTOCOL_VERSION,
      world_id_proof_type: 'session',
      handle_hash: handleHash,
      controller_address: controllerAddress,
      agent_address: agentAddress,
      scope: scope.toString(),
      valid_from: new Date(Number(validFrom) * 1000).toISOString(),
      expires_at: new Date(Number(expiresAt) * 1000).toISOString(),
      nonce: salt,
      chain_id: input.chainId,
      registry_address: registryAddress,
    },
    contractRegistration: { handleHash, controllerAddress, agentAddress, scope, validFrom, expiresAt, salt },
    signal,
    signalHash,
    registrationHash,
  }
}

export function prepareAgentRegistration(input: {
  result: IDKitResultSession
  contractRegistration: AgentRegistrationContractInput
  handle: string
  claimHandle: boolean
  config: LibroAgentServerConfig
}): AgentRegistrationTransaction {
  const proof = mapWorldIdSessionProof(input.result)
  const data = input.claimHandle
    ? encodeFunctionData({
      abi: libroRegistryAbi,
      functionName: 'claimHandleAndRegisterAgent',
      args: [input.handle, input.contractRegistration, proof],
    })
    : encodeFunctionData({
      abi: libroRegistryAbi,
      functionName: 'registerAgent',
      args: [input.contractRegistration, proof],
    })
  return { chainId: input.config.chainId, transactions: [{ to: input.config.registryAddress, data, value: '0x0' }] }
}

export function createLibroAgentPublicationV1(input: PublicationDraftInput & {
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
    author_handle_hash_libro: hashLibroHandle(input.author.handle),
    author_bio_libro: input.author.bio || '',
    publication_title: normalizeOptionalPublicationText(input.title),
    publication_content: input.content,
    publication_subtitle: normalizeOptionalPublicationText(input.subtitle),
    agent_address: assertAddress(input.agentAddress, 'agent_address'),
    agent_registration_hash: assertBytes32(input.agentRegistrationHash, 'agent_registration_hash'),
  }
}

export function createAgentDocumentTypedData(input: {
  chainId: number; registryAddress: string; registrationHash: string
  documentSignalHash: string; documentNonce: string; signedAt: number | bigint
}): AgentDocumentTypedData {
  return {
    domain: {
      name: 'LibroRegistry', version: '1', chainId: input.chainId,
      verifyingContract: assertAddress(input.registryAddress, 'registry_address'),
    },
    types: { AgentDocument: [
      { name: 'registrationHash', type: 'bytes32' },
      { name: 'documentSignalHash', type: 'uint256' },
      { name: 'documentNonce', type: 'bytes32' },
      { name: 'signedAt', type: 'uint64' },
    ] },
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
  typedData: AgentDocumentTypedData; signature: string
}): Promise<Address> {
  return recoverTypedDataAddress({ ...input.typedData, signature: normalizeHex(input.signature, 'signature') })
}

export function prepareAgentDocumentRegistration(input: {
  registrationHash: string; documentSignalHash: string; documentNonce: string
  signedAt: number | bigint; signature: string; config: LibroAgentServerConfig
}): AgentRegistrationTransaction {
  const data = encodeFunctionData({
    abi: libroRegistryAbi,
    functionName: 'registerAgentDocument',
    args: [
      assertBytes32(input.registrationHash, 'registration_hash'),
      hexToUint256(input.documentSignalHash, 'document_signal_hash'),
      assertBytes32(input.documentNonce, 'document_nonce'),
      BigInt(input.signedAt),
      normalizeHex(input.signature, 'signature'),
    ],
  })
  return { chainId: input.config.chainId, transactions: [{ to: input.config.registryAddress, data, value: '0x0' }] }
}

export function buildAgentPublicationSignal(publication: LibroAgentPublicationV1): {
  signalText: string; signalHash: Hex
} {
  const signalText = canonicalPublicationSignal(publication)
  return { signalText, signalHash: hashPublicationSignal(signalText) as Hex }
}

export function parseAgentPublicationPayload(value: unknown): {
  title: string; subtitle: string; content: PublicationContent
} {
  if (!value || typeof value !== 'object') throw new Error('Publication payload is required')
  const payload = value as Record<string, unknown>
  const title = typeof payload.title === 'string' ? payload.title : ''
  const subtitle = typeof payload.subtitle === 'string' ? payload.subtitle : ''
  const content = payload.content as PublicationContent | undefined
  if (!content || typeof content !== 'object' || typeof content.html !== 'string') {
    throw new Error('Publication content HTML is required')
  }
  const validationError = validatePublicationForKind({
    kind: publicationKindFromTitle(title), title, subtitle, content,
  })
  if (validationError) throw new Error(validationError)
  return {
    title: normalizeOptionalPublicationText(title),
    subtitle: normalizeOptionalPublicationText(subtitle),
    content,
  }
}
