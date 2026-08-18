import { describe, expect, it } from 'vitest'
import { mapPublicationInfoRow } from './objects'
import { PUBLICATION_TEASER_MAX_CHARS } from '@/lib/access/teaser'

const body = `<p>${'filler '.repeat(120)}SENTINEL</p>`

const row = (access: 'public' | 'gated') => ({
  id: '42',
  access,
  proof: { protocol_version: '4.0' } as never,
  signal: {
    author_id_libro: 'author-1',
    publication_date: '2026-08-18T00:00:00.000Z',
    author_name_libro: 'Ada',
    author_handle_libro: 'ada',
    author_bio_libro: '',
    publication_title: 'A gated article',
    publication_subtitle: '',
    publication_content: { html: body },
  } as never,
})

describe('mapPublicationInfoRow', () => {
  it('returns the whole readable body for a public publication', () => {
    const info = mapPublicationInfoRow(row('public'))
    expect(info.access).toBe('public')
    expect(info.publication_excerpt).toContain('SENTINEL')
  })

  // Feeds are unauthenticated, so a gated body must never leave the server in full.
  it('truncates a gated publication to a teaser', () => {
    const info = mapPublicationInfoRow(row('gated'))
    expect(info.access).toBe('gated')
    expect(info.publication_excerpt).not.toContain('SENTINEL')
    expect(info.publication_excerpt.length).toBeLessThanOrEqual(PUBLICATION_TEASER_MAX_CHARS + 1)
  })

  it('keeps title and subtitle visible when gated', () => {
    const info = mapPublicationInfoRow(row('gated'))
    expect(info.publication_title).toBe('A gated article')
  })

  it('treats an unknown access value as public', () => {
    const info = mapPublicationInfoRow({ ...row('public'), access: 'nonsense' as never })
    expect(info.access).toBe('public')
  })
})
