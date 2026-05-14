'use client'

import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react'
import { signIn } from 'next-auth/react'
import {
  IDKitSessionWidget,
  CredentialRequest,
  any as anyCredential,
  type ConstraintNode,
  type IDKitResultSession,
  type RpContext,
} from '@worldcoin/idkit'

type AuthContextResponse = {
  success: boolean
  appId: `app_${string}`
  environment: 'production' | 'staging'
  rpContext: RpContext
}

type WorldIdAuthContextValue = {
  signInWithWorldId: () => Promise<void>
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
  const [activeContext, setActiveContext] = useState<ActiveAuthContext | null>(null)
  const [isOpen, setIsOpen] = useState(false)

  const constraints = useMemo<ConstraintNode>(() => anyCredential(
    CredentialRequest('proof_of_human'),
    CredentialRequest('face'),
    CredentialRequest('passport'),
    CredentialRequest('mnc')
  ), [])

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

    const signInResult = await signIn('world-id', {
      payload: JSON.stringify(result),
      nonce: activeContext.rpContext.nonce,
      redirect: false,
    })

    if (signInResult?.error) {
      throw new Error(signInResult.error)
    }

    if (typeof window !== 'undefined') {
      window.localStorage.setItem(WORLD_ID_SESSION_STORAGE_KEY, result.session_id)
    }
  }, [activeContext])

  return (
    <WorldIdAuthContext.Provider value={{ signInWithWorldId }}>
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
