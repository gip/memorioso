'use client'

import { Button } from '@/components/ui/button'
import { useMemo, useState } from 'react'
import { CredentialRequest, IDKitSessionWidget, type IDKitResultSession, type RpContext } from '@worldcoin/idkit'
import { sendSponsoredWorldTransaction } from '@/lib/libro-service/sponsored-transaction'
import { waitForUserOperation } from '@/lib/libro-service/wallet-receipt'

type Context = {
  appId: `app_${string}`
  environment: 'production' | 'staging'
  rpContext: RpContext
  existingSessionId: `session_${string}`
  registrationHash: string
  payload: { signal?: string }
}

async function parsed(response: Response) {
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(body?.error?.message || `Libro returned HTTP ${response.status}`)
  return body
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
      setContext(await parsed(await fetch(`/api/libro/browser/api/v1/agent-signing/${capability}/context`, { method: 'POST' })))
      setOpen(true)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not start authorization') }
  }

  async function authorize(idkitResult: IDKitResultSession) {
    setStatus('Preparing agent authorization…')
    const prepared = await parsed(await fetch(`/api/libro/browser/api/v1/agent-signing/${capability}/prepare`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idkitResult }),
    }))
    let transactionHash = prepared.transactionHash
    let userOpHash: string | undefined
    if (!transactionHash) {
      setStatus('Submitting the agent authorization…')
      userOpHash = await sendSponsoredWorldTransaction(prepared.transaction) || undefined
      if (userOpHash) transactionHash = await waitForUserOperation(userOpHash)
    }
    if (!transactionHash) {
      setStatus('Requesting sponsored gas…')
      transactionHash = (await parsed(await fetch(`/api/libro/browser/api/v1/agent-signing/${capability}/relay`, { method: 'PUT' }))).transactionHash
    }
    await parsed(await fetch(`/api/libro/browser/api/v1/agent-signing/${capability}/finalize`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transactionHash, userOpHash }),
    }))
    setStatus('Agent authorized. Return to your MCP client.')
  }

  return <div>
    <Button type="button" onClick={begin}>Authorize agent with World ID</Button>
    {status && <p>{status}</p>}
    {error && <p role="alert">{error}</p>}
    {context && <IDKitSessionWidget
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
