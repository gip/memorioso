import type { IDKitSessionConfig, IDKitResultSession } from '@worldcoin/idkit'

export type MobileOperation =
  | { kind: 'login' | 'identity'; handle: string; intent: 'login' | 'signup'; destination?: string }
  | { kind: 'signing' | 'agent-signing' | 'handle-signing'; capability: string; publication?: { draftId: string; kind: 'article' | 'short' } }
  | { kind: 'draft'; draftId: string; challengeId: string; publicationKind: 'article' | 'short' }

export type MobileFlow = {
  version: 1
  id: string
  expiresAt: number
  returnPath: string
  config: IDKitSessionConfig
  signalHashes: Record<string, string>
  existingSessionId?: `session_${string}`
  operation: MobileOperation
  connectorURI?: string
  result?: IDKitResultSession
  prepared?: { registrationId: string; transactionHash?: string; publicationId?: string }
  completed?: { message: string; destination?: string }
}

const PREFIX = 'memorioso:world-id:mobile:'
const FLOW_ID = /^[0-9a-f-]{36}$/
export const MOBILE_FLOW_TTL = 5 * 60_000

export function safeReturnPath(value: string, origin: string): string {
  try {
    const url = new URL(value, origin)
    if (url.origin !== origin || url.pathname === '/world-id/return') return '/'
    return `${url.pathname}${url.search}${url.hash}`
  } catch { return '/' }
}

export function callbackUrl(id: string, origin: string): string {
  if (!FLOW_ID.test(id)) throw new Error('Invalid verification link')
  return new URL(`/world-id/return?flow=${id}`, origin).href
}

export function saveMobileFlow(flow: MobileFlow): void {
  localStorage.setItem(PREFIX + flow.id, JSON.stringify(flow))
}

export function removeMobileFlow(id: string): void {
  localStorage.removeItem(PREFIX + id)
}

export function clearMobileFlows(): void {
  for (const key of Object.keys(localStorage)) if (key.startsWith(PREFIX)) localStorage.removeItem(key)
}

export function readMobileFlow(id: string): MobileFlow | null {
  if (!FLOW_ID.test(id)) return null
  try {
    const flow = JSON.parse(localStorage.getItem(PREFIX + id) || 'null') as MobileFlow | null
    if (!flow || flow.version !== 1 || flow.id !== id || !Number.isFinite(flow.expiresAt)
      || flow.expiresAt <= Date.now() || typeof flow.returnPath !== 'string') {
      removeMobileFlow(id)
      return null
    }
    return flow
  } catch {
    removeMobileFlow(id)
    return null
  }
}

export function pruneMobileFlows(): void {
  for (const key of Object.keys(localStorage)) if (key.startsWith(PREFIX)) readMobileFlow(key.slice(PREFIX.length))
}

export function canUseMobileFlow(): boolean {
  if (typeof window === 'undefined' || (window as Window & { WorldApp?: unknown }).WorldApp
    || !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
    || !navigator.locks || !window.isSecureContext
    || typeof AbortSignal.timeout !== 'function' || typeof AbortSignal.any !== 'function') return false
  try {
    localStorage.setItem(PREFIX + 'probe', '1')
    localStorage.removeItem(PREFIX + 'probe')
    return true
  } catch { return false }
}
