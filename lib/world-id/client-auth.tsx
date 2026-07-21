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
  CredentialRequest,
  IDKitSessionWidget,
  any as anyCredential,
  type ConstraintNode,
  type IDKitResultSession,
  type RpContext,
} from '@worldcoin/idkit'
import type { WorldIdSessionResponse, WorldIdSessionUser } from '@/lib/auth-types'
import { isWorldIdSessionId, WORLD_ID_LOGIN_CREDENTIALS } from '@/lib/world-id/constants'
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
  worldAppLoginDiagnostic: string | null
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
  IDKIT_DEBUG?: boolean
  WorldApp?: {
    world_app_version?: number
    device_os?: string
    supported_commands?: Array<{
      name: string
      supported_versions?: number[]
    }>
  }
  Android?: {
    postMessage?: (payload: string) => void
  }
  webkit?: {
    messageHandlers?: {
      minikit?: {
        postMessage?: (payload: unknown) => void
      }
    }
  }
}

export function isInWorldApp(): boolean {
  return typeof window !== 'undefined' && Boolean((window as WorldAppWindow).WorldApp)
}

function getWorldAppVerifyVersions(): number[] | null {
  if (typeof window === 'undefined') {
    return null
  }

  const supportedCommands = (window as WorldAppWindow).WorldApp?.supported_commands
  if (!Array.isArray(supportedCommands)) {
    return null
  }

  return supportedCommands.find((command) => command.name === 'verify')?.supported_versions || null
}

function getWorldAppBridgeName(): string | null {
  if (typeof window === 'undefined') {
    return null
  }

  const worldAppWindow = window as WorldAppWindow
  if (typeof worldAppWindow.webkit?.messageHandlers?.minikit?.postMessage === 'function') {
    return 'ios'
  }
  if (typeof worldAppWindow.Android?.postMessage === 'function') {
    return 'android'
  }

  return null
}

function getWorldAppDiagnostic(step?: string): string | null {
  if (!isInWorldApp()) {
    return step || null
  }

  const worldApp = (window as WorldAppWindow).WorldApp
  const verifyVersions = getWorldAppVerifyVersions()
  const verifyLabel = verifyVersions?.length ? verifyVersions.join(',') : 'missing'
  const bridgeName = getWorldAppBridgeName() || 'missing'
  const version = worldApp?.world_app_version ? `World App ${worldApp.world_app_version}` : 'World App'
  const os = worldApp?.device_os ? ` on ${worldApp.device_os}` : ''

  const diagnostic = `${version}${os}; verify=${verifyLabel}; bridge=${bridgeName}`
  return step ? `${step}. ${diagnostic}` : diagnostic
}

function logWorldIdAuthStep(step: string, details?: Record<string, unknown>): void {
  if (process.env.NODE_ENV === 'production') {
    return
  }

  console.info('[world-id] login step', {
    step,
    ...details,
  })
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
}

