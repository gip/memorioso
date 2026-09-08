'use client'

import { useEffect, useMemo, useState } from 'react'
import { CredentialRequest, IDKitSessionWidget, any as anyCredential, type IDKitResultSession, type RpContext } from '@worldcoin/idkit'
import { WorldIdLoginDialog } from '@/components/WorldIdLoginDialog'

type Context = { appId: `app_${string}`; environment: 'production' | 'staging'; rpContext: RpContext; existingSessionId: `session_${string}` | null }
const base = '/api/libro/browser/api/v1/identity'

export function IdentityClient({ continueUrl }: { continueUrl: string }) {
  const [continueAs, setContinueAs] = useState<string | null>(null)
  const [pending, setPending] = useState<{ handle: string; intent: 'login' | 'signup' } | null>(null)
  const [context, setContext] = useState<Context | null>(null)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const constraints = useMemo(() => anyCredential(CredentialRequest('proof_of_human')), [])
  useEffect(() => {
    let active = true
    fetch(`${base}/hint`, { cache: 'no-store' }).then(async (response) => {
      if (!response.ok) return
      const body = await response.json()
      if (active) setContinueAs(body.continueAs)
    }).catch(() => undefined)
    return () => { active = false }
  }, [])

  async function begin(handle: string, intent: 'login' | 'signup') {
    setError(null)
    try {
      const response = await fetch(`${base}/context`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ purpose: intent, handle: intent === 'login' ? handle : undefined }) })
      const body = await response.json()
      if (!response.ok) throw new Error(body?.error?.message || 'Could not start World ID')
      setPending({ handle, intent }); setContext(body); setOpen(true)
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not start World ID')
      throw error
    }
  }

  async function verify(payload: IDKitResultSession) {
    if (!pending) throw new Error('World ID login context is missing')
    const response = await fetch(`${base}/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload, purpose: pending.intent, handle: pending.handle }) })
    const body = await response.json()
    if (!response.ok) {
      const message = body?.error?.message || 'World ID verification failed'
      setError(message)
      throw new Error(message)
    }
  }

  return <>
    <WorldIdLoginDialog open={!open} onOpenChange={(value) => { if (!value) window.location.assign('/') }}
      onLogin={(handle) => begin(handle, 'login')} onSignup={(handle) => begin(handle, 'signup')}
      onContinue={() => continueAs ? begin(continueAs, 'login') : Promise.resolve()}
      continueAs={continueAs} error={error} lookupUrl={`${base}/handle`} />
    {context && <IDKitSessionWidget key={context.rpContext.nonce} open={open} onOpenChange={setOpen}
      app_id={context.appId} rp_context={context.rpContext} environment={context.environment}
      require_user_presence={true} existing_session_id={context.existingSessionId || undefined}
      constraints={constraints} polling={{ interval: 1000, timeout: 120_000 }} handleVerify={verify}
      onError={(code) => setError((current) => current || `World ID login failed: ${code}`)}
      onSuccess={() => {
        const destination = new URL(continueUrl, window.location.origin)
        window.location.assign(destination.origin === window.location.origin ? destination.toString() : '/')
      }} />}
  </>
}
