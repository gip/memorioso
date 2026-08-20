import { cacheLife, cacheTag } from 'next/cache'
import {
  getAuthorPublicationCounts,
  getLatestPublications,
  getProof,
  getPublication,
  getPublicationAccess,
  getPublicationBySignalHash,
  getSitemapAuthors,
  getSitemapPublications,
  type AuthorPublicationCounts,
  type SitemapAuthor,
  type SitemapPublication,
} from '@/lib/db/objects'
import { type PublicationFeedKind } from '@/lib/publication-kind'
import type { PublicationInfo } from '@/types'

export const publicationCacheTag = (publicationId: string) => `publication:${publicationId}`
export const publicationHashCacheTag = (signalHash: string) =>
  `publication-hash:${signalHash.toLowerCase()}`
export const authorPublicationCountsCacheTag = (authorId: string) =>
  `author-publication-counts:${authorId}`
export const sitemapCacheTag = 'sitemap'
export const latestPublicationsCacheTag = 'latest-publications'

/**
 * The reading feed, cached so the homepage can prerender with articles already
 * in it instead of fetching them after hydration. Publications are append-only,
 * so `max` plus tag invalidation from the two publish finalize routes is exact:
 * nothing else changes what this returns.
 *
 * Keep the page window small and stable. Every distinct (limit, offset, type)
 * is its own cache entry, so this is for the pages a server render asks for,
 * not for arbitrary scroll offsets.
 */
export async function getCachedLatestPublications(
  limit: number,
  offset: number,
  type: PublicationFeedKind
): Promise<PublicationInfo[]> {
  'use cache'

  cacheTag(latestPublicationsCacheTag)
  cacheLife('max')
  return getLatestPublications(limit, offset, type)
}

export async function getCachedPublication(publicationId: string) {
  'use cache'

  cacheTag(publicationCacheTag(publicationId))
  const publication = await getPublication(publicationId)
  if (publication) {
    cacheLife('max')
  } else {
    cacheLife('minutes')
  }
  return publication
}

export async function getCachedProof(publicationId: string) {
  'use cache'

  cacheTag(publicationCacheTag(publicationId))
  const proof = await getProof(publicationId)
  if (proof) {
    cacheLife('max')
  } else {
    cacheLife('minutes')
  }
  return proof
}

/**
 * Deliberately a separate query rather than a column on getCachedPublication:
 * getPublication spreads `signal` into PublicationRecord, and buildLibroEmbedManifest
 * re-parses that object as a signed payload. An extra key there breaks every manifest.
 */
export async function getCachedPublicationAccess(publicationId: string) {
  'use cache'

  cacheTag(publicationCacheTag(publicationId))
  const access = await getPublicationAccess(publicationId)
  if (access) {
    cacheLife('max')
  } else {
    cacheLife('minutes')
  }
  return access
}

export async function getCachedPublicationBySignalHash(signalHash: string) {
  'use cache'

  cacheTag(publicationHashCacheTag(signalHash))
  const result = await getPublicationBySignalHash(signalHash)
  if (result) {
    cacheTag(publicationCacheTag(result.publicationId))
    cacheLife('max')
  } else {
    cacheLife('minutes')
  }
  return result
}

export async function getCachedAuthorPublicationCounts(authorId: string): Promise<AuthorPublicationCounts> {
  'use cache'

  cacheTag(authorPublicationCountsCacheTag(authorId))
  cacheLife('days')
  return getAuthorPublicationCounts(authorId)
}

export async function getCachedSitemapPublications(): Promise<SitemapPublication[]> {
  'use cache'

  cacheTag(sitemapCacheTag)
  cacheLife('days')
  return getSitemapPublications()
}

export async function getCachedSitemapAuthors(): Promise<SitemapAuthor[]> {
  'use cache'

  cacheTag(sitemapCacheTag)
  cacheLife('days')
  return getSitemapAuthors()
}