function isWorldIdLoginContext(value: unknown): value is WorldIdLoginContext {
  return isRecord(value) &&
    value.success === true &&
    typeof value.appId === 'string' &&
    value.appId.startsWith('app_') &&
    (value.environment === 'production' || value.environment === 'staging') &&
    isRpContext(value.rpContext) &&
    (value.existingSessionId === null || isWorldIdSessionId(value.existingSessionId))
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
  const [error, setError] = useState<string | null>(null)
  const [activeContext, setActiveContext] = useState<ActiveAuthContext | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [isLoginDialogOpen, setIsLoginDialogOpen] = useState(false)
  const [pendingLogin, setPendingLogin] = useState<PendingLogin | null>(null)
  const [isWorldAppLoginPending, setIsWorldAppLoginPending] = useState(false)
  const [worldAppLoginDiagnostic, setWorldAppLoginDiagnostic] = useState<string | null>(null)

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
    setIsWorldAppLoginPending(isInWorldApp())
    setWorldAppLoginDiagnostic(getWorldAppDiagnostic('Fetching RP context'))
    if (typeof window !== 'undefined') {
      (window as WorldAppWindow).IDKIT_DEBUG = process.env.NODE_ENV !== 'production'
    }
    logWorldIdAuthStep('start-widget-login', {
      inWorldApp: isInWorldApp(),
      bridge: getWorldAppBridgeName(),
      verifyVersions: getWorldAppVerifyVersions(),
    })

    let loginContext
    try {
      loginContext = await fetchLoginContext()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not start World ID login'
      setError(message)
      setIsWorldAppLoginPending(false)
      setWorldAppLoginDiagnostic(getWorldAppDiagnostic('World ID login failed'))
      throw error
    }

    if (!loginContext.existingSessionId) {
      // No session hint on this browser: ask for a name so the account can be
      // found (log in) or created cross-device.
      setIsWorldAppLoginPending(false)
      setWorldAppLoginDiagnostic(null)
      setPendingLogin(null)
      setIsLoginDialogOpen(true)
      return
    }

    setActiveContext({
      appId: loginContext.appId,
      environment: loginContext.environment,
      rpContext: loginContext.rpContext,
      existingSessionId: loginContext.existingSessionId,
    })
    setPendingLogin(null)
    setWorldAppLoginDiagnostic(getWorldAppDiagnostic('Opening IDKit session widget'))
    logWorldIdAuthStep('open-session-widget', {
      hasExistingSessionId: true,
    })
    setIsOpen(true)
  }, [])

  const startHandleFlow = useCallback(async (handle: string, intent: PendingLogin['intent']) => {
    setError(null)
    setIsWorldAppLoginPending(isInWorldApp())
    setWorldAppLoginDiagnostic(getWorldAppDiagnostic('Fetching RP context'))

    let loginContext
    try {
      loginContext = await fetchLoginContext(intent === 'login' ? handle : undefined)
      if (intent === 'login' && !loginContext.existingSessionId) {
        throw new Error('No World ID login is linked to that name')
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not start World ID login'
      setError(message)
      setIsWorldAppLoginPending(false)
      setWorldAppLoginDiagnostic(getWorldAppDiagnostic('World ID login failed'))
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
    setWorldAppLoginDiagnostic(getWorldAppDiagnostic('Opening IDKit session widget'))
    logWorldIdAuthStep('open-session-widget', {
      intent,
      hasExistingSessionId: intent === 'login',
    })
    setIsOpen(true)
  }, [])

  const handleVerify = useCallback(async (result: IDKitResultSession) => {
    if (!activeContext) {
      const message = 'World ID login context is missing'
      setError(message)
      setIsWorldAppLoginPending(false)
      setWorldAppLoginDiagnostic(getWorldAppDiagnostic('World ID login failed'))
      throw new Error(message)
    }

    setWorldAppLoginDiagnostic(getWorldAppDiagnostic('World ID proof received'))
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
      setWorldAppLoginDiagnostic(getWorldAppDiagnostic('World ID login failed'))
      throw new Error(message)
    }

    setPendingLogin(null)
    setUser(body.user)
    setStatus('authenticated')
  }, [activeContext, pendingLogin])

  const signOut = useCallback(async () => {
    setError(null)
    setIsOpen(false)
    setIsLoginDialogOpen(false)
    setPendingLogin(null)
    setIsWorldAppLoginPending(false)
    setWorldAppLoginDiagnostic(null)
    await fetch('/api/auth/logout', {
      method: 'POST',
    })
    setUser(null)
    setStatus('unauthenticated')
  }, [])

  const value = useMemo<WorldIdAuthContextValue>(() => ({
    user,
    status,
    error,
    isWorldAppLoginPending,
    worldAppLoginDiagnostic,
    signInWithWorldId,
    signOut,
    refreshSession,
  }), [user, status, error, isWorldAppLoginPending, worldAppLoginDiagnostic, signInWithWorldId, signOut, refreshSession])

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
            setWorldAppLoginDiagnostic(getWorldAppDiagnostic('World ID login failed'))
            setError((current) => current || `World ID login failed: ${errorCode}`)
          }}
          onSuccess={() => {
            setError(null)
            setIsWorldAppLoginPending(false)
            setWorldAppLoginDiagnostic(null)
            setIsOpen(false)
          }}
        />
      )}
      {children}
    </WorldIdAuthContext.Provider>
  )
}
