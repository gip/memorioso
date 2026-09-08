'use client'

import { useMemo, useState } from 'react'
import {
  CredentialRequest,
  IDKitRequestWidget,
  IDKitSessionWidget,
  type IDKitResult,
  type IDKitResultSession,
  type RpContext,
} from '@worldcoin/idkit'
import { MiniKit } from '@worldcoin/minikit-js'
import { useMiniKit } from '@worldcoin/minikit-js/minikit-provider'
import { waitForUserOperation } from '@/lib/wallet-receipt'

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

type SponsorshipContext = {
  appId: `app_${string}`
  environment: 'production' | 'staging'
  rpContext: RpContext
  action: string
  signal: string
}

async function responseBody(response: Response) {
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(body?.error?.message || `Libro returned HTTP ${response.status}`)
  return body
}


export function SigningClient({ capability }: { capability: string }) {
  const { isInstalled } = useMiniKit()
  const [context, setContext] = useState<SigningContext | null>(null)
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [publicationId, setPublicationId] = useState<string | null>(null)
  const [sponsorship, setSponsorship] = useState<SponsorshipContext | null>(null)
  const [sponsorshipOpen, setSponsorshipOpen] = useState(false)
  const [sponsorshipReady, setSponsorshipReady] = useState(false)
  const constraints = useMemo(() => context
    ? CredentialRequest('proof_of_human', { signal: context.signalText })
    : null, [context])

  async function begin() {
    setError('')
    setStatus('Starting World ID signing…')
    try {
      const response = await fetch(`/api/v1/signing/${capability}/context`, { method: 'POST' })
      const body = await responseBody(response)
      if (body.prepared) await complete(body.prepared)
      else { setContext(body); setOpen(true) }
    } catch (reason) {
      setStatus('')
      setError(reason instanceof Error ? reason.message : 'Could not start signing')
    }
  }

  async function beginSponsorship() {
    setError('')
    try {
      const response = await fetch('/api/v1/sponsorship/context', { method: 'POST' })
      setSponsorship(await responseBody(response))
      setSponsorshipOpen(true)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not start sponsorship proof')
    }
  }

  async function verifySponsorshipProof(payload: IDKitResult) {
    await responseBody(await fetch('/api/v1/sponsorship/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload }),
    }))
    setSponsorshipReady(true)
  }

  async function sign(result: IDKitResultSession) {
    setStatus('Preparing the on-chain registration…')
    const prepared = await responseBody(await fetch(`/api/v1/signing/${capability}/prepare`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idkitResult: result }),
    })) as Prepared
    await complete(prepared)
  }

  async function complete(prepared: Prepared) {
    if (prepared.publicationId) {
      setPublicationId(prepared.publicationId)
      setStatus('Published')
      return
    }

    let submissionMethod: 'world_wallet' | 'libro_relayer'
    let transactionHash = prepared.transactionHash
    let userOpHash = prepared.userOpHash
    if (!transactionHash && userOpHash) {
      submissionMethod = 'world_wallet'
      transactionHash = await waitForUserOperation(userOpHash)
    } else if (!transactionHash && MiniKit.isInstalled()) {
      setStatus('Approve the registration in your World wallet…')
      const sent = await MiniKit.sendTransaction(prepared.transaction)
      if (sent.executedWith !== 'minikit') throw new Error('Open this signing page inside World App to use World wallet')
      submissionMethod = 'world_wallet'
      userOpHash = sent.data.userOpHash
      await responseBody(await fetch(`/api/v1/signing/${capability}/submission`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ registrationId: prepared.registrationId, userOpHash }),
      }))
      setStatus('Waiting for World Chain confirmation…')
      transactionHash = await waitForUserOperation(userOpHash)
    } else if (!transactionHash) {
      setStatus('Requesting Libro-sponsored gas…')
      const relayed = await responseBody(await fetch(`/api/v1/signing/${capability}/relay`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ registrationId: prepared.registrationId }),
      }))
      transactionHash = relayed.transactionHash
      submissionMethod = 'libro_relayer'
    } else {
      submissionMethod = prepared.submissionMethod || 'libro_relayer'
    }
    setStatus('Finalizing the canonical publication…')
    const finalized = await responseBody(await fetch(`/api/v1/signing/${capability}/finalize`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registrationId: prepared.registrationId, submissionMethod, transactionHash, userOpHash }),
    }))
    setPublicationId(finalized.publicationId)
    setStatus('Published')
  }

  return (
    <div>
      {isInstalled === false && !sponsorshipReady && (
        <p><button type="button" onClick={beginSponsorship}>Enable one-person sponsored gas</button></p>
      )}
      {sponsorshipReady && <p>Sponsored gas eligibility verified.</p>}
      <button type="button" onClick={begin} disabled={Boolean(status && status !== 'Published')}>Sign with World ID</button>
      {status && <p>{status}</p>}
      {error && <p role="alert">{error}</p>}
      {publicationId && <p>Publication #{publicationId} is finalized. You can return to your MCP client.</p>}
      {context && constraints && (
        <IDKitSessionWidget
          open={open}
          onOpenChange={setOpen}
          app_id={context.appId}
          rp_context={context.rpContext}
          require_user_presence={true}
          existing_session_id={context.existingSessionId}
          environment={context.environment}
          constraints={constraints}
          polling={{ interval: 1000, timeout: 120_000 }}
          handleVerify={sign}
          onSuccess={() => setOpen(false)}
          onError={(code) => { setStatus(''); setError(`World ID failed: ${code}`) }}
        />
      )}
      {sponsorship && (
        <IDKitRequestWidget
          open={sponsorshipOpen}
          onOpenChange={setSponsorshipOpen}
          app_id={sponsorship.appId}
          action={sponsorship.action}
          rp_context={sponsorship.rpContext}
          environment={sponsorship.environment}
          allow_legacy_proofs={false}
          constraints={CredentialRequest('proof_of_human', { signal: sponsorship.signal })}
          polling={{ interval: 1000, timeout: 120_000 }}
          handleVerify={verifySponsorshipProof}
          onSuccess={() => setSponsorshipOpen(false)}
          onError={(code) => setError(`World ID sponsorship failed: ${code}`)}
        />
      )}
    </div>
  )
}
