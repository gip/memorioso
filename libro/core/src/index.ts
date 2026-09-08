import { hashSignal } from '@worldcoin/idkit/hashing'
import { parseDocument } from 'htmlparser2'
import type { AnyNode, Element } from 'domhandler'
import {
  createPublicClient,
  encodeAbiParameters,
  encodeFunctionData,
  fallback,
  http,
  isAddress,
  isHex,
  keccak256,
  parseEventLogs,
  recoverTypedDataAddress,
  toBytes,
  TransactionReceiptNotFoundError,
  type Abi,
  type Address,
  type Hex,
  type TransactionReceipt,
  type TypedDataDomain,
} from 'viem'
import { worldchain } from 'viem/chains'

export const LIBRO_PROTOCOL_VERSION = 'libro-v1' as const
export const LIBRO_PUBLICATION_SCHEMA_V1 = 'libro-publication-v1' as const
export const LIBRO_PUBLICATION_SCHEMA_V2 = 'libro-publication-v2' as const
export const LIBRO_EMBED_SCHEMA_V1 = 'libro-embed-v1' as const
export const LIBRO_HUMAN_SIGNED_CLAIM = 'human-signed' as const
export const LIBRO_AGENT_SIGNED_CLAIM = 'human-authorized-agent' as const
export const LIBRO_AGENT_PUBLICATION_SCHEMA_V1 = 'libro-agent-publication-v1' as const
export const LIBRO_AGENT_PUBLICATION_SCHEMA_V2 = 'libro-agent-publication-v2' as const
export const LIBRO_AGENT_PROTOCOL_VERSION = 'libro-agent-v1' as const
export const LIBRO_WORLD_CHAIN_ID = 480 as const
export const LIBRO_INLINE_TEXT_MAX_LENGTH = 10_000 as const
export const MEMORIOSO_SHORT_MAX_LENGTH = 500 as const
/**
 * Ordered World Chain endpoints. Verification queries all of them, so the list is a quorum
 * rather than a preference: `worldchain-mainnet.g.alchemy.com/public` prunes its transaction
 * index after ~10k blocks (~6 hours) and answers `eth_getTransactionReceipt` with null for
 * anything older, which is indistinguishable from an unregistered publication when it is the
 * only endpoint asked.
 */
export const LIBRO_WORLD_CHAIN_RPC_URLS = [
  'https://worldchain-mainnet.gateway.tenderly.co',
  'https://480.rpc.thirdweb.com',
  'https://worldchain-mainnet.g.alchemy.com/public',
] as const
export const LIBRO_WORLD_CHAIN_RPC_URL = LIBRO_WORLD_CHAIN_RPC_URLS[0]
// Deliberately fail closed until the session-aware registry is deployed and this
// release constant is replaced as part of the hard cutover.
export const LIBRO_V1_REGISTRY_ADDRESS = '0x0000000000000000000000000000000000000000' as const

export type JsonPrimitive = string | number | boolean | null
export type JsonInput = JsonPrimitive | JsonInput[] | { [key: string]: JsonInput | undefined }

export type LibroAuthorReference = {
  namespace: string
  id: string
}

export type LibroPublicationV1Payload = {
  publication_schema: typeof LIBRO_PUBLICATION_SCHEMA_V1
  libro_protocol_version: typeof LIBRO_PROTOCOL_VERSION
  world_id_protocol_version: '4.0'
  world_id_proof_type: 'session'
  world_id_credential_policy: 'orb'
  author_id_libro: string
  publication_date: string
  author_name_libro: string
  author_handle_libro: string
  author_handle_hash_libro: Hex
  author_bio_libro: string
  publication_title: string
  publication_content: { html: string }
  publication_subtitle: string
}

export type LibroPublicationSignalCommitmentV1 = Omit<LibroPublicationV1Payload, 'publication_content'> & {
  content_hash: Hex
}

export type LibroPublicationV2Payload = {
  publication_schema: typeof LIBRO_PUBLICATION_SCHEMA_V2
  libro_protocol_version: typeof LIBRO_PROTOCOL_VERSION
  world_id_protocol_version: '4.0'
  world_id_proof_type: 'session'
  world_id_credential_policy: 'orb'
  author_reference?: LibroAuthorReference
  publication_date: string
  author_name_libro: string
  author_handle_libro: string
  author_handle_hash_libro: Hex
  author_bio_libro: string
  publication_title: string
  publication_content: { html: string }
  publication_subtitle: string
}

export type LibroPublicationSignalCommitmentV2 = Omit<LibroPublicationV2Payload, 'publication_content'> & {
  content_hash: Hex
}

export type LibroAgentPublicationV1Payload = {
  publication_schema: typeof LIBRO_AGENT_PUBLICATION_SCHEMA_V1
  libro_agent_protocol_version: typeof LIBRO_AGENT_PROTOCOL_VERSION
  authorship_claim: 'human_authorized_agent'
  author_id_libro: string
  publication_date: string
  author_name_libro: string
  author_handle_libro: string
  author_handle_hash_libro: Hex
  author_bio_libro: string
  publication_title: string
  publication_content: { html: string }
  publication_subtitle: string
  agent_address: Address
  agent_registration_hash: Hex
}

export type LibroAgentPublicationV2Payload = {
  publication_schema: typeof LIBRO_AGENT_PUBLICATION_SCHEMA_V2
  libro_agent_protocol_version: typeof LIBRO_AGENT_PROTOCOL_VERSION
  authorship_claim: 'human_authorized_agent'
  author_reference?: LibroAuthorReference
  publication_date: string
  author_name_libro: string
  author_handle_libro: string
  author_handle_hash_libro: Hex
  author_bio_libro: string
  publication_title: string
  publication_content: { html: string }
  publication_subtitle: string
  agent_address: Address
  agent_registration_hash: Hex
}

export type LibroHumanPublicationPayload = LibroPublicationV1Payload | LibroPublicationV2Payload
export type LibroAgentPublicationPayload = LibroAgentPublicationV1Payload | LibroAgentPublicationV2Payload
export type LibroPublicationPayload = LibroHumanPublicationPayload | LibroAgentPublicationPayload

export type LibroServiceError = {
  error: {
    code: string
    message: string
    retryable: boolean
  }
}

export type LibroHumanPrincipal = {
  identityId: string
  authorId: string
  handle: string
  sessionCommitment: Hex
  authorReference: LibroAuthorReference
  originClientId: string | null
}

export type LibroAgentAuthority = {
  registrationHash: Hex
  agentAddress: Address
  handleHash: Hex
  scope: string
  validFrom: string
  expiresAt: string
  authorReference?: LibroAuthorReference
}

