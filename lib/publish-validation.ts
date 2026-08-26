import type { PoolClient } from 'pg'
import type { LibroPublicationV1, PublicationAccess, PublicationV2 } from '@/types'
import type { PublicationKind } from '@/lib/publication-kind'

type PublishChallengeLookup = {
  challengeId: string
  draftId: string
  userId: number
}

export type PublishChallengeRow = {
  id: string
  userId: number
  draftId: string
  nonce: string
  session_commitment: string
  signal_text: string
  signal_hash: string
  publication: PublicationV2 | LibroPublicationV1
  expires_at: string | Date
  consumed_at: string | Date | null
}

/**
 * What is still readable about a draft once its prose is encrypted. Title,
 * subtitle, and content are deliberately absent: the publish challenge already
 * holds the signed publication, and it is the only copy that matters here.
 */
export type PublishDraftRow = {
  id: string
  status: string
  authorId: string
  author_name: string
  author_handle: string
  author_bio: string | null
  publicationType: PublicationKind
  /** Not part of the signed payload, so it never participates in challenge matching. */
  access: PublicationAccess
}

/**
 * Removes publish challenges that have finished doing their job.
 *
 * A challenge holds the publication in the clear — it has to, since it is what
 * the proof is taken over — so it is the one place draft prose still sits
 * readable in the database. Consumed rows are redundant the moment the
 * publication exists; expired rows are abandoned publishes. Neither should
 * outlive its purpose by long.
 *
 * The expiry window is deliberately generous: finalize accepts an expired
 * challenge, because a slow chain registration should not cost an author their
 * publication.
 */
export async function cleanupFinishedPublishChallenges(client: PoolClient): Promise<void> {
  await client.query(
    `DELETE FROM world_id_publish_challenges
     WHERE consumed_at < CURRENT_TIMESTAMP - INTERVAL '1 hour'
        OR (consumed_at IS NULL AND expires_at < CURRENT_TIMESTAMP - INTERVAL '1 day')`
  )
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
      d.status,
      d.publication_type AS "publicationType",
      d.access,
      d."authorId",
      a.name AS author_name,
      a.handle AS author_handle,
      a.bio AS author_bio
     FROM drafts d
     INNER JOIN authors a ON a.id = d."authorId" AND a."userId" = d."userId"
     INNER JOIN users u ON u.id = d."userId" AND u.handle = a.handle
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

/**
 * Confirms the challenge still belongs to this draft's author, and returns the
 * publication it holds.
 *
 * Encrypted drafts move the authority for what is being published into the
 * challenge: it is created from the prose the author's browser decrypted, it is
 * locked FOR UPDATE, and it is consumed once. There is no readable draft left to
 * re-derive it from, and re-deriving it never guarded the prose anyway — only
 * the author fields, which are still plaintext and still worth checking, because
 * a handle that changed after the challenge was signed would put a name on the
 * publication that its proof does not support.
 */
export function assertChallengeMatchesAuthor(
  draft: PublishDraftRow,
  challenge: PublishChallengeRow
): PublicationV2 | LibroPublicationV1 {
  const publication = challenge.publication

  if (
    publication.author_id_libro !== draft.authorId ||
    publication.author_name_libro !== draft.author_name ||
    publication.author_handle_libro !== draft.author_handle ||
    publication.author_bio_libro !== (draft.author_bio || '')
  ) {
    throw new Error('Author changed after proof challenge creation')
  }

  return publication
}
