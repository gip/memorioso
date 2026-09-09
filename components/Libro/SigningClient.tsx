'use client'

import { WorldIdSessionWidget } from '@/components/WorldIdSessionWidget'

import { Button } from '@/components/ui/button'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CredentialRequest,
  type IDKitResultSession,
  type RpContext,
} from '@worldcoin/idkit'
import { sendSponsoredWorldTransaction } from '@/lib/libro-service/sponsored-transaction'
import { waitForUserOperation } from '@/lib/libro-service/wallet-receipt'

type SigningContext = {
  appId: `app_${string}`
  environment: 'production' | 'staging'
  rpContext: RpContext
  signalHash: string
  signalText: string
  existingSessionId: `session_${string}`
}

type Prepared = { registrationId: string; transaction: Transaction; transactionHash?: string; publicationId?: string; userOpHash?: string; submissionMethod?: 'world_wallet' | 'libro_relayer' }

type Transaction = {
  chainId: number
  transactions: Array<{ to: string; data: string; value: string }>
}

async function responseBody(response: Response) {
  const body = await response.json().catch(() => null)
  if (response.status === 401) {
    window.location.assign(`/libro/identity?continue=${encodeURIComponent(window.location.href)}`)
    throw new Error('Verify your identity to continue')
  }
  if (!response.ok) throw new Error(body?.error?.message || `Libro returned HTTP ${response.status}`)
  return body
}


export function SigningClient({ capability, mobilePublication }: { capability: string; mobilePublication?: { draftId: string; kind: 'article' | 'short' } }) {
  const [context, setContext] = useState<SigningContext | null>(null)
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState('Starting World ID signing…')
  const started = useRef(false)
  const verifying = useRef(false)
  const [error, setError] = useState('')
  const [publicationId, setPublicationId] = useState<string | null>(null)
  const constraints = useMemo(() => context
    ? CredentialRequest('proof_of_human', { signal: context.signalText })
    : null, [context])

  async function sign(result: IDKitResultSession) {
    verifying.current = true
    setStatus('Preparing the on-chain registration…')
    const prepared = await responseBody(await fetch(`/api/libro/browser/api/v1/signing/${capability}/prepare`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idkitResult: result }),
    })) as Prepared
    await complete(prepared)
  }

  const complete = useCallback(async (prepared: Prepared) => {
    if (prepared.publicationId) {
      setPublicationId(prepared.publicationId)
      setStatus('Published')
      return
    }

    let submissionMethod = prepared.submissionMethod || 'libro_relayer'
    let transactionHash = prepared.transactionHash
    let userOpHash = prepared.userOpHash
    if (!transactionHash && userOpHash) {
      submissionMethod = 'world_wallet'
      transactionHash = await waitForUserOperation(userOpHash)
    }
    if (!transactionHash) {
      setStatus('Submitting the registration…')
      userOpHash = await sendSponsoredWorldTransaction(prepared.transaction) || undefined
      if (userOpHash) {
        submissionMethod = 'world_wallet'
        await responseBody(await fetch(`/api/libro/browser/api/v1/signing/${capability}/submission`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ registrationId: prepared.registrationId, userOpHash }),
        }))
        setStatus('Waiting for World Chain confirmation…')
        transactionHash = await waitForUserOperation(userOpHash)
      }
    }
    if (!transactionHash) {
      setStatus('Requesting Libro-sponsored gas…')
      const relayed = await responseBody(await fetch(`/api/libro/browser/api/v1/signing/${capability}/relay`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ registrationId: prepared.registrationId }),
      }))
      transactionHash = relayed.transactionHash
      submissionMethod = 'libro_relayer'
    }
    setStatus('Finalizing the canonical publication…')
    const finalized = await responseBody(await fetch(`/api/libro/browser/api/v1/signing/${capability}/finalize`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registrationId: prepared.registrationId, submissionMethod, transactionHash, userOpHash }),
    }))
    setPublicationId(finalized.publicationId)
    setStatus('Published')
  }, [capability])

  const begin = useCallback(async () => {
    verifying.current = false
    setError('')
    setStatus('Starting World ID signing…')
    try {
      const response = await fetch(`/api/libro/browser/api/v1/signing/${capability}/context`, { method: 'POST' })
      const body = await responseBody(response)
      if (body.prepared) await complete(body.prepared)
      else { setContext(body); setOpen(true) }
    } catch (reason) {
      setStatus('')
      setError(reason instanceof Error ? reason.message : 'Could not start signing')
    }
  }, [capability, complete])

  useEffect(() => {
    if (started.current) return
    started.current = true
    void begin()
  }, [begin])

  return (
    <div>
      {error && <Button type="button" onClick={begin}>Try again</Button>}
      {status && <p>{status}</p>}
      {error && <p role="alert">{error}</p>}
      {publicationId && <p>Your publication is signed and published.</p>}
      {context && constraints && (
        <WorldIdSessionWidget
          mobileOperation={{ kind: 'signing', capability, publication: mobilePublication }}
          open={open}
          onOpenChange={(value) => {
            setOpen(value)
            if (!value && !verifying.current) {
              setStatus('')
              setError('Signing was canceled.')
            }
          }}
          app_id={context.appId}
          rp_context={context.rpContext}
          // Match draft publishing: require the session proof without optional Face Auth.
          require_user_presence={false}
          existing_session_id={context.existingSessionId}
          environment={context.environment}
          constraints={constraints}
          polling={{ interval: 1000, timeout: 120_000 }}
          handleVerify={sign}
          onSuccess={() => setOpen(false)}
          onError={(code) => { setStatus(''); setError(`World ID failed: ${code}`) }}
        />
      )}
    </div>
  )
}
