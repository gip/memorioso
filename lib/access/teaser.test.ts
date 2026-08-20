import { describe, expect, it } from 'vitest'
import { extractReadableText } from '@libro/core'
import { buildGatedTeaser, buildPublicationTeaser, PUBLICATION_TEASER_MAX_CHARS } from './teaser'

const longBody = `<p>${'word '.repeat(200)}</p>`

describe('buildPublicationTeaser', () => {
  it('returns a short body whole', () => {
    expect(buildPublicationTeaser('<p>Two short lines.</p>')).toBe('Two short lines.')
  })

  it('never emits markup', () => {
    const teaser = buildPublicationTeaser(
      '<p>Opening line with <strong>emphasis</strong> and a <a href="https://example.com">link</a>.</p>'
    )
    expect(teaser).toBe('Opening line with emphasis and a link.')
    expect(teaser).not.toMatch(/[<>]/)
  })

  it('drops an image in the opening block instead of leaking its source', () => {
    const teaser = buildPublicationTeaser('<p><img src="https://example.com/secret.png" alt="secret" /></p>')
    expect(teaser).not.toContain('secret.png')
    expect(teaser).not.toContain('img')
  })

  it('truncates on a word boundary and marks the cut', () => {
    const teaser = buildPublicationTeaser(longBody)
    expect(teaser.length).toBeLessThanOrEqual(PUBLICATION_TEASER_MAX_CHARS + 1)
    expect(teaser.endsWith('…')).toBe(true)
    expect(teaser).not.toMatch(/\s…$/)
  })

  it('withholds the tail of the body', () => {
    const body = `<p>${'filler '.repeat(80)}SENTINEL</p>`
    expect(buildPublicationTeaser(body)).not.toContain('SENTINEL')
  })

  it('decodes entities rather than passing them through', () => {
    expect(buildPublicationTeaser('<p>Caf́e&nbsp;notes</p>')).not.toContain('&nbsp;')
  })

  it('handles an empty body', () => {
    expect(buildPublicationTeaser('')).toBe('')
  })
})

describe('buildGatedTeaser', () => {
  it('matches the plain teaser for a normal-length article', () => {
    expect(buildGatedTeaser(longBody)).toBe(buildPublicationTeaser(longBody))
  })

  // Gating an unusually short article must still withhold something.
  it('never reveals a whole short body', () => {
    const short = '<p>Only two short sentences here. And that is the whole thing.</p>'
    const teaser = buildGatedTeaser(short)
    expect(teaser).not.toContain('the whole thing')
    expect(teaser.length).toBeLessThan(extractReadableText(short).length)
  })

  it('withholds even a two-character body', () => {
    expect(buildGatedTeaser('<p>Hi</p>')).not.toContain('Hi')
  })
})
