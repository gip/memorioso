'use client'

import { browserMcp } from '@/lib/libro-service/browser-mcp'

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
    const prepared = await browserMcp<Prepared>('signing_prepare', { capability, idkitResult: result }) as Prepared
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
        await browserMcp<unknown>('signing_submission', { capability, registrationId: prepared.registrationId, userOpHash })
        setStatus('Waiting for World Chain confirmation…')
        transactionHash = await waitForUserOperation(userOpHash)
      }
    }
    if (!transactionHash) {
      setStatus('Requesting Libro-sponsored gas…')
      const relayed = await browserMcp<{ transactionHash: string }>('signing_relay', { capability, registrationId: prepared.registrationId })
      transactionHash = relayed.transactionHash
      submissionMethod = 'libro_relayer'
    }
    setStatus('Finalizing the canonical publication…')
    const finalized = await browserMcp<{ publicationId: string }>('signing_finalize', { capability, registrationId: prepared.registrationId, submissionMethod, transactionHash, userOpHash })
    setPublicationId(finalized.publicationId)
    setStatus('Published')
  }, [capability])

  const begin = useCallback(async () => {
    verifying.current = false
    setError('')
    setStatus('Starting World ID signing…')
    try {
      const body = await browserMcp<SigningContext & { prepared?: Prepared }>('signing_context', { capability })
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
