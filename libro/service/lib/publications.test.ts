import { beforeEach, describe, expect, it, vi } from 'vitest'
import { extractReadableText } from '@libro/core'

const query = vi.hoisted(() => vi.fn())
vi.mock('./db', () => ({ pool: { query } }))
import { listPublications, publicationExcerpt } from './publications'

const row = {
  id: '42', author_id: 'author', signal_hash: '0x1234', authorship_class: 'human', legacy_proof: false,
  publication_date: '2026-09-01T10:00:00+01:00', author_name: 'Ada', publication_title: 'A title',
  publication_subtitle: '', modified_at: '2026-09-01T09:00:00Z', feed_excerpt: 'Human writing.', excerpt_html: null,
}

describe('lightweight Libro summaries', () => {
  beforeEach(() => query.mockReset())

  it.each([
    ['nested HTML', '<p>Hello <strong>human</strong></p><p>world.</p>'],
    ['Unicode and entities', '<p>Cafe\u0301&nbsp;notes &amp; ideas</p>'],
    ['long text', `<p>${'word '.repeat(90)}</p>`],
    ['large opening image', `<img src="data:image/png;base64,${'a'.repeat(280_000)}"><p>The text after a large image.</p>`],
    ['empty text', '<p></p>'],
  ])('preserves the previous exact excerpt for %s', (_name, html) => {
    const text = extractReadableText(html)
    const previous = text.length > 240 ? `${text.slice(0, 239).trimEnd()}…` : text
    expect(publicationExcerpt(html)).toBe(previous)
  })

  it('returns the same metadata without selecting a complete proof or signal', async () => {
    query.mockResolvedValue({ rows: [{ ...row }] })
    expect(await listPublications({ limit: 6, offset: 5, kind: 'article', originClientId: 'memorioso' })).toEqual([{
      id: '42', authorId: 'author', signalHash: '0x1234', authorshipClass: 'human', legacyProof: false,
      publicationDate: row.publication_date, authorName: 'Ada', title: 'A title', subtitle: '',
      revision: { rootPublicationId:'42', previousPublicationId:null, latestPublicationId:'42', initiallyPublishedAt:'2026-09-01T09:00:00.000Z', revisionNumber:1, isLatest:false, statusAvailable:false },
      excerpt: 'Human writing.', publicationType: 'article', modifiedAt: '2026-09-01T09:00:00.000Z',
    }])
    expect(query).toHaveBeenCalledTimes(2)
    const [sql, values] = query.mock.calls[0]
    expect(sql).not.toMatch(/SELECT \*|p\.proof\s*,/)
    expect(sql).toContain("AS registry_address")
    expect(sql).toContain('CASE WHEN feed_excerpt IS NULL')
    expect(values).toEqual([6, 5, null, 'memorioso', 'article', false])
  })

  it('fills missing historical and copied excerpts once without rewriting signed data or dates', async () => {
    query.mockResolvedValueOnce({ rows: [
      { ...row, id: '1', feed_excerpt: null, excerpt_html: '<p>Legacy &amp; text.</p>', legacy_proof: true },
      { ...row, id: '2', publication_title: '', feed_excerpt: null, excerpt_html: '<p>Short text.</p>', authorship_class: 'agent' },
      { ...row, id: '3', feed_excerpt: '', excerpt_html: null },
    ] }).mockResolvedValue({ rows: [] })
    const summaries = await listPublications({ limit: 10, offset: 0 })
    expect(summaries[0]).toMatchObject({ legacyProof: true, excerpt: 'Legacy & text.' })
    expect(summaries[1]).toMatchObject({ authorshipClass: 'agent', publicationType: 'short', excerpt: 'Short text.' })
    expect(summaries[2].excerpt).toBe('')
    expect(query.mock.calls[1][1]).toEqual([['1', '2'], ['Legacy & text.', 'Short text.'], ['0x1234', '0x1234']])
    expect(query.mock.calls[1][0]).not.toMatch(/SET signal|SET proof|modified_at\s*=/)
  })
})
