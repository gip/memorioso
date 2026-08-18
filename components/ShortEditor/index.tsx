'use client'

import { useEffect, useState } from 'react'
import { Textarea } from '@/components/ui/textarea'
import {
  MEMORIOSO_SHORT_MAX_LENGTH,
} from '@/lib/publication-kind'
import { inlineTextToHtml, normalizeInlineSigningText } from '@/lib/libro/inline'

function textFromHtml(html: string): string {
  if (typeof DOMParser === 'undefined') return ''
  const document = new DOMParser().parseFromString(html, 'text/html')
  const read = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || ''
    if (!(node instanceof HTMLElement)) return ''
    if (node.tagName === 'BR') return '\n'
    const text = Array.from(node.childNodes).map(read).join('')
    return node.tagName === 'P' ? `${text}\n\n` : text
  }
  return Array.from(document.body.childNodes).map(read).join('').replace(/\n{2}$/, '')
}

export function ShortEditor({
  initialHtml,
  onChange,
  disabled = false,
}: {
  initialHtml: string
  onChange: (content: { html: string }) => void
  disabled?: boolean
}) {
  const [text, setText] = useState('')

  useEffect(() => {
    setText(textFromHtml(initialHtml))
  }, [initialHtml])

  const length = Array.from(normalizeInlineSigningText(text)).length

  return (
    <div className="space-y-2 py-6">
      <Textarea
        value={text}
        onChange={(event) => {
          const next = event.target.value
          if (Array.from(normalizeInlineSigningText(next)).length > MEMORIOSO_SHORT_MAX_LENGTH) return
          setText(next)
          onChange({ html: inlineTextToHtml(next) })
        }}
        placeholder="What do you want to say?"
        autoFocus
        readOnly={disabled}
        className="min-h-48 resize-y border-0 px-0 text-xl leading-relaxed shadow-none focus-visible:ring-0"
      />
      <div className="text-right text-xs text-muted-foreground">
        {length}/{MEMORIOSO_SHORT_MAX_LENGTH}
      </div>
    </div>
  )
}
