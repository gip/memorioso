import { describe, expect, it } from 'vitest'
import {
  assertChallengeCanBeUsed,
  assertChallengeMatchesAuthor,
  assertDraftCanBePublished,
  type PublishChallengeRow,
  type PublishDraftRow,
} from './publish-validation'
import { canonicalPublicationSignal, createLibroPublicationV1, hashPublicationSignal } from './world-id/publication'

const draft: PublishDraftRow = {
  id: 'draft-1',
  status: 'editing',
  authorId: 'author-1',
  author_name: 'Ada',
  author_handle: 'ada',
  author_bio: null,
  publicationType: 'short',
  access: 'public',
}

function challengeForDraft(row: PublishDraftRow): PublishChallengeRow {
  const publication = createLibroPublicationV1({
    author: { id: row.authorId, name: row.author_name, handle: row.author_handle, bio: row.author_bio || '' },
    title: '',
    subtitle: '',
    content: { html: '<p>Readable body</p>' },
    publicationDate: '2026-07-21T12:00:00.000Z',
  })
  const signalText = canonicalPublicationSignal(publication)
  return {
    id: 'challenge-1',
    userId: 1,
    draftId: row.id,
    nonce: '0x1',
    session_commitment: '0x2',
    signal_text: signalText,
    signal_hash: hashPublicationSignal(signalText),
    publication,
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    consumed_at: null,
  }
}

describe('assertDraftCanBePublished', () => {
  it('accepts a draft that is still being edited', () => {
    expect(() => assertDraftCanBePublished(draft)).not.toThrow()
  })

  it('rejects a draft that was already published', () => {
    expect(() => assertDraftCanBePublished({ ...draft, status: 'published' }))
      .toThrow('Only editing drafts can be published')
  })
})

describe('assertChallengeMatchesAuthor', () => {
  it('returns the publication the challenge holds', () => {
    const challenge = challengeForDraft(draft)

    expect(assertChallengeMatchesAuthor(draft, challenge)).toBe(challenge.publication)
  })

  it('rejects an author renamed after the challenge was signed', () => {
    const challenge = challengeForDraft(draft)

    expect(() => assertChallengeMatchesAuthor({ ...draft, author_name: 'Grace' }, challenge))
      .toThrow('Author changed after proof challenge creation')
  })

  it('rejects a handle that changed after the challenge was signed', () => {
    const challenge = challengeForDraft(draft)

    expect(() => assertChallengeMatchesAuthor({ ...draft, author_handle: 'grace' }, challenge))
      .toThrow('Author changed after proof challenge creation')
  })

  it('rejects a bio that changed after the challenge was signed', () => {
    const challenge = challengeForDraft(draft)

    expect(() => assertChallengeMatchesAuthor({ ...draft, author_bio: 'Rewritten' }, challenge))
      .toThrow('Author changed after proof challenge creation')
  })

  it('rejects a challenge belonging to another author', () => {
    const challenge = challengeForDraft(draft)

    expect(() => assertChallengeMatchesAuthor({ ...draft, authorId: 'author-2' }, challenge))
      .toThrow('Author changed after proof challenge creation')
  })

  it('treats a null bio and an empty bio as the same', () => {
    const challenge = challengeForDraft({ ...draft, author_bio: null })

    expect(() => assertChallengeMatchesAuthor({ ...draft, author_bio: '' }, challenge)).not.toThrow()
  })
})

describe('assertChallengeCanBeUsed', () => {
  it('rejects a challenge that was already consumed', () => {
    const challenge = challengeForDraft(draft)

    expect(() => assertChallengeCanBeUsed({ ...challenge, consumed_at: new Date().toISOString() }, false))
      .toThrow('Publish challenge has already been used')
  })

  it('rejects an expired challenge only when freshness is required', () => {
    const expired: PublishChallengeRow = {
      ...challengeForDraft(draft),
      expires_at: new Date(Date.now() - 60_000).toISOString(),
    }

    expect(() => assertChallengeCanBeUsed(expired, true)).toThrow('Publish challenge has expired')
    expect(() => assertChallengeCanBeUsed(expired, false)).not.toThrow()
  })
})
