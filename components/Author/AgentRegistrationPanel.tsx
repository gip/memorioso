'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CredentialRequest,
  IDKitRequestWidget,
  any as anyCredential,
  type IDKitResult,
  type RpContext,
} from '@worldcoin/idkit'
import { useUserOperationReceipt } from '@worldcoin/minikit-react'
import { createLibroPublicClient } from '@libro/core'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  getLibroControllerAddress,
  sendLibroRegistrationTransaction,
} from '@/lib/libro/client'
import type { AgentRegistrationTransaction } from '@/lib/libro/agent'
import { useWorldIdAuth } from '@/lib/world-id/client-auth'

type AgentRegistrationRow = {
  id: string
  registration_hash: string
  controller_address: string
  agent_address: string
  expires_at: string
  finalized_at: string | null
  revoked_at: string | null
}

type AgentRegistrationContext = {
  registrationId: string
  appId: `app_${string}`
  action: string
  environment: 'production' | 'staging'
  rpContext: RpContext
  signal: string
  signalHash: string
}

type PrepareResponse =
  | {
      success: true
      registrationId: string
      transaction: AgentRegistrationTransaction
    }
  | {
      success: false
      message?: string
    }

type TransactionResponse =
  | {
      success: true
      transaction: AgentRegistrationTransaction
    }
  | {
      success: false
      message?: string
    }