export type LibroPublicationRecord = {
  id: string
  authorId: string
  identityId: string | null
  signalHash: Hex
  authorshipClass: 'human' | 'agent'
  signal: LibroPublicationPayload | LegacyPublicationPayload
  legacyProof?: boolean
  proof: unknown
  version: string
  originClientId: string | null
  clientReference: string | null
  createdAt: string
  modifiedAt: string
}

export type LibroPublicationSummary = {
  id: string
  authorId: string
  signalHash: Hex
  authorshipClass: 'human' | 'agent'
  legacyProof?: boolean
  publicationDate: string
  authorName: string
  title: string
  subtitle: string
  excerpt: string
  publicationType: 'short' | 'article'
  modifiedAt: string
}

export type LibroEmbedManifestV1 = {
  schema: typeof LIBRO_EMBED_SCHEMA_V1
  claim: typeof LIBRO_HUMAN_SIGNED_CLAIM | typeof LIBRO_AGENT_SIGNED_CLAIM
  publication: LibroPublicationPayload
  registration: {
    chain_id: typeof LIBRO_WORLD_CHAIN_ID
    registry_address: Address
    signal_hash: Hex
    handle_hash: Hex
    authorship_class: 'human' | 'agent'
    transaction_hash: Hex
  }
  source?: {
    publication_url: string
    proof_url: string
    manifest_url?: string
  }
}

export type LibroTextTagV1 = {
  authorHandle: string
  publicationDate: string
  signalHash: string
  manifestUrl: string | null
  bodyText: string
}

const libroSessionProofComponents = [
  { name: 'sessionCommitment', type: 'uint256' },
  { name: 'nonce', type: 'uint256' },
  { name: 'expiresAtMin', type: 'uint64' },
  { name: 'issuerSchemaId', type: 'uint64' },
  { name: 'credentialGenesisIssuedAtMin', type: 'uint256' },
  { name: 'sessionNullifier', type: 'uint256[2]' },
  { name: 'zeroKnowledgeProof', type: 'uint256[5]' },
] as const

const libroAgentRegistrationComponents = [
  { name: 'handleHash', type: 'bytes32' },
  { name: 'controllerAddress', type: 'address' },
  { name: 'agentAddress', type: 'address' },
  { name: 'scope', type: 'uint256' },
  { name: 'validFrom', type: 'uint64' },
  { name: 'expiresAt', type: 'uint64' },
  { name: 'salt', type: 'bytes32' },
] as const

