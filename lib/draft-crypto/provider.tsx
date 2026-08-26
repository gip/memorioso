'use client'

// The draft key, for the whole app.
//
// Drafts are unreadable without it, so every surface that shows one — the
// editor, the feeds, the drafts menu — reads it from here. Its states are all
// ordinary: 'loading' while this device is checked for a cached key, 'unlocked'
// once there is one, 'locked' on a browser that has never held it, 'unset'
// before the author has decided whether to encrypt at all, and 'disabled' when
// they decided not to, in which case there is no key and drafts are stored as
// prose.

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
import { migratePlaintextDrafts } from '@/lib/draft-crypto/migrate'
import { clearCachedDraftKeys, readCachedDraftKey } from '@/lib/draft-crypto/store'
import {
  createDraftKey,
  declineDraftEncryption,
  fetchDraftKeyState,
  setPassphrase as storePassphrase,
  unlockWithPassphrase,
  unlockWithRecoveryCode,
  DraftKeyMismatchError,
} from '@/lib/draft-crypto/unlock'
import { useWorldIdAuth } from '@/lib/world-id/client-auth'

export type DraftKeyStatus = 'loading' | 'unset' | 'locked' | 'unlocked' | 'disabled'

type DraftKeyContextValue = {
  status: DraftKeyStatus
  key: CryptoKey | null
  error: string | null
  /** Shown once, when the key is first created. Dismissed by acknowledgeRecoveryCode. */
  recoveryCode: string | null
  /** True after a recovery-code unlock, while a new passphrase can still be set. */
  canSetPassphrase: boolean
  /** From 'unset': creates the key behind this passphrase and a recovery code. */
  enableEncryption: (passphrase: string) => Promise<void>
  /** From 'unset': records that this author does not want their drafts encrypted. */
  skipEncryption: () => Promise<void>
  unlockWithPassphrase: (passphrase: string) => Promise<void>
  unlockWithCode: (code: string) => Promise<void>
  resetPassphrase: (passphrase: string) => Promise<void>
  dismissPassphraseReset: () => void
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

const messageFor = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback

export function DraftKeyProvider({ children }: { children: ReactNode }) {
  const { status: authStatus, user } = useWorldIdAuth()
  const [status, setStatus] = useState<DraftKeyStatus>('loading')
  const [key, setKey] = useState<CryptoKey | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null)
  const [canSetPassphrase, setCanSetPassphrase] = useState(false)
  // Kept out of state so the raw key bytes a recovery unlock produced are not
  // sitting in the component tree; they live only until a passphrase is set or
  // the offer is dismissed.
  const pendingDekRef = useRef<Uint8Array | null>(null)

  const userId = user?.id ?? null

  const applyKey = useCallback((unlocked: CryptoKey) => {
    setKey(unlocked)
    setStatus('unlocked')
    setError(null)
  }, [])

  // A page load has no secret in hand, so the device cache is the only way in
  // that costs the author nothing. What it cannot answer — whether this author
  // wants encryption at all — comes from the server alongside it.
  useEffect(() => {
    if (authStatus === 'loading') return

    if (authStatus !== 'authenticated' || userId === null) {
      setKey(null)
      setStatus('locked')
      setError(null)
      setRecoveryCode(null)
      setCanSetPassphrase(false)
      pendingDekRef.current = null
      return
    }

    let cancelled = false
    setStatus('loading')

    Promise.all([
      readCachedDraftKey(userId),
      fetchDraftKeyState().catch(() => null),
    ]).then(([cached, state]) => {
      if (cancelled) return

      if (cached) {
        setKey(cached)
        setStatus('unlocked')
        return
      }

      if (!state) {
        // The choice is unknown, so assume the safer of the two: prompting for a
        // passphrase costs a click, writing prose on a wrong guess does not undo.
        setStatus('locked')
        setError('Could not check how your drafts are stored')
        return
      }

      if (state.encryption === 'none' && state.wrappers.length === 0) {
        setStatus('disabled')
        return
      }
      setStatus(state.encryption === null && state.wrappers.length === 0 ? 'unset' : 'locked')
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
    }
    previousAuthStatus.current = authStatus
  }, [authStatus])

  const enableEncryption = useCallback(async (passphrase: string) => {
    if (userId === null) throw new Error('Sign in to encrypt your drafts')

    setError(null)
    try {
      const created = await createDraftKey(userId, passphrase)
      applyKey(created.key)
      setRecoveryCode(created.recoveryCode)
    } catch (creationError) {
      const message = messageFor(creationError, 'Could not encrypt your drafts')
      setError(message)
      throw new Error(message)
    }
  }, [applyKey, userId])

  const skipEncryption = useCallback(async () => {
    setError(null)
    try {
      await declineDraftEncryption()
      setKey(null)
      setStatus('disabled')
    } catch (choiceError) {
      const message = messageFor(choiceError, 'Could not save that choice')
      setError(message)
      throw new Error(message)
    }
  }, [])

  const unlock = useCallback(async (passphrase: string) => {
    if (userId === null) throw new Error('Sign in to unlock your drafts')

    setError(null)
    try {
      applyKey(await unlockWithPassphrase(userId, passphrase))
    } catch (unlockError) {
      // A mismatch already says which secret was wrong, and which one to reach
      // for instead; only an unexpected failure needs a message inventing.
      const message = unlockError instanceof DraftKeyMismatchError
        ? unlockError.message
        : messageFor(unlockError, 'Could not unlock your drafts')
      setError(message)
      throw new Error(message)
    }
  }, [applyKey, userId])

  const unlockWithCode = useCallback(async (code: string) => {
    if (userId === null) throw new Error('Sign in to unlock your drafts')

    setError(null)
    try {
      const recovered = await unlockWithRecoveryCode(userId, normalizeRecoveryCode(code))
      applyKey(recovered.key)
      // The code got them in, but it is not something to type every time. This
      // is the only moment the raw key exists, so the offer stands only now.
      pendingDekRef.current = recovered.dekBytes
      setCanSetPassphrase(true)
    } catch (unlockError) {
      const message = unlockError instanceof DraftKeyMismatchError
        ? unlockError.message
        : messageFor(unlockError, 'Could not unlock your drafts')
      setError(message)
      throw new Error(message)
    }
  }, [applyKey, userId])

  const resetPassphrase = useCallback(async (passphrase: string) => {
    const dekBytes = pendingDekRef.current
    if (!dekBytes) throw new Error('Unlock your drafts before setting a passphrase')

    setError(null)
    try {
      await storePassphrase(dekBytes, passphrase)
      pendingDekRef.current = null
      setCanSetPassphrase(false)
    } catch (resetError) {
      const message = messageFor(resetError, 'Could not set that passphrase')
      setError(message)
      throw new Error(message)
    }
  }, [])

  const dismissPassphraseReset = useCallback(() => {
    pendingDekRef.current = null
    setCanSetPassphrase(false)
  }, [])

  const acknowledgeRecoveryCode = useCallback(() => setRecoveryCode(null), [])

  // Drafts written before this author had a key are moved over once per unlock.
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
    canSetPassphrase,
    enableEncryption,
    skipEncryption,
    unlockWithPassphrase: unlock,
    unlockWithCode,
    resetPassphrase,
    dismissPassphraseReset,
    acknowledgeRecoveryCode,
  }), [
    status, key, error, recoveryCode, canSetPassphrase, enableEncryption, skipEncryption,
    unlock, unlockWithCode, resetPassphrase, dismissPassphraseReset, acknowledgeRecoveryCode,
  ])

  return <DraftKeyContext.Provider value={value}>{children}</DraftKeyContext.Provider>
}
