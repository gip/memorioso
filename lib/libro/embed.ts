import sanitizeHtml from 'sanitize-html'
import {
  LIBRO_EMBED_SCHEMA_V1,
  LIBRO_AGENT_SIGNED_CLAIM,
  LIBRO_HUMAN_SIGNED_CLAIM,
  LIBRO_V1_REGISTRY_ADDRESS,
  LIBRO_WORLD_CHAIN_ID,
  assertLibroManifestLocalIntegrity,
  canonicalPublicationSignal,
  extractReadableText,
  formatLibroPublicationMinute,
  formatLibroTextTag,
  hashPublicationSignal,
  isApprovedLibroRegistry,
  isSimpleTextPublication,
  manifestElementId,
  normalizeUint256Hex,
  parseLibroPublication,
  serializeManifestForHtml,
  type LibroEmbedManifestV1,
} from '@libro/core'
import { isLibroAgentProof, isLibroRegisteredProof } from '@/lib/publication-status'
import type { Proof, PublicationRecord } from '@/types'
import { publicationPathFor } from '@/lib/publication-kind'

export class LibroEmbedUnavailableError extends Error {}

const EMBED_ALLOWED_TAGS = [
  'a', 'blockquote', 'br', 'code', 'em', 'h1', 'h2', 'h3', 'img', 'li', 'ol', 'p',
  'pre', 's', 'strong', 'u', 'ul',
]

const EMBED_ALLOWED_ATTRIBUTES = {
  a: ['href', 'title', 'target', 'rel'],
  img: ['src', 'alt', 'title', 'width', 'height'],
  code: ['class'],
}

function normalizeAppUrl(): string | null {
  const value = process.env.NEXT_PUBLIC_APP_URL
  if (!value) return null
  try {
    return new URL(value).toString().replace(/\/$/, '')
  } catch {
    return null
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function buildLibroEmbedManifest(
  publication: PublicationRecord,
  proof: Proof | null | undefined,
  publicationId?: string
): LibroEmbedManifestV1 {
  const isHuman = isLibroRegisteredProof(proof)
  const isAgent = isLibroAgentProof(proof)
  if (!isHuman && !isAgent) throw new LibroEmbedUnavailableError('Publication does not have a Libro registration')

  const signalText = isHuman ? proof.signal_text : proof.agent_document_signature.document_signal_text
  const signalHash = isHuman ? proof.signal_hash : proof.agent_document_signature.document_signal_hash
  const registryAddress = isHuman
    ? proof.libro_registration.registry_address
    : proof.agent_document_signature.registry_address
  const transactionHash = isHuman
    ? proof.libro_registration.transaction_hash
    : proof.agent_document_signature.transaction_hash
  const handleHash = isHuman
    ? proof.libro_registration.handle_hash
    : proof.agent_registration.handle_hash

  let signedValue: unknown
  try {
    signedValue = JSON.parse(signalText)
  } catch {
    throw new LibroEmbedUnavailableError('Stored publication signal is not valid JSON')
  }

  let signedPublication
  try {
    signedPublication = parseLibroPublication(signedValue)
  } catch (error) {
    throw new LibroEmbedUnavailableError(error instanceof Error ? error.message : 'Unsupported signed publication')
  }

  const canonicalSignal = canonicalPublicationSignal(signedPublication)
  if (canonicalSignal !== signalText) {
    throw new LibroEmbedUnavailableError('Stored publication signal is not canonical')
  }

  const expectedSignalHash = hashPublicationSignal(canonicalSignal)
  if (normalizeUint256Hex(signalHash, 'proof signal_hash') !== expectedSignalHash) {
    throw new LibroEmbedUnavailableError('Stored proof signal hash does not match its signed signal')
  }
  const { version: _version, ...storedPublication } = publication
  if (canonicalPublicationSignal(storedPublication) !== canonicalSignal) {
    throw new LibroEmbedUnavailableError('Stored publication does not match its signed signal')
  }

  if (!/^0x[0-9a-fA-F]{64}$/.test(transactionHash)) {
    throw new LibroEmbedUnavailableError('transaction_hash must be a 32-byte hex string')
  }
  const manifest: LibroEmbedManifestV1 = {
    schema: LIBRO_EMBED_SCHEMA_V1,
    claim: isHuman ? LIBRO_HUMAN_SIGNED_CLAIM : LIBRO_AGENT_SIGNED_CLAIM,
    publication: signedPublication,
    registration: {
      chain_id: (isHuman ? proof.libro_registration.chain_id : proof.agent_document_signature.chain_id) as 480,
      registry_address: registryAddress as `0x${string}`,
      signal_hash: normalizeUint256Hex(signalHash, 'signal_hash'),
      handle_hash: normalizeUint256Hex(handleHash, 'handle_hash'),
      authorship_class: isHuman ? 'human' : 'agent',
      transaction_hash: transactionHash.toLowerCase() as `0x${string}`,
    },
  }

  const appUrl = normalizeAppUrl()
  if (appUrl && publicationId) {
    const publicationUrl = `${appUrl}${publicationPathFor(publication, publicationId)}`
    manifest.source = {
      publication_url: publicationUrl,
      proof_url: `${publicationUrl}/proof`,
      manifest_url: `${appUrl}/api/publications/${publicationId}/libro-manifest`,
    }
  }

  let validated: LibroEmbedManifestV1
  try {
    validated = assertLibroManifestLocalIntegrity(manifest)
  } catch (error) {
    throw new LibroEmbedUnavailableError(error instanceof Error ? error.message : 'Embed manifest is inconsistent')
  }

  if (!isApprovedLibroRegistry(validated.registration.chain_id, validated.registration.registry_address)) {
    throw new LibroEmbedUnavailableError(
      `Publication uses an unsupported Libro registry: ` +
      `publication registry (chain_id=${validated.registration.chain_id}, ` +
      `registry_address=${validated.registration.registry_address}) does not match ` +
      `approved registry (chain_id=${LIBRO_WORLD_CHAIN_ID}, registry_address=${LIBRO_V1_REGISTRY_ADDRESS})`
    )
  }

  return validated
}

export function sanitizeLibroEmbedHtml(html: string): string {
  const sanitized = sanitizeHtml(html, {
    allowedTags: EMBED_ALLOWED_TAGS,
    allowedAttributes: EMBED_ALLOWED_ATTRIBUTES,
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: {
      img: ['http', 'https', 'data'],
    },
    allowedSchemesAppliedToAttributes: ['href', 'src'],
    transformTags: {
      a: (_tagName, attribs) => ({
        tagName: 'a',
        attribs: {
          ...attribs,
          ...(attribs.target === '_blank' ? { rel: 'noopener noreferrer' } : {}),
        },
      }),
    },
  })
  const signedText = extractReadableText(html)
  return extractReadableText(sanitized) === signedText
    ? sanitized
    : `<p>${escapeHtml(signedText)}</p>`
}

export function sanitizeShortPublicationHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ['p', 'br'],
    allowedAttributes: {},
  })
}

