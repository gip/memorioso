import { requireV2Registry, configuredLibroRegistries } from '@libro/core'
import { isAddress, type Address, type Hex } from 'viem'
import { parseLibroRpcUrls } from '@libro/core'
import {
  LIBRO_AGENT_PROTOCOL_VERSION,
  LIBRO_PROTOCOL_VERSION,
  LIBRO_WORLD_CHAIN_ID,
} from './contract'
import { rpIdToUint64 } from './encoding'

export type LibroServerConfig = {
  protocolVersion: typeof LIBRO_PROTOCOL_VERSION | 'libro-v2'
  chainId: typeof LIBRO_WORLD_CHAIN_ID
  registryAddress: Address
  rpId: bigint
  /** Every configured endpoint; clients fail over between them. */
  rpcUrls: string[]
}

export type LibroAgentServerConfig = {
  protocolVersion: typeof LIBRO_AGENT_PROTOCOL_VERSION | 'libro-agent-v2'
  chainId: typeof LIBRO_WORLD_CHAIN_ID
  registryAddress: Address
  rpId: bigint
  /** Every configured endpoint; clients fail over between them. */
  rpcUrls: string[]
}

export type LibroRelayerConfig = {
  privateKey: Hex
}

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} is required`)
  }
  return value
}

function trustedV1Address(): Address {
  const value = configuredLibroRegistries().v1
  if (!isAddress(value) || /^0x0{40}$/i.test(value)) throw new Error('NEXT_PUBLIC_LIBRO_V1_REGISTRY_ADDRESS must name a verified non-zero deployment')
  return value
}

function getLibroChainId(): typeof LIBRO_WORLD_CHAIN_ID {
  const raw = process.env.NEXT_PUBLIC_LIBRO_CHAIN_ID || String(LIBRO_WORLD_CHAIN_ID)
  const parsed = Number(raw)

  if (parsed !== LIBRO_WORLD_CHAIN_ID) {
    throw new Error(`NEXT_PUBLIC_LIBRO_CHAIN_ID must be ${LIBRO_WORLD_CHAIN_ID}`)
  }

  return LIBRO_WORLD_CHAIN_ID
}

export function getLibroServerConfig(protocol: string = 'libro-v2'): LibroServerConfig {
  if (protocol !== 'libro-v1' && protocol !== 'libro-v2') throw new Error('Unsupported Libro human protocol')
  return {
    protocolVersion: protocol === 'libro-v1' ? LIBRO_PROTOCOL_VERSION : 'libro-v2',
    chainId: getLibroChainId(),
    registryAddress: protocol.endsWith('v1') ? trustedV1Address() : requireV2Registry(),
    rpId: rpIdToUint64(requireEnv('WORLD_ID_RP_ID')),
    rpcUrls: parseLibroRpcUrls(process.env.LIBRO_RPC_URL),
  }
}

export function getLibroAgentServerConfig(protocol: string = 'libro-agent-v2'): LibroAgentServerConfig {
  if (protocol !== 'libro-agent-v1' && protocol !== 'libro-agent-v2') throw new Error('Unsupported Libro agent protocol')
  return {
    protocolVersion: protocol === 'libro-agent-v1' ? LIBRO_AGENT_PROTOCOL_VERSION : 'libro-agent-v2',
    chainId: getLibroChainId(),
    registryAddress: protocol.endsWith('v1') ? trustedV1Address() : requireV2Registry(),
    rpId: rpIdToUint64(requireEnv('WORLD_ID_RP_ID')),
    rpcUrls: parseLibroRpcUrls(process.env.LIBRO_RPC_URL),
  }
}

export function getLibroRelayerConfig(): LibroRelayerConfig {
  const privateKey = requireEnv('LIBRO_RELAYER_PRIVATE_KEY')
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey) || /^0x0{64}$/.test(privateKey)) {
    throw new Error('LIBRO_RELAYER_PRIVATE_KEY must be a valid non-zero 32-byte private key')
  }

  return {
    privateKey: privateKey as Hex,
  }
}
