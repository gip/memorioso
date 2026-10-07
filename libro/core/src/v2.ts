import { parseEventLogs, encodeAbiParameters, keccak256, toBytes, isAddress, isHex, createPublicClient, http, type Address, type Hex } from 'viem'
import { worldchain } from 'viem/chains'
import { canonicalStringify, parseLibroPublicationV2, parseLibroAgentPublicationV2, hashPublicationSignal, parseLibroRpcUrls, LIBRO_V1_REGISTRY_ADDRESS, type LibroPublicationV2Payload, type LibroAgentPublicationV2Payload, type JsonInput } from './index'
import { libroRegistryV2Abi } from './v2-abi'

export const LIBRO_PROTOCOL_VERSION_V2 = 'libro-v2' as const
export const LIBRO_AGENT_PROTOCOL_VERSION_V2 = 'libro-agent-v2' as const
export const LIBRO_PUBLICATION_SCHEMA_V3 = 'libro-publication-v3' as const
export const LIBRO_AGENT_PUBLICATION_SCHEMA_V3 = 'libro-agent-publication-v3' as const
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const
export type LibroPublicationReference = { chain_id: 480; registry_address: Address; signal_hash: Hex }
export type LibroRevisionFields = {
  publication_registry: Address
  previous_publication: LibroPublicationReference | null
  initially_published_at: string
  revision_number: number
}
export type LibroPublicationV3Payload = Omit<LibroPublicationV2Payload, 'publication_schema' | 'libro_protocol_version'> & LibroRevisionFields & {
  publication_schema: typeof LIBRO_PUBLICATION_SCHEMA_V3
  libro_protocol_version: typeof LIBRO_PROTOCOL_VERSION_V2
}
export type LibroAgentPublicationV3Payload = Omit<LibroAgentPublicationV2Payload, 'publication_schema' | 'libro_agent_protocol_version'> & LibroRevisionFields & {
  publication_schema: typeof LIBRO_AGENT_PUBLICATION_SCHEMA_V3
  libro_agent_protocol_version: typeof LIBRO_AGENT_PROTOCOL_VERSION_V2
}
export type LibroRevisionInfo = {
  rootPublicationId: string
  previousPublicationId: string | null
  latestPublicationId: string | null
  initiallyPublishedAt: string
  revisionNumber: number
  isLatest: boolean
  latestReference?: LibroPublicationReference
  statusAvailable?: boolean
  pending?: boolean
}

