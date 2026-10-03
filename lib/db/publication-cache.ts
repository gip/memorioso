import { cacheLife, cacheTag } from 'next/cache'
import {
  getAuthorPublicationCounts,
  getLatestPublications,
  getPublicationsByAuthor,
  getProof,
  getPublication,
  getPublicationAccess,
  getPublicationBySignalHash,
  type AuthorPublicationCounts,
} from '@/lib/db/objects'
import { type PublicationFeedKind } from '@/lib/publication-kind'
import type { PublicationInfo } from '@/types'
import { libroServiceReadsEnabled } from '@/lib/libro-service/client'

export const publicationCacheTag = (publicationId: string) => `publication:${publicationId}`
export const publicationHashCacheTag = (signalHash: string) =>
  `publication-hash:${signalHash.toLowerCase()}`
export const authorPublicationCountsCacheTag = (authorId: string) =>
  `author-publication-counts:${authorId}`
export const latestPublicationsCacheTag = 'latest-publications'

/**
 * Service-backed feeds run at request time and share entries across instances.
 * The publication tags expire these entries when a publish or webhook completes.
 */
export async function getCachedLatestPublications(
  limit: number,
  offset: number,
  type: PublicationFeedKind
): Promise<PublicationInfo[]> {
  if (libroServiceReadsEnabled()) return getSharedLatestPublications(limit, offset, type)
  return getPrerenderedLatestPublications(limit, offset, type)
}

async function getPrerenderedLatestPublications(limit: number, offset: number, type: PublicationFeedKind) {
  'use cache'

  cacheTag(latestPublicationsCacheTag)
  cacheLife('max')
  return getLatestPublications(limit, offset, type)
}

async function getSharedLatestPublications(limit: number, offset: number, type: PublicationFeedKind) {
  'use cache: remote'

  cacheTag(latestPublicationsCacheTag)
  cacheLife('max')
  return getLatestPublications(limit, offset, type)
}

export async function getCachedPublicationsByAuthor(
  authorId: string,
  limit: number,
  offset: number,
  type: PublicationFeedKind
): Promise<PublicationInfo[]> {
  'use cache: remote'

  cacheTag(authorPublicationCountsCacheTag(authorId), latestPublicationsCacheTag)
  cacheLife('max')
  return getPublicationsByAuthor(authorId, limit, offset, type)
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
