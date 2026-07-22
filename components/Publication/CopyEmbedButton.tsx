'use client'

import { useState } from 'react'
import { Check, Code2, Text } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function CopyEmbedButton({ snippet, textSnippet }: { snippet: string; textSnippet: string }) {
  const [copied, setCopied] = useState<'embed' | 'text' | null>(null)

  const copy = async (value: string, kind: 'embed' | 'text') => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(kind)
      window.setTimeout(() => setCopied(null), 2000)
    } catch {
      setCopied(null)
    }
  }

  return (
    <>
      <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs" onClick={() => copy(textSnippet, 'text')}>
        {copied === 'text' ? <Check className="h-3.5 w-3.5" /> : <Text className="h-3.5 w-3.5" />}
        {copied === 'text' ? 'Text tag copied' : 'Copy text tag'}
      </Button>
      <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs" onClick={() => copy(snippet, 'embed')}>
        {copied === 'embed' ? <Check className="h-3.5 w-3.5" /> : <Code2 className="h-3.5 w-3.5" />}
        {copied === 'embed' ? 'Embed copied' : 'Copy embed'}
      </Button>
    </>
  )
}
