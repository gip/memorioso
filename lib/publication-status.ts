import type { Proof, PublicationRecord } from '@/types'

export const LEGACY_VERIFICATION_UNAVAILABLE_MESSAGE =
  'This publication was created before the World ID protocol change. It remains visible, but independent verification is no longer available.'

export function isLegacyPublication(publication: Pick<PublicationRecord, 'version'>): boolean {
  return publication.version === '1'
}

export function isWorldIdV4Proof(proof?: Proof | null): proof is Extract<Proof, { protocol_version: '4.0' }> {
  return Boolean(proof && 'protocol_version' in proof && proof.protocol_version === '4.0')
}

export function isLibroRegisteredProof(
  proof?: Proof | null
): proof is Extract<Proof, { protocol_version: '4.0' }> & {
  libro_registration: NonNullable<Extract<Proof, { protocol_version: '4.0' }>['libro_registration']>
} {
  return isWorldIdV4Proof(proof) && Boolean(proof.libro_registration)
}

export function getCredentialIdentifierForPublication(
  publication: Pick<PublicationRecord, 'version'>,
  proof?: Proof | null
): string | null {
  if (isLegacyPublication(publication) || !isWorldIdV4Proof(proof)) {
    return null
  }

  return proof.credential_identifier
}
