import { createPublicClient, http } from 'viem'
import { worldchain } from 'viem/chains'
import { getLibroServerConfig, type LibroServerConfig } from './config'
import { libroProofRegistryAbi } from './contract'
import { hexToUint256 } from './encoding'

export async function verifyLibroSignalRegistered(
  signalHash: string,
  config: LibroServerConfig = getLibroServerConfig()
): Promise<boolean> {
  const client = createPublicClient({
    chain: worldchain,
    transport: http(config.rpcUrl),
  })

  return client.readContract({
    address: config.registryAddress,
    abi: libroProofRegistryAbi,
    functionName: 'verify',
    args: [hexToUint256(signalHash, 'signal_hash')],
  })
}
