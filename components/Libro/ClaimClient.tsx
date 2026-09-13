'use client'

import { browserMcp } from '@/lib/libro-service/browser-mcp'

import { WorldIdSessionWidget } from '@/components/WorldIdSessionWidget'

import { Button } from '@/components/ui/button'
import { useMemo, useState } from 'react'
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

export function ClaimClient({ capability, signal }: { capability: string; signal: string }) {
  const [context, setContext] = useState<Context | null>(null)
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const constraints = useMemo(() => CredentialRequest('proof_of_human', { signal }), [signal])
  async function begin() {
    try {
      setContext(await browserMcp<Context>('handle_signing_context', { capability }))
      setOpen(true)
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not start handle claim') }
  }
  async function verify(idkitResult: IDKitResultSession) {
    setMessage('Preparing handle claim…')
    const prepared = await browserMcp<Prepared>('handle_signing_prepare', { capability, idkitResult })
    let transactionHash = prepared.transactionHash
    if (!transactionHash) {
      const userOpHash = await sendSponsoredWorldTransaction(prepared.transaction)
      if (userOpHash) transactionHash = await waitForUserOperation(userOpHash)
    }
    if (!transactionHash) {
      transactionHash = (await browserMcp<{ transactionHash: string }>('handle_signing_relay', { capability })).transactionHash
    }
    await browserMcp<{ publicationId: string }>('handle_signing_finalize', { capability, transactionHash })
    setMessage('Handle claimed. Return to your MCP client.')
  }
  return <div>
    <Button type="button" onClick={begin}>Claim handle with World ID</Button>
    {message && <p>{message}</p>}
    {context && <WorldIdSessionWidget mobileOperation={{ kind: 'handle-signing', capability }} open={open} onOpenChange={setOpen}
      app_id={context.appId} rp_context={context.rpContext} require_user_presence={true}
          existing_session_id={context.existingSessionId}
      environment={context.environment} constraints={constraints}
      handleVerify={verify} onSuccess={() => setOpen(false)}
      onError={(code) => setMessage(`World ID failed: ${code}`)} />}
  </div>
}
