import { isAddress, type Address } from 'viem'
import { DEFAULT_WORLD_ID_AGENT_REGISTRATION_ACTION } from '@/lib/world-id/constants'
import {
  LIBRO_AGENT_PROTOCOL_VERSION,
  LIBRO_PROTOCOL_VERSION,
  LIBRO_WORLD_CHAIN_ID,
  LIBRO_WORLD_CHAIN_RPC_URL,
} from './contract'
import { actionHashToUint256, rpIdToUint64 } from './encoding'

export type LibroServerConfig = {
  protocolVersion: typeof LIBRO_PROTOCOL_VERSION
  chainId: typeof LIBRO_WORLD_CHAIN_ID
  registryAddress: Address
  rpId: bigint
  rpcUrl: string
}

export type LibroAgentServerConfig = {
  protocolVersion: typeof LIBRO_AGENT_PROTOCOL_VERSION
  chainId: typeof LIBRO_WORLD_CHAIN_ID
  registryAddress: Address
  rpId: bigint
  action: string
  actionHash: bigint
  rpcUrl: string
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
    rpcUrl: process.env.LIBRO_RPC_URL || LIBRO_WORLD_CHAIN_RPC_URL,
  }
}

export function getLibroAgentServerConfig(): LibroAgentServerConfig {
  const action = process.env.WORLD_ID_AGENT_REGISTRATION_ACTION || DEFAULT_WORLD_ID_AGENT_REGISTRATION_ACTION

  return {
    protocolVersion: LIBRO_AGENT_PROTOCOL_VERSION,
    chainId: getLibroChainId(),
    registryAddress: requireAddress('NEXT_PUBLIC_LIBRO_AGENT_REGISTRY_ADDRESS'),
    rpId: rpIdToUint64(requireEnv('WORLD_ID_RP_ID')),
    action,
    actionHash: actionHashToUint256(action),
    rpcUrl: process.env.LIBRO_RPC_URL || LIBRO_WORLD_CHAIN_RPC_URL,
  }
}
