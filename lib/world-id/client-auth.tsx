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
import { MiniKit } from '@worldcoin/minikit-js'
import type { WalletAuthResult } from '@worldcoin/minikit-js/commands'
import type { WalletSessionResponse, WalletSessionUser } from '@/lib/auth-types'

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated'

type WalletAuthContextValue = {
  user: WalletSessionUser | null
  status: AuthStatus
  error: string | null
  isWalletAuthPending: boolean
  walletAuthDiagnostic: string | null
  signInWithWallet: () => Promise<void>
  signOut: () => Promise<void>
  refreshSession: () => Promise<void>
}

type WalletNonceResponse =
  | {
      success: true
      nonce: string
      statement: string
      expiresAt: string
    }
  | {
      success: false
      message: string
    }

type WorldAppWindow = Window & {
  WorldApp?: {
    world_app_version?: number
    device_os?: string
    supported_commands?: Array<{
      name: string
      supported_versions?: number[]
    }>
  }
}

const WalletAuthContext = createContext<WalletAuthContextValue | null>(null)

function getClientWorldIdAppId(): string | null {
  return process.env.NEXT_PUBLIC_WORLD_ID_APP_ID || null
}

function isInWorldApp(): boolean {
  return typeof window !== 'undefined' && Boolean((window as WorldAppWindow).WorldApp)
}

function getWorldAppWalletAuthVersions(): number[] | null {
  if (typeof window === 'undefined') {
    return null
  }

  const supportedCommands = (window as WorldAppWindow).WorldApp?.supported_commands
  if (!Array.isArray(supportedCommands)) {
    return null
  }

  return supportedCommands.find((command) => command.name === 'wallet-auth')?.supported_versions || null
}

function getWalletAuthDiagnostic(step?: string): string | null {
  if (!isInWorldApp()) {
    return step || null
  }

  const worldApp = (window as WorldAppWindow).WorldApp
  const walletAuthVersions = getWorldAppWalletAuthVersions()
  const walletAuthLabel = walletAuthVersions?.length ? walletAuthVersions.join(',') : 'missing'
  const version = worldApp?.world_app_version ? `World App ${worldApp.world_app_version}` : 'World App'
  const os = worldApp?.device_os ? ` on ${worldApp.device_os}` : ''
  const diagnostic = `${version}${os}; wallet-auth=${walletAuthLabel}`

  return step ? `${step}. ${diagnostic}` : diagnostic
}

function logWalletAuthStep(step: string, details?: Record<string, unknown>): void {
  if (process.env.NODE_ENV === 'production') {
    return
  }

  console.info('[wallet-auth] login step', {
    step,
    ...details,
  })
}

async function fetchWalletNonce(): Promise<Extract<WalletNonceResponse, { success: true }>> {
  const response = await fetch('/api/auth/wallet/nonce', {
    cache: 'no-store',
  })
  const body = await response.json().catch(() => null) as WalletNonceResponse | null

  if (!response.ok || !body || !body.success) {
    const message = body && !body.success ? body.message : 'Could not start wallet login'
    throw new Error(message)
  }

  return body
}

async function verifyWalletAuth(
  payload: WalletAuthResult,
  nonce: string
): Promise<Extract<WalletSessionResponse, { success: true; authenticated: true }>> {
  const response = await fetch('/api/auth/wallet/verify', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      payload,
      nonce,
    }),
  })
  const body = await response.json() as WalletSessionResponse

  if (!response.ok || !body.success || !body.authenticated) {
    const message = body.success === false ? body.message : 'Wallet login failed'
    throw new Error(message)
  }

  return body
}

export function useWorldIdAuth(): WalletAuthContextValue {
  const context = useContext(WalletAuthContext)
  if (!context) {
    throw new Error('useWorldIdAuth must be used inside WorldIdAuthProvider')
  }
  return context
}

export function WorldIdAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<WalletSessionUser | null>(null)
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [error, setError] = useState<string | null>(null)
  const [isWalletAuthPending, setIsWalletAuthPending] = useState(false)
  const [walletAuthDiagnostic, setWalletAuthDiagnostic] = useState<string | null>(null)

  const refreshSession = useCallback(async () => {
    setStatus('loading')
    const response = await fetch('/api/auth/session', {
      method: 'GET',
    })
    const body = await response.json() as WalletSessionResponse

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

  const signInWithWallet = useCallback(async () => {
    const appId = getClientWorldIdAppId()
    if (!appId) {
      const message = 'NEXT_PUBLIC_WORLD_ID_APP_ID is required'
      setError(message)
      throw new Error(message)
    }

    setError(null)
    setIsWalletAuthPending(true)
    setWalletAuthDiagnostic(getWalletAuthDiagnostic('Starting wallet login'))
    logWalletAuthStep('start-wallet-login', {
      inWorldApp: isInWorldApp(),
      walletAuthVersions: getWorldAppWalletAuthVersions(),
    })

    const installResult = MiniKit.install(appId)
    if (!installResult.success) {
      const message = 'Open Memorioso in World App to log in'
      setError(message)
      setIsWalletAuthPending(false)
      setWalletAuthDiagnostic(getWalletAuthDiagnostic('Wallet login unavailable'))
      throw new Error(message)
    }

    let nonceResponse
    try {
      setWalletAuthDiagnostic(getWalletAuthDiagnostic('Fetching wallet nonce'))
      nonceResponse = await fetchWalletNonce()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not start wallet login'
      setError(message)
      setIsWalletAuthPending(false)
      setWalletAuthDiagnostic(getWalletAuthDiagnostic('Wallet login failed'))
      throw error
    }

    try {
      setWalletAuthDiagnostic(getWalletAuthDiagnostic('Opening wallet signature request'))
      const result = await MiniKit.walletAuth({
        nonce: nonceResponse.nonce,
        statement: nonceResponse.statement,
        expirationTime: new Date(nonceResponse.expiresAt),
      })

      if (result.executedWith !== 'minikit') {
        throw new Error('Open Memorioso in World App to log in')
      }

      setWalletAuthDiagnostic(getWalletAuthDiagnostic('Wallet signature received'))
      const body = await verifyWalletAuth(result.data, nonceResponse.nonce)
      if (!body.authenticated) {
        throw new Error('Wallet login failed')
      }

      setUser(body.user)
      setStatus('authenticated')
      setError(null)
      setIsWalletAuthPending(false)
      setWalletAuthDiagnostic(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Wallet login failed'
      setError(message)
      setIsWalletAuthPending(false)
      setWalletAuthDiagnostic(getWalletAuthDiagnostic('Wallet login failed'))
      throw error
    }
  }, [])

  const signOut = useCallback(async () => {
    setError(null)
    setIsWalletAuthPending(false)
    setWalletAuthDiagnostic(null)
    await fetch('/api/auth/logout', {
      method: 'POST',
    })
    setUser(null)
    setStatus('unauthenticated')
  }, [])

  const value = useMemo<WalletAuthContextValue>(() => ({
    user,
    status,
    error,
    isWalletAuthPending,
    walletAuthDiagnostic,
    signInWithWallet,
    signOut,
    refreshSession,
  }), [user, status, error, isWalletAuthPending, walletAuthDiagnostic, signInWithWallet, signOut, refreshSession])

  return (
    <WalletAuthContext.Provider value={value}>
      {children}
    </WalletAuthContext.Provider>
  )
}