// These are trusted deployment configuration, never addresses discovered in a manifest.
export function configuredLibroRegistries(): { v1: Address; v2: Address } {
  return {
    v1: (process.env.NEXT_PUBLIC_LIBRO_V1_REGISTRY_ADDRESS || process.env.NEXT_PUBLIC_LIBRO_REGISTRY_ADDRESS || LIBRO_V1_REGISTRY_ADDRESS).toLowerCase() as Address,
    v2: (process.env.NEXT_PUBLIC_LIBRO_V2_REGISTRY_ADDRESS || ZERO_ADDRESS).toLowerCase() as Address,
  }
}
export function registryProtocolVersion(address: string): 'libro-v1' | 'libro-v2' | null {
  const registries = configuredLibroRegistries()
  if (!isAddress(address) || address.toLowerCase() === ZERO_ADDRESS) return null
  if (registries.v2 !== ZERO_ADDRESS && address.toLowerCase() === registries.v2) return 'libro-v2'
  if (address.toLowerCase() === registries.v1) return 'libro-v1'
  return null
}
export function requireV2Registry(): Address {
  const { v1, v2 } = configuredLibroRegistries()
  if (!isAddress(v2) || v2 === ZERO_ADDRESS || v2 === v1) throw new Error('NEXT_PUBLIC_LIBRO_V2_REGISTRY_ADDRESS must be a distinct non-zero address')
  if (!isAddress(v1) || v1 === ZERO_ADDRESS) throw new Error('NEXT_PUBLIC_LIBRO_V1_REGISTRY_ADDRESS must be a non-zero address')
  return v2
}
export function isV2Publication(value: unknown): value is LibroPublicationV3Payload | LibroAgentPublicationV3Payload {
  return Boolean(value && typeof value === 'object' && 'publication_schema' in value &&
    (value.publication_schema === LIBRO_PUBLICATION_SCHEMA_V3 || value.publication_schema === LIBRO_AGENT_PUBLICATION_SCHEMA_V3))
}
export function parseLibroPublicationV3(value: unknown): LibroPublicationV3Payload | LibroAgentPublicationV3Payload {
  if (!isV2Publication(value)) throw new Error('Unsupported publication schema')
  const human = value.publication_schema === LIBRO_PUBLICATION_SCHEMA_V3
  if (human) {
    if (value.libro_protocol_version !== LIBRO_PROTOCOL_VERSION_V2) throw new Error('Unsupported Libro protocol')
    parseLibroPublicationV2({ ...value, publication_schema: 'libro-publication-v2', libro_protocol_version: 'libro-v1' })
  } else {
    if (value.libro_agent_protocol_version !== LIBRO_AGENT_PROTOCOL_VERSION_V2) throw new Error('Unsupported Libro agent protocol')
    parseLibroAgentPublicationV2({ ...value, publication_schema: 'libro-agent-publication-v2', libro_agent_protocol_version: 'libro-agent-v1' })
  }
  if (!isAddress(value.publication_registry) || value.publication_registry.toLowerCase() === ZERO_ADDRESS || value.publication_registry !== value.publication_registry.toLowerCase()) throw new Error('Invalid publication_registry')
  if (!Number.isSafeInteger(value.revision_number) || value.revision_number < 1 || value.revision_number > 2147483647) throw new Error('Invalid revision_number')
  const initial = Date.parse(value.initially_published_at)
  if (!Number.isFinite(initial) || initial > Date.parse(value.publication_date)) throw new Error('Invalid initially_published_at')
  if (value.previous_publication === null) {
    if (value.revision_number !== 1 || value.initially_published_at !== value.publication_date) throw new Error('Original publication must use its publication date and revision 1')
  } else {
    const ref = value.previous_publication
    if (!ref || ref.chain_id !== 480 || !isAddress(ref.registry_address) || ref.registry_address.toLowerCase() === ZERO_ADDRESS ||
      !isHex(ref.signal_hash) || ref.signal_hash.length !== 66 || BigInt(ref.signal_hash) === BigInt(0) || value.revision_number < 2) throw new Error('Invalid previous_publication')
  }
  return value
}
const COMMITMENT_TYPE = 'PublicationCommitmentV2(bytes32 payloadHash,bytes32 handleHash,address previousRegistry,uint256 previousSignalHash,uint8 authorshipClass,uint256 chainId,address registryAddress)'
export function v2PublicationCommitment(publication: LibroPublicationV3Payload | LibroAgentPublicationV3Payload) {
  return {
    payloadHash: keccak256(toBytes(canonicalStringify(publication as unknown as JsonInput))),
    previousRegistry: publication.previous_publication?.registry_address ?? ZERO_ADDRESS,
    previousSignalHash: BigInt(publication.previous_publication?.signal_hash ?? 0),
  }
}
export function canonicalV2PublicationSignal(publication: LibroPublicationV3Payload | LibroAgentPublicationV3Payload): string {
  const commitment = v2PublicationCommitment(publication)
  const digest = keccak256(encodeAbiParameters(
    [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'address' }, { type: 'uint256' }, { type: 'uint8' }, { type: 'uint256' }, { type: 'address' }],
    [keccak256(toBytes(COMMITMENT_TYPE)), commitment.payloadHash, publication.author_handle_hash_libro, commitment.previousRegistry,
      commitment.previousSignalHash, publication.publication_schema === LIBRO_PUBLICATION_SCHEMA_V3 ? 1 : 2, BigInt(480), publication.publication_registry],
  ))
  return `libro-publication-v2:${digest}`
}
export function v2PublicationSignalHash(publication: LibroPublicationV3Payload | LibroAgentPublicationV3Payload): Hex {
  return hashPublicationSignal(canonicalV2PublicationSignal(publication))
}
export async function readLibroRevisionStatus(reference: LibroPublicationReference, rpcUrls?: string | readonly string[]) {
  const registry = requireV2Registry()
  if (!registryProtocolVersion(reference.registry_address) || reference.chain_id !== 480) throw new Error('Unsupported predecessor registry')
  const outcomes = await Promise.allSettled(parseLibroRpcUrls(rpcUrls).map(async url => {
    const client = createPublicClient({ chain: worldchain, transport: http(url, { timeout: 5000, retryCount: 0 }) })
    if (await client.getChainId() !== 480) throw new Error('Wrong chain')
    const block = await client.getBlockNumber()
    const status = await client.readContract({ address: registry, abi: libroRegistryV2Abi, functionName: 'getPublicationStatus', args: [reference.registry_address, BigInt(reference.signal_hash)], blockNumber: block })
    return { block, status }
  }))
  const available = outcomes.flatMap(outcome => outcome.status === 'fulfilled' ? [outcome.value] : [])
  if (!available.length) throw new Error('Libro revision status is unavailable')
  available.sort((a, b) => a.block > b.block ? -1 : a.block < b.block ? 1 : 0)
  return available[0].status
}

export function assertLibroRevisionReceipt(publication: LibroPublicationV3Payload | LibroAgentPublicationV3Payload, registration: import('./index').LibroRegistrationReference, receipt: import('viem').TransactionReceipt): void {
  if (v2PublicationSignalHash(publication) !== registration.signal_hash.toLowerCase()) throw new Error('Registration commitment does not match the publication')
  const previous = publication.previous_publication
  if (!previous) return
  const events = parseEventLogs({ abi: libroRegistryV2Abi, eventName: 'PublicationUpdated', logs: receipt.logs, strict: true })
  if (!events.some(event => event.address.toLowerCase() === registration.registry_address.toLowerCase() && event.args.newSignalHash === BigInt(registration.signal_hash) && event.args.previousSignalHash === BigInt(previous.signal_hash) && event.args.previousRegistry.toLowerCase() === previous.registry_address.toLowerCase() && event.args.handleHash.toLowerCase() === registration.handle_hash.toLowerCase() && event.args.revisionNumber === BigInt(publication.revision_number))) throw new Error('Registration revision event does not match the publication')
}
