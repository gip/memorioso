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
  registrationHash: string
  payload: { signal?: string }
}

export function AgentSigningClient({ capability, signal }: { capability: string; signal: string }) {
  const [context, setContext] = useState<Context | null>(null)
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const constraints = useMemo(() => CredentialRequest('proof_of_human', { signal }), [signal])

  async function begin() {
    setError('')
    try {
      setContext(await browserMcp<Context>('agent_signing_context', { capability }))
      setOpen(true)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not start authorization') }
  }

  async function authorize(idkitResult: IDKitResultSession) {
    setStatus('Preparing agent authorization…')
    const prepared = await browserMcp<Prepared>('agent_signing_prepare', { capability, idkitResult })
    let transactionHash = prepared.transactionHash
    let userOpHash: string | undefined
    if (!transactionHash) {
      setStatus('Submitting the agent authorization…')
      userOpHash = await sendSponsoredWorldTransaction(prepared.transaction) || undefined
      if (userOpHash) transactionHash = await waitForUserOperation(userOpHash)
    }
    if (!transactionHash) {
      setStatus('Requesting sponsored gas…')
      transactionHash = (await browserMcp<{ transactionHash: string }>('agent_signing_relay', { capability })).transactionHash
    }
    await browserMcp<{ publicationId: string }>('agent_signing_finalize', { capability, transactionHash, userOpHash })
    setStatus('Agent authorized. Return to your MCP client.')
  }

  return <div>
    <Button type="button" onClick={begin}>Authorize agent with World ID</Button>
    {status && <p>{status}</p>}
    {error && <p role="alert">{error}</p>}
    {context && <WorldIdSessionWidget
      mobileOperation={{ kind: 'agent-signing', capability }}
      open={open}
      onOpenChange={setOpen}
      app_id={context.appId}
      rp_context={context.rpContext}
      require_user_presence={true}
          existing_session_id={context.existingSessionId}
      environment={context.environment}
      constraints={constraints}
      polling={{ interval: 1000, timeout: 120_000 }}
      handleVerify={authorize}
      onSuccess={() => setOpen(false)}
      onError={(code) => setError(`World ID failed: ${code}`)}
    />}
  </div>
}