export function AgentRegistrationPanel({ authorId }: { authorId: string }) {
  const { status } = useWorldIdAuth()
  const [registrations, setRegistrations] = useState<AgentRegistrationRow[]>([])
  const [canManage, setCanManage] = useState(false)
  const [agentAddress, setAgentAddress] = useState('')
  const [context, setContext] = useState<AgentRegistrationContext | null>(null)
  const [isWorldIdOpen, setIsWorldIdOpen] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  const publicClient = useMemo(
    () => createLibroPublicClient(process.env.NEXT_PUBLIC_LIBRO_RPC_URL),
    []
  )
  const { poll: pollUserOperationReceipt } = useUserOperationReceipt({ client: publicClient })

  const loadRegistrations = useCallback(async () => {
    if (status !== 'authenticated') {
      return
    }

    const raw = await fetch(`/api/libro/agent-registration?authorId=${encodeURIComponent(authorId)}`)
    const response = await raw.json()
    if (response.success) {
      setCanManage(true)
      setRegistrations(response.registrations)
    } else {
      setCanManage(false)
    }
  }, [authorId, status])

  useEffect(() => {
    loadRegistrations().catch(() => setCanManage(false))
  }, [loadRegistrations])

  const registerAgent = async () => {
    try {
      setMessage(null)
      setIsBusy(true)
      const controllerAddress = await getLibroControllerAddress()
      const expiresAt = new Date()
      expiresAt.setDate(expiresAt.getDate() + 30)
      const raw = await fetch('/api/libro/agent-registration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          authorId,
          controllerAddress,
          agentAddress,
          expiresAt: expiresAt.toISOString(),
        }),
      })
      const response = await raw.json()
      if (!response.success) {
        throw new Error(response.message || 'Failed to start agent registration')
      }

      setContext({
        registrationId: response.registrationId,
        appId: response.appId,
        action: response.action,
        environment: response.environment,
        rpContext: response.rpContext,
        signal: response.signal,
        signalHash: response.signalHash,
      })
      setIsWorldIdOpen(true)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to register agent')
      setIsBusy(false)
    }
  }

  const handleWorldIdResult = async (idkitResult: IDKitResult) => {
    if (!context) {
      throw new Error('Agent registration context is missing')
    }

    try {
      setMessage('Preparing on-chain agent registration')
      const prepareRaw = await fetch(`/api/libro/agent-registration/${context.registrationId}/prepare`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idkitResult }),
      })
      const prepareResponse = await prepareRaw.json() as PrepareResponse
      if (!prepareResponse.success) {
        throw new Error(prepareResponse.message || 'Failed to prepare agent registration')
      }

      setMessage('Confirming sponsored registration in World App')
      const { userOpHash } = await sendLibroRegistrationTransaction(prepareResponse.transaction)

      setMessage('Waiting for on-chain registration')
      const { transactionHash } = await pollUserOperationReceipt(userOpHash)

      setMessage('Finalizing agent registration')
      const finalizeRaw = await fetch(`/api/libro/agent-registration/${context.registrationId}/finalize`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userOpHash, transactionHash }),
      })
      const finalizeResponse = await finalizeRaw.json()
      if (!finalizeResponse.success) {
        throw new Error(finalizeResponse.message || 'Failed to finalize agent registration')
      }

      setAgentAddress('')
      setContext(null)
      setIsWorldIdOpen(false)
      setMessage('Agent registered')
      await loadRegistrations()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to register agent')
      throw error
    } finally {
      setIsBusy(false)
    }
  }

  const revokeAgent = async (registrationId: string) => {
    try {
      setMessage(null)
      setIsBusy(true)
      const raw = await fetch(`/api/libro/agent-registration/${registrationId}/revoke`, { method: 'PUT' })
      const response = await raw.json() as TransactionResponse
      if (!response.success) {
        throw new Error(response.message || 'Failed to prepare revocation')
      }

      const { userOpHash } = await sendLibroRegistrationTransaction(response.transaction)
      const { transactionHash } = await pollUserOperationReceipt(userOpHash)
      const finalizeRaw = await fetch(`/api/libro/agent-registration/${registrationId}/revoke/finalize`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userOpHash, transactionHash }),
      })
      const finalizeResponse = await finalizeRaw.json()
      if (!finalizeResponse.success) {
        throw new Error(finalizeResponse.message || 'Failed to finalize revocation')
      }

      setMessage('Agent revoked')
      await loadRegistrations()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to revoke agent')
    } finally {
      setIsBusy(false)
    }
  }

  if (!canManage) {
    return null
  }

  const constraints = context
    ? anyCredential(
      CredentialRequest('proof_of_human', { signal: context.signal })
    )
    : null

  return (
    <div className="space-y-3 border-t pt-6">
      {context && constraints && (
        <IDKitRequestWidget
          open={isWorldIdOpen}
          onOpenChange={setIsWorldIdOpen}
          app_id={context.appId}
          action={context.action}
          rp_context={context.rpContext}
          allow_legacy_proofs={false}
          environment={context.environment}
          constraints={constraints}
          handleVerify={handleWorldIdResult}
          onSuccess={() => setIsWorldIdOpen(false)}
          onError={(errorCode) => {
            setMessage(`World ID verification failed: ${errorCode}`)
            setIsBusy(false)
          }}
        />
      )}
      <div className="text-sm font-medium">Agent addresses</div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          value={agentAddress}
          onChange={(event) => setAgentAddress(event.target.value)}
          placeholder="0x agent address"
          className="font-mono text-sm"
        />
        <Button onClick={registerAgent} disabled={isBusy || !agentAddress}>
          Register Agent
        </Button>
      </div>
      {message && <div className="text-xs text-muted-foreground">{message}</div>}
      <div className="space-y-2">
        {registrations.map((registration) => (
          <div key={registration.id} className="flex flex-col gap-2 border p-3 text-xs sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="truncate font-mono">{registration.agent_address}</div>
              <div className="text-muted-foreground">
                Expires {new Date(registration.expires_at).toLocaleDateString()}
                {registration.revoked_at ? ' · revoked' : registration.finalized_at ? ' · active' : ' · pending'}
              </div>
            </div>
            {!registration.revoked_at && registration.finalized_at && (
              <Button variant="outline" size="sm" onClick={() => revokeAgent(registration.id)} disabled={isBusy}>
                Revoke
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
