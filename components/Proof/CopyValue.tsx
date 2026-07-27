'use client'

import { Check, Copy } from 'lucide-react'
import { useState } from 'react'

// Copies a full hash/address while the page only shows a shortened form.
export const CopyValue = ({ value, label }: { value: string; label: string }) => {
  const [copied, setCopied] = useState(false)

  return (
    <button
      type="button"
      aria-label={`Copy ${label}`}
      title={value}
      onClick={() => {
        navigator.clipboard.writeText(value)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
      className="inline-flex h-5 w-5 items-center justify-center rounded text-zinc-400 transition-colors hover:text-blurple"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-blurple" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  )
}
