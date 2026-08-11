import { createLibroPublicClient } from '@libro/core'
import {
  getLibroAgentServerConfig,
  getLibroServerConfig,
  type LibroAgentServerConfig,
  type LibroServerConfig,
} from './config'
import { libroAgentRegistryAbi, libroProofRegistryAbi } from './contract'
import { hexToUint256 } from './encoding'

export async function verifyLibroSignalRegistered(
  signalHash: string,
  config: LibroServerConfig = getLibroServerConfig()
): Promise<boolean> {
  const client = createLibroPublicClient(config.rpcUrls)

  return client.readContract({
    address: config.registryAddress,
    abi: libroProofRegistryAbi,
    functionName: 'verify',
    args: [hexToUint256(signalHash, 'signal_hash')],
  })
}

export async function verifyLibroAgentRegistered(
  registrationHash: string,
  config: LibroAgentServerConfig = getLibroAgentServerConfig()
): Promise<boolean> {
  const client = createLibroPublicClient(config.rpcUrls)

  return client.readContract({
    address: config.registryAddress,
    abi: libroAgentRegistryAbi,
    functionName: 'verifyAgent',
    args: [registrationHash as `0x${string}`],
  })
}

export async function verifyLibroAgentDocumentRegistered(
  documentSignalHash: string,
  config: LibroAgentServerConfig = getLibroAgentServerConfig()
): Promise<boolean> {
  const client = createLibroPublicClient(config.rpcUrls)

  return client.readContract({
    address: config.registryAddress,
    abi: libroAgentRegistryAbi,
    functionName: 'verifyAgentDocument',
    args: [hexToUint256(documentSignalHash, 'document_signal_hash')],
  })
}
