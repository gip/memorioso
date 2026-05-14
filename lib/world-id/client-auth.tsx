'use client'

import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import {
  IDKitSessionWidget,
  CredentialRequest,
  any as anyCredential,
  type ConstraintNode,
  type IDKitResultSession,
  type RpContext,
} from '@worldcoin/idkit'
import type { WorldIdSessionResponse, WorldIdSessionUser } from '@/lib/auth-types'

type AuthContextResponse = {
  success: boolean
  appId: `app_${string}`
  environment: 'production' | 'staging'
  rpContext: RpContext
}

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated'

type WorldIdAuthContextValue = {
  user: WorldIdSessionUser | null
  status: AuthStatus
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

const WORLD_ID_SESSION_STORAGE_KEY = 'memorioso_world_id_session_id'

const WorldIdAuthContext = createContext<WorldIdAuthContextValue | null>(null)

export function useWorldIdAuth(): WorldIdAuthContextValue {
  const context = useContext(WorldIdAuthContext)
  if (!context) {
    throw new Error('useWorldIdAuth must be used inside WorldIdAuthProvider')
  }
  return context
}

export function WorldIdAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<WorldIdSessionUser | null>(null)
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [activeContext, setActiveContext] = useState<ActiveAuthContext | null>(null)
  const [isOpen, setIsOpen] = useState(false)

  const constraints = useMemo<ConstraintNode>(() => anyCredential(
    CredentialRequest('proof_of_human'),
    CredentialRequest('face'),
    CredentialRequest('passport'),
    CredentialRequest('mnc')
  ), [])

  const refreshSession = useCallback(async () => {
    setStatus('loading')
    const response = await fetch('/api/auth/session', {
      method: 'GET',
    })
    const body = await response.json() as WorldIdSessionResponse

    if (body.success && body.authenticated) {
      setUser(body.user)
      setStatus('authenticated')
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(WORLD_ID_SESSION_STORAGE_KEY, body.user.worldIdSessionId)
      }
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
    const response = await fetch('/api/auth/world-id/context', {
      method: 'POST',
    })
    const body = await response.json() as AuthContextResponse

    if (!response.ok || !body.success) {
      throw new Error('Could not start World ID login')
    }

    const existingSessionId = typeof window !== 'undefined'
      ? window.localStorage.getItem(WORLD_ID_SESSION_STORAGE_KEY) as `session_${string}` | null
      : null

    setActiveContext({
      appId: body.appId,
      environment: body.environment,
      rpContext: body.rpContext,
      existingSessionId: existingSessionId?.startsWith('session_') ? existingSessionId : null,
    })
    setIsOpen(true)
  }, [])

  const handleVerify = useCallback(async (result: IDKitResultSession) => {
    if (!activeContext) {
      throw new Error('World ID login context is missing')
    }

    const response = await fetch('/api/auth/world-id/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        payload: result,
        nonce: activeContext.rpContext.nonce,
      }),
    })
    const body = await response.json() as WorldIdSessionResponse

    if (!response.ok || !body.success || !body.authenticated) {
      throw new Error(body.success === false ? body.message : 'World ID login failed')
    }

    setUser(body.user)
    setStatus('authenticated')

    if (typeof window !== 'undefined') {
      window.localStorage.setItem(WORLD_ID_SESSION_STORAGE_KEY, result.session_id)
    }
  }, [activeContext])

  const signOut = useCallback(async () => {
    await fetch('/api/auth/logout', {
      method: 'POST',
    })
    setUser(null)
    setStatus('unauthenticated')
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(WORLD_ID_SESSION_STORAGE_KEY)
    }
  }, [])

  const value = useMemo<WorldIdAuthContextValue>(() => ({
    user,
    status,
    signInWithWorldId,
    signOut,
    refreshSession,
  }), [user, status, signInWithWorldId, signOut, refreshSession])

  return (
    <WorldIdAuthContext.Provider value={value}>
      {activeContext && (
        <IDKitSessionWidget
          open={isOpen}
          onOpenChange={setIsOpen}
          app_id={activeContext.appId}
          rp_context={activeContext.rpContext}
          environment={activeContext.environment}
          constraints={constraints}
          existing_session_id={activeContext.existingSessionId || undefined}
          handleVerify={handleVerify}
          onSuccess={() => setIsOpen(false)}
        />
      )}
      {children}
    </WorldIdAuthContext.Provider>
  )
}
