import { isAddress, type Address } from 'viem'
import { DEFAULT_WORLD_ID_PUBLISH_ACTION } from '@/lib/world-id/constants'
import {
  LIBRO_PROTOCOL_VERSION,
  LIBRO_WORLD_CHAIN_ID,
  LIBRO_WORLD_CHAIN_RPC_URL,
} from './contract'
import { actionHashToUint256, parseUint64 } from './encoding'

export type LibroServerConfig = {
  protocolVersion: typeof LIBRO_PROTOCOL_VERSION
  chainId: typeof LIBRO_WORLD_CHAIN_ID
  registryAddress: Address
  worldIdVerifierAddress: Address
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
  const action = process.env.WORLD_ID_PUBLISH_ACTION || DEFAULT_WORLD_ID_PUBLISH_ACTION

  return {
    protocolVersion: LIBRO_PROTOCOL_VERSION,
    chainId: getLibroChainId(),
    registryAddress: requireAddress('NEXT_PUBLIC_LIBRO_REGISTRY_ADDRESS'),
    worldIdVerifierAddress: requireAddress('LIBRO_WORLD_ID_VERIFIER_ADDRESS'),
    rpId: parseUint64(requireEnv('LIBRO_WORLD_ID_RP_ID_UINT64'), 'LIBRO_WORLD_ID_RP_ID_UINT64'),
    action,
    actionHash: actionHashToUint256(action),
    rpcUrl: process.env.LIBRO_RPC_URL || LIBRO_WORLD_CHAIN_RPC_URL,
  }
}
