import { extractReadableText } from '@libro/core'

/** Roughly the first two lines of an article at the published body width. */
export const PUBLICATION_TEASER_MAX_CHARS = 240

/**
 * A gated teaser never shows more than this share of the body, so gating an unusually
 * short article still withholds something instead of silently revealing all of it.
 */
export const GATED_TEASER_MAX_FRACTION = 0.5

/**
 * A teaser is plain text, never truncated HTML. Cutting markup risks unbalanced
 * tags, and an image inside the opening blocks would leak the gated body outright.
 */
export function buildPublicationTeaser(
  html: string,
  maxChars: number = PUBLICATION_TEASER_MAX_CHARS
): string {
  const text = extractReadableText(html)
  if (text.length <= maxChars) return text

  const window = text.slice(0, maxChars)
  const lastBreak = window.lastIndexOf(' ')
  const cut = lastBreak > maxChars * 0.6 ? window.slice(0, lastBreak) : window
  return `${cut.replace(/[\s.,;:!?-]+$/, '')}…`
}

/** The teaser for a body that is being withheld. Always shows strictly less than all of it. */
export function buildGatedTeaser(html: string): string {
  const full = extractReadableText(html)
  const cap = Math.min(
    PUBLICATION_TEASER_MAX_CHARS,
    Math.floor(full.length * GATED_TEASER_MAX_FRACTION)
  )
  return buildPublicationTeaser(html, Math.max(cap, 0))
}
