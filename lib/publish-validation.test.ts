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
}

describe('publish draft validation', () => {
  it('accepts a title or readable body content', () => {
    expect(() => assertDraftCanBePublished(draft)).not.toThrow()
    expect(() => assertDraftCanBePublished({
      ...draft,
      title: 'Title only',
      content: { html: '<p><br></p>' },
    })).not.toThrow()
  })

  it('rejects a draft when both title and body are empty', () => {
    expect(() => assertDraftCanBePublished({
      ...draft,
      title: '   ',
      content: { html: '<p><br></p>' },
    })).toThrow('Publication must include a title or readable content')
  })
})
