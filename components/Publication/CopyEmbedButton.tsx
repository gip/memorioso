'use client'

import { useState } from 'react'
import { Check, Code2, Text } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export function CopyEmbedButton({
  snippet,
  textSnippet,
  vertical = false,
}: {
  snippet: string
  textSnippet: string
  vertical?: boolean
}) {
  const [copied, setCopied] = useState<'html' | 'text' | null>(null)

  const copy = async (value: string, kind: 'html' | 'text') => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(kind)
      window.setTimeout(() => setCopied(null), 2000)
    } catch {
      setCopied(null)
    }
  }

  return (
    <div className={cn('flex gap-1', vertical && 'w-full flex-col')}>
      <Button
        variant="ghost"
        size="sm"
        className={cn('h-8 gap-1.5 px-2 text-xs', vertical && 'w-full justify-start')}
        onClick={() => copy(textSnippet, 'text')}
      >
        {copied === 'text' ? <Check className="h-3.5 w-3.5" /> : <Text className="h-3.5 w-3.5" />}
        {copied === 'text' ? 'Text tag copied' : 'Copy text tag'}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className={cn('h-8 gap-1.5 px-2 text-xs', vertical && 'w-full justify-start')}
        onClick={() => copy(snippet, 'html')}
      >
        {copied === 'html' ? <Check className="h-3.5 w-3.5" /> : <Code2 className="h-3.5 w-3.5" />}
        {copied === 'html' ? 'HTML copied' : 'Copy HTML'}
      </Button>
    </div>
  )
}
