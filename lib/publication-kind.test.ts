import { describe, expect, it } from 'vitest'
import {
  normalizedShortLength,
  publicationKindFromTitle,
  publicationPath,
  validatePublicationForKind,
} from './publication-kind'

describe('publication kinds', () => {
  it('derives the published kind from the signed title', () => {
    expect(publicationKindFromTitle('An article')).toBe('article')
    expect(publicationKindFromTitle('   ')).toBe('short')
    expect(publicationPath('short', 57)).toBe('/short/57')
  })

  it('accepts plain shorts and rejects formatting and images', () => {
    expect(validatePublicationForKind({
      kind: 'short',
      title: '',
      subtitle: '',
      content: { html: '<p>Hello<br>world</p>' },
    })).toBeNull()
    expect(validatePublicationForKind({
      kind: 'short',
      title: '',
      subtitle: '',
      content: { html: '<p>Hello <strong>world</strong></p>' },
    })).toBe('Shorts can contain only plain text and line breaks')
    expect(validatePublicationForKind({
      kind: 'short',
      title: '',
      subtitle: '',
      content: { html: '<p>Hello<img src="data:image/png;base64,AA=="></p>' },
    })).toBe('Shorts can contain only plain text and line breaks')
  })

  it('counts normalized Unicode code points and enforces 500 characters', () => {
    expect(normalizedShortLength({ html: '<p>Cafe\u0301</p>' })).toBe(4)
    expect(validatePublicationForKind({
      kind: 'short',
      title: '',
      content: { html: `<p>${'a'.repeat(500)}</p>` },
    })).toBeNull()
    expect(validatePublicationForKind({
      kind: 'short',
      title: '',
      content: { html: `<p>${'a'.repeat(501)}</p>` },
    })).toBe('Shorts are limited to 500 characters')
  })

  it('requires both an article title and readable body', () => {
    expect(validatePublicationForKind({
      kind: 'article',
      title: 'Title',
      content: { html: '<p>Body</p>' },
    })).toBeNull()
    expect(validatePublicationForKind({
      kind: 'article',
      title: 'Title',
      content: { html: '<p><br></p>' },
    })).toBe('Article body is required')
  })
})
