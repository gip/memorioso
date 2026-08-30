'use client'

import { useMemo, useState } from 'react'
import { CredentialRequest, IDKitSessionWidget, type IDKitResultSession, type RpContext } from '@worldcoin/idkit'
import { MiniKit } from '@worldcoin/minikit-js'

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

async function receipt(hash: string): Promise<string> {
  for (let count = 0; count < 60; count += 1) {
    const response = await fetch(`/api/v1/user-operations/${hash}`, { cache: 'no-store' })
    if (response.ok) return (await response.json()).transactionHash
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }
  throw new Error('Handle claim is still pending')
}

export function ClaimClient({ capability, signal }: { capability: string; signal: string }) {
  const [context, setContext] = useState<Context | null>(null)
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const constraints = useMemo(() => CredentialRequest('proof_of_human', { signal }), [signal])
  async function begin() {
    try {
      setContext(await value(await fetch(`/api/v1/handle-signing/${capability}/context`, { method: 'POST' })))
      setOpen(true)
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not start handle claim') }
  }
  async function verify(idkitResult: IDKitResultSession) {
    setMessage('Preparing handle claim…')
    const prepared = await value(await fetch(`/api/v1/handle-signing/${capability}/prepare`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idkitResult }),
    }))
    let transactionHash = prepared.transactionHash
    if (!transactionHash && MiniKit.isInstalled()) {
      const sent = await MiniKit.sendTransaction(prepared.transaction)
      if (sent.executedWith !== 'minikit') throw new Error('World wallet is required')
      transactionHash = await receipt(sent.data.userOpHash)
    } else if (!transactionHash) {
      transactionHash = (await value(await fetch(`/api/v1/handle-signing/${capability}/relay`, { method: 'PUT' }))).transactionHash
    }
    await value(await fetch(`/api/v1/handle-signing/${capability}/finalize`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transactionHash }),
    }))
    setMessage('Handle claimed. Return to your MCP client.')
  }
  return <div>
    <button type="button" onClick={begin}>Claim handle with World ID</button>
    {message && <p>{message}</p>}
    {context && <IDKitSessionWidget open={open} onOpenChange={setOpen}
      app_id={context.appId} rp_context={context.rpContext} existing_session_id={context.existingSessionId}
      environment={context.environment} constraints={constraints}
      handleVerify={verify} onSuccess={() => setOpen(false)}
      onError={(code) => setMessage(`World ID failed: ${code}`)} />}
  </div>
}
