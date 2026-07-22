import { hashSignal } from '@worldcoin/idkit/hashing'
import { parseDocument } from 'htmlparser2'
import type { AnyNode, Element } from 'domhandler'
import {
  createPublicClient,
  http,
  isAddress,
  isHex,
  keccak256,
  parseEventLogs,
  toBytes,
  type Abi,
  type Address,
  type Hex,
} from 'viem'
import { worldchain } from 'viem/chains'

export const LIBRO_PROTOCOL_VERSION = 'libro-v1' as const
export const LIBRO_PUBLICATION_SCHEMA_V1 = 'libro-publication-v1' as const
export const LIBRO_EMBED_SCHEMA_V1 = 'libro-embed-v1' as const
export const LIBRO_HUMAN_AUTHORSHIP_CLAIM = 'human-authored' as const
export const LIBRO_WORLD_CHAIN_ID = 480 as const
export const LIBRO_WORLD_CHAIN_RPC_URL = 'https://worldchain-mainnet.g.alchemy.com/public' as const
export const LIBRO_V1_REGISTRY_ADDRESS = '0x487A2F9B47569dBd75c3597dDD8AB6ceAc580940' as const

export type JsonPrimitive = string | number | boolean | null
export type JsonInput = JsonPrimitive | JsonInput[] | { [key: string]: JsonInput | undefined }

export type LibroPublicationV1Payload = {
  publication_schema: typeof LIBRO_PUBLICATION_SCHEMA_V1
  libro_protocol_version: typeof LIBRO_PROTOCOL_VERSION
  world_id_protocol_version: '4.0'
  world_id_action: string
  world_id_credential_policy: string
  author_id_libro: string
  publication_date: string
  author_name_libro: string
  author_handle_libro: string
  author_bio_libro: string
  publication_title: string
  publication_content: { html: string }
  publication_subtitle: string
}

export type LibroEmbedManifestV1 = {
  schema: typeof LIBRO_EMBED_SCHEMA_V1
  claim: typeof LIBRO_HUMAN_AUTHORSHIP_CLAIM
  publication: LibroPublicationV1Payload
  registration: {
    chain_id: typeof LIBRO_WORLD_CHAIN_ID
    registry_address: Address
    signal_hash: Hex
    action_hash: Hex
    transaction_hash: Hex
  }
  source?: {
    publication_url: string
    proof_url: string
  }
}

