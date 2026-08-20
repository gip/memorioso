import { describe, expect, it } from 'vitest'
import { mapPublicationInfoRow } from './objects'
import { PUBLICATION_TEASER_MAX_CHARS } from '@/lib/access/teaser'

const body = `<p>${'filler '.repeat(120)}SENTINEL</p>`

const row = (access: 'public' | 'gated') => ({
  id: '42',
  access,
  proof_type: 'session',
  author_id_libro: 'author-1',
  publication_date: '2026-08-18T00:00:00.000Z',
  author_name_libro: 'Ada',
  publication_title: 'A gated article',
  publication_subtitle: '',
  content_html: body,
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

  it('labels an agent-signed publication from the proof type column', () => {
    const info = mapPublicationInfoRow({
      ...row('public'),
      proof_type: 'human_authorized_agent_signature',
    })
    expect(info.authorship_label).toBe('Human-authorized agent')
  })

  // The feed query selects only the head of the body, so the mapper has to cope with a
  // row whose content column came back empty rather than assume a full signal payload.
  it('survives a row with no body', () => {
    const info = mapPublicationInfoRow({ ...row('public'), content_html: null })
    expect(info.publication_excerpt).toBe('')
    expect(info.publication_title).toBe('A gated article')
  })

  it('derives the publication type from a missing title', () => {
    const info = mapPublicationInfoRow({ ...row('public'), publication_title: null })
    expect(info.publication_type).toBe('short')
    expect(info.publication_title).toBe('')
  })
})
