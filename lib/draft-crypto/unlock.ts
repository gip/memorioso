'use client'

// Getting hold of the author's draft key.
//
// Two ways in, both landing on the same key: World ID proof material, which
// needs nothing remembered and is available exactly when the author logs in, and
// a recovery code, which is what remains when the first one stops working. The
// server stores both wrappers and can open neither.

import {
  deriveKek,
  generateDekBytes,
  generateRecoveryCode,
  generateSalt,
  importDek,
  kekFingerprint,
  toBase64Url,
  fromBase64Url,
  unwrapDek,
  wrapDek,
  type DraftKeyWrapperName,
} from '@/lib/draft-crypto'
import { writeCachedDraftKey } from '@/lib/draft-crypto/store'

export type StoredWrapper = {
  wrapper: DraftKeyWrapperName
  kdfSalt: string
  kekFingerprint: string
  wrappedDek: string
}

export type DraftKeyUnlock = {
  key: CryptoKey
  /** Set only when this call created the key, because it is the one chance to show it. */
  recoveryCode?: string
}

/** Thrown when a secret is valid input but does not open this author's key. */
export class DraftKeyMismatchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DraftKeyMismatchError'
  }
}

async function fetchWrappers(): Promise<StoredWrapper[]> {
  const response = await fetch('/api/draft-keys')
  const body = await response.json() as { success?: boolean; wrappers?: StoredWrapper[]; message?: string }
  if (!response.ok || !body.success) {
    throw new Error(body.message || 'Could not read the draft key')
  }
  return body.wrappers || []
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
  const kek = await deriveKek(name, secret, salt)
  return {
    wrapper: name,
    kdfSalt: toBase64Url(salt),
    kekFingerprint: await kekFingerprint(secret, salt),
    wrappedDek: toBase64Url(await wrapDek(kek, dekBytes)),
  }
}

async function openWrapper(stored: StoredWrapper, secret: string): Promise<Uint8Array> {
  const salt = fromBase64Url(stored.kdfSalt)

  // The fingerprint turns "this is not the right key" into something the caller
  // can act on, instead of the indistinguishable failure AES-GCM would give.
  if (await kekFingerprint(secret, salt) !== stored.kekFingerprint) {
    throw new DraftKeyMismatchError('That key does not open these drafts')
  }

  const kek = await deriveKek(stored.wrapper, secret, salt)
  return unwrapDek(kek, fromBase64Url(stored.wrappedDek))
}

async function adopt(userId: number, dekBytes: Uint8Array): Promise<CryptoKey> {
  const key = await importDek(dekBytes)
  await writeCachedDraftKey(userId, key)
  return key
}

/**
 * Unlocks with World ID proof material, creating the key on first use.
 *
 * Called right after a login, which is the only moment the secret exists. A
 * DraftKeyMismatchError here means that material stopped reproducing; the caller
 * should ask for the recovery code rather than overwrite a wrapper that still
 * opens the author's drafts.
 */
export async function unlockWithWorldId(userId: number, worldIdSecret: string): Promise<DraftKeyUnlock> {
  const wrappers = await fetchWrappers()

  if (wrappers.length === 0) {
    // The recovery code exists only in this return value. It is stored nowhere
    // readable, so if it is not shown to the author now it is gone for good.
    const dekBytes = generateDekBytes()
    const recoveryCode = generateRecoveryCode()

    await storeWrappers([
      await buildWrapper('worldid', worldIdSecret, dekBytes),
      await buildWrapper('recovery', recoveryCode.replace(/-/g, ''), dekBytes),
    ])

    return { key: await adopt(userId, dekBytes), recoveryCode }
  }

  const stored = wrappers.find((entry) => entry.wrapper === 'worldid')
  if (!stored) {
    throw new DraftKeyMismatchError('These drafts open with a recovery code')
  }

  return { key: await adopt(userId, await openWrapper(stored, worldIdSecret)) }
}

/**
 * Unlocks with the recovery code, on a device that has never held the key.
 *
 * When the caller still holds World ID proof material from the login that just
 * failed to unlock, the 'worldid' wrapper is rebuilt around it here — this is the
 * only moment the raw key bytes and a fresh secret exist together, and doing it
 * now is what stops the author from typing the code again on every device.
 */
export async function unlockWithRecoveryCode(
  userId: number,
  normalizedCode: string,
  worldIdSecret?: string
): Promise<DraftKeyUnlock> {
  const stored = (await fetchWrappers()).find((entry) => entry.wrapper === 'recovery')
  if (!stored) {
    throw new DraftKeyMismatchError('This account has no recovery code')
  }

  const dekBytes = await openWrapper(stored, normalizedCode)
  const key = await adopt(userId, dekBytes)

  if (worldIdSecret) {
    // Best effort: the author is already unlocked, and a failure here only means
    // they are asked for the code again next time.
    await storeWrappers([await buildWrapper('worldid', worldIdSecret, dekBytes)]).catch(() => {})
  }

  return { key }
}

/** Replaces the recovery code, keeping the same underlying draft key. */
export async function replaceRecoveryCode(dekBytes: Uint8Array): Promise<string> {
  const recoveryCode = generateRecoveryCode()
  await storeWrappers([await buildWrapper('recovery', recoveryCode.replace(/-/g, ''), dekBytes)])
  return recoveryCode
}
