'use client'

import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useRouter } from 'next/navigation'
import {
  CredentialRequest,
  IDKitSessionWidget,
  any as anyCredential,
  type ConstraintNode,
  type IDKitResultSession,
  type RpContext,
} from '@worldcoin/idkit'
import type { WorldIdSessionResponse, WorldIdSessionUser } from '@/lib/auth-types'
import { isWorldIdSessionId, WORLD_ID_LOGIN_CREDENTIALS } from '@/lib/world-id/constants'
import { normalizeUserHandle } from '@/lib/handle'
import { WorldIdLoginDialog } from '@/components/WorldIdLoginDialog'

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated'

type PendingLogin = {
  handle: string
  intent: 'login' | 'signup'
}

type WorldIdAuthContextValue = {
  user: WorldIdSessionUser | null
  status: AuthStatus
  error: string | null
  isWorldAppLoginPending: boolean
  signInWithWorldId: () => Promise<void>
  signOut: () => Promise<void>
  refreshSession: () => Promise<void>
}

type ActiveAuthContext = {
  appId: `app_${string}`
  environment: 'production' | 'staging'
  rpContext: RpContext
  existingSessionId: `session_${string}` | null
}

const WorldIdAuthContext = createContext<WorldIdAuthContextValue | null>(null)

type WorldAppWindow = Window & {
  WorldApp?: unknown
}

export function isInWorldApp(): boolean {
  return typeof window !== 'undefined' && Boolean((window as WorldAppWindow).WorldApp)
}

