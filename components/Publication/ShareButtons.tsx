'use client'

import { useState } from 'react'
import { Check, Share2, Text } from 'lucide-react'
import { cn } from '@/lib/utils'

// Two share affordances on the authorship badge: the page URL, and (when the
// publication is plain text, not a formatted article) the Libro text tag.
export function ShareButtons({
  textSnippet,
  className,
}: {
  textSnippet: string | null
  className?: string
}) {
  const [copied, setCopied] = useState<'url' | 'text' | null>(null)

  const share = async (kind: 'url' | 'text') => {
    const value = kind === 'url' ? window.location.href : textSnippet
    if (!value) return

    if (navigator.share) {
      try {
        await navigator.share(kind === 'url' ? { url: value } : { text: value })
      } catch {
        // User dismissed the share sheet, or the platform rejected the payload; no fallback needed.
      }
      return
    }

    try {
      await navigator.clipboard.writeText(value)
      setCopied(kind)
      window.setTimeout(() => setCopied(null), 2000)
    } catch {
      setCopied(null)
    }
  }

  return (
    <div className={cn('flex items-center gap-1', className)}>
      <button
        type="button"
        aria-label="Share link"
        title="Share link"
        onClick={() => share('url')}
        className="inline-flex h-6 w-6 items-center justify-center rounded text-zinc-400 transition-colors hover:text-blurple"
      >
        {copied === 'url' ? <Check className="h-3.5 w-3.5 text-blurple" /> : <Share2 className="h-3.5 w-3.5" />}
      </button>
      <button
        type="button"
        aria-label="Share text"
        title={textSnippet ? 'Share text' : 'Not available for formatted articles'}
        disabled={!textSnippet}
        onClick={() => share('text')}
        className="inline-flex h-6 w-6 items-center justify-center rounded text-zinc-400 transition-colors hover:text-blurple disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:text-zinc-400"
      >
        {copied === 'text' ? <Check className="h-3.5 w-3.5 text-blurple" /> : <Text className="h-3.5 w-3.5" />}
      </button>
    </div>
  )
}
