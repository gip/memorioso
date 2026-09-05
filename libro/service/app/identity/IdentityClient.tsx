'use client'

import { useMemo, useState } from 'react'
import {
  CredentialRequest,
  IDKitSessionWidget,
  any as anyCredential,
  type IDKitResultSession,
  type RpContext,
} from '@worldcoin/idkit'

type Context = {
  appId: `app_${string}`
  environment: 'production' | 'staging'
  rpContext: RpContext
  existingSessionId: `session_${string}` | null
}

export function IdentityClient({ continueUrl }: { continueUrl: string }) {
  const [intent, setIntent] = useState<'login' | 'signup'>('login')
  const [handle, setHandle] = useState('')
  const [name, setName] = useState('')
  const [context, setContext] = useState<Context | null>(null)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const constraints = useMemo(() => anyCredential(CredentialRequest('proof_of_human')), [])

  async function begin() {
    setError(null)
    const response = await fetch('/api/v1/identity/context', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ purpose: intent, handle: intent === 'login' ? handle : undefined }),
    })
    const body = await response.json()
    if (!response.ok) {
      setError(body?.error?.message || 'Could not start World ID')
      return
    }
    setContext(body)
    setOpen(true)
  }

  async function verify(payload: IDKitResultSession) {
    const response = await fetch('/api/v1/identity/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload, purpose: intent, handle, name: name || handle }),
    })
    const body = await response.json()
    if (!response.ok) throw new Error(body?.error?.message || 'World ID verification failed')
  }

  return (
    <div className="card">
      <h1>Continue with World ID</h1>
      <p className="muted">Libro uses an Orb-verified World ID session for human authorship.</p>
      <p>
        <button type="button" onClick={() => setIntent('login')} disabled={intent === 'login'}>Sign in</button>{' '}
        <button type="button" onClick={() => setIntent('signup')} disabled={intent === 'signup'}>Create identity</button>
      </p>
      <p><input value={handle} onChange={(event) => setHandle(event.target.value)} placeholder="handle" maxLength={32} /></p>
      {intent === 'signup' && <p><input value={name} onChange={(event) => setName(event.target.value)} placeholder="display name" maxLength={255} /></p>}
      <button type="button" onClick={begin}>{intent === 'login' ? 'Sign in' : 'Create Libro identity'}</button>
      {error && <p role="alert">{error}</p>}
      {context && (
        <IDKitSessionWidget
          key={context.rpContext.nonce}
          open={open}
          onOpenChange={setOpen}
          app_id={context.appId}
          rp_context={context.rpContext}
          environment={context.environment}
          require_user_presence={true}
          existing_session_id={context.existingSessionId || undefined}
          constraints={constraints}
          polling={{ interval: 1000, timeout: 120_000 }}
          handleVerify={verify}
          onError={(code) => setError(`World ID failed: ${code}`)}
          onSuccess={() => { window.location.assign(continueUrl || '/') }}
        />
      )}
    </div>
  )
}
