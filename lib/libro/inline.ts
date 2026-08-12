import { LIBRO_INLINE_TEXT_MAX_LENGTH, normalizeReadableText } from '@libro/core'

export const MAX_INLINE_TEXT_LENGTH = LIBRO_INLINE_TEXT_MAX_LENGTH

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function normalizeInlineSigningText(value: string): string {
  return normalizeReadableText(value)
}

export function inlineTextToHtml(value: string): string {
  const normalizedLines = value
    .normalize('NFC')
    .replace(/\u00a0/gu, ' ')
    .replace(/\r\n?/g, '\n')
    .trim()
  return normalizedLines
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('')
}
