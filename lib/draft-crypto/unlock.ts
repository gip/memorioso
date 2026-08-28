'use client'

// Getting hold of the author's draft key.
//
// Two ways in, both landing on the same key: a passphrase the author chose, and
// a recovery code shown once when the key was created, which is what remains
// when the passphrase is forgotten. The server stores both wrappers and can open
// neither.
//
// An author may also decline encryption entirely, which is recorded here and
// nowhere else: there is no key in that case, and drafts are stored as prose.

import {
  deriveWrapperKey,
  generateDekBytes,
  generateRecoveryCode,
  generateSalt,
  importDek,
  normalizeRecoveryCode,
  toBase64Url,
  fromBase64Url,
  unwrapDek,
  wrapDek,
  PBKDF2_ITERATIONS,
  type DraftKeyWrapperName,
} from '@/lib/draft-crypto'
import { writeCachedDraftKey } from '@/lib/draft-crypto/store'

export type StoredWrapper = {
  wrapper: DraftKeyWrapperName
  kdfSalt: string
  /** PBKDF2 cost. Set for 'passphrase', absent for 'recovery', which needs none. */
  kdfIterations?: number | null
  kekFingerprint: string
  wrappedDek: string
}

/** What the author decided about draft encryption, or null if they have not yet. */
export type DraftEncryptionChoice = 'passphrase' | 'none'

export type DraftKeyState = {
  encryption: DraftEncryptionChoice | null
  wrappers: StoredWrapper[]
}

/** A key plus, when this call created it, the one showing of the recovery code. */
export type CreatedDraftKey = {
  key: CryptoKey
  recoveryCode: string
}

/**
 * A recovery-code unlock hands back the raw key bytes as well as the key.
 * Setting a fresh passphrase needs them, and this is the only moment they exist:
 * the cached key is imported non-extractable and cannot be read back out.
 */
export type RecoveredDraftKey = {
  key: CryptoKey
  dekBytes: Uint8Array
}

/** Thrown when a secret is valid input but does not open this author's key. */
export class DraftKeyMismatchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DraftKeyMismatchError'
  }
}

export async function fetchDraftKeyState(): Promise<DraftKeyState> {
  const response = await fetch('/api/draft-keys')
  const body = await response.json() as {
    success?: boolean
    encryption?: DraftEncryptionChoice | null
    wrappers?: StoredWrapper[]
    message?: string
  }
  if (!response.ok || !body.success) {
    throw new Error(body.message || 'Could not read the draft key')
  }
  return { encryption: body.encryption ?? null, wrappers: body.wrappers || [] }
}

async function storeWrappers(wrappers: StoredWrapper[]): Promise<void> {
  const response = await fetch('/api/draft-keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wrappers }),
  })
  const body = await response.json() as { success?: boolean; message?: string }
  if (!response.ok || !body.success) {
    throw new Error(body.message || 'Could not store the draft key')
  }
}

async function buildWrapper(
  name: DraftKeyWrapperName,
  secret: string,
  dekBytes: Uint8Array
): Promise<StoredWrapper> {
  const salt = generateSalt()
  const iterations = name === 'passphrase' ? PBKDF2_ITERATIONS : undefined
  const { kek, fingerprint } = await deriveWrapperKey(name, secret, salt, iterations)
  return {
    wrapper: name,
    kdfSalt: toBase64Url(salt),
    ...(iterations === undefined ? {} : { kdfIterations: iterations }),
    kekFingerprint: fingerprint,
    wrappedDek: toBase64Url(await wrapDek(kek, dekBytes)),
  }
}

async function openWrapper(stored: StoredWrapper, secret: string): Promise<Uint8Array> {
  const salt = fromBase64Url(stored.kdfSalt)
  const { kek, fingerprint } = await deriveWrapperKey(
    stored.wrapper,
    secret,
    salt,
    stored.kdfIterations ?? undefined
  )

  // The fingerprint turns "this is not the right secret" into something the
  // caller can act on, instead of the indistinguishable failure AES-GCM gives.
  if (fingerprint !== stored.kekFingerprint) {
    throw new DraftKeyMismatchError(
      stored.wrapper === 'passphrase'
        ? 'That passphrase does not open these drafts'
        : 'That recovery code does not open these drafts'
    )
  }

  return unwrapDek(kek, fromBase64Url(stored.wrappedDek))
}

async function adopt(userId: number, dekBytes: Uint8Array): Promise<CryptoKey> {
  const key = await importDek(dekBytes)
  await writeCachedDraftKey(userId, key)
  return key
}

/**
 * Creates the author's key, wrapped by their new passphrase and by a recovery
 * code. Both wrappers are written together: a key with only a passphrase behind
 * it has no way back if the passphrase is forgotten.
 */
export async function createDraftKey(userId: number, passphrase: string): Promise<CreatedDraftKey> {
  // The recovery code exists only in this return value. It is stored nowhere
  // readable, so if it is not shown to the author now it is gone for good.
  const dekBytes = generateDekBytes()
  const recoveryCode = generateRecoveryCode()

  await storeWrappers([
    await buildWrapper('passphrase', passphrase, dekBytes),
    await buildWrapper('recovery', normalizeRecoveryCode(recoveryCode), dekBytes),
  ])

  return { key: await adopt(userId, dekBytes), recoveryCode }
}

/** Unlocks on a device that has no cached key, with the author's passphrase. */
export async function unlockWithPassphrase(userId: number, passphrase: string): Promise<CryptoKey> {
  const stored = (await fetchDraftKeyState()).wrappers.find((entry) => entry.wrapper === 'passphrase')
  // An author carried over from the World ID wrapper has no passphrase yet.
  // Telling them their passphrase is wrong would send them looking for a typo.
  if (!stored) {
    throw new DraftKeyMismatchError('These drafts open with your recovery code')
  }

  return adopt(userId, await openWrapper(stored, passphrase))
}

/**
 * Unlocks with the recovery code, which is the way back from a forgotten
 * passphrase. The caller gets the key bytes too, so it can offer to set a new
 * passphrase while they are still in hand.
 */
export async function unlockWithRecoveryCode(
  userId: number,
  normalizedCode: string
): Promise<RecoveredDraftKey> {
  const stored = (await fetchDraftKeyState()).wrappers.find((entry) => entry.wrapper === 'recovery')
  if (!stored) {
    throw new DraftKeyMismatchError('This account has no recovery code')
  }

  const dekBytes = await openWrapper(stored, normalizedCode)
  return { key: await adopt(userId, dekBytes), dekBytes }
}

/**
 * Re-wraps the existing key under a new passphrase. The drafts themselves are
 * untouched — that is the whole reason the DEK is wrapped rather than derived.
 */
export async function setPassphrase(dekBytes: Uint8Array, passphrase: string): Promise<void> {
  await storeWrappers([await buildWrapper('passphrase', passphrase, dekBytes)])
}

/**
 * Records that the author does not want their drafts encrypted. Refused by the
 * server once a key exists, because turning encryption off would strand every
 * draft already sealed under it.
 */
export async function declineDraftEncryption(): Promise<void> {
  const response = await fetch('/api/draft-keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ encryption: 'none' }),
  })
  const body = await response.json() as { success?: boolean; message?: string }
  if (!response.ok || !body.success) {
    throw new Error(body.message || 'Could not save that choice')
  }
}
