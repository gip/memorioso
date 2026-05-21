import type { Abi } from 'viem'

export const LIBRO_PROTOCOL_VERSION = 'libro-v1' as const
export const LIBRO_PUBLICATION_SCHEMA_V1 = 'libro-publication-v1' as const
export const LIBRO_WORLD_CHAIN_ID = 480 as const
export const LIBRO_WORLD_CHAIN_RPC_URL = 'https://worldchain-mainnet.g.alchemy.com/public' as const

export const libroProofRegistryAbi = [
  {
    type: 'function',
    name: 'register',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'signalHash', type: 'uint256' },
      {
        name: 'proof',
        type: 'tuple',
        components: [
          { name: 'nullifier', type: 'uint256' },
          { name: 'nonce', type: 'uint256' },
          { name: 'expiresAtMin', type: 'uint64' },
          { name: 'issuerSchemaId', type: 'uint64' },
          { name: 'credentialGenesisIssuedAtMin', type: 'uint256' },
          { name: 'zeroKnowledgeProof', type: 'uint256[5]' },
        ],
      },
    ],
    outputs: [],
  },
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
    inputs: [{ name: 'signalHash', type: 'uint256', indexed: true }],
  },
] as const satisfies Abi
