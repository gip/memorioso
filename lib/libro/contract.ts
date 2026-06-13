import type { Abi } from 'viem'

export const LIBRO_PROTOCOL_VERSION = 'libro-v1' as const
export const LIBRO_PUBLICATION_SCHEMA_V1 = 'libro-publication-v1' as const
export const LIBRO_AGENT_PROTOCOL_VERSION = 'libro-agent-v1' as const
export const LIBRO_AGENT_REGISTRATION_SCHEMA_V1 = 'libro-agent-registration-v1' as const
export const LIBRO_AGENT_PUBLICATION_SCHEMA_V1 = 'libro-agent-publication-v1' as const
export const LIBRO_AGENT_AUTHORSHIP_CLAIM = 'human_authorized_agent' as const
export const LIBRO_WORLD_CHAIN_ID = 480 as const
export const LIBRO_WORLD_CHAIN_RPC_URL = 'https://worldchain-mainnet.g.alchemy.com/public' as const

export const libroProofRegistryAbi = [
  {
    type: 'function',
    name: 'register',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'signalHash', type: 'uint256' },
      { name: 'actionHash', type: 'uint256' },
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
    inputs: [
      { name: 'signalHash', type: 'uint256', indexed: true },
      { name: 'actionHash', type: 'uint256', indexed: true },
    ],
  },
] as const satisfies Abi

export const libroAgentRegistryAbi = [
  {
    type: 'function',
    name: 'registerAgent',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'registration',
        type: 'tuple',
        components: [
          { name: 'principalAuthorHash', type: 'bytes32' },
          { name: 'controllerAddress', type: 'address' },
          { name: 'agentAddress', type: 'address' },
          { name: 'scope', type: 'uint256' },
          { name: 'validFrom', type: 'uint64' },
          { name: 'expiresAt', type: 'uint64' },
          { name: 'salt', type: 'bytes32' },
        ],
      },
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
    name: 'revokeAgent',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'registrationHash', type: 'bytes32' }],
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
    name: 'verifyAgent',
    stateMutability: 'view',
    inputs: [{ name: 'registrationHash', type: 'bytes32' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'verifyAgentDocument',
    stateMutability: 'view',
    inputs: [{ name: 'documentSignalHash', type: 'uint256' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'documentRegistrationHash',
    stateMutability: 'view',
    inputs: [{ name: 'documentSignalHash', type: 'uint256' }],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  {
    type: 'event',
    name: 'AgentRegistered',
    inputs: [
      { name: 'registrationHash', type: 'bytes32', indexed: true },
      { name: 'principalAuthorHash', type: 'bytes32', indexed: true },
      { name: 'agentAddress', type: 'address', indexed: true },
      { name: 'controllerAddress', type: 'address', indexed: false },
      { name: 'scope', type: 'uint256', indexed: false },
      { name: 'expiresAt', type: 'uint64', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'AgentRevoked',
    inputs: [{ name: 'registrationHash', type: 'bytes32', indexed: true }],
  },
  {
    type: 'event',
    name: 'AgentDocumentRegistered',
    inputs: [
      { name: 'documentSignalHash', type: 'uint256', indexed: true },
      { name: 'registrationHash', type: 'bytes32', indexed: true },
      { name: 'agentAddress', type: 'address', indexed: true },
      { name: 'documentNonce', type: 'bytes32', indexed: false },
      { name: 'signedAt', type: 'uint64', indexed: false },
    ],
  },
] as const satisfies Abi
