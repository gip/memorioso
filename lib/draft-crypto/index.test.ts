import { describe, expect, it } from 'vitest'
import {
  decryptDraft,
  deriveKek,
  encryptDraft,
  fromBase64Url,
  generateDekBytes,
  generateRecoveryCode,
  generateSalt,
  importDek,
  kekFingerprint,
  normalizeRecoveryCode,
  toBase64Url,
  unwrapDek,
  wrapDek,
  type DraftPlaintext,
} from '@/lib/draft-crypto'

const plaintext: DraftPlaintext = {
  title: 'The salt marsh in November',
  subtitle: 'Notes from a cold walk',
  content: { html: '<p>The tide was out and the light went early.</p>' },
}

const aad = { draftId: '0f1c8f6e-2a1b-4a3d-9c7e-5b2f8a1d4c60', userId: 42 }

const dekFor = async () => importDek(generateDekBytes())

describe('draft envelope', () => {
  it('round-trips a draft', async () => {
    const dek = await dekFor()
    const envelope = await encryptDraft(dek, aad, plaintext)

    expect(envelope).not.toContain('salt marsh')
    await expect(decryptDraft(dek, aad, envelope)).resolves.toEqual(plaintext)
  })

  it('produces a different ciphertext each time', async () => {
    const dek = await dekFor()
    const first = await encryptDraft(dek, aad, plaintext)
    const second = await encryptDraft(dek, aad, plaintext)

    expect(first).not.toEqual(second)
  })

  it('refuses a ciphertext moved to another draft', async () => {
    const dek = await dekFor()
    const envelope = await encryptDraft(dek, aad, plaintext)

    await expect(
      decryptDraft(dek, { ...aad, draftId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }, envelope)
    ).rejects.toThrow()
  })

  it('refuses a ciphertext moved to another author', async () => {
    const dek = await dekFor()
    const envelope = await encryptDraft(dek, aad, plaintext)

    await expect(decryptDraft(dek, { ...aad, userId: 43 }, envelope)).rejects.toThrow()
  })

  it('refuses another author key', async () => {
    const envelope = await encryptDraft(await dekFor(), aad, plaintext)

    await expect(decryptDraft(await dekFor(), aad, envelope)).rejects.toThrow()
  })

  it('rejects anything that is not an envelope', async () => {
    const dek = await dekFor()

    await expect(decryptDraft(dek, aad, 'not json')).rejects.toThrow(/recognised envelope/)
    await expect(decryptDraft(dek, aad, '{"v":2}')).rejects.toThrow(/recognised envelope/)
  })
})

describe('key wrapping', () => {
  it('unwraps the same data key from either wrapper', async () => {
    const dekBytes = generateDekBytes()
    const worldIdSalt = generateSalt()
    const recoverySalt = generateSalt()
    const recoveryCode = generateRecoveryCode()

    const worldIdKek = await deriveKek('worldid', 'nullifier-value', worldIdSalt)
    const recoveryKek = await deriveKek('recovery', normalizeRecoveryCode(recoveryCode), recoverySalt)

    const fromWorldId = await unwrapDek(worldIdKek, await wrapDek(worldIdKek, dekBytes))
    const fromRecovery = await unwrapDek(recoveryKek, await wrapDek(recoveryKek, dekBytes))

    expect(Array.from(fromWorldId)).toEqual(Array.from(dekBytes))
    expect(Array.from(fromRecovery)).toEqual(Array.from(dekBytes))
  })

  it('derives the same key from the same secret and salt', async () => {
    const salt = generateSalt()
    const dekBytes = generateDekBytes()

    const wrapped = await wrapDek(await deriveKek('worldid', 'nullifier-value', salt), dekBytes)
    const unwrapped = await unwrapDek(await deriveKek('worldid', 'nullifier-value', salt), wrapped)

    expect(Array.from(unwrapped)).toEqual(Array.from(dekBytes))
  })

  it('separates the two wrappers even under one secret and salt', async () => {
    const salt = generateSalt()
    const wrapped = await wrapDek(await deriveKek('worldid', 'shared', salt), generateDekBytes())

    await expect(unwrapDek(await deriveKek('recovery', 'shared', salt), wrapped)).rejects.toThrow()
  })

  it('refuses a different secret', async () => {
    const salt = generateSalt()
    const wrapped = await wrapDek(await deriveKek('worldid', 'nullifier-value', salt), generateDekBytes())

    await expect(unwrapDek(await deriveKek('worldid', 'other-value', salt), wrapped)).rejects.toThrow()
  })

  it('rejects malformed wrapped bytes', async () => {
    const kek = await deriveKek('worldid', 'nullifier-value', generateSalt())

    await expect(unwrapDek(kek, new Uint8Array(8))).rejects.toThrow(/malformed/)
  })

  it('fingerprints a key without revealing the secret', async () => {
    const salt = generateSalt()

    const fingerprint = await kekFingerprint('nullifier-value', salt)

    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(fingerprint).toEqual(await kekFingerprint('nullifier-value', salt))
    expect(fingerprint).not.toEqual(await kekFingerprint('other-value', salt))
    expect(fingerprint).not.toEqual(await kekFingerprint('nullifier-value', generateSalt()))
  })
})

describe('recovery codes', () => {
  it('generates readable codes with no lookalike characters', () => {
    const code = generateRecoveryCode()

    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{1,4})+$/)
    expect(code).not.toEqual(generateRecoveryCode())
  })

  it('normalises spacing, case, and lookalike characters', () => {
    expect(normalizeRecoveryCode('abcd-efgh')).toEqual('ABCDEFGH')
    expect(normalizeRecoveryCode('  ab cd ')).toEqual('ABCD')
    expect(normalizeRecoveryCode('IL0O')).toEqual('1100')
  })

  it('normalises a generated code to itself without its separators', () => {
    const code = generateRecoveryCode()

    expect(normalizeRecoveryCode(code)).toEqual(code.replace(/-/g, ''))
  })
})

describe('base64url', () => {
  it('round-trips every byte value', () => {
    const bytes = new Uint8Array(256).map((_, index) => index)

    expect(toBase64Url(bytes)).not.toMatch(/[+/=]/)
    expect(Array.from(fromBase64Url(toBase64Url(bytes)))).toEqual(Array.from(bytes))
  })

  it('round-trips lengths across every padding case', () => {
    for (let length = 0; length < 8; length += 1) {
      const bytes = new Uint8Array(length).map((_, index) => index * 7 + 1)
      expect(Array.from(fromBase64Url(toBase64Url(bytes)))).toEqual(Array.from(bytes))
    }
  })
})
