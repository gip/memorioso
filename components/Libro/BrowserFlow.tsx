'use client'

import { browserMcp } from '@/lib/libro-service/browser-mcp'
import { LibroMcpError } from '@libro/core'

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
  useEffect(() => {
    let active = true
    setError('')
    const load = async () => {
      if (kind !== 'authorize') return browserMcp<Review>('browser_review', { kind, capability })
      return browserMcp<Review>('oauth_authorization_context', { query })
    }
    load().then(async (body) => {
      if (!active) return
      if (kind === 'authorize') {
        const result = await browserMcp<{ redirectUrl: string }>('oauth_authorize', { consent: body.consent })
        if (!active) return
        window.location.assign(result.redirectUrl)
        return
      }
      setReview(body)
    }).catch((error) => {
      if (!active) return
      if (error instanceof LibroMcpError && error.status === 401) {
        window.location.assign(`/libro/identity?continue=${encodeURIComponent(window.location.href)}`)
      } else setError(error instanceof Error ? error.message : 'Could not load this request')
    })
    return () => { active = false }
  }, [query, capability, attempt, kind])

  return <div className="space-y-4 py-8">
    {error && <div role="alert"><p>{error}</p><Button onClick={() => { setReview(null); setAttempt((value) => value + 1) }}>Try again</Button></div>}
    {!review && !error && <p>{kind === 'authorize' ? 'Connecting…' : 'Loading request…'}</p>}
    {review?.publication && kind === 'sign' && <>
      <h1 className="text-xl font-semibold">{review.publication.publication_title || 'Untitled short'}</h1>
      {review.publication.publication_subtitle && <p>{review.publication.publication_subtitle}</p>}
      <p>By {review.publication.author_name_libro} (@{review.publication.author_handle_libro})</p>
      <h2>Review your publication</h2>
      <pre className="whitespace-pre-wrap break-words">{review.publication.publication_content.html}</pre>
      <SigningClient key={capability} capability={capability!} />
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
