import {
  extractReadableText,
  hasMeaningfulPublicationBody,
  isPlainTextPublicationHtml,
  MEMORIOSO_SHORT_MAX_LENGTH,
  normalizedUnicodeLength,
} from '@libro/core'
import type { PublicationContent, PublicationKind, PublicationRecord } from '@/types'
import { PUBLICATION_SUBTITLE_MAX_LENGTH } from '@/lib/publication-limits'

export const PUBLICATION_KINDS = ['short', 'article'] as const
export type { PublicationKind }
export type PublicationFeedKind = PublicationKind | 'all'
export { MEMORIOSO_SHORT_MAX_LENGTH }

export function isPublicationKind(value: unknown): value is PublicationKind {
  return typeof value === 'string' && PUBLICATION_KINDS.includes(value as PublicationKind)
}

export function publicationKindFromTitle(title: unknown): PublicationKind {
  return typeof title === 'string' && title.trim() ? 'article' : 'short'
}

export function getPublicationKind(
  publication: Pick<PublicationRecord, 'publication_title'>
): PublicationKind {
  return publicationKindFromTitle(publication.publication_title)
}

export function publicationPath(kind: PublicationKind, publicationId: string | number): string {
  return `/${kind}/${publicationId}`
}

export function publicationContentPath(publicationId: string | number): string {
  return `/api/publications/${publicationId}/content`
}

export function publicationProofPath(kind: PublicationKind, publicationId: string | number): string {
  return `${publicationPath(kind, publicationId)}/proof`
}

export function publicationPathFor(
  publication: Pick<PublicationRecord, 'publication_title'>,
  publicationId: string | number
): string {
  return publicationPath(getPublicationKind(publication), publicationId)
}

export function normalizedShortLength(content: PublicationContent): number {
  return normalizedUnicodeLength(extractReadableText(content.html))
}

export function validatePublicationForKind(input: {
  kind: PublicationKind
  title: unknown
  subtitle?: unknown
  content: unknown
}): string | null {
  if (input.kind === 'article') {
    if (typeof input.title !== 'string' || !input.title.trim()) return 'Article title is required'
    if (typeof input.subtitle === 'string' && input.subtitle.length > PUBLICATION_SUBTITLE_MAX_LENGTH) {
      return `Article subtitles are limited to ${PUBLICATION_SUBTITLE_MAX_LENGTH} characters`
    }
    if (!hasMeaningfulPublicationBody(input.content)) return 'Article body is required'
    return null
  }

  if (typeof input.title === 'string' && input.title.trim()) return 'Shorts cannot have a title'
  if (typeof input.subtitle === 'string' && input.subtitle.trim()) return 'Shorts cannot have a subtitle'
  if (!input.content || typeof input.content !== 'object') return 'Short text is required'
  const html = (input.content as { html?: unknown }).html
  if (!isPlainTextPublicationHtml(html)) return 'Shorts can contain only plain text and line breaks'
  if (normalizedUnicodeLength(extractReadableText(html)) > MEMORIOSO_SHORT_MAX_LENGTH) {
    return `Shorts are limited to ${MEMORIOSO_SHORT_MAX_LENGTH} characters`
  }
  return null
}
