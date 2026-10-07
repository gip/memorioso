'use client'

import { browserMcp } from '@/lib/libro-service/browser-mcp'

import { WorldIdSessionWidget } from '@/components/WorldIdSessionWidget'

import { Button } from '@/components/ui/button'
import { useCallback, useEffect, useRef, useMemo, useState } from 'react'
import { CredentialRequest, type IDKitResultSession, type RpContext } from '@worldcoin/idkit'
import { sendSponsoredWorldTransaction } from '@/lib/libro-service/sponsored-transaction'
import { waitForUserOperation } from '@/lib/libro-service/wallet-receipt'

type Prepared = { transaction: Parameters<typeof sendSponsoredWorldTransaction>[0]; transactionHash?: string }

type Context = {
  appId: `app_${string}`
  environment: 'production' | 'staging'
  rpContext: RpContext
  existingSessionId: `session_${string}`
  signal: string
}

export function ClaimClient({ capability, signal, onComplete, autoStart = false, local = false }: { capability: string; signal: string; onComplete?: () => void; autoStart?: boolean; local?: boolean }) {
  const started = useRef(false)
  const claimRequest = useCallback(async <T,>(tool: Parameters<typeof browserMcp>[0], args: Record<string, unknown>): Promise<T> => {
    if (!local) return browserMcp<T>(tool, args)
    const raw = await fetch('/api/libro/handle-claim', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...args, tool }) })
    const body = await raw.json(); if (!raw.ok) throw new Error(body.message || 'Handle claim failed'); return body as T
  }, [local])
  const [context, setContext] = useState<Context | null>(null)
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const constraints = useMemo(() => CredentialRequest('proof_of_human', { signal }), [signal])
  async function verify(idkitResult: IDKitResultSession) {
    setMessage('Preparing handle claim…')
    const prepared = await claimRequest<Prepared>('handle_signing_prepare', { capability, idkitResult })
    await complete(prepared)
  }
  const complete = useCallback(async (prepared: Prepared) => {
    let transactionHash = prepared.transactionHash
    if (!transactionHash) {
      const userOpHash = await sendSponsoredWorldTransaction(prepared.transaction)
      if (userOpHash) transactionHash = await waitForUserOperation(userOpHash)
    }
    if (!transactionHash) {
      transactionHash = (await claimRequest<{ transactionHash: string }>('handle_signing_relay', { capability })).transactionHash
    }
    await claimRequest<{ publicationId: string }>('handle_signing_finalize', { capability, transactionHash })
    setMessage('Handle claimed.')
    onComplete?.()
  }, [capability, claimRequest, onComplete])
  const begin = useCallback(async () => {
    try {
      const body = await claimRequest<Context & { prepared?: Prepared }>('handle_signing_context', { capability })
      if (body.prepared) await complete(body.prepared)
      else { setContext(body); setOpen(true) }
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not start handle claim') }
  }, [capability, claimRequest, complete])
  useEffect(() => { if (autoStart && !started.current) { started.current = true; void begin() } }, [autoStart, begin])
  return <div>
    <Button type="button" onClick={begin}>Claim handle with World ID</Button>
    {message && <p>{message}</p>}
    {context && <WorldIdSessionWidget mobileOperation={{ kind: 'handle-signing', capability, local }} open={open} onOpenChange={setOpen}
      app_id={context.appId} rp_context={context.rpContext} require_user_presence={true}
          existing_session_id={context.existingSessionId}
      environment={context.environment} constraints={constraints}
      handleVerify={verify} onSuccess={() => setOpen(false)}
      onError={(code) => setMessage(`World ID failed: ${code}`)} />}
  </div>
}