export const libroProofRegistryAbi = [
  {
    type: 'function',
    name: 'verify',
    stateMutability: 'view',
    inputs: [{ name: 'signalHash', type: 'uint256' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'event',
    name: 'SignalRegistered',
    inputs: [
      { name: 'signalHash', type: 'uint256', indexed: true },
      { name: 'actionHash', type: 'uint256', indexed: true },
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

export function extractReadableText(html: string): string {
  if (typeof html !== 'string' || html.length === 0) return ''
  const document = parseDocument(html, { decodeEntities: true })
  const parts: string[] = []
  collectReadableText(document, parts)
  return normalizeReadableText(parts.join(''))
}

export function hasMeaningfulPublicationBody(content: unknown): content is { html: string } {
  if (!content || typeof content !== 'object') return false
  const html = (content as { html?: unknown }).html
  return typeof html === 'string' && extractReadableText(html).length > 0
}

export function normalizeOptionalPublicationText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
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

export function canonicalPublicationSignal(publication: LibroPublicationV1Payload | Record<string, unknown>): string {
  return canonicalStringify(publication as unknown as JsonInput)
}

export function hashPublicationSignal(signalText: string): Hex {
  return hashSignal(signalText).toLowerCase() as Hex
}

export function actionHashToHex(action: string): Hex {
  if (!action.trim()) throw new Error('World ID action is required')
  const shifted = BigInt(keccak256(toBytes(action))) >> BigInt(8)
  return `0x${shifted.toString(16).padStart(64, '0')}` as Hex
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
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

export function parseLibroPublicationV1(value: unknown): LibroPublicationV1Payload {
  if (!isRecord(value)) throw new Error('publication must be an object')
  if (value.publication_schema !== LIBRO_PUBLICATION_SCHEMA_V1) throw new Error('Unsupported publication schema')
  if (value.libro_protocol_version !== LIBRO_PROTOCOL_VERSION) throw new Error('Unsupported Libro protocol')
  if (value.world_id_protocol_version !== '4.0') throw new Error('Unsupported World ID protocol')
  if (!isRecord(value.publication_content) || typeof value.publication_content.html !== 'string') {
    throw new Error('publication_content.html must be a string')
  }

  for (const field of [
    'world_id_action', 'world_id_credential_policy', 'author_id_libro', 'publication_date',
    'author_name_libro', 'author_handle_libro', 'author_bio_libro', 'publication_title',
    'publication_subtitle',
  ]) requireString(value, field)

  if (!hasMeaningfulPublicationBody(value.publication_content)) {
    throw new Error('Publication body must contain readable text')
  }

  return value as LibroPublicationV1Payload
}

export function parseLibroEmbedManifest(value: unknown): LibroEmbedManifestV1 {
  if (!isRecord(value)) throw new Error('Manifest must be an object')
  if (value.schema !== LIBRO_EMBED_SCHEMA_V1) throw new Error('Unsupported embed schema')
  if (value.claim !== LIBRO_HUMAN_AUTHORSHIP_CLAIM) throw new Error('Unsupported authorship claim')

  const publication = parseLibroPublicationV1(value.publication)
  if (!isRecord(value.registration)) throw new Error('registration must be an object')
  const registration = value.registration
  if (registration.chain_id !== LIBRO_WORLD_CHAIN_ID) throw new Error('Unsupported chain id')
  if (typeof registration.registry_address !== 'string' || !isAddress(registration.registry_address)) {
    throw new Error('registry_address must be an address')
  }

  const manifest: LibroEmbedManifestV1 = {
    schema: LIBRO_EMBED_SCHEMA_V1,
    claim: LIBRO_HUMAN_AUTHORSHIP_CLAIM,
    publication,
    registration: {
      chain_id: LIBRO_WORLD_CHAIN_ID,
      registry_address: registration.registry_address,
      signal_hash: requireHash(registration.signal_hash, 'signal_hash'),
      action_hash: requireHash(registration.action_hash, 'action_hash'),
      transaction_hash: requireHash(registration.transaction_hash, 'transaction_hash'),
    },
  }

  if (value.source !== undefined) {
    if (!isRecord(value.source)) throw new Error('source must be an object')
    const publicationUrl = requireString(value.source, 'publication_url')
    const proofUrl = requireString(value.source, 'proof_url')
    for (const [field, url] of [['publication_url', publicationUrl], ['proof_url', proofUrl]] as const) {
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
    manifest.source = { publication_url: publicationUrl, proof_url: proofUrl }
  }

  return manifest
}

export function isApprovedLibroRegistry(chainId: number, address: string): boolean {
  return chainId === LIBRO_WORLD_CHAIN_ID && address.toLowerCase() === LIBRO_V1_REGISTRY_ADDRESS.toLowerCase()
}

export class LibroUnsupportedRegistryError extends Error {}
export class LibroNotRegisteredError extends Error {}
export class LibroRegistrationMismatchError extends Error {}

export function assertLibroManifestLocalIntegrity(value: unknown): LibroEmbedManifestV1 {
  const manifest = parseLibroEmbedManifest(value)
  const signalText = canonicalPublicationSignal(manifest.publication)
  if (hashPublicationSignal(signalText) !== manifest.registration.signal_hash) {
    throw new Error('Manifest signal hash does not match the publication')
  }
  if (actionHashToHex(manifest.publication.world_id_action) !== manifest.registration.action_hash) {
    throw new Error('Manifest action hash does not match the publication action')
  }
  return manifest
}

export function manifestElementId(signalHash: string): string {
  return `libro-manifest-${signalHash.toLowerCase()}`
}

export function serializeManifestForHtml(manifest: LibroEmbedManifestV1): string {
  return JSON.stringify(manifest).replace(/</g, '\\u003c')
}

export function isSimpleTextPublication(publication: LibroPublicationV1Payload): boolean {
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

export async function verifyLibroManifestOnChain(
  manifestValue: unknown,
  rpcUrl: string = LIBRO_WORLD_CHAIN_RPC_URL
): Promise<LibroEmbedManifestV1> {
  const manifest = assertLibroManifestLocalIntegrity(manifestValue)
  if (!isApprovedLibroRegistry(manifest.registration.chain_id, manifest.registration.registry_address)) {
    throw new LibroUnsupportedRegistryError('Libro registry is not approved')
  }

  const client = createPublicClient({ chain: worldchain, transport: http(rpcUrl) })
  const registered = await client.readContract({
    address: manifest.registration.registry_address,
    abi: libroProofRegistryAbi,
    functionName: 'verify',
    args: [BigInt(manifest.registration.signal_hash)],
  })
  if (!registered) throw new LibroNotRegisteredError('Signal is not registered')

  const receipt = await client.getTransactionReceipt({ hash: manifest.registration.transaction_hash })
  if (receipt.status !== 'success') {
    throw new LibroRegistrationMismatchError('Registration transaction was not successful')
  }

  const events = parseEventLogs({
    abi: libroProofRegistryAbi,
    eventName: 'SignalRegistered',
    logs: receipt.logs,
    strict: true,
  })
  const matchingEvent = events.some((event) =>
    event.address.toLowerCase() === manifest.registration.registry_address.toLowerCase() &&
    event.args.signalHash === BigInt(manifest.registration.signal_hash) &&
    event.args.actionHash === BigInt(manifest.registration.action_hash)
  )
  if (!matchingEvent) throw new LibroRegistrationMismatchError('Registration event does not match the manifest')

  return manifest
}