export const libroRegistryAbi = [
  { type: 'function', name: 'revokeAgent', stateMutability: 'nonpayable',
    inputs: [{ name: 'registrationHash', type: 'bytes32' }], outputs: [] },
  { type: 'event', name: 'AgentRevoked', inputs: [
    { name: 'registrationHash', type: 'bytes32', indexed: true },
    { name: 'handleHash', type: 'bytes32', indexed: true },
  ] },

  {
    type: 'function',
    name: 'claimHandle',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'handle', type: 'string' },
      { name: 'proof', type: 'tuple', components: libroSessionProofComponents },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'registerAgent',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'registration', type: 'tuple', components: libroAgentRegistrationComponents },
      { name: 'proof', type: 'tuple', components: libroSessionProofComponents },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'claimHandleAndRegisterAgent',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'handle', type: 'string' },
      { name: 'registration', type: 'tuple', components: libroAgentRegistrationComponents },
      { name: 'proof', type: 'tuple', components: libroSessionProofComponents },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'registerAgentDocument',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'registrationHash', type: 'bytes32' },
      { name: 'documentSignalHash', type: 'uint256' },
      { name: 'documentNonce', type: 'bytes32' },
      { name: 'signedAt', type: 'uint64' },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'claimHandleAndRegisterHumanDocument',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'handle', type: 'string' },
      { name: 'documentSignalHash', type: 'uint256' },
      { name: 'proof', type: 'tuple', components: libroSessionProofComponents },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'verifyAgent',
    stateMutability: 'view',
    inputs: [
      { name: 'registrationHash', type: 'bytes32' },
      { name: 'handleHash', type: 'bytes32' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'registerHumanDocument',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'handleHash', type: 'bytes32' },
      { name: 'documentSignalHash', type: 'uint256' },
      { name: 'proof', type: 'tuple', components: libroSessionProofComponents },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'verifyHumanDocument',
    stateMutability: 'view',
    inputs: [
      { name: 'documentSignalHash', type: 'uint256' },
      { name: 'handleHash', type: 'bytes32' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'verifyAgentDocument',
    stateMutability: 'view',
    inputs: [
      { name: 'documentSignalHash', type: 'uint256' },
      { name: 'handleHash', type: 'bytes32' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'event',
    name: 'HandleClaimed',
    inputs: [
      { name: 'handleHash', type: 'bytes32', indexed: true },
      { name: 'sessionCommitment', type: 'uint256', indexed: true },
    ],
  },
  {
    type: 'event',
    name: 'AgentRegistered',
    inputs: [
      { name: 'registrationHash', type: 'bytes32', indexed: true },
      { name: 'handleHash', type: 'bytes32', indexed: true },
      { name: 'agentAddress', type: 'address', indexed: true },
      { name: 'controllerAddress', type: 'address', indexed: false },
      { name: 'scope', type: 'uint256', indexed: false },
      { name: 'expiresAt', type: 'uint64', indexed: false },
      { name: 'sessionNullifier', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'HumanDocumentRegistered',
    inputs: [
      { name: 'documentSignalHash', type: 'uint256', indexed: true },
      { name: 'handleHash', type: 'bytes32', indexed: true },
      { name: 'sessionNullifier', type: 'uint256', indexed: true },
    ],
  },
  {
    type: 'event',
    name: 'AgentDocumentRegistered',
    inputs: [
      { name: 'documentSignalHash', type: 'uint256', indexed: true },
      { name: 'registrationHash', type: 'bytes32', indexed: true },
      { name: 'handleHash', type: 'bytes32', indexed: true },
      { name: 'agentAddress', type: 'address', indexed: false },
      { name: 'documentNonce', type: 'bytes32', indexed: false },
      { name: 'signedAt', type: 'uint64', indexed: false },
    ],
  },
] as const satisfies Abi

const IGNORED_ELEMENTS = new Set([
  'audio', 'canvas', 'iframe', 'img', 'noscript', 'object', 'script', 'style',
  'svg', 'template', 'video',
])

const BLOCK_ELEMENTS = new Set([
  'address', 'article', 'aside', 'blockquote', 'dd', 'div', 'dl', 'dt', 'fieldset',
  'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'header', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'tbody',
  'td', 'tfoot', 'th', 'thead', 'tr', 'ul',
])

function isElement(node: AnyNode): node is Element {
  return node.type === 'tag' || node.type === 'script' || node.type === 'style'
}

function appendBoundary(parts: string[]): void {
  if (parts.length > 0 && parts[parts.length - 1] !== ' ') parts.push(' ')
}

function collectReadableText(node: AnyNode, parts: string[]): void {
  if (node.type === 'text') {
    parts.push(node.data)
    return
  }

  if (!isElement(node) && node.type !== 'root') return

  if (isElement(node)) {
    const name = node.name.toLowerCase()
    if (IGNORED_ELEMENTS.has(name)) return
    if (name === 'br') {
      appendBoundary(parts)
      return
    }
    if (BLOCK_ELEMENTS.has(name)) appendBoundary(parts)
  }

  for (const child of node.children) collectReadableText(child, parts)

  if (isElement(node) && BLOCK_ELEMENTS.has(node.name.toLowerCase())) appendBoundary(parts)
}

export function normalizeReadableText(value: string): string {
  return value
    .normalize('NFC')
    .replace(/\u00a0/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
}

export function normalizedUnicodeLength(value: string): number {
  return Array.from(normalizeReadableText(value)).length
}

export function isPlainTextPublicationHtml(html: unknown): html is string {
  if (typeof html !== 'string' || !extractReadableText(html)) return false
  const document = parseDocument(html, { decodeEntities: true })
  const roots = document.children.filter((node) => {
    if (node.type === 'text') return normalizeReadableText(node.data).length > 0
    return node.type !== 'comment'
  })
  if (roots.length === 0) return false

  const isPlainNode = (node: AnyNode, root = false): boolean => {
    if (node.type === 'text' || node.type === 'comment') return true
    if (!isElement(node)) return false
    const name = node.name.toLowerCase()
    if (root ? name !== 'p' : name !== 'br') return false
    if (Object.keys(node.attribs).length > 0) return false
    return node.children.every((child) => isPlainNode(child, false))
  }

  return roots.every((node) => isPlainNode(node, true))
}

const LIBRO_TEXT_TAG_PATTERN = new RegExp(
  String.raw`(?:^|\n)=== Libro · (?:Signed by a human|Human-authorized agent) · @([^\s·]+) · (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z) · (0x(?:[0-9a-fA-F]{64}|[0-9a-fA-F]{6}(?:…|\.\.\.)[0-9a-fA-F]{4}))(?: · ([^\s]+))? ===[\t ]*\n([\s\S]*?)\n=== End Libro ===(?=$|\n)`,
  'g'
)

export function parseLibroTextTags(value: string): LibroTextTagV1[] {
  const normalized = value.replace(/\r\n?/g, '\n')
  const tags: LibroTextTagV1[] = []
  LIBRO_TEXT_TAG_PATTERN.lastIndex = 0

  for (const match of normalized.matchAll(LIBRO_TEXT_TAG_PATTERN)) {
    const bodyText = normalizeReadableText(match[5])
    if (!bodyText) continue
    tags.push({
      authorHandle: match[1],
      publicationDate: match[2],
      signalHash: match[3].toLowerCase(),
      manifestUrl: match[4] || null,
      bodyText,
    })
  }

  return tags
}

export function libroTextTagHashMatches(declaredHash: string, signalHash: string): boolean {
  const declared = declaredHash.toLowerCase().replace('...', '…')
  const expected = signalHash.toLowerCase()
  if (/^0x[0-9a-f]{64}$/.test(declared)) return declared === expected
  return declared === `${expected.slice(0, 8)}…${expected.slice(-4)}`
}

export function extractReadableText(html: string): string {
  if (typeof html !== 'string' || html.length === 0) return ''
  const document = parseDocument(html, { decodeEntities: true })
  const parts: string[] = []
  collectReadableText(document, parts)
  return normalizeReadableText(parts.join(''))
}

export function formatLibroPublicationMinute(value: string): string {
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) {
    throw new Error('publication_date must be an ISO 8601 timestamp with a timezone')
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('publication_date must be a valid timestamp')
  }
  return `${parsed.toISOString().slice(0, 16)}Z`
}

export function formatLibroTextTag(manifestValue: unknown): string {
  const manifest = assertLibroManifestLocalIntegrity(manifestValue)
  const { publication, registration } = manifest
  const manifestUrl = manifest.source?.manifest_url
  const boundary = [
    '=== Libro',
    manifest.registration.authorship_class === 'human' ? 'Signed by a human' : 'Human-authorized agent',
    `@${publication.author_handle_libro}`,
    formatLibroPublicationMinute(publication.publication_date),
    registration.signal_hash,
    ...(manifestUrl ? [manifestUrl] : []),
  ].join(' · ')
  const text = extractReadableText(publication.publication_content.html)
  return `${boundary} ===\n${text}\n=== End Libro ===`
}

export function hasMeaningfulPublicationBody(content: unknown): content is { html: string } {
  if (!content || typeof content !== 'object') return false
  const html = (content as { html?: unknown }).html
  return typeof html === 'string' && extractReadableText(html).length > 0
}

export function normalizeOptionalPublicationText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function hasPublishablePublication(title: unknown, content: unknown): boolean {
  return normalizeOptionalPublicationText(title).length > 0 || hasMeaningfulPublicationBody(content)
}

export function canonicalizeJson(input: JsonInput): JsonInput {
  if (Array.isArray(input)) return input.map((item) => canonicalizeJson(item))

  if (input !== null && typeof input === 'object') {
    return Object.keys(input)
      .sort()
      .reduce<{ [key: string]: JsonInput }>((result, key) => {
        const value = input[key]
        if (value !== undefined) result[key] = canonicalizeJson(value)
        return result
      }, {})
  }

  return input
}

export function canonicalStringify(input: JsonInput): string {
  return JSON.stringify(canonicalizeJson(input))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function hashLibroPublicationContent(content: { html: string }): Hex {
  return keccak256(toBytes(canonicalStringify(content as unknown as JsonInput))).toLowerCase() as Hex
}

function buildLibroPublicationSignalCommitment(
  publication: LibroHumanPublicationPayload
): LibroPublicationSignalCommitmentV1 | LibroPublicationSignalCommitmentV2 {
  const { publication_content, ...rest } = publication
  return { ...rest, content_hash: hashLibroPublicationContent(publication_content) }
}

export function canonicalPublicationSignal(publication: LibroPublicationPayload | Record<string, unknown>): string {
  if (isRecord(publication) && (
    publication.publication_schema === LIBRO_PUBLICATION_SCHEMA_V1 ||
    publication.publication_schema === LIBRO_PUBLICATION_SCHEMA_V2
  )) {
    return canonicalStringify(
      buildLibroPublicationSignalCommitment(publication as LibroHumanPublicationPayload) as unknown as JsonInput
    )
  }
  return canonicalStringify(publication as unknown as JsonInput)
}

export function hashPublicationSignal(signalText: string): Hex {
  return hashSignal(signalText).toLowerCase() as Hex
}

export function normalizeLibroHandle(value: string): string {
  if (!/^[a-z0-9_-]{3,32}$/.test(value)) {
    throw new Error('author_handle_libro must be 3-32 lowercase letters, numbers, _ or -')
  }
  return value
}

export function hashLibroHandle(handle: string): Hex {
  return keccak256(toBytes(normalizeLibroHandle(handle))).toLowerCase() as Hex
}

export const LIBRO_AGENT_PUBLISH_DOCUMENT_SCOPE = BigInt(1)
export const LIBRO_AGENT_REGISTRATION_TYPE =
  'LibroAgentRegistration(bytes32 handleHash,address controllerAddress,address agentAddress,uint256 scope,uint64 validFrom,uint64 expiresAt,bytes32 salt,uint256 chainId,address registryAddress)' as const
export const LIBRO_AGENT_DOCUMENT_TYPE =
  'AgentDocument(bytes32 registrationHash,uint256 documentSignalHash,bytes32 documentNonce,uint64 signedAt)' as const
export const LIBRO_AGENT_DOCUMENT_FINALIZATION_TYPE =
  'AgentDocumentFinalization(bytes32 registrationHash,uint256 documentSignalHash,bytes32 documentNonce,bytes32 transactionHash,uint64 signedAt)' as const

function requireLibroBytes32(value: string, name: string): Hex {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`${name} must be a 32-byte hex string`)
  return value.toLowerCase() as Hex
}

function requireLibroAddress(value: string, name: string): Address {
  if (!isAddress(value)) throw new Error(`${name} must be an EVM address`)
  return value
}

export type LibroAgentDocumentTypedData = {
  domain: TypedDataDomain
  types: { AgentDocument: readonly [
    { readonly name: 'registrationHash'; readonly type: 'bytes32' },
    { readonly name: 'documentSignalHash'; readonly type: 'uint256' },
    { readonly name: 'documentNonce'; readonly type: 'bytes32' },
    { readonly name: 'signedAt'; readonly type: 'uint64' },
  ] }
  primaryType: 'AgentDocument'
  message: { registrationHash: Hex; documentSignalHash: bigint; documentNonce: Hex; signedAt: bigint }
}

export type LibroAgentDocumentFinalizationTypedData = {
  domain: TypedDataDomain
  types: { AgentDocumentFinalization: readonly [
    { readonly name: 'registrationHash'; readonly type: 'bytes32' },
    { readonly name: 'documentSignalHash'; readonly type: 'uint256' },
    { readonly name: 'documentNonce'; readonly type: 'bytes32' },
    { readonly name: 'transactionHash'; readonly type: 'bytes32' },
    { readonly name: 'signedAt'; readonly type: 'uint64' },
  ] }
  primaryType: 'AgentDocumentFinalization'
  message: {
    registrationHash: Hex
    documentSignalHash: bigint
    documentNonce: Hex
    transactionHash: Hex
    signedAt: bigint
  }
}

export function createLibroAgentDocumentTypedData(input: {
  chainId: number
  registryAddress: string
  registrationHash: string
  documentSignalHash: string
  documentNonce: string
  signedAt: number | bigint
}): LibroAgentDocumentTypedData {
  return {
    domain: {
      name: 'LibroRegistry',
      version: '1',
      chainId: input.chainId,
      verifyingContract: requireLibroAddress(input.registryAddress, 'registry_address'),
    },
    types: { AgentDocument: [
      { name: 'registrationHash', type: 'bytes32' },
      { name: 'documentSignalHash', type: 'uint256' },
      { name: 'documentNonce', type: 'bytes32' },
      { name: 'signedAt', type: 'uint64' },
    ] },
    primaryType: 'AgentDocument',
    message: {
      registrationHash: requireLibroBytes32(input.registrationHash, 'registration_hash'),
      documentSignalHash: BigInt(requireLibroBytes32(input.documentSignalHash, 'document_signal_hash')),
      documentNonce: requireLibroBytes32(input.documentNonce, 'document_nonce'),
      signedAt: BigInt(input.signedAt),
    },
  }
}

export function createLibroAgentDocumentFinalizationTypedData(input: {
  chainId: number
  registryAddress: string
  registrationHash: string
  documentSignalHash: string
  documentNonce: string
  transactionHash: string
  signedAt: number | bigint
}): LibroAgentDocumentFinalizationTypedData {
  return {
    domain: {
      name: 'LibroRegistry',
      version: '1',
      chainId: input.chainId,
      verifyingContract: requireLibroAddress(input.registryAddress, 'registry_address'),
    },
    types: { AgentDocumentFinalization: [
      { name: 'registrationHash', type: 'bytes32' },
      { name: 'documentSignalHash', type: 'uint256' },
      { name: 'documentNonce', type: 'bytes32' },
      { name: 'transactionHash', type: 'bytes32' },
      { name: 'signedAt', type: 'uint64' },
    ] },
    primaryType: 'AgentDocumentFinalization',
    message: {
      registrationHash: requireLibroBytes32(input.registrationHash, 'registration_hash'),
      documentSignalHash: BigInt(requireLibroBytes32(input.documentSignalHash, 'document_signal_hash')),
      documentNonce: requireLibroBytes32(input.documentNonce, 'document_nonce'),
      transactionHash: requireLibroBytes32(input.transactionHash, 'transaction_hash'),
      signedAt: BigInt(input.signedAt),
    },
  }
}

export async function recoverLibroAgentDocumentSigner(typedData: LibroAgentDocumentTypedData, signature: string): Promise<Address> {
  if (!isHex(signature)) throw new Error('signature must be hex')
  return recoverTypedDataAddress({ ...typedData, signature })
}

export async function recoverLibroAgentDocumentFinalizationSigner(
  typedData: LibroAgentDocumentFinalizationTypedData,
  signature: string,
): Promise<Address> {
  if (!isHex(signature)) throw new Error('signature must be hex')
  return recoverTypedDataAddress({ ...typedData, signature })
}

export function prepareLibroAgentDocumentTransaction(input: {
  chainId: number
  registryAddress: string
  registrationHash: string
  documentSignalHash: string
  documentNonce: string
  signedAt: number | bigint
  signature: string
}) {
  if (!isHex(input.signature)) throw new Error('signature must be hex')
  const registryAddress = requireLibroAddress(input.registryAddress, 'registry_address')
  const data = encodeFunctionData({
    abi: libroRegistryAbi,
    functionName: 'registerAgentDocument',
    args: [
      requireLibroBytes32(input.registrationHash, 'registration_hash'),
      BigInt(requireLibroBytes32(input.documentSignalHash, 'document_signal_hash')),
      requireLibroBytes32(input.documentNonce, 'document_nonce'),
      BigInt(input.signedAt),
      input.signature,
    ],
  })
  return { chainId: input.chainId, transactions: [{ to: registryAddress, data, value: '0x0' as const }] }
}

export function createLibroAgentRegistration(input: {
  handleHash: string
  controllerAddress: string
  agentAddress: string
  scope?: bigint
  validFrom: string | Date
  expiresAt: string | Date
  salt: string
  chainId: number
  registryAddress: string
}) {
  const handleHash = requireLibroBytes32(input.handleHash, 'handle_hash')
  const controllerAddress = requireLibroAddress(input.controllerAddress, 'controller_address')
  const agentAddress = requireLibroAddress(input.agentAddress, 'agent_address')
  const registryAddress = requireLibroAddress(input.registryAddress, 'registry_address')
  const salt = requireLibroBytes32(input.salt, 'salt')
  const scope = input.scope || LIBRO_AGENT_PUBLISH_DOCUMENT_SCOPE
  const validFrom = BigInt(Math.floor(new Date(input.validFrom).getTime() / 1000))
  const expiresAt = BigInt(Math.floor(new Date(input.expiresAt).getTime() / 1000))
  if (validFrom <= BigInt(0) || expiresAt < validFrom) throw new Error('Agent validity window is invalid')
  const typeHash = keccak256(toBytes(LIBRO_AGENT_REGISTRATION_TYPE))
  const encoded = encodeAbiParameters(
    [
      { type: 'bytes32' }, { type: 'bytes32' }, { type: 'address' }, { type: 'address' },
      { type: 'uint256' }, { type: 'uint64' }, { type: 'uint64' }, { type: 'bytes32' },
      { type: 'uint256' }, { type: 'address' },
    ],
    [typeHash, handleHash, controllerAddress, agentAddress, scope, validFrom, expiresAt,
      salt, BigInt(input.chainId), registryAddress],
  )
  const registrationHash = keccak256(encoded)
  return {
    registrationHash,
    signal: registrationHash,
    signalHash: hashPublicationSignal(registrationHash),
    contractRegistration: { handleHash, controllerAddress, agentAddress, scope, validFrom, expiresAt, salt },
  }
}

export function normalizeUint256Hex(value: string, fieldName: string): Hex {
  let parsed: bigint
  try {
    parsed = BigInt(value)
  } catch {
    throw new Error(`${fieldName} must be a uint256`)
  }
  if (parsed < BigInt(0) || parsed >= (BigInt(1) << BigInt(256))) {
    throw new Error(`${fieldName} must be a uint256`)
  }
  return `0x${parsed.toString(16).padStart(64, '0')}` as Hex
}

function requireString(record: Record<string, unknown>, field: string): string {
  const value = record[field]
  if (typeof value !== 'string') throw new Error(`${field} must be a string`)
  return value
}

function requireHash(value: unknown, field: string): Hex {
  if (typeof value !== 'string' || !isHex(value) || value.length !== 66) {
    throw new Error(`${field} must be a 32-byte hex string`)
  }
  return value.toLowerCase() as Hex
}

export function parseLibroAuthorReference(value: unknown): LibroAuthorReference {
  if (!isRecord(value)) throw new Error('author_reference must be an object')
  const keys = Object.keys(value).sort()
  if (keys.length !== 2 || keys[0] !== 'id' || keys[1] !== 'namespace') {
    throw new Error('author_reference must contain only namespace and id')
  }

  const namespace = requireString(value, 'namespace')
  let parsedNamespace: URL
  try {
    parsedNamespace = new URL(namespace)
  } catch {
    throw new Error('author_reference.namespace must be an absolute URL origin')
  }
  const isLocalhost = parsedNamespace.protocol === 'http:' && parsedNamespace.hostname === 'localhost'
  if (parsedNamespace.protocol !== 'https:' && !isLocalhost) {
    throw new Error('author_reference.namespace must use HTTPS')
  }
  if (parsedNamespace.username || parsedNamespace.password || namespace !== parsedNamespace.origin) {
    throw new Error('author_reference.namespace must be a canonical URL origin')
  }

  const id = requireString(value, 'id')
  if (!id || id !== id.trim() || id.length > 256) {
    throw new Error('author_reference.id must be a trimmed non-empty string of at most 256 characters')
  }
  return { namespace, id }
}

export type LegacyPublicationPayload = {
  author_id_libro: string
  author_name_libro: string
  author_handle_libro?: string
  author_bio_libro: string
  publication_date: string
  publication_title: string
  publication_subtitle: string
  publication_content: { html: string }
}

/** Historical read/copy compatibility only; never accepted by Libro signing or chain verification. */
export function parseLegacyPublication(value: unknown): LegacyPublicationPayload {
  if (!isRecord(value) || 'publication_schema' in value) throw new Error('Not a legacy publication')
  const allowed = new Set(['author_id_libro', 'author_name_libro', 'author_handle_libro', 'author_bio_libro',
    'publication_date', 'publication_title', 'publication_subtitle', 'publication_content'])
  if (Object.keys(value).some((key) => !allowed.has(key))) throw new Error('Unsupported legacy publication field')
  for (const key of allowed) {
    if (key !== 'publication_content' && !(key === 'author_handle_libro' && value[key] === undefined)) requireString(value, key)
  }
  if (!isRecord(value.publication_content) || typeof value.publication_content.html !== 'string' ||
      !Number.isFinite(Date.parse(value.publication_date as string))) throw new Error('Invalid legacy publication content or date')
  return value as LegacyPublicationPayload
}

export function isLegacyPublicationProof(value: unknown): boolean {
  return isRecord(value) && value.verification_level === 'orb' &&
    Object.keys(value).length === 4 && ['proof', 'merkle_root', 'nullifier_hash'].every((key) =>
      typeof value[key] === 'string' && /^0x[0-9a-f]+$/i.test(value[key] as string))
}

export function parseLibroPublicationV1(value: unknown): LibroPublicationV1Payload {
  if (!isRecord(value)) throw new Error('publication must be an object')
  if (value.publication_schema !== LIBRO_PUBLICATION_SCHEMA_V1) throw new Error('Unsupported publication schema')
  if (value.libro_protocol_version !== LIBRO_PROTOCOL_VERSION) throw new Error('Unsupported Libro protocol')
  if (value.world_id_protocol_version !== '4.0') throw new Error('Unsupported World ID protocol')
  if (!isRecord(value.publication_content) || typeof value.publication_content.html !== 'string') {
    throw new Error('publication_content.html must be a string')
  }

  for (const field of [
    'author_id_libro',
    'author_name_libro', 'author_handle_libro', 'author_bio_libro', 'publication_title',
    'publication_subtitle',
  ]) requireString(value, field)
  const publicationDate = requireString(value, 'publication_date')
  if (value.world_id_proof_type !== 'session') throw new Error('Unsupported World ID proof type')
  if (value.world_id_credential_policy !== 'orb') throw new Error('Unsupported World ID credential policy')
  const handleHash = requireHash(value.author_handle_hash_libro, 'author_handle_hash_libro')
  if (hashLibroHandle(value.author_handle_libro as string) !== handleHash) {
    throw new Error('author_handle_hash_libro does not match author_handle_libro')
  }
  formatLibroPublicationMinute(publicationDate)

  if (!hasPublishablePublication(value.publication_title, value.publication_content)) {
    throw new Error('Publication must include a title or readable content')
  }

  return value as LibroPublicationV1Payload
}

export function parseLibroPublicationV2(value: unknown): LibroPublicationV2Payload {
  if (!isRecord(value)) throw new Error('publication must be an object')
  if (value.publication_schema !== LIBRO_PUBLICATION_SCHEMA_V2) throw new Error('Unsupported publication schema')
  if (value.libro_protocol_version !== LIBRO_PROTOCOL_VERSION) throw new Error('Unsupported Libro protocol')
  if ('author_id_libro' in value) throw new Error('author_id_libro is not allowed in Libro publication v2')
  if (!isRecord(value.publication_content) || typeof value.publication_content.html !== 'string') {
    throw new Error('publication_content.html must be a string')
  }

  for (const field of [
    'author_name_libro', 'author_handle_libro', 'author_bio_libro', 'publication_title',
    'publication_subtitle',
  ]) requireString(value, field)
  if (value.author_reference !== undefined) parseLibroAuthorReference(value.author_reference)
  const publicationDate = requireString(value, 'publication_date')
  if (value.world_id_protocol_version !== '4.0') throw new Error('Unsupported World ID protocol')
  if (value.world_id_proof_type !== 'session') throw new Error('Unsupported World ID proof type')
  if (value.world_id_credential_policy !== 'orb') throw new Error('Unsupported World ID credential policy')
  const handleHash = requireHash(value.author_handle_hash_libro, 'author_handle_hash_libro')
  if (hashLibroHandle(value.author_handle_libro as string) !== handleHash) {
    throw new Error('author_handle_hash_libro does not match author_handle_libro')
  }
  formatLibroPublicationMinute(publicationDate)

  if (!hasPublishablePublication(value.publication_title, value.publication_content)) {
    throw new Error('Publication must include a title or readable content')
  }

  return value as LibroPublicationV2Payload
}

export function parseLibroAgentPublicationV1(value: unknown): LibroAgentPublicationV1Payload {
  if (!isRecord(value)) throw new Error('publication must be an object')
  if (value.publication_schema !== LIBRO_AGENT_PUBLICATION_SCHEMA_V1) throw new Error('Unsupported publication schema')
  if (value.libro_agent_protocol_version !== LIBRO_AGENT_PROTOCOL_VERSION) throw new Error('Unsupported Libro agent protocol')
  if (value.authorship_claim !== 'human_authorized_agent') throw new Error('Unsupported authorship claim')
  if (!isRecord(value.publication_content) || typeof value.publication_content.html !== 'string') {
    throw new Error('publication_content.html must be a string')
  }
  for (const field of [
    'author_id_libro', 'author_name_libro', 'author_handle_libro', 'author_bio_libro',
    'publication_title', 'publication_subtitle',
  ]) requireString(value, field)
  const publicationDate = requireString(value, 'publication_date')
  const handleHash = requireHash(value.author_handle_hash_libro, 'author_handle_hash_libro')
  if (hashLibroHandle(value.author_handle_libro as string) !== handleHash) {
    throw new Error('author_handle_hash_libro does not match author_handle_libro')
  }
  if (typeof value.agent_address !== 'string' || !isAddress(value.agent_address)) {
    throw new Error('agent_address must be an address')
  }
  requireHash(value.agent_registration_hash, 'agent_registration_hash')
  formatLibroPublicationMinute(publicationDate)
  if (!hasPublishablePublication(value.publication_title, value.publication_content)) {
    throw new Error('Publication must include a title or readable content')
  }
  return value as LibroAgentPublicationV1Payload
}

export function parseLibroAgentPublicationV2(value: unknown): LibroAgentPublicationV2Payload {
  if (!isRecord(value)) throw new Error('publication must be an object')
  if (value.publication_schema !== LIBRO_AGENT_PUBLICATION_SCHEMA_V2) throw new Error('Unsupported publication schema')
  if (value.libro_agent_protocol_version !== LIBRO_AGENT_PROTOCOL_VERSION) throw new Error('Unsupported Libro agent protocol')
  if (value.authorship_claim !== 'human_authorized_agent') throw new Error('Unsupported authorship claim')
  if ('author_id_libro' in value) throw new Error('author_id_libro is not allowed in Libro agent publication v2')
  if (!isRecord(value.publication_content) || typeof value.publication_content.html !== 'string') {
    throw new Error('publication_content.html must be a string')
  }
  for (const field of [
    'author_name_libro', 'author_handle_libro', 'author_bio_libro',
    'publication_title', 'publication_subtitle',
  ]) requireString(value, field)
  if (value.author_reference !== undefined) parseLibroAuthorReference(value.author_reference)
  const publicationDate = requireString(value, 'publication_date')
  const handleHash = requireHash(value.author_handle_hash_libro, 'author_handle_hash_libro')
  if (hashLibroHandle(value.author_handle_libro as string) !== handleHash) {
    throw new Error('author_handle_hash_libro does not match author_handle_libro')
  }
  if (typeof value.agent_address !== 'string' || !isAddress(value.agent_address)) {
    throw new Error('agent_address must be an address')
  }
  requireHash(value.agent_registration_hash, 'agent_registration_hash')
  formatLibroPublicationMinute(publicationDate)
  if (!hasPublishablePublication(value.publication_title, value.publication_content)) {
    throw new Error('Publication must include a title or readable content')
  }
  return value as LibroAgentPublicationV2Payload
}

export function parseLibroPublication(value: unknown): LibroPublicationPayload {
  if (isRecord(value)) {
    if (value.publication_schema === LIBRO_PUBLICATION_SCHEMA_V2) return parseLibroPublicationV2(value)
    if (value.publication_schema === LIBRO_AGENT_PUBLICATION_SCHEMA_V1) return parseLibroAgentPublicationV1(value)
    if (value.publication_schema === LIBRO_AGENT_PUBLICATION_SCHEMA_V2) return parseLibroAgentPublicationV2(value)
  }
  return parseLibroPublicationV1(value)
}

export function parseLibroEmbedManifest(value: unknown): LibroEmbedManifestV1 {
  if (!isRecord(value)) throw new Error('Manifest must be an object')
  if (value.schema !== LIBRO_EMBED_SCHEMA_V1) throw new Error('Unsupported embed schema')
  if (value.claim !== LIBRO_HUMAN_SIGNED_CLAIM && value.claim !== LIBRO_AGENT_SIGNED_CLAIM) {
    throw new Error('Unsupported signing claim')
  }

  const publication = parseLibroPublication(value.publication)
  if (!isRecord(value.registration)) throw new Error('registration must be an object')
  const registration = value.registration
  if (registration.chain_id !== LIBRO_WORLD_CHAIN_ID) throw new Error('Unsupported chain id')
  if (typeof registration.registry_address !== 'string' || !isAddress(registration.registry_address)) {
    throw new Error('registry_address must be an address')
  }

  const manifest: LibroEmbedManifestV1 = {
    schema: LIBRO_EMBED_SCHEMA_V1,
    claim: value.claim,
    publication,
    registration: {
      chain_id: LIBRO_WORLD_CHAIN_ID,
      registry_address: registration.registry_address,
      signal_hash: requireHash(registration.signal_hash, 'signal_hash'),
      handle_hash: requireHash(registration.handle_hash, 'handle_hash'),
      authorship_class: registration.authorship_class === 'human' || registration.authorship_class === 'agent'
        ? registration.authorship_class
        : (() => { throw new Error('Unsupported authorship class') })(),
      transaction_hash: requireHash(registration.transaction_hash, 'transaction_hash'),
    },
  }

  if (value.source !== undefined) {
    if (!isRecord(value.source)) throw new Error('source must be an object')
    const publicationUrl = requireString(value.source, 'publication_url')
    const proofUrl = requireString(value.source, 'proof_url')
    const manifestUrl = value.source.manifest_url === undefined
      ? undefined
      : requireString(value.source, 'manifest_url')
    for (const [field, url] of [
      ['publication_url', publicationUrl],
      ['proof_url', proofUrl],
      ...(manifestUrl ? [['manifest_url', manifestUrl] as const] : []),
    ] as const) {
      let parsed: URL
      try {
        parsed = new URL(url)
      } catch {
        throw new Error(`${field} must be an absolute URL`)
      }
      if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && parsed.hostname === 'localhost')) {
        throw new Error(`${field} must use HTTPS`)
      }
    }
    manifest.source = {
      publication_url: publicationUrl,
      proof_url: proofUrl,
      ...(manifestUrl ? { manifest_url: manifestUrl } : {}),
    }
  }

  return manifest
}

export function isApprovedLibroRegistry(chainId: number, address: string): boolean {
  return chainId === LIBRO_WORLD_CHAIN_ID && address.toLowerCase() === LIBRO_V1_REGISTRY_ADDRESS.toLowerCase()
}

/** Carries what every queried endpoint reported, so callers can show the split rather than one verdict. */
export class LibroChainVerificationError extends Error {
  readonly outcomes: LibroRpcOutcome[]

  constructor(message: string, outcomes: LibroRpcOutcome[] = []) {
    super(message)
    this.outcomes = outcomes
  }
}
export class LibroUnsupportedRegistryError extends LibroChainVerificationError {}
export class LibroNotRegisteredError extends LibroChainVerificationError {}
export class LibroRegistrationMismatchError extends LibroChainVerificationError {}
/** The exact registration exists, but its L2 block has not inherited Ethereum finality yet. */
export class LibroRegistrationPendingFinalityError extends LibroChainVerificationError {}
/** The signal is registered, but the transaction the manifest cites cannot be found on chain. */
export class LibroRegistrationUnconfirmedError extends LibroChainVerificationError {}
/** No endpoint could be reached, so the registration is unknown rather than wrong. */
export class LibroChainUnavailableError extends LibroChainVerificationError {}

export function assertLibroManifestLocalIntegrity(value: unknown): LibroEmbedManifestV1 {
  const manifest = parseLibroEmbedManifest(value)
  const isAgent = manifest.publication.publication_schema === LIBRO_AGENT_PUBLICATION_SCHEMA_V1 ||
    manifest.publication.publication_schema === LIBRO_AGENT_PUBLICATION_SCHEMA_V2
  if ((isAgent ? LIBRO_AGENT_SIGNED_CLAIM : LIBRO_HUMAN_SIGNED_CLAIM) !== manifest.claim ||
      (isAgent ? 'agent' : 'human') !== manifest.registration.authorship_class) {
    throw new Error('Manifest authorship class does not match the publication')
  }
  const signalText = canonicalPublicationSignal(manifest.publication)
  if (hashPublicationSignal(signalText) !== manifest.registration.signal_hash) {
    throw new Error('Manifest signal hash does not match the publication')
  }
  if (manifest.publication.author_handle_hash_libro !== manifest.registration.handle_hash) {
    throw new Error('Manifest event handle hash does not match the publication handle')
  }
  return manifest
}

export function manifestElementId(signalHash: string): string {
  return `libro-manifest-${signalHash.toLowerCase()}`
}

export function serializeManifestForHtml(manifest: LibroEmbedManifestV1): string {
  return JSON.stringify(manifest).replace(/</g, '\\u003c')
}

export function isSimpleTextPublication(publication: LibroPublicationPayload): boolean {
  if (publication.publication_title || publication.publication_subtitle) return false
  const document = parseDocument(publication.publication_content.html, { decodeEntities: true })
  const roots = document.children.filter((node) => {
    if (node.type === 'text') return normalizeReadableText(node.data).length > 0
    return node.type !== 'comment'
  })
  if (roots.length !== 1 || !isElement(roots[0]) || roots[0].name.toLowerCase() !== 'p') return false

  let hasImage = false
  const visit = (node: AnyNode): void => {
    if (isElement(node) && node.name.toLowerCase() === 'img') hasImage = true
    if ((isElement(node) || node.type === 'root') && !hasImage) node.children.forEach(visit)
  }
  visit(roots[0])
  return !hasImage && extractReadableText(publication.publication_content.html).length > 0
}

/** Accepts a single URL or a comma-separated list, so one env var can hold the whole quorum. */
export function parseLibroRpcUrls(value?: string | readonly string[] | null): string[] {
  const candidates = typeof value === 'string' ? value.split(',') : value ?? []
  const urls = candidates.map((url) => url.trim()).filter(Boolean)
  return urls.length > 0 ? urls : [...LIBRO_WORLD_CHAIN_RPC_URLS]
}

/** Host, for showing a reader which endpoints answered without pasting full URLs into the UI. */
export function libroRpcLabel(rpcUrl: string): string {
  try {
    return new URL(rpcUrl).host
  } catch {
    return rpcUrl
  }
}

/**
 * Client that fails over between endpoints. Note this only covers transport failures — an RPC
 * that answers `null` has succeeded as far as the transport is concerned, so lookups that treat
 * an empty answer as meaningful must ask every endpoint themselves.
 */
export type LibroPublicClientOptions = {
  timeoutMs?: number
  retryCount?: number
}

export function createLibroPublicClient(
  rpcUrls?: string | readonly string[] | null,
  options: LibroPublicClientOptions = {}
) {
  const urls = parseLibroRpcUrls(rpcUrls)
  return createPublicClient({
    chain: worldchain,
    transport: fallback(urls.map((url) => http(url, {
      ...(options.timeoutMs === undefined ? {} : { timeout: options.timeoutMs }),
      ...(options.retryCount === undefined ? {} : { retryCount: options.retryCount }),
    }))),
  })
}

export type LibroRpcStatus =
  | 'verified'
  | 'pending_finality'
  | 'not_registered'
  | 'mismatch'
  | 'unconfirmed'
  | 'unavailable'

export type LibroRpcOutcome = {
  rpcUrl: string
  label: string
  status: LibroRpcStatus
  detail: string
}

export type LibroChainVerification = {
  manifest: LibroEmbedManifestV1
  outcomes: LibroRpcOutcome[]
  /** Labels of the endpoints that confirmed the registration, in the order they were configured. */
  verifiedBy: string[]
}

export type LibroRegistrationReference = LibroEmbedManifestV1['registration']

/** Validates that one successful receipt emitted the exact registry event cited by a manifest. */
export function assertLibroRegistrationReceipt(
  registration: LibroRegistrationReference,
  receipt: TransactionReceipt
): void {
  if (receipt.status !== 'success') {
    throw new Error('Registration transaction was not successful')
  }
  const events = registration.authorship_class === 'human'
    ? parseEventLogs({ abi: libroRegistryAbi, eventName: 'HumanDocumentRegistered', logs: receipt.logs, strict: true })
    : parseEventLogs({ abi: libroRegistryAbi, eventName: 'AgentDocumentRegistered', logs: receipt.logs, strict: true })
  const matchingEvent = events.some((event) =>
    event.address.toLowerCase() === registration.registry_address.toLowerCase() &&
    event.args.documentSignalHash === BigInt(registration.signal_hash) &&
    event.args.handleHash.toLowerCase() === registration.handle_hash.toLowerCase()
  )
  if (!matchingEvent) throw new Error('Registration event does not match the manifest')
}

function describeChainError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const headline = message.split('\n', 1)[0].trim()
  return headline || (error instanceof Error ? error.name : 'unknown error')
}

async function verifyLibroManifestAtRpc(
  manifest: LibroEmbedManifestV1,
  rpcUrl: string
): Promise<LibroRpcOutcome> {
  const outcome = (status: LibroRpcStatus, detail: string): LibroRpcOutcome =>
    ({ rpcUrl, label: libroRpcLabel(rpcUrl), status, detail })
  const client = createPublicClient({ chain: worldchain, transport: http(rpcUrl) })

  try {
    const chainId = await client.getChainId()
    if (chainId !== LIBRO_WORLD_CHAIN_ID) {
      return outcome('mismatch', `RPC reports chain id ${chainId}, expected ${LIBRO_WORLD_CHAIN_ID}`)
    }
  } catch (error) {
    return outcome('unavailable', describeChainError(error))
  }

  let registered: boolean
  try {
    registered = await client.readContract({
      address: manifest.registration.registry_address,
      abi: libroRegistryAbi,
      functionName: manifest.registration.authorship_class === 'human'
        ? 'verifyHumanDocument'
        : 'verifyAgentDocument',
      args: [BigInt(manifest.registration.signal_hash), manifest.registration.handle_hash],
    })
  } catch (error) {
    return outcome('unavailable', describeChainError(error))
  }
  if (!registered) return outcome('not_registered', 'Signal is not registered')

  let receipt
  try {
    receipt = await client.getTransactionReceipt({ hash: manifest.registration.transaction_hash })
  } catch (error) {
    if (error instanceof TransactionReceiptNotFoundError) {
      return outcome('unconfirmed', 'Registration transaction was not found on chain')
    }
    return outcome('unavailable', describeChainError(error))
  }
  try {
    assertLibroRegistrationReceipt(manifest.registration, receipt)
  } catch (error) {
    return outcome('mismatch', error instanceof Error ? error.message : 'Registration receipt does not match the manifest')
  }

  let finalizedBlock
  try {
    finalizedBlock = await client.getBlock({ blockTag: 'finalized' })
  } catch (error) {
    return outcome('unavailable', describeChainError(error))
  }
  if (receipt.blockNumber > finalizedBlock.number) {
    return outcome(
      'pending_finality',
      `Registered in block ${receipt.blockNumber}; finalized head is ${finalizedBlock.number}`
    )
  }

  return outcome('verified', `Registered in block ${receipt.blockNumber}`)
}

/**
 * Asks every configured endpoint at once. One endpoint producing the registration event is proof
 * enough; the rest are reported so a reader can see who confirmed and who could not answer.
 */
export async function verifyLibroManifestOnChain(
  manifestValue: unknown,
  rpcUrls: string | readonly string[] = LIBRO_WORLD_CHAIN_RPC_URLS
): Promise<LibroChainVerification> {
  const manifest = assertLibroManifestLocalIntegrity(manifestValue)
  if (!isApprovedLibroRegistry(manifest.registration.chain_id, manifest.registration.registry_address)) {
    throw new LibroUnsupportedRegistryError('Libro registry is not approved')
  }

  const urls = parseLibroRpcUrls(rpcUrls)
  const outcomes = await Promise.all(urls.map((url) => verifyLibroManifestAtRpc(manifest, url)))
  const verifiedBy = outcomes.filter((item) => item.status === 'verified').map((item) => item.label)
  if (verifiedBy.length > 0) return { manifest, outcomes, verifiedBy }

  const detailFor = (status: LibroRpcStatus): string =>
    outcomes.find((item) => item.status === status)?.detail ?? 'Verification failed'

  // Ranked by how much the answer tells us: a contradiction outranks an absence, which outranks
  // an endpoint that simply could not answer.
  if (outcomes.some((item) => item.status === 'mismatch')) {
    throw new LibroRegistrationMismatchError(detailFor('mismatch'), outcomes)
  }
  if (outcomes.some((item) => item.status === 'pending_finality')) {
    throw new LibroRegistrationPendingFinalityError(detailFor('pending_finality'), outcomes)
  }
  if (outcomes.some((item) => item.status === 'not_registered')) {
    throw new LibroNotRegisteredError(detailFor('not_registered'), outcomes)
  }
  if (outcomes.some((item) => item.status === 'unconfirmed')) {
    throw new LibroRegistrationUnconfirmedError(detailFor('unconfirmed'), outcomes)
  }
  throw new LibroChainUnavailableError(detailFor('unavailable'), outcomes)
}
