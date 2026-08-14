import { describe, expect, it } from 'vitest'
import { assertDraftCanBePublished, type PublishDraftRow } from './publish-validation'

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
