// Client-side draft encryption.
//
// Drafts are private prose that only their author should be able to read, so
// they are encrypted in the browser and the server stores an opaque envelope.
// A random per-author data key (DEK) does the encrypting; that DEK is wrapped by
// one or more key-encryption keys (KEKs) and only the wrapped form is stored.
// Wrapping rather than deriving the DEK straight from a KEK is what lets a
// second key source — a recovery code — open the same drafts, and what makes
// changing the passphrase a re-wrap instead of re-encrypting every draft.
//
// Everything here runs on WebCrypto and takes no dependency, so it works
// unchanged in the browser and under Node in tests.

import type { PublicationContent } from '@/types'

/** Which secret a stored wrapper is wrapped with. */
export type DraftKeyWrapperName = 'passphrase' | 'recovery'

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

/**
 * PBKDF2 cost for a passphrase, at the OWASP figure for PBKDF2-HMAC-SHA256.
 * It is stored per wrapper rather than only pinned here, because a cost that
 * cannot be read back is a cost that can never be raised: a wrapper written
 * under an old count would simply stop deriving, and "wrong passphrase" and
 * "stale parameters" would be the same failure.
 */
export const PBKDF2_ITERATIONS = 600_000

/** The floor a stored wrapper's cost has to clear to be worth anything. */
export const MIN_PBKDF2_ITERATIONS = 100_000

/**
 * Long enough that PBKDF2 is doing real work rather than papering over a
 * four-character password. No composition rules: they push authors towards
 * shorter, more predictable strings, which is the opposite of what this needs.
 */
export const MIN_PASSPHRASE_LENGTH = 12

const HKDF_INFO: Record<DraftKeyWrapperName, string> = {
  passphrase: 'memorioso-draft-kek-passphrase-v1',
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
 * Normalises a passphrase to NFC so that the same characters typed on two
 * platforms produce the same bytes. Deliberately does not trim: a passphrase is
 * confirmed twice when it is set, so a stray space is caught there rather than
 * silently changing what the author chose.
 */
export const normalizePassphrase = (passphrase: string): string => passphrase.normalize('NFC')

/** Why this passphrase cannot be used, or null when it can. */
export function passphraseProblem(passphrase: string): string | null {
  if (passphrase.trim().length === 0) return 'Enter a passphrase'
  if (normalizePassphrase(passphrase).length < MIN_PASSPHRASE_LENGTH) {
    return `Use at least ${MIN_PASSPHRASE_LENGTH} characters`
  }
  return null
}

/**
 * Stretches the author's secret into 32 bytes of key material.
 *
 * A passphrase carries far less entropy than the key it protects, and the
 * wrapper it protects is sitting in the database this feature exists to
 * devalue — so it goes through PBKDF2, which is what makes a dump expensive to
 * attack offline. A recovery code is 128 random bits and needs no work factor;
 * it is passed through unchanged, which also keeps every recovery wrapper
 * written before this existed openable.
 */
async function rootMaterial(
  wrapper: DraftKeyWrapperName,
  secret: string,
  salt: Uint8Array,
  iterations: number
): Promise<Uint8Array> {
  if (wrapper !== 'passphrase') return utf8(secret)

  const material = await subtle().importKey('raw', utf8(normalizePassphrase(secret)), 'PBKDF2', false, ['deriveBits'])
  const bits = await subtle().deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    material,
    AES_KEY_BITS
  )
  return new Uint8Array(bits)
}

/** A key-encryption key and the public identifier stored beside it. */
export type DraftWrapperKey = {
  kek: CryptoKey
  /**
   * Lets the client say "this is the wrong secret" instead of surfacing an
   * indistinguishable AES-GCM failure. It comes out of the same stretched
   * material as the KEK, so it is not a cheap oracle for guessing the
   * passphrase that the KEK's own cost would otherwise have prevented.
   */
  fingerprint: string
}

/**
 * Derives the KEK and its fingerprint from a secret the author carries. The salt
 * and the iteration count are stored beside the wrapper, so the same secret on
 * any device reproduces the same key.
 */
export async function deriveWrapperKey(
  wrapper: DraftKeyWrapperName,
  secret: string,
  salt: Uint8Array,
  iterations: number = PBKDF2_ITERATIONS
): Promise<DraftWrapperKey> {
  const root = await rootMaterial(wrapper, secret, salt, iterations)
  const ikm = await subtle().importKey('raw', root, 'HKDF', false, ['deriveBits'])

  const expand = (info: string): Promise<ArrayBuffer> =>
    subtle().deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: utf8(info) }, ikm, 256)

  // One stretch, two expansions: deriving the fingerprint separately would run
  // PBKDF2 twice on every unlock attempt for no gain.
  const [kekBits, fingerprintBits] = await Promise.all([
    expand(HKDF_INFO[wrapper]),
    expand(HKDF_INFO_FINGERPRINT),
  ])

  return {
    kek: await subtle().importKey('raw', kekBits, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']),
    fingerprint: toHex(new Uint8Array(fingerprintBits)),
  }
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
