import { describe, expect, it } from 'vitest'
import { extractReadableText } from '@libro/core'
import { inlineTextToHtml, normalizeInlineSigningText } from '../inline'

describe('inline Libro text', () => {
  it('escapes markup while preserving paragraphs and line breaks', () => {
    const source = 'Café & <human>\nsecond line\n\nnext paragraph'
    const html = inlineTextToHtml(source)
    expect(html).toBe('<p>Café &amp; &lt;human&gt;<br>second line</p><p>next paragraph</p>')
    expect(extractReadableText(html)).toBe(normalizeInlineSigningText(source))
  })

  it('normalizes NFC, non-breaking spaces, and whitespace for signing', () => {
    expect(normalizeInlineSigningText('  Cafe\u0301\u00a0\n note  ')).toBe('Café note')
  })
})
