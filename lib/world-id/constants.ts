import type { CredentialType } from '@worldcoin/idkit'

export const WORLD_ID_PROTOCOL_VERSION = '4.0' as const
export const PUBLICATION_SCHEMA_V2 = 'memorioso-publication-v2' as const
export const WORLD_ID_CREDENTIAL_POLICY = 'document_or_orb' as const
export const DEFAULT_WORLD_ID_LOGIN_ACTION = 'memorioso-login-v1' as const
export const DEFAULT_WORLD_ID_PUBLISH_ACTION = 'written-by-a-human-v4' as const
export const DEFAULT_WORLD_ID_AGENT_REGISTRATION_ACTION = 'register-agent-v1' as const
export const WORLD_ID_AUTH_NONCE_COOKIE = 'memorioso_world_id_auth_nonce' as const
export const WORLD_ID_SESSION_HINT_COOKIE = 'memorioso_world_id_session_hint' as const
export const WORLD_ID_SESSION_HINT_MAX_AGE_SECONDS = 60 * 60 * 24 * 365

export const WORLD_ID_ALLOWED_CREDENTIALS = [
  'proof_of_human',
  'selfie',
  'passport',
  'mnc',
] as const satisfies readonly CredentialType[]

export type WorldIdCredentialIdentifier = typeof WORLD_ID_ALLOWED_CREDENTIALS[number]

export function isWorldIdSessionId(value: unknown): value is `session_${string}` {
  return typeof value === 'string' && /^session_[0-9a-fA-F]{128}$/.test(value)
}

export const WORLD_ID_CREDENTIAL_LABELS: Record<WorldIdCredentialIdentifier, string> = {
  proof_of_human: 'Orb',
  selfie: 'Secure Document',
  passport: 'Document',
  mnc: 'Document',
}
