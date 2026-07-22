'use client'

import { useState } from 'react'
import { Check, Code2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function CopyEmbedButton({ snippet }: { snippet: string }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(snippet)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs" onClick={copy}>
      {copied ? <Check className="h-3.5 w-3.5" /> : <Code2 className="h-3.5 w-3.5" />}
      {copied ? 'Embed copied' : 'Copy embed'}
    </Button>
  )
}
