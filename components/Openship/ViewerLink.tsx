'use client'

import { useEffect, useState } from 'react'

export function openshipViewerUrl(origin: string): string {
  const url = new URL('https://openship.dev/view')
  if (origin) url.searchParams.set('url', new URL(origin).origin)
  url.searchParams.set('view', 'system')
  url.searchParams.set('panel', 'architecture')
  url.searchParams.set('layer', 'logical')
  return url.toString()
}

export default function ViewerLink({ origin }: { origin: string }) {
  const [provider, setProvider] = useState(origin)
  // Inspect the current origin when viewing a local or preview deployment.
  useEffect(() => setProvider(window.location.origin), [])
  return (
    <a className="underline underline-offset-4" href={openshipViewerUrl(provider)}>
      View system design
    </a>
  )
}
