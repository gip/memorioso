import { describe, expect, it } from 'vitest'
import {
  decryptDraft,
  deriveWrapperKey,
  encryptDraft,
  fromBase64Url,
  generateDekBytes,
  generateRecoveryCode,
  generateSalt,
  importDek,
  normalizePassphrase,
  normalizeRecoveryCode,
  passphraseProblem,
  toBase64Url,
  unwrapDek,
  wrapDek,
  MIN_PASSPHRASE_LENGTH,
  type DraftPlaintext,
} from '@/lib/draft-crypto'

// Real PBKDF2 cost would make this suite take minutes; the parameter is stored
// per wrapper precisely so it can vary, and the derivation is the same either way.
const TEST_ITERATIONS = 1_000

const kekFor = async (
  wrapper: 'passphrase' | 'recovery',
  secret: string,
  salt: Uint8Array,
  iterations = TEST_ITERATIONS
) => (await deriveWrapperKey(wrapper, secret, salt, iterations)).kek

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
    const passphraseSalt = generateSalt()
    const recoverySalt = generateSalt()
    const recoveryCode = generateRecoveryCode()

    const passphraseKek = await kekFor('passphrase', 'a long enough passphrase', passphraseSalt)
    const recoveryKek = await kekFor('recovery', normalizeRecoveryCode(recoveryCode), recoverySalt)

    const fromPassphrase = await unwrapDek(passphraseKek, await wrapDek(passphraseKek, dekBytes))
    const fromRecovery = await unwrapDek(recoveryKek, await wrapDek(recoveryKek, dekBytes))

    expect(Array.from(fromPassphrase)).toEqual(Array.from(dekBytes))
    expect(Array.from(fromRecovery)).toEqual(Array.from(dekBytes))
  })

  it('derives the same key from the same secret and salt', async () => {
    const salt = generateSalt()
    const dekBytes = generateDekBytes()

    const wrapped = await wrapDek(await kekFor('passphrase', 'correct horse battery', salt), dekBytes)
    const unwrapped = await unwrapDek(await kekFor('passphrase', 'correct horse battery', salt), wrapped)

    expect(Array.from(unwrapped)).toEqual(Array.from(dekBytes))
  })

  it('separates the two wrappers even under one secret and salt', async () => {
    const salt = generateSalt()
    const wrapped = await wrapDek(await kekFor('passphrase', 'shared secret value', salt), generateDekBytes())

    await expect(unwrapDek(await kekFor('recovery', 'shared secret value', salt), wrapped)).rejects.toThrow()
  })

  it('refuses a different secret', async () => {
    const salt = generateSalt()
    const wrapped = await wrapDek(await kekFor('passphrase', 'the right passphrase', salt), generateDekBytes())

    await expect(
      unwrapDek(await kekFor('passphrase', 'the wrong passphrase', salt), wrapped)
    ).rejects.toThrow()
  })

  it('rejects malformed wrapped bytes', async () => {
    const kek = await kekFor('passphrase', 'a long enough passphrase', generateSalt())

    await expect(unwrapDek(kek, new Uint8Array(8))).rejects.toThrow(/malformed/)
  })

  it('fingerprints a key without revealing the secret', async () => {
    const salt = generateSalt()
    const fingerprintFor = async (secret: string, forSalt = salt) =>
      (await deriveWrapperKey('recovery', secret, forSalt)).fingerprint

    const fingerprint = await fingerprintFor('ABCD1234')

    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(fingerprint).toEqual(await fingerprintFor('ABCD1234'))
    expect(fingerprint).not.toEqual(await fingerprintFor('other-value'))
    expect(fingerprint).not.toEqual(await fingerprintFor('ABCD1234', generateSalt()))
  })

  it('costs the same to guess the fingerprint as to guess the key', async () => {
    const salt = generateSalt()

    // The fingerprint comes out of the stretched material, not the raw
    // passphrase, so it moves with the iteration count. If it ever stopped
    // doing so it would be a cheap offline oracle for the passphrase, and
    // PBKDF2 would be protecting nothing.
    const cheap = await deriveWrapperKey('passphrase', 'a long enough passphrase', salt, 1_000)
    const dearer = await deriveWrapperKey('passphrase', 'a long enough passphrase', salt, 2_000)

    expect(cheap.fingerprint).not.toEqual(dearer.fingerprint)
  })

  it('ignores the iteration count for a recovery code', async () => {
    const salt = generateSalt()

    const first = await deriveWrapperKey('recovery', 'ABCD1234', salt, 1_000)
    const second = await deriveWrapperKey('recovery', 'ABCD1234', salt, 900_000)

    expect(first.fingerprint).toEqual(second.fingerprint)
  })
})

describe('passphrases', () => {
  it('rejects an empty or short passphrase', () => {
    expect(passphraseProblem('')).toMatch(/Enter a passphrase/)
    expect(passphraseProblem('   ')).toMatch(/Enter a passphrase/)
    expect(passphraseProblem('a'.repeat(MIN_PASSPHRASE_LENGTH - 1))).toMatch(/at least/)
    expect(passphraseProblem('a'.repeat(MIN_PASSPHRASE_LENGTH))).toBeNull()
  })

  it('derives one key from either Unicode spelling of the same passphrase', async () => {
    const salt = generateSalt()
    const composed = 'the caf\u00e9 passphrase'
    const decomposed = 'the cafe\u0301 passphrase'

    expect(composed).not.toEqual(decomposed)
    expect(normalizePassphrase(decomposed)).toEqual(composed)

    const wrapped = await wrapDek(await kekFor('passphrase', composed, salt), generateDekBytes())
    await expect(unwrapDek(await kekFor('passphrase', decomposed, salt), wrapped)).resolves.toBeTruthy()
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
