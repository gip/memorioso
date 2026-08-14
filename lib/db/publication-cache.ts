import { cacheLife, cacheTag } from 'next/cache'
import { getProof, getPublication, getPublicationBySignalHash } from '@/lib/db/objects'

export const publicationCacheTag = (publicationId: string) => `publication:${publicationId}`
export const publicationHashCacheTag = (signalHash: string) =>
  `publication-hash:${signalHash.toLowerCase()}`

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
