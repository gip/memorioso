'use client'

import { Check, ChevronDown, Copy, Download } from 'lucide-react'
import { useState } from 'react'

// The verification script: collapsed by default so the page stays readable,
// one click away for anyone who actually wants to run it.
export const CodeCard = ({ code, filename }: { code: string; filename: string }) => {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const lines = code.split('\n').length

  const download = () => {
    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-zinc-200">
      <div className="flex items-center justify-between gap-3 bg-zinc-50 px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="flex min-w-0 items-center gap-2 text-[13px] text-zinc-600 transition-colors hover:text-foreground"
        >
          <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? '' : '-rotate-90'}`} />
          <span className="truncate font-mono">{filename}</span>
          <span className="shrink-0 text-zinc-400">{lines} lines</span>
        </button>
        <div className="flex shrink-0 items-center gap-3">
          <button
            type="button"
            onClick={download}
            className="inline-flex shrink-0 items-center gap-1.5 text-[13px] text-zinc-500 transition-colors hover:text-blurple"
          >
            <Download className="h-3.5 w-3.5" />
            Download
          </button>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(code)
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            }}
            className="inline-flex shrink-0 items-center gap-1.5 text-[13px] text-zinc-500 transition-colors hover:text-blurple"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-blurple" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>
      {open && (
        <pre className="max-h-[26rem] overflow-auto border-t border-zinc-200 bg-white px-3 py-3 font-mono text-[12px] leading-[1.6] text-zinc-800">
          <code>{code}</code>
        </pre>
      )}
    </div>
  )
}
