import {
  LibroChainVerificationError,
  LibroNotRegisteredError,
  LibroRegistrationPendingFinalityError,
  LibroRegistrationMismatchError,
  LibroRegistrationUnconfirmedError,
  LibroUnsupportedRegistryError,
  assertLibroManifestLocalIntegrity,
  extractReadableText,
  formatLibroPublicationMinute,
  isApprovedLibroRegistry,
  libroTextTagHashMatches,
  manifestElementId,
  normalizeReadableText,
  verifyLibroManifestOnChain,
  type LibroChainVerification,
  type LibroEmbedManifestV1,
} from '@libro/core'
import type { LibroCandidate, LibroVerificationResult, LibroVerificationSource } from './shared'

type ChainVerifier = (manifest: LibroEmbedManifestV1) => Promise<LibroChainVerification>

const LABELS = {
  verified: 'Verified',
  text_mismatch: 'Text mismatch',
  invalid_manifest: 'Invalid manifest',
  manifest_missing: 'Manifest missing',
  unsupported_registry: 'Unsupported registry',
  not_registered: 'Not registered',
  pending_finality: 'Pending finality',
  registration_unconfirmed: 'Registration unconfirmed',
  network_unavailable: 'Network unavailable',
} as const

/** viem errors carry multi-line docs footers; keep only the headline for the badge tooltip. */
function summarizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const headline = message.split('\n', 1)[0].trim()
  if (!headline) return error instanceof Error ? error.name : 'unknown error'
  return headline.length > 140 ? `${headline.slice(0, 139)}…` : headline
}

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
  manifest?: LibroEmbedManifestV1,
  sources?: LibroVerificationSource[]
): LibroVerificationResult {
  const verifiedBy = sources?.filter((source) => source.status === 'verified').map((source) => source.label)
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
    ...(sources?.length ? { sources } : {}),
    ...(verifiedBy?.length ? { verifiedBy } : {}),
  }
}

function sourcesFrom(error: unknown): LibroVerificationSource[] | undefined {
  if (!(error instanceof LibroChainVerificationError) || error.outcomes.length === 0) return undefined
  return error.outcomes.map(({ label, status, detail }) => ({ label, status, detail }))
}

function summarizeSources(sources: LibroVerificationSource[] | undefined): string {
  if (!sources?.length) return ''
  const grouped = new Map<string, string[]>()
  for (const source of sources) {
    grouped.set(source.status, [...(grouped.get(source.status) ?? []), source.label])
  }
  return ` (${[...grouped].map(([status, labels]) => `${status}: ${labels.join(', ')}`).join('; ')})`
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
    if (candidate.declaredPublicationDate !== formatLibroPublicationMinute(manifest.publication.publication_date)) {
      return result(candidate, 'invalid_manifest', 'The text tag timestamp does not match its signed manifest', manifest)
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
    const verification = await verifyChain(manifest)
    const sources = verification.outcomes.map(({ label, status, detail }) => ({ label, status, detail }))
    return result(
      candidate,
      'verified',
      `Readable text and the on-chain Libro registration match, confirmed by ${verification.verifiedBy.join(', ')}`,
      manifest,
      sources
    )
  } catch (error) {
    const sources = sourcesFrom(error)
    if (error instanceof LibroUnsupportedRegistryError) {
      return result(candidate, 'unsupported_registry', error.message, manifest, sources)
    }
    if (error instanceof LibroNotRegisteredError) {
      return result(candidate, 'not_registered', error.message + summarizeSources(sources), manifest, sources)
    }
    if (error instanceof LibroRegistrationMismatchError) {
      return result(candidate, 'invalid_manifest', error.message + summarizeSources(sources), manifest, sources)
    }
    if (error instanceof LibroRegistrationPendingFinalityError) {
      return result(
        candidate,
        'pending_finality',
        'The exact registration is on World Chain but has not inherited Ethereum finality yet' +
          summarizeSources(sources),
        manifest,
        sources
      )
    }
    if (error instanceof LibroRegistrationUnconfirmedError) {
      return result(
        candidate,
        'registration_unconfirmed',
        'The signal is registered, but no World Chain endpoint has a record of the transaction this manifest cites' +
          summarizeSources(sources),
        manifest,
        sources
      )
    }
    // Everything else lands here, so surface the cause rather than reporting every
    // unclassified failure as an unreachable network.
    console.warn('[libro] on-chain verification failed', {
      blockId: candidate.blockId,
      signalHash: manifest.registration.signal_hash,
      transactionHash: manifest.registration.transaction_hash,
      error,
    })
    return result(
      candidate,
      'network_unavailable',
      `World Chain could not be reached; verification is unknown (${summarizeError(error)})`,
      manifest,
      sources
    )
  }
}
