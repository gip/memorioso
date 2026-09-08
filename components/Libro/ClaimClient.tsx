'use client'

import { Button } from '@/components/ui/button'
import { useMemo, useState } from 'react'
import { CredentialRequest, IDKitSessionWidget, type IDKitResultSession, type RpContext } from '@worldcoin/idkit'
import { MiniKit } from '@worldcoin/minikit-js'
import { waitForUserOperation } from '@/lib/libro-service/wallet-receipt'

type Context = {
  appId: `app_${string}`
  environment: 'production' | 'staging'
  rpContext: RpContext
  existingSessionId: `session_${string}`
  signal: string
}

async function value(response: Response) {
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(body?.error?.message || `Libro returned HTTP ${response.status}`)
  return body
}


export function ClaimClient({ capability, signal }: { capability: string; signal: string }) {
  const [context, setContext] = useState<Context | null>(null)
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const constraints = useMemo(() => CredentialRequest('proof_of_human', { signal }), [signal])
  async function begin() {
    try {
      setContext(await value(await fetch(`/api/libro/browser/api/v1/handle-signing/${capability}/context`, { method: 'POST' })))
      setOpen(true)
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not start handle claim') }
  }
  async function verify(idkitResult: IDKitResultSession) {
    setMessage('Preparing handle claim…')
    const prepared = await value(await fetch(`/api/libro/browser/api/v1/handle-signing/${capability}/prepare`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idkitResult }),
    }))
    let transactionHash = prepared.transactionHash
    if (!transactionHash && MiniKit.isInstalled()) {
      const sent = await MiniKit.sendTransaction(prepared.transaction)
      if (sent.executedWith !== 'minikit') throw new Error('World wallet is required')
      transactionHash = await waitForUserOperation(sent.data.userOpHash)
    } else if (!transactionHash) {
      transactionHash = (await value(await fetch(`/api/libro/browser/api/v1/handle-signing/${capability}/relay`, { method: 'PUT' }))).transactionHash
    }
    await value(await fetch(`/api/libro/browser/api/v1/handle-signing/${capability}/finalize`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transactionHash }),
    }))
    setMessage('Handle claimed. Return to your MCP client.')
  }
  return <div>
    <Button type="button" onClick={begin}>Claim handle with World ID</Button>
    {message && <p>{message}</p>}
    {context && <IDKitSessionWidget open={open} onOpenChange={setOpen}
      app_id={context.appId} rp_context={context.rpContext} require_user_presence={true}
          existing_session_id={context.existingSessionId}
      environment={context.environment} constraints={constraints}
      handleVerify={verify} onSuccess={() => setOpen(false)}
      onError={(code) => setMessage(`World ID failed: ${code}`)} />}
  </div>
}
