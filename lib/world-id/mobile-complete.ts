import { browserMcp } from '@/lib/libro-service/browser-mcp'
import { safeReturnPath, saveMobileFlow, type MobileFlow } from './mobile-store'

async function request(path: string, method: 'POST' | 'PUT', body?: unknown) {
  const response = await fetch(path, {
    method, headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  })
  const value = await response.json().catch(() => null)
  if (!response.ok || value?.success === false) {
    throw new Error(value?.error?.message || value?.message || `Verification returned HTTP ${response.status}`)
  }
  return value
}

/** Mobile web always uses the existing relayer; native wallet flows stay in the SDK widget. */
export async function completeMobileFlow(flow: MobileFlow, origin: string): Promise<void> {
  if (flow.completed) return
  const operation = flow.operation
  if (operation.kind === 'login' || operation.kind === 'identity') {
    const legacy = operation.kind === 'login'
    const verify = legacy ? (args: Record<string, unknown>) => request('/api/worldid/verify', 'POST', args)
      : (args: Record<string, unknown>) => browserMcp<{ success: boolean; authenticated?: boolean }>('identity_verify', args)
    const verified = await verify({
      payload: flow.result, handle: operation.handle,
      [legacy ? 'intent' : 'purpose']: operation.intent,
    })
    if (legacy && (!verified.success || !verified.authenticated)) throw new Error('World ID sign-in was not completed')
    flow.completed = { message: 'You are signed in.', destination: safeReturnPath(operation.destination || flow.returnPath, origin) }
  } else {
    if (!('draftId' in operation) && !('capability' in operation)) throw new Error('Unknown verification operation')
    const legacy = operation.kind === 'draft'
    if (!legacy && !['signing', 'agent-signing', 'handle-signing'].includes(operation.kind)) throw new Error('Unknown verification operation')
    const submit = (action: 'prepare' | 'relay' | 'finalize', args: Record<string, unknown>) => {
      if (operation.kind === 'draft') return request(`/api/draft/${encodeURIComponent(operation.draftId)}/publish/${action}`, 'PUT', args)
      const prefix = operation.kind === 'signing' ? 'signing' : operation.kind === 'agent-signing' ? 'agent_signing' : 'handle_signing'
      return browserMcp<{ registrationId?: string; requestId?: string; transactionHash?: string; publicationId?: string }>(
        `${prefix}_${action}`, { ...args, capability: operation.capability },
      )
    }
    if (!flow.prepared) {
      const prepared = await submit('prepare', {
        idkitResult: flow.result, ...(legacy ? { challengeId: operation.challengeId } : {}),
      })
      const registrationId = prepared?.registrationId || prepared?.requestId
      if (typeof registrationId !== 'string' || !registrationId) throw new Error('The server did not return a prepared registration. Resume verification to try again.')
      flow.prepared = {
        registrationId,
        transactionHash: prepared.transactionHash || undefined,
        publicationId: prepared.publicationId || undefined,
      }
      // The server now owns the prepared operation. Recovery must never request
      // another World proof after this point, even when the original RP expires.
      flow.expiresAt = Date.now() + 24 * 60 * 60_000
      delete flow.result
      delete flow.connectorURI
      saveMobileFlow(flow)
    }
    if (!flow.prepared.publicationId) {
      if (!flow.prepared.transactionHash) {
        const relayed = await submit('relay', { registrationId: flow.prepared.registrationId })
        flow.prepared.transactionHash = relayed.transactionHash
        saveMobileFlow(flow)
      }
      const finalized = await submit('finalize', {
        registrationId: flow.prepared.registrationId,
        transactionHash: flow.prepared.transactionHash,
        submissionMethod: legacy ? 'memorioso_relayer' : 'libro_relayer',
      })
      flow.prepared.publicationId = finalized.publicationId
    }
    const publication = legacy ? { kind: operation.publicationKind } : operation.publication
    flow.completed = {
      message: operation.kind === 'agent-signing' ? 'Agent authorized. You can return to your MCP client.'
        : operation.kind === 'handle-signing' ? 'Handle claimed. You can return to your MCP client.' : 'Your publication is signed and published.',
      destination: publication && flow.prepared.publicationId
        ? `/${publication.kind}/${encodeURIComponent(flow.prepared.publicationId)}?signed=1` : undefined,
    }
  }
  // Keep a short-lived receipt so a second callback/tab observes completion,
  // while removing the bridge key, proof, handle and signing capability.
  flow.expiresAt = Date.now() + 5 * 60_000
  delete flow.result
  delete flow.connectorURI
  delete flow.prepared
  const receipt = { version: flow.version, id: flow.id, expiresAt: flow.expiresAt,
    returnPath: flow.returnPath, completed: flow.completed }
  saveMobileFlow(receipt as MobileFlow)
}
