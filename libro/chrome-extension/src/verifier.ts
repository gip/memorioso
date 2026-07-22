import {
  LibroNotRegisteredError,
  LibroRegistrationMismatchError,
  LibroUnsupportedRegistryError,
  assertLibroManifestLocalIntegrity,
  extractReadableText,
  isApprovedLibroRegistry,
  manifestElementId,
  verifyLibroManifestOnChain,
  type LibroEmbedManifestV1,
} from '@libro/core'
import type { LibroCandidate, LibroVerificationResult } from './shared'

type ChainVerifier = (manifest: LibroEmbedManifestV1) => Promise<LibroEmbedManifestV1>

const LABELS = {
  verified: 'Verified',
  text_mismatch: 'Text mismatch',
  invalid_manifest: 'Invalid manifest',
  unsupported_registry: 'Unsupported registry',
  not_registered: 'Not registered',
  network_unavailable: 'Network unavailable',
} as const

function result(
  candidate: LibroCandidate,
  status: keyof typeof LABELS,
  detail: string,
  manifest?: LibroEmbedManifestV1
): LibroVerificationResult {
  return {
    blockId: candidate.blockId,
    status,
    label: LABELS[status],
    detail,
    ...(manifest ? {
      authorHandle: manifest.publication.author_handle_libro,
      publicationDate: manifest.publication.publication_date,
      signalHash: manifest.registration.signal_hash,
    } : {}),
  }
}

export async function verifyCandidate(
  candidate: LibroCandidate,
  verifyChain: ChainVerifier = verifyLibroManifestOnChain
): Promise<LibroVerificationResult> {
  if (candidate.error || !candidate.manifestText) {
    return result(candidate, 'invalid_manifest', candidate.error || 'The Libro manifest is missing')
  }

  let manifest: LibroEmbedManifestV1
  try {
    manifest = assertLibroManifestLocalIntegrity(JSON.parse(candidate.manifestText))
  } catch (error) {
    return result(candidate, 'invalid_manifest', error instanceof Error ? error.message : 'Manifest validation failed')
  }

  if (candidate.declaredHash?.toLowerCase() !== manifest.registration.signal_hash) {
    return result(candidate, 'invalid_manifest', 'The block signal hash does not match its manifest', manifest)
  }
  if (candidate.manifestId !== manifestElementId(manifest.registration.signal_hash)) {
    return result(candidate, 'invalid_manifest', 'The block manifest reference does not match its signal hash', manifest)
  }

  const embeddedText = extractReadableText(candidate.innerHtml)
  const signedText = extractReadableText(manifest.publication.publication_content.html)
  if (embeddedText !== signedText) {
    return result(candidate, 'text_mismatch', 'The readable page text differs from the signed publication', manifest)
  }

  if (!isApprovedLibroRegistry(manifest.registration.chain_id, manifest.registration.registry_address)) {
    return result(candidate, 'unsupported_registry', 'This registry is not in the Libro verifier allowlist', manifest)
  }

  try {
    await verifyChain(manifest)
    return result(candidate, 'verified', 'Readable text and the on-chain Libro registration match', manifest)
  } catch (error) {
    if (error instanceof LibroUnsupportedRegistryError) {
      return result(candidate, 'unsupported_registry', error.message, manifest)
    }
    if (error instanceof LibroNotRegisteredError) {
      return result(candidate, 'not_registered', error.message, manifest)
    }
    if (error instanceof LibroRegistrationMismatchError) {
      return result(candidate, 'invalid_manifest', error.message, manifest)
    }
    return result(candidate, 'network_unavailable', 'World Chain could not be reached; verification is unknown', manifest)
  }
}
