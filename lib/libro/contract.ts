import type { Abi } from 'viem'
import {
  LIBRO_PROTOCOL_VERSION as CORE_LIBRO_PROTOCOL_VERSION,
  LIBRO_PUBLICATION_SCHEMA_V1 as CORE_LIBRO_PUBLICATION_SCHEMA_V1,
  LIBRO_PUBLICATION_SCHEMA_V2 as CORE_LIBRO_PUBLICATION_SCHEMA_V2,
  LIBRO_AGENT_PUBLICATION_SCHEMA_V1 as CORE_LIBRO_AGENT_PUBLICATION_SCHEMA_V1,
  LIBRO_AGENT_PUBLICATION_SCHEMA_V2 as CORE_LIBRO_AGENT_PUBLICATION_SCHEMA_V2,
  LIBRO_WORLD_CHAIN_ID as CORE_LIBRO_WORLD_CHAIN_ID,
  LIBRO_WORLD_CHAIN_RPC_URL as CORE_LIBRO_WORLD_CHAIN_RPC_URL,
  LIBRO_WORLD_CHAIN_RPC_URLS as CORE_LIBRO_WORLD_CHAIN_RPC_URLS,
} from '@libro/core'

export const LIBRO_PROTOCOL_VERSION = CORE_LIBRO_PROTOCOL_VERSION
export const LIBRO_PUBLICATION_SCHEMA_V1 = CORE_LIBRO_PUBLICATION_SCHEMA_V1
export const LIBRO_PUBLICATION_SCHEMA_V2 = CORE_LIBRO_PUBLICATION_SCHEMA_V2
export const LIBRO_AGENT_PROTOCOL_VERSION = 'libro-agent-v1' as const
export const LIBRO_AGENT_REGISTRATION_SCHEMA_V1 = 'libro-agent-registration-v1' as const
export const LIBRO_AGENT_PUBLICATION_SCHEMA_V1 = CORE_LIBRO_AGENT_PUBLICATION_SCHEMA_V1
export const LIBRO_AGENT_PUBLICATION_SCHEMA_V2 = CORE_LIBRO_AGENT_PUBLICATION_SCHEMA_V2
export const LIBRO_AGENT_AUTHORSHIP_CLAIM = 'human_authorized_agent' as const
export const LIBRO_WORLD_CHAIN_ID = CORE_LIBRO_WORLD_CHAIN_ID
export const LIBRO_WORLD_CHAIN_RPC_URL = CORE_LIBRO_WORLD_CHAIN_RPC_URL
export const LIBRO_WORLD_CHAIN_RPC_URLS = CORE_LIBRO_WORLD_CHAIN_RPC_URLS

const sessionProofComponents = [
  { name: 'sessionCommitment', type: 'uint256' },
  { name: 'nonce', type: 'uint256' },
  { name: 'expiresAtMin', type: 'uint64' },
  { name: 'issuerSchemaId', type: 'uint64' },
  { name: 'credentialGenesisIssuedAtMin', type: 'uint256' },
  { name: 'sessionNullifier', type: 'uint256[2]' },
  { name: 'zeroKnowledgeProof', type: 'uint256[5]' },
] as const

const agentRegistrationComponents = [
  { name: 'handleHash', type: 'bytes32' },
  { name: 'controllerAddress', type: 'address' },
  { name: 'agentAddress', type: 'address' },
  { name: 'scope', type: 'uint256' },
  { name: 'validFrom', type: 'uint64' },
  { name: 'expiresAt', type: 'uint64' },
  { name: 'salt', type: 'bytes32' },
] as const

