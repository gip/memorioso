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
  IDKitRequestWidget,
  proofOfHuman,
  type IDKitResult,
  type Preset,
  type RpContext,
} from '@worldcoin/idkit'
import type { WorldIdSessionResponse, WorldIdSessionUser } from '@/lib/auth-types'

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated'

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
  action: string
  environment: 'production' | 'staging'
  rpContext: RpContext
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

function getClientWorldIdAppId(): `app_${string}` | null {
  const appId = process.env.NEXT_PUBLIC_WORLD_ID_APP_ID
  return appId?.startsWith('app_') ? appId as `app_${string}` : null
}

function getClientWorldIdEnvironment(): 'production' | 'staging' {
  return process.env.NEXT_PUBLIC_WORLD_ID_ENVIRONMENT === 'staging' ? 'staging' : 'production'
}

function isInWorldApp(): boolean {
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

function createWorldIdLoginPreset(): Preset {
  return proofOfHuman()
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
  action: string
  rpContext: RpContext
}

function isWorldIdLoginContext(value: unknown): value is WorldIdLoginContext {
  return isRecord(value) &&
    typeof value.action === 'string' &&
    isRpContext(value.rpContext)
}

async function fetchLoginContext(): Promise<WorldIdLoginContext> {
  const response = await fetch('/api/worldid/rp-context', {
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
  const [isWorldAppLoginPending, setIsWorldAppLoginPending] = useState(false)
  const [worldAppLoginDiagnostic, setWorldAppLoginDiagnostic] = useState<string | null>(null)

  const loginPreset = useMemo<Preset>(() => createWorldIdLoginPreset(), [])

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
    const appId = getClientWorldIdAppId()
    if (!appId) {
      const message = 'NEXT_PUBLIC_WORLD_ID_APP_ID is required'
      setError(message)
      throw new Error(message)
    }

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

    setActiveContext({
      appId,
      action: loginContext.action,
      environment: getClientWorldIdEnvironment(),
      rpContext: loginContext.rpContext,
    })
    setWorldAppLoginDiagnostic(getWorldAppDiagnostic('Opening IDKit request widget'))
    logWorldIdAuthStep('open-request-widget', {
      action: loginContext.action,
    })
    setIsOpen(true)
  }, [])

  const handleVerify = useCallback(async (result: IDKitResult) => {
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
      body: JSON.stringify(result),
    })
    const body = await response.json() as WorldIdSessionResponse

    if (!response.ok || !body.success || !body.authenticated) {
      const message = body.success === false ? body.message : 'World ID login failed'
      setError(message)
      setIsWorldAppLoginPending(false)
      setWorldAppLoginDiagnostic(getWorldAppDiagnostic('World ID login failed'))
      throw new Error(message)
    }

    setUser(body.user)
    setStatus('authenticated')
  }, [activeContext])

  const signOut = useCallback(async () => {
    setError(null)
    setIsOpen(false)
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
      {activeContext && (
        <IDKitRequestWidget
          key={activeContext.rpContext.nonce}
          open={isOpen}
          onOpenChange={(open) => {
            setIsOpen(open)
            if (!open) {
              setIsWorldAppLoginPending(false)
            }
          }}
          app_id={activeContext.appId}
          action={activeContext.action}
          rp_context={activeContext.rpContext}
          environment={activeContext.environment}
          allow_legacy_proofs={false}
          preset={loginPreset}
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
