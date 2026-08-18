import { describe, expect, it } from 'vitest'
import {
  assertDraftCanBePublished,
  assertDraftMatchesChallenge,
  type PublishChallengeRow,
  type PublishDraftRow,
} from './publish-validation'
import { canonicalPublicationSignal, createLibroPublicationV1, hashPublicationSignal } from './world-id/publication'

const draft: PublishDraftRow = {
  id: 'draft-1',
  title: '',
  subtitle: '',
  content: { html: '<p>Readable body</p>' },
  status: 'editing',
  authorId: 'author-1',
  author_name: 'Ada',
  author_handle: 'ada',
  author_bio: null,
  publicationType: 'short',
}

function challengeForDraft(row: PublishDraftRow): PublishChallengeRow {
  const publication = createLibroPublicationV1({
    author: { id: row.authorId, name: row.author_name, handle: row.author_handle, bio: row.author_bio || '' },
    title: row.title,
    subtitle: row.subtitle || '',
    content: row.content,
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

describe('publish draft validation', () => {
  it('accepts valid shorts and articles', () => {
    expect(() => assertDraftCanBePublished(draft)).not.toThrow()
    expect(() => assertDraftCanBePublished({
      ...draft,
      publicationType: 'article',
      title: 'An article',
      content: { html: '<p>Readable body</p>' },
    })).not.toThrow()
  })

  it('rejects empty shorts and articles without bodies', () => {
    expect(() => assertDraftCanBePublished({
      ...draft,
      title: '   ',
      content: { html: '<p><br></p>' },
    })).toThrow('Shorts can contain only plain text and line breaks')
    expect(() => assertDraftCanBePublished({
      ...draft,
      publicationType: 'article',
      title: 'Title only',
      content: { html: '<p><br></p>' },
    })).toThrow('Article body is required')
  })
})

describe('assertDraftMatchesChallenge', () => {
  it('accepts a draft that still matches the challenge it was signed against', () => {
    const challenge = challengeForDraft(draft)
    expect(() => assertDraftMatchesChallenge(draft, challenge)).not.toThrow()
  })

  it('rejects a draft whose content changed after the challenge was created', () => {
    const challenge = challengeForDraft(draft)
    const editedDraft: PublishDraftRow = { ...draft, content: { html: '<p>Edited after signing</p>' } }
    expect(() => assertDraftMatchesChallenge(editedDraft, challenge))
      .toThrow('Draft, author, or publication content changed after proof challenge creation')
  })

  it('rejects a challenge whose stored publication was tampered with', () => {
    const challenge = challengeForDraft(draft)
    const tamperedChallenge: PublishChallengeRow = {
      ...challenge,
      publication: { ...challenge.publication, publication_title: 'Swapped title' },
    }
    expect(() => assertDraftMatchesChallenge(draft, tamperedChallenge))
      .toThrow('Draft, author, or publication content changed after proof challenge creation')
  })
})
