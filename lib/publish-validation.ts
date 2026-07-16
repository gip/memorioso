import type { PoolClient } from 'pg'
import {
  canonicalPublicationSignal,
  createLibroPublicationV1,
  createPublicationV2,
  hashPublicationSignal,
  isLibroPublicationV1,
} from '@/lib/world-id/publication'
import { isJsonEqual } from '@/lib/json'
import type { JsonValue } from '@/lib/json'
import type { LibroPublicationV1, PublicationContent, PublicationV2 } from '@/types'

type PublishChallengeLookup = {
  challengeId: string
  draftId: string
  userId: number
}

export type PublishChallengeRow = {
  id: string
  userId: number
  draftId: string
  action: string
  nonce: string
  signal_text: string
  signal_hash: string
  publication: PublicationV2 | LibroPublicationV1
  expires_at: string | Date
  consumed_at: string | Date | null
}

export type PublishDraftRow = {
  id: string
  title: string
  subtitle: string | null
  content: PublicationContent
  status: string
  authorId: string
  author_name: string
  author_handle: string
  author_bio: string | null
}

export async function getLockedPublishChallenge(
  client: PoolClient,
  { challengeId, draftId, userId }: PublishChallengeLookup
): Promise<PublishChallengeRow | null> {
  const { rows } = await client.query(
    `SELECT *
     FROM world_id_publish_challenges
     WHERE id = $1 AND "draftId" = $2 AND "userId" = $3
     FOR UPDATE`,
    [challengeId, draftId, userId]
  )

  return rows[0] || null
}

export async function getLockedDraftForPublish(
  client: PoolClient,
  draftId: string,
  userId: number
): Promise<PublishDraftRow | null> {
  const { rows } = await client.query(
    `SELECT
      d.id,
      d.title,
      d.subtitle,
      d.content,
      d.status,
      d."authorId",
      a.name AS author_name,
      a.handle AS author_handle,
      a.bio AS author_bio
     FROM drafts d
     INNER JOIN authors a ON a.id = d."authorId"
     WHERE d.id = $1 AND d."userId" = $2
     FOR UPDATE`,
    [draftId, userId]
  )

  return rows[0] || null
}

export function assertChallengeCanBeUsed(challenge: PublishChallengeRow, requireUnexpired: boolean): void {
  if (challenge.consumed_at) {
    throw new Error('Publish challenge has already been used')
  }

  if (requireUnexpired && new Date(challenge.expires_at) < new Date()) {
    throw new Error('Publish challenge has expired')
  }
}

export function assertDraftCanBePublished(draft: PublishDraftRow): void {
  if (draft.status !== 'editing') {
    throw new Error('Only editing drafts can be published')
  }
}

export function assertPublicationDateIsFresh(publication: PublicationV2 | LibroPublicationV1): void {
  const publicationDate = new Date(publication.publication_date)
  const now = new Date()
  const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000)

  if (publicationDate > now || publicationDate < fiveMinutesAgo) {
    throw new Error('Invalid publication date')
  }
}

export function assertDraftMatchesChallenge(
  draft: PublishDraftRow,
  challenge: PublishChallengeRow
): PublicationV2 | LibroPublicationV1 {
  const storedPublication = challenge.publication
  const publicationInput = {
    author: {
      id: draft.authorId,
      name: draft.author_name,
      handle: draft.author_handle,
      bio: draft.author_bio || '',
    },
    title: draft.title,
    subtitle: draft.subtitle || '',
    content: draft.content,
    publicationDate: storedPublication.publication_date,
    action: challenge.action,
  }
  const expectedPublication = isLibroPublicationV1(storedPublication)
    ? createLibroPublicationV1(publicationInput)
    : createPublicationV2(publicationInput)
  const expectedSignalText = canonicalPublicationSignal(expectedPublication)
  const expectedSignalHash = hashPublicationSignal(expectedSignalText)

  if (
    expectedSignalText !== challenge.signal_text ||
    expectedSignalHash !== challenge.signal_hash ||
    !isJsonEqual(storedPublication as unknown as JsonValue, expectedPublication as unknown as JsonValue)
  ) {
    throw new Error('Draft, author, or publication content changed after proof challenge creation')
  }

  return storedPublication
}
