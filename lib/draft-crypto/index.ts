// Client-side draft encryption.
//
// Drafts are private prose that only their author should be able to read, so
// they are encrypted in the browser and the server stores an opaque envelope.
// A random per-author data key (DEK) does the encrypting; that DEK is wrapped by
// one or more key-encryption keys (KEKs) and only the wrapped form is stored.
// Wrapping rather than deriving the DEK straight from a KEK is what lets a
// second key source — today a recovery code — open the same drafts, and what
// makes changing key source a re-wrap instead of re-encrypting every draft.
//
// Everything here runs on WebCrypto and takes no dependency, so it works
// unchanged in the browser and under Node in tests.

import type { PublicationContent } from '@/types'

/** Which secret a stored wrapper is wrapped with. */
export type DraftKeyWrapperName = 'worldid' | 'recovery'

/** The author-written half of a draft — the part that becomes ciphertext. */
export type DraftPlaintext = {
  title: string
  subtitle: string
  content: PublicationContent
}

/** Binds a ciphertext to one draft of one author, as AES-GCM additional data. */
export type DraftAad = {
  draftId: string
  userId: number
}

export type DraftEnvelope = {
  v: 1
  alg: 'A256GCM'
  iv: string
  ct: string
}

export const DRAFT_ENCRYPTION_V1 = 'v1' as const

const AES_KEY_BITS = 256
const GCM_IV_BYTES = 12
const DEK_BYTES = 32
const RECOVERY_CODE_BYTES = 16

const HKDF_INFO: Record<DraftKeyWrapperName, string> = {
  worldid: 'memorioso-draft-kek-worldid-v1',
  recovery: 'memorioso-draft-kek-recovery-v1',
}
const HKDF_INFO_FINGERPRINT = 'memorioso-draft-kek-fingerprint-v1'

// Crockford base32: no I, L, O or U, so a recovery code read off a screen and
// typed into another device cannot be mangled by lookalike characters.
const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

const subtle = (): SubtleCrypto => {
  const available = globalThis.crypto?.subtle
  if (!available) {
    throw new Error('WebCrypto is unavailable; drafts cannot be encrypted here')
  }
  return available
}

const utf8 = (value: string): Uint8Array => new TextEncoder().encode(value)

export const toBase64Url = (bytes: Uint8Array): string => {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export const fromBase64Url = (value: string): Uint8Array => {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
    .padEnd(value.length + ((4 - (value.length % 4)) % 4), '=')
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('')

/** The exact bytes AES-GCM authenticates alongside a draft's ciphertext. */
const aadBytes = ({ draftId, userId }: DraftAad): Uint8Array =>
  utf8(`memorioso-draft-v1:${userId}:${draftId}`)

/**
 * Derives a key-encryption key from a secret the author carries — World ID proof
 * material, or a recovery code. The salt is stored beside the wrapper, so the
 * same secret on any device reproduces the same KEK.
 */
export async function deriveKek(
  wrapper: DraftKeyWrapperName,
  secret: string,
  salt: Uint8Array
): Promise<CryptoKey> {
  const material = await subtle().importKey('raw', utf8(secret), 'HKDF', false, ['deriveBits'])
  const bits = await subtle().deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info: utf8(HKDF_INFO[wrapper]) },
    material,
    AES_KEY_BITS
  )
  return subtle().importKey('raw', bits, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

/**
 * A public identifier for a KEK, stored with the wrapper. It lets the client say
 * "this is the wrong key" instead of surfacing an indistinguishable AES-GCM
 * failure — the signal that matters if a key source ever stops being stable.
 */
export async function kekFingerprint(secret: string, salt: Uint8Array): Promise<string> {
  const material = await subtle().importKey('raw', utf8(secret), 'HKDF', false, ['deriveBits'])
  const bits = await subtle().deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info: utf8(HKDF_INFO_FINGERPRINT) },
    material,
    256
  )
  return toHex(new Uint8Array(bits))
}

