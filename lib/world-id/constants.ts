import type { CredentialType } from '@worldcoin/idkit'

export const WORLD_ID_PROTOCOL_VERSION = '4.0' as const
export const PUBLICATION_SCHEMA_V2 = 'memorioso-publication-v2' as const
export const WORLD_ID_CREDENTIAL_POLICY = 'document_or_orb' as const
export const DEFAULT_WORLD_ID_PUBLISH_ACTION = 'written-by-a-human-v4' as const
export const WORLD_ID_WALLET_AUTH_STATEMENT = 'Sign in to Memorioso with World App.' as const
export const WORLD_WALLET_NONCE_COOKIE = 'memorioso_wallet_nonce' as const
export const WORLD_CHAIN_ID = 480

export const WORLD_ID_ALLOWED_CREDENTIALS = [
  'proof_of_human',
  'face',
  'passport',
  'mnc',
] as const satisfies readonly CredentialType[]

export type WorldIdCredentialIdentifier = typeof WORLD_ID_ALLOWED_CREDENTIALS[number]

export const WORLD_ID_CREDENTIAL_LABELS: Record<WorldIdCredentialIdentifier, string> = {
  proof_of_human: 'Orb',
  face: 'Secure Document',
  passport: 'Document',
  mnc: 'Document',
}