function createWorldIdLoginConstraints(): ConstraintNode {
  return anyCredential(...WORLD_ID_LOGIN_CREDENTIALS.map((credential) => CredentialRequest(credential)))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isRpContext(value: unknown): value is RpContext {
  return isRecord(value) &&
    typeof value.rp_id === 'string' &&
    typeof value.nonce === 'string' &&
    typeof value.created_at === 'number' &&
    typeof value.expires_at === 'number' &&
    typeof value.signature === 'string'
}

type WorldIdLoginContext = {
  success: true
  appId: `app_${string}`
  environment: 'production' | 'staging'
  rpContext: RpContext
  existingSessionId: `session_${string}` | null
  existingHandle?: string | null
}

function isWorldIdLoginContext(value: unknown): value is WorldIdLoginContext {
  return isRecord(value) &&
    value.success === true &&
    typeof value.appId === 'string' &&
    value.appId.startsWith('app_') &&
    (value.environment === 'production' || value.environment === 'staging') &&
    isRpContext(value.rpContext) &&
    (value.existingSessionId === null || isWorldIdSessionId(value.existingSessionId)) &&
    (value.existingHandle === undefined || value.existingHandle === null || typeof value.existingHandle === 'string')
}

async function fetchLoginContext(handle?: string): Promise<WorldIdLoginContext> {
  const query = handle ? `?handle=${encodeURIComponent(handle)}` : ''
  const response = await fetch(`/api/worldid/rp-context${query}`, {
    cache: 'no-store',
  })
  const body = await response.json().catch(() => null) as unknown

  if (!response.ok || !isWorldIdLoginContext(body)) {
    const message = isRecord(body) && typeof body.message === 'string'
      ? body.message
      : 'Could not start World ID login'
    throw new Error(message)
  }

  return body
}

// The verify route only accepts the nonce from the most recent rp-context
// response (it is stored in an httpOnly cookie), so a cached context stays
// usable until another fetch replaces it or it nears expiry.
const RP_CONTEXT_REUSE_MARGIN_MS = 60_000

function isLoginContextFresh(context: WorldIdLoginContext): boolean {
  return context.rpContext.expires_at * 1000 - Date.now() > RP_CONTEXT_REUSE_MARGIN_MS
}

export function useWorldIdAuth(): WorldIdAuthContextValue {
  const context = useContext(WorldIdAuthContext)
  if (!context) {
    throw new Error('useWorldIdAuth must be used inside WorldIdAuthProvider')
  }
  return context
}

export function WorldIdAuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter()
  const [user, setUser] = useState<WorldIdSessionUser | null>(null)
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [error, setError] = useState<string | null>(null)
  const [activeContext, setActiveContext] = useState<ActiveAuthContext | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [isLoginDialogOpen, setIsLoginDialogOpen] = useState(false)
  const [hintHandle, setHintHandle] = useState<string | null>(null)
  const [pendingLogin, setPendingLogin] = useState<PendingLogin | null>(null)
  const [isWorldAppLoginPending, setIsWorldAppLoginPending] = useState(false)
  const cachedLoginContextRef = useRef<WorldIdLoginContext | null>(null)

  const loginConstraints = useMemo<ConstraintNode>(() => createWorldIdLoginConstraints(), [])

  const refreshSession = useCallback(async () => {
    setStatus('loading')
    const response = await fetch('/api/auth/session', {
      method: 'GET',
    })
    const body = await response.json() as WorldIdSessionResponse

    if (body.success && body.authenticated) {
      setUser(body.user)
      setStatus('authenticated')
      return
    }

    setUser(null)
    setStatus('unauthenticated')
  }, [])

  useEffect(() => {
    refreshSession().catch(() => {
      setUser(null)
      setStatus('unauthenticated')
    })
  }, [refreshSession])

  const signInWithWorldId = useCallback(async () => {
    setError(null)
    setIsOpen(false)

    let loginContext
    try {
      loginContext = await fetchLoginContext()
      cachedLoginContextRef.current = loginContext
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not start World ID login'
      setError(message)
      throw error
    }

    // Always ask for a name; a hinted session with a known handle becomes a
    // one-tap "continue as" shortcut inside the dialog.
    setHintHandle(loginContext.existingSessionId ? loginContext.existingHandle ?? null : null)
    setPendingLogin(null)
    setIsLoginDialogOpen(true)
  }, [])

  const startContinueFlow = useCallback(async () => {
    setError(null)
    setIsWorldAppLoginPending(isInWorldApp())

    let loginContext
    try {
      const cached = cachedLoginContextRef.current
      loginContext = cached && cached.existingSessionId && isLoginContextFresh(cached)
        ? cached
        : await fetchLoginContext()
      cachedLoginContextRef.current = loginContext
      if (!loginContext.existingSessionId) {
        throw new Error('No existing login on this browser')
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not start World ID login'
      setError(message)
      setIsWorldAppLoginPending(false)
      throw error
    }

    setActiveContext({
      appId: loginContext.appId,
      environment: loginContext.environment,
      rpContext: loginContext.rpContext,
      existingSessionId: loginContext.existingSessionId,
    })
    setPendingLogin({ handle: loginContext.existingHandle ?? '', intent: 'login' })
    setIsLoginDialogOpen(false)
    setIsOpen(true)
  }, [])

  const startHandleFlow = useCallback(async (handle: string, intent: PendingLogin['intent']) => {
    setError(null)
    setIsWorldAppLoginPending(isInWorldApp())

    let loginContext
    try {
      const cached = cachedLoginContextRef.current
      const cachedMatchesIntent = cached && isLoginContextFresh(cached) && (
        intent === 'signup' ||
        (Boolean(cached.existingSessionId) && typeof cached.existingHandle === 'string' &&
          normalizeUserHandle(cached.existingHandle) === normalizeUserHandle(handle))
      )
      loginContext = cachedMatchesIntent && cached
        ? cached
        : await fetchLoginContext(intent === 'login' ? handle : undefined)
      cachedLoginContextRef.current = loginContext
      if (intent === 'login' && !loginContext.existingSessionId) {
        throw new Error('No World ID login is linked to that name')
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not start World ID login'
      setError(message)
      setIsWorldAppLoginPending(false)
      throw error
    }

    setActiveContext({
      appId: loginContext.appId,
      environment: loginContext.environment,
      rpContext: loginContext.rpContext,
      existingSessionId: intent === 'login' ? loginContext.existingSessionId : null,
    })
    setPendingLogin({ handle, intent })
    setIsLoginDialogOpen(false)
    setIsOpen(true)
  }, [])

  const handleVerify = useCallback(async (result: IDKitResultSession) => {
    if (!activeContext) {
      const message = 'World ID login context is missing'
      setError(message)
      setIsWorldAppLoginPending(false)
      throw new Error(message)
    }

    const response = await fetch('/api/worldid/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        payload: result,
        handle: pendingLogin?.handle ?? null,
        intent: pendingLogin?.intent ?? null,
      }),
    })
    const body = await response.json() as WorldIdSessionResponse

    if (!response.ok || !body.success || !body.authenticated) {
      const message = body.success === false ? body.message : 'World ID login failed'
      setError(message)
      setIsWorldAppLoginPending(false)
      throw new Error(message)
    }

    cachedLoginContextRef.current = null
    setPendingLogin(null)
    setUser(body.user)
    setStatus('authenticated')
  }, [activeContext, pendingLogin])

  const signOut = useCallback(async () => {
    setError(null)
    cachedLoginContextRef.current = null
    setIsOpen(false)
    setIsLoginDialogOpen(false)
    setPendingLogin(null)
    setIsWorldAppLoginPending(false)
    const response = await fetch('/api/auth/logout', {
      method: 'POST',
    })
    if (!response.ok) {
      throw new Error('Failed to log out')
    }
    setUser(null)
    setStatus('unauthenticated')
    router.refresh()
  }, [router])

  const value = useMemo<WorldIdAuthContextValue>(() => ({
    user,
    status,
    error,
    isWorldAppLoginPending,
    signInWithWorldId,
    signOut,
    refreshSession,
  }), [user, status, error, isWorldAppLoginPending, signInWithWorldId, signOut, refreshSession])

  return (
    <WorldIdAuthContext.Provider value={value}>
      <WorldIdLoginDialog
        open={isLoginDialogOpen}
        onOpenChange={(open) => {
          setIsLoginDialogOpen(open)
          if (open) {
            setError(null)
          }
        }}
        onLogin={(handle) => startHandleFlow(handle, 'login')}
        onSignup={(handle) => startHandleFlow(handle, 'signup')}
        onContinue={startContinueFlow}
        continueAs={hintHandle}
        error={error}
      />
      {activeContext && (
        <IDKitSessionWidget
          key={activeContext.rpContext.nonce}
          open={isOpen}
          onOpenChange={(open) => {
            setIsOpen(open)
            if (!open) {
              setIsWorldAppLoginPending(false)
            }
          }}
          app_id={activeContext.appId}
          rp_context={activeContext.rpContext}
          environment={activeContext.environment}
          existing_session_id={activeContext.existingSessionId || undefined}
          constraints={loginConstraints}
          polling={{ interval: 1000, timeout: 120_000 }}
          handleVerify={handleVerify}
          onError={(errorCode) => {
            setIsWorldAppLoginPending(false)
            setError((current) => current || `World ID login failed: ${errorCode}`)
          }}
          onSuccess={() => {
            setError(null)
            setIsWorldAppLoginPending(false)
            setIsOpen(false)
          }}
        />
      )}
      {children}
    </WorldIdAuthContext.Provider>
  )
}