export const generateDekBytes = (): Uint8Array =>
  globalThis.crypto.getRandomValues(new Uint8Array(DEK_BYTES))

export const generateSalt = (): Uint8Array =>
  globalThis.crypto.getRandomValues(new Uint8Array(16))

/**
 * Imports raw DEK bytes as a **non-extractable** key. Once a DEK is cached for a
 * device it only ever exists in this form, so script running on the page can use
 * it but cannot read it back out and send it somewhere.
 */
export async function importDek(dekBytes: Uint8Array): Promise<CryptoKey> {
  return subtle().importKey('raw', dekBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

/** Wraps DEK bytes under a KEK. The result is `iv || ciphertext`. */
export async function wrapDek(kek: CryptoKey, dekBytes: Uint8Array): Promise<Uint8Array> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(GCM_IV_BYTES))
  const wrapped = await subtle().encrypt({ name: 'AES-GCM', iv }, kek, dekBytes)
  const output = new Uint8Array(iv.length + wrapped.byteLength)
  output.set(iv, 0)
  output.set(new Uint8Array(wrapped), iv.length)
  return output
}

/** Reverses {@link wrapDek}. Throws when the KEK is wrong or the bytes are damaged. */
export async function unwrapDek(kek: CryptoKey, wrapped: Uint8Array): Promise<Uint8Array> {
  if (wrapped.length <= GCM_IV_BYTES) {
    throw new Error('Wrapped draft key is malformed')
  }
  const iv = wrapped.slice(0, GCM_IV_BYTES)
  const body = wrapped.slice(GCM_IV_BYTES)
  const dek = await subtle().decrypt({ name: 'AES-GCM', iv }, kek, body)
  return new Uint8Array(dek)
}

export async function encryptDraft(
  dek: CryptoKey,
  aad: DraftAad,
  plaintext: DraftPlaintext
): Promise<string> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(GCM_IV_BYTES))
  const ciphertext = await subtle().encrypt(
    { name: 'AES-GCM', iv, additionalData: aadBytes(aad) },
    dek,
    utf8(JSON.stringify(plaintext))
  )
  const envelope: DraftEnvelope = {
    v: 1,
    alg: 'A256GCM',
    iv: toBase64Url(iv),
    ct: toBase64Url(new Uint8Array(ciphertext)),
  }
  return JSON.stringify(envelope)
}

export async function decryptDraft(
  dek: CryptoKey,
  aad: DraftAad,
  serializedEnvelope: string
): Promise<DraftPlaintext> {
  let envelope: DraftEnvelope
  try {
    envelope = JSON.parse(serializedEnvelope) as DraftEnvelope
  } catch {
    throw new Error('Draft ciphertext is not a recognised envelope')
  }

  if (envelope?.v !== 1 || envelope.alg !== 'A256GCM' || !envelope.iv || !envelope.ct) {
    throw new Error('Draft ciphertext is not a recognised envelope')
  }

  const plaintext = await subtle().decrypt(
    { name: 'AES-GCM', iv: fromBase64Url(envelope.iv), additionalData: aadBytes(aad) },
    dek,
    fromBase64Url(envelope.ct)
  )
  return JSON.parse(new TextDecoder().decode(plaintext)) as DraftPlaintext
}

/** A one-time recovery code: 128 random bits, grouped for reading aloud. */
export function generateRecoveryCode(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(RECOVERY_CODE_BYTES))
  let bits = 0
  let value = 0
  let code = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      code += CROCKFORD_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) code += CROCKFORD_ALPHABET[(value << (5 - bits)) & 31]
  return (code.match(/.{1,4}/g) || []).join('-')
}

/**
 * Accepts a recovery code however it was typed — spacing, case, and the
 * Crockford lookalikes I/L for 1 and O for 0 all normalise away.
 */
export function normalizeRecoveryCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0')
}