export const libroRegistryAbi = [
  {
    type: 'function', name: 'claimHandle', stateMutability: 'nonpayable',
    inputs: [
      { name: 'handle', type: 'string' },
      { name: 'proof', type: 'tuple', components: sessionProofComponents },
    ], outputs: [],
  },
  {
    type: 'function', name: 'claimHandleAndRegisterHumanDocument', stateMutability: 'nonpayable',
    inputs: [
      { name: 'handle', type: 'string' },
      { name: 'documentSignalHash', type: 'uint256' },
      { name: 'proof', type: 'tuple', components: sessionProofComponents },
    ], outputs: [],
  },
  {
    type: 'function', name: 'registerHumanDocument', stateMutability: 'nonpayable',
    inputs: [
      { name: 'handleHash', type: 'bytes32' },
      { name: 'documentSignalHash', type: 'uint256' },
      { name: 'proof', type: 'tuple', components: sessionProofComponents },
    ], outputs: [],
  },
  {
    type: 'function', name: 'registerAgent', stateMutability: 'nonpayable',
    inputs: [
      { name: 'registration', type: 'tuple', components: agentRegistrationComponents },
      { name: 'proof', type: 'tuple', components: sessionProofComponents },
    ], outputs: [],
  },
  {
    type: 'function', name: 'claimHandleAndRegisterAgent', stateMutability: 'nonpayable',
    inputs: [
      { name: 'handle', type: 'string' },
      { name: 'registration', type: 'tuple', components: agentRegistrationComponents },
      { name: 'proof', type: 'tuple', components: sessionProofComponents },
    ], outputs: [],
  },
  {
    type: 'function', name: 'revokeAgent', stateMutability: 'nonpayable',
    inputs: [{ name: 'registrationHash', type: 'bytes32' }], outputs: [],
  },
  {
    type: 'function', name: 'registerAgentDocument', stateMutability: 'nonpayable',
    inputs: [
      { name: 'registrationHash', type: 'bytes32' },
      { name: 'documentSignalHash', type: 'uint256' },
      { name: 'documentNonce', type: 'bytes32' },
      { name: 'signedAt', type: 'uint64' },
      { name: 'signature', type: 'bytes' },
    ], outputs: [],
  },
  {
    type: 'function', name: 'verifyHumanDocument', stateMutability: 'view',
    inputs: [
      { name: 'documentSignalHash', type: 'uint256' },
      { name: 'handleHash', type: 'bytes32' },
    ], outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function', name: 'verifyAgent', stateMutability: 'view',
    inputs: [
      { name: 'registrationHash', type: 'bytes32' },
      { name: 'handleHash', type: 'bytes32' },
    ], outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function', name: 'verifyAgentDocument', stateMutability: 'view',
    inputs: [
      { name: 'documentSignalHash', type: 'uint256' },
      { name: 'handleHash', type: 'bytes32' },
    ], outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'event', name: 'HandleClaimed',
    inputs: [
      { name: 'handleHash', type: 'bytes32', indexed: true },
      { name: 'sessionCommitment', type: 'uint256', indexed: true },
    ],
  },
  {
    type: 'event', name: 'HumanDocumentRegistered',
    inputs: [
      { name: 'documentSignalHash', type: 'uint256', indexed: true },
      { name: 'handleHash', type: 'bytes32', indexed: true },
      { name: 'sessionNullifier', type: 'uint256', indexed: true },
    ],
  },
  {
    type: 'event', name: 'AgentRegistered',
    inputs: [
      { name: 'registrationHash', type: 'bytes32', indexed: true },
      { name: 'handleHash', type: 'bytes32', indexed: true },
      { name: 'agentAddress', type: 'address', indexed: true },
      { name: 'controllerAddress', type: 'address', indexed: false },
      { name: 'scope', type: 'uint256', indexed: false },
      { name: 'expiresAt', type: 'uint64', indexed: false },
      { name: 'sessionNullifier', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event', name: 'AgentRevoked',
    inputs: [
      { name: 'registrationHash', type: 'bytes32', indexed: true },
      { name: 'handleHash', type: 'bytes32', indexed: true },
    ],
  },
  {
    type: 'event', name: 'AgentDocumentRegistered',
    inputs: [
      { name: 'documentSignalHash', type: 'uint256', indexed: true },
      { name: 'registrationHash', type: 'bytes32', indexed: true },
      { name: 'handleHash', type: 'bytes32', indexed: true },
      { name: 'agentAddress', type: 'address', indexed: false },
      { name: 'documentNonce', type: 'bytes32', indexed: false },
      { name: 'signedAt', type: 'uint64', indexed: false },
    ],
  },
] as const satisfies Abi
