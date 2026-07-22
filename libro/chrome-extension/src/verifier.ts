import {
  LibroNotRegisteredError,
  LibroRegistrationMismatchError,
  LibroUnsupportedRegistryError,
  assertLibroManifestLocalIntegrity,
  extractReadableText,
  isApprovedLibroRegistry,
  libroTextTagHashMatches,
  manifestElementId,
  normalizeReadableText,
  verifyLibroManifestOnChain,
  type LibroEmbedManifestV1,
} from '@libro/core'
import type { LibroCandidate, LibroVerificationResult } from './shared'

type ChainVerifier = (manifest: LibroEmbedManifestV1) => Promise<LibroEmbedManifestV1>

const LABELS = {
  verified: 'Verified',
  text_mismatch: 'Text mismatch',
  invalid_manifest: 'Invalid manifest',
  manifest_missing: 'Manifest missing',
  unsupported_registry: 'Unsupported registry',
  not_registered: 'Not registered',
  network_unavailable: 'Network unavailable',
} as const

function urlsMatch(left: string, right: string): boolean {
  try {
    return new URL(left).toString() === new URL(right).toString()
  } catch {
    return false
  }
}

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
    const status = candidate.kind === 'text' && !candidate.manifestText ? 'manifest_missing' : 'invalid_manifest'
    return result(candidate, status, candidate.error || (
      candidate.kind === 'text'
        ? 'The text tag was found, but its signed Libro manifest is unavailable'
        : 'The Libro manifest is missing'
    ))
  }

  let manifest: LibroEmbedManifestV1
  try {
    manifest = assertLibroManifestLocalIntegrity(JSON.parse(candidate.manifestText))
  } catch (error) {
    return result(candidate, 'invalid_manifest', error instanceof Error ? error.message : 'Manifest validation failed')
  }

  const hashMatches = candidate.kind === 'text'
    ? Boolean(candidate.declaredHash && libroTextTagHashMatches(candidate.declaredHash, manifest.registration.signal_hash))
    : candidate.declaredHash?.toLowerCase() === manifest.registration.signal_hash
  if (!hashMatches) {
    return result(candidate, 'invalid_manifest', 'The block signal hash does not match its manifest', manifest)
  }
  if (candidate.kind === 'embed' && candidate.manifestId !== manifestElementId(manifest.registration.signal_hash)) {
    return result(candidate, 'invalid_manifest', 'The block manifest reference does not match its signal hash', manifest)
  }

  if (candidate.kind === 'text') {
    if (candidate.declaredAuthorHandle !== manifest.publication.author_handle_libro) {
      return result(candidate, 'invalid_manifest', 'The text tag author does not match its signed manifest', manifest)
    }
    if (candidate.declaredPublicationDate !== manifest.publication.publication_date.slice(0, 10)) {
      return result(candidate, 'invalid_manifest', 'The text tag date does not match its signed manifest', manifest)
    }
    if (candidate.manifestUrl) {
      const declaredManifestUrl = manifest.source?.manifest_url
      if (!declaredManifestUrl || !urlsMatch(declaredManifestUrl, candidate.manifestUrl)) {
        return result(candidate, 'invalid_manifest', 'The text tag manifest URL does not match the returned manifest source', manifest)
      }
    }
  }

  const embeddedText = candidate.readableText === undefined
    ? extractReadableText(candidate.innerHtml)
    : normalizeReadableText(candidate.readableText)
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
