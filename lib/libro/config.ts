import { isAddress, type Address, type Hex } from 'viem'
import { parseLibroRpcUrls } from '@libro/core'
import {
  LIBRO_AGENT_PROTOCOL_VERSION,
  LIBRO_PROTOCOL_VERSION,
  LIBRO_WORLD_CHAIN_ID,
} from './contract'
import { rpIdToUint64 } from './encoding'

export type LibroServerConfig = {
  protocolVersion: typeof LIBRO_PROTOCOL_VERSION
  chainId: typeof LIBRO_WORLD_CHAIN_ID
  registryAddress: Address
  rpId: bigint
  /** Every configured endpoint; clients fail over between them. */
  rpcUrls: string[]
}

export type LibroAgentServerConfig = {
  protocolVersion: typeof LIBRO_AGENT_PROTOCOL_VERSION
  chainId: typeof LIBRO_WORLD_CHAIN_ID
  registryAddress: Address
  rpId: bigint
  /** Every configured endpoint; clients fail over between them. */
  rpcUrls: string[]
}

export type LibroHandlePermitConfig = {
  privateKey: Hex
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

function requireAddress(name: string): Address {
  const value = requireEnv(name)
  if (!isAddress(value) || value.toLowerCase() === '0x0000000000000000000000000000000000000000') {
    throw new Error(`${name} must be a valid non-zero EVM address`)
  }
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

export function getLibroServerConfig(): LibroServerConfig {
  return {
    protocolVersion: LIBRO_PROTOCOL_VERSION,
    chainId: getLibroChainId(),
    registryAddress: requireAddress('NEXT_PUBLIC_LIBRO_REGISTRY_ADDRESS'),
    rpId: rpIdToUint64(requireEnv('WORLD_ID_RP_ID')),
    rpcUrls: parseLibroRpcUrls(process.env.LIBRO_RPC_URL),
  }
}

export function getLibroAgentServerConfig(): LibroAgentServerConfig {
  return {
    protocolVersion: LIBRO_AGENT_PROTOCOL_VERSION,
    chainId: getLibroChainId(),
    registryAddress: requireAddress('NEXT_PUBLIC_LIBRO_REGISTRY_ADDRESS'),
    rpId: rpIdToUint64(requireEnv('WORLD_ID_RP_ID')),
    rpcUrls: parseLibroRpcUrls(process.env.LIBRO_RPC_URL),
  }
}

export function getLibroHandlePermitConfig(): LibroHandlePermitConfig {
  const privateKey = requireEnv('LIBRO_HANDLE_PERMIT_PRIVATE_KEY')
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey) || /^0x0{64}$/.test(privateKey)) {
    throw new Error('LIBRO_HANDLE_PERMIT_PRIVATE_KEY must be a valid non-zero 32-byte private key')
  }
  if (privateKey.toLowerCase() === process.env.WORLD_ID_RP_SIGNING_KEY?.toLowerCase()) {
    throw new Error('LIBRO_HANDLE_PERMIT_PRIVATE_KEY must not reuse WORLD_ID_RP_SIGNING_KEY')
  }
  return { privateKey: privateKey as Hex }
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
