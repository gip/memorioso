'use client'

// The draft key, for the whole app.
//
// Drafts are unreadable without it, so every surface that shows one — the
// editor, the feeds, the drafts menu — reads it from here. It has three states
// and they are all ordinary: 'loading' while this device is checked for a cached
// key, 'unlocked' once there is one, and 'locked' when there is not, which is
// what an author sees on a browser whose session predates the key or whose
// storage was cleared.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { normalizeRecoveryCode } from '@/lib/draft-crypto'
import {
  clearLoginSecret,
  consumeLoginSecret,
  onLoginSecret,
} from '@/lib/draft-crypto/login-secret'
import { migratePlaintextDrafts } from '@/lib/draft-crypto/migrate'
import { clearCachedDraftKeys, readCachedDraftKey } from '@/lib/draft-crypto/store'
import {
  DraftKeyMismatchError,
  unlockWithRecoveryCode,
  unlockWithWorldId,
} from '@/lib/draft-crypto/unlock'
import { useWorldIdAuth } from '@/lib/world-id/client-auth'

export type DraftKeyStatus = 'loading' | 'locked' | 'unlocked'

type DraftKeyContextValue = {
  status: DraftKeyStatus
  key: CryptoKey | null
  error: string | null
  /** Shown once, when the key is first created. Dismissed by acknowledgeRecoveryCode. */
  recoveryCode: string | null
  /** True when a login happened but its proof material no longer opens the key. */
  needsRecoveryCode: boolean
  unlockWithCode: (code: string) => Promise<void>
  acknowledgeRecoveryCode: () => void
}

const DraftKeyContext = createContext<DraftKeyContextValue | null>(null)

export function useDraftKey(): DraftKeyContextValue {
  const context = useContext(DraftKeyContext)
  if (!context) {
    throw new Error('useDraftKey must be used inside DraftKeyProvider')
  }
  return context
}

export function DraftKeyProvider({ children }: { children: ReactNode }) {
  const { status: authStatus, user } = useWorldIdAuth()
  const [status, setStatus] = useState<DraftKeyStatus>('loading')
  const [key, setKey] = useState<CryptoKey | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null)
  const [needsRecoveryCode, setNeedsRecoveryCode] = useState(false)
  // Kept out of state so a failed unlock can still repair its wrapper without
  // the secret living in the component tree any longer than it has to.
  const pendingSecretRef = useRef<string | null>(null)

  const userId = user?.id ?? null

  const applyUnlock = useCallback((unlocked: { key: CryptoKey; recoveryCode?: string }) => {
    setKey(unlocked.key)
    setStatus('unlocked')
    setError(null)
    setNeedsRecoveryCode(false)
    if (unlocked.recoveryCode) setRecoveryCode(unlocked.recoveryCode)
  }, [])

  const unlockFromLogin = useCallback(async (id: number, secret: string) => {
    try {
      applyUnlock(await unlockWithWorldId(id, secret))
      pendingSecretRef.current = null
      clearLoginSecret()
    } catch (unlockError) {
      if (unlockError instanceof DraftKeyMismatchError) {
        // Hold the secret: if the author gets back in with their recovery code,
        // this is what rebuilds the wrapper so they are not asked again.
        pendingSecretRef.current = secret
        setNeedsRecoveryCode(true)
        setStatus('locked')
        setError('Your drafts need their recovery code on this sign-in.')
        return
      }
      setStatus('locked')
      setError(unlockError instanceof Error ? unlockError.message : 'Could not unlock your drafts')
    }
  }, [applyUnlock])

  // A login is the only moment World ID proof material exists, so take it as it
  // arrives — including a login that completed before this provider mounted.
  useEffect(() => {
    if (authStatus !== 'authenticated' || userId === null) return

    const secret = consumeLoginSecret()
    if (secret) {
      void unlockFromLogin(userId, secret)
      return
    }

    return onLoginSecret((published) => {
      void unlockFromLogin(userId, published)
    })
  }, [authStatus, userId, unlockFromLogin])

  // A reload has no proof material, so fall back to whatever this device cached.
  useEffect(() => {
    if (authStatus === 'loading') return

    if (authStatus !== 'authenticated' || userId === null) {
      setKey(null)
      setStatus('locked')
      setRecoveryCode(null)
      setNeedsRecoveryCode(false)
      pendingSecretRef.current = null
      return
    }

    let cancelled = false
    readCachedDraftKey(userId).then((cached) => {
      if (cancelled || !cached) {
        if (!cancelled) setStatus((current) => (current === 'loading' ? 'locked' : current))
        return
      }
      setKey((current) => current ?? cached)
      setStatus((current) => (current === 'unlocked' ? current : 'unlocked'))
    })

    return () => {
      cancelled = true
    }
  }, [authStatus, userId])

  // Sign-out has to take the key with it, or the next person at this browser
  // inherits an unlocked account.
  const previousAuthStatus = useRef(authStatus)
  useEffect(() => {
    if (previousAuthStatus.current === 'authenticated' && authStatus === 'unauthenticated') {
      void clearCachedDraftKeys()
      clearLoginSecret()
    }
    previousAuthStatus.current = authStatus
  }, [authStatus])

  const unlockWithCode = useCallback(async (code: string) => {
    if (userId === null) throw new Error('Sign in to unlock your drafts')

    setError(null)
    try {
      applyUnlock(await unlockWithRecoveryCode(
        userId,
        normalizeRecoveryCode(code),
        pendingSecretRef.current ?? undefined
      ))
      pendingSecretRef.current = null
      clearLoginSecret()
    } catch (unlockError) {
      const message = unlockError instanceof DraftKeyMismatchError
        ? 'That recovery code does not open these drafts'
        : unlockError instanceof Error ? unlockError.message : 'Could not unlock your drafts'
      setError(message)
      throw new Error(message)
    }
  }, [applyUnlock, userId])

  const acknowledgeRecoveryCode = useCallback(() => setRecoveryCode(null), [])

  // Drafts written before encryption existed are moved over once per unlock.
  // Best effort and idempotent: anything that fails is still readable, because
  // it is still plaintext, and the next unlock tries again.
  const migratedForRef = useRef<number | null>(null)
  useEffect(() => {
    if (status !== 'unlocked' || !key || userId === null) return
    if (migratedForRef.current === userId) return

    migratedForRef.current = userId
    migratePlaintextDrafts(key, userId).catch(() => {
      migratedForRef.current = null
    })
  }, [status, key, userId])

  const value = useMemo<DraftKeyContextValue>(() => ({
    status,
    key,
    error,
    recoveryCode,
    needsRecoveryCode,
    unlockWithCode,
    acknowledgeRecoveryCode,
  }), [status, key, error, recoveryCode, needsRecoveryCode, unlockWithCode, acknowledgeRecoveryCode])

  return <DraftKeyContext.Provider value={value}>{children}</DraftKeyContext.Provider>
}
