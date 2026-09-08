'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { SigningClient } from './SigningClient'
import { AgentSigningClient } from './AgentSigningClient'
import { ClaimClient } from './ClaimClient'

type Review = {
  clientId?: string; displayName?: string; resource?: string; scope?: string[]; consent?: string
  handle?: string; controller?: string; agent?: string; expiresAt?: string; signal?: string
  publication?: { publication_title: string; publication_subtitle: string; publication_content: { html: string }; author_name_libro: string; author_handle_libro: string }
}

export function BrowserFlow({ kind, capability, query }: { kind: string; capability?: string; query: string }) {
  const [review, setReview] = useState<Review | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const path = kind === 'authorize' ? `/oauth/authorize?${query}` : `/api/v1/browser/${kind}/${encodeURIComponent(capability || '')}`
  useEffect(() => {
    let active = true
    setError('')
    fetch(`/api/libro/browser${path}`, { cache: 'no-store' }).then(async (response) => {
      const body = await response.json()
      if (!active) return
      if (response.status === 401) {
        window.location.assign(`/libro/identity?continue=${encodeURIComponent(window.location.href)}`)
        return
      }
      if (!response.ok) throw new Error(body?.error?.message || 'Could not load this request')
      if (kind === 'authorize') {
        const connected = await fetch('/api/libro/browser/oauth/authorize', {
          method: 'POST', body: new URLSearchParams({ consent: body.consent }),
        })
        const result = await connected.json()
        if (!active) return
        if (!connected.ok) throw new Error(result?.error?.message || 'Could not connect this application')
        window.location.assign(result.redirectUrl)
        return
      }
      setReview(body)
    }).catch((error) => { if (active) setError(error instanceof Error ? error.message : 'Could not load this request') })
    return () => { active = false }
  }, [path, attempt, kind])

  return <div className="space-y-4 py-8">
    {error && <div role="alert"><p>{error}</p><Button onClick={() => { setReview(null); setAttempt((value) => value + 1) }}>Try again</Button></div>}
    {!review && !error && <p>{kind === 'authorize' ? 'Connecting…' : 'Loading request…'}</p>}
    {review?.publication && kind === 'sign' && <>
      <h1 className="text-xl font-semibold">{review.publication.publication_title || 'Untitled short'}</h1>
      {review.publication.publication_subtitle && <p>{review.publication.publication_subtitle}</p>}
      <p>By {review.publication.author_name_libro} (@{review.publication.author_handle_libro})</p>
      <h2>Review your publication</h2>
      <pre className="whitespace-pre-wrap break-words">{review.publication.publication_content.html}</pre>
      <SigningClient capability={capability!} />
    </>}
    {review && kind === 'sign-agent' && <>
      <h1 className="text-xl font-semibold">Authorize an agent for @{review.handle}</h1>
      <p>Controller: {review.controller}</p><p>Agent key: {review.agent}</p>
      <p>Scope: publish agent documents</p><p>Valid until: {review.expiresAt}</p>
      <AgentSigningClient capability={capability!} signal={review.signal!} />
    </>}
    {review && kind === 'claim' && <>
      <h1 className="text-xl font-semibold">Claim @{review.handle}</h1>
      <p>This permanently binds the handle to your World ID.</p>
      <ClaimClient capability={capability!} signal={review.signal!} />
    </>}
  </div>
}