export function getLibroSimpleBoundaryLabel(manifest: LibroEmbedManifestV1): string {
  const { publication, registration } = manifest
  const manifestUrl = manifest.source?.manifest_url
  const label = registration.authorship_class === 'human' ? 'Signed by a human' : 'Human-authorized agent'
  return `=== Libro · ${label} · @${publication.author_handle_libro} · ${formatLibroPublicationMinute(publication.publication_date)} · ${registration.signal_hash}${manifestUrl ? ` · ${manifestUrl}` : ''} ===`
}

export function buildLibroTextSnippet(manifest: LibroEmbedManifestV1): string {
  return formatLibroTextTag(manifest)
}

export function buildLibroEmbedSnippet(manifest: LibroEmbedManifestV1): string {
  const id = manifestElementId(manifest.registration.signal_hash)
  const content = sanitizeLibroEmbedHtml(manifest.publication.publication_content.html)
  const body = `<div class="libro-${manifest.claim}" data-libro-claim="${manifest.claim}" data-libro-manifest="${id}" data-libro-signal-hash="${manifest.registration.signal_hash}">\n${content}\n</div>`
  const presentation = isSimpleTextPublication(manifest.publication)
    ? `<div class="libro-simple">\n<div class="libro-boundary">${escapeHtml(getLibroSimpleBoundaryLabel(manifest))}</div>\n${body}\n<div class="libro-boundary">=== End Libro ===</div>\n</div>`
    : body
  const dataBlock = `<script id="${id}" type="application/libro+json">${serializeManifestForHtml(manifest)}</script>`
  return `${presentation}\n${dataBlock}`
}
