import { describe, expect, it } from 'vitest'
import type { IDKitResult } from '@worldcoin/idkit'
import { canonicalStringify, createPublicationV2, canonicalPublicationSignal, hashPublicationSignal } from '../publication'
import { validateWorldIdV4Result } from '../proof'
import { mapPublicationRow } from '../../db/objects'
import {
  getCredentialIdentifierForPublication,
  isLegacyPublication,
  LEGACY_VERIFICATION_UNAVAILABLE_MESSAGE,
} from '../../publication-status'
import type { JsonValue } from '../../json'
import type { PublicationRecord, WorldIdProofV4 } from '../../../types'

const content = { html: '<p>Hello human world.</p>' }
const author = {
  id: '8d22d0e5-2a31-42ca-9356-6e2b3c16a4aa',
  name: 'Ada',
  handle: 'ada',
  bio: 'Writes proofs.',
}

function publication(overrides: Partial<Parameters<typeof createPublicationV2>[0]> = {}) {
  return createPublicationV2({
    author,
    title: 'A human note',
    subtitle: 'On signatures',
    content,
    publicationDate: '2026-05-13T12:00:00.000Z',
    action: 'written-by-a-human-v4',
    ...overrides,
  })
}

function result(signalHash: string, overrides: Partial<IDKitResult> = {}): IDKitResult {
  return {
    protocol_version: '4.0',
    action: 'written-by-a-human-v4',
    nonce: 'nonce123',
    environment: 'production',
    responses: [{
      identifier: 'passport',
      signal_hash: signalHash,
      proof: ['0x1', '0x2', '0x3', '0x4', '0x5'],
      nullifier: '0xabc',
      issuer_schema_id: 9303,
      expires_at_min: 1770000000,
    }],
    ...overrides,
  } as IDKitResult
}

describe('World ID publication signals', () => {
  it('canonicalizes object keys deterministically', () => {
    expect(canonicalStringify({ b: 2, a: { d: 4, c: 3 } })).toBe(
      canonicalStringify({ a: { c: 3, d: 4 }, b: 2 })
    )
  })

  it('binds signal hash to the exact publication payload', () => {
    const original = canonicalPublicationSignal(publication())
    const changed = canonicalPublicationSignal(publication({ title: 'A changed human note' }))

    expect(hashPublicationSignal(original)).not.toBe(hashPublicationSignal(changed))
  })

  it('does not put the actual credential result into the signed signal', () => {
    const signalText = canonicalPublicationSignal(publication())

    expect(signalText).toContain('"world_id_credential_policy":"document_or_orb"')
    expect(signalText).not.toContain('credential_identifier')
    expect(signalText).not.toContain('passport')
  })
})

describe('publication version compatibility', () => {
  it('maps table version onto the publication record', () => {
    const mapped = mapPublicationRow({
      signal: publication(),
      version: '1',
    })

    expect(mapped.version).toBe('1')
    expect(mapped.publication_title).toBe('A human note')
  })

  it('marks version 1 publications as visible but not verifiable', () => {
    const legacyPublication: PublicationRecord = {
      ...publication(),
      version: '1',
    }
    const v4Proof: WorldIdProofV4 = {
      protocol_version: '4.0',
      action: 'written-by-a-human-v4',
      nonce: 'nonce123',
      signal_text: canonicalPublicationSignal(publication()),
      signal_hash: hashPublicationSignal(canonicalPublicationSignal(publication())),
      credential_identifier: 'passport',
      credential_identifiers: ['passport'],
      idkit_result: result('0x123') as unknown as JsonValue,
      verify_response: { success: true },
    }

    expect(isLegacyPublication(legacyPublication)).toBe(true)
    expect(LEGACY_VERIFICATION_UNAVAILABLE_MESSAGE).toContain('independent verification is no longer available')
    expect(getCredentialIdentifierForPublication(legacyPublication, v4Proof)).toBeNull()
  })

  it('keeps version 2 credential display derived from proof JSON', () => {
    const v2Publication: PublicationRecord = {
      ...publication(),
      version: '2',
    }
    const v4Proof: WorldIdProofV4 = {
      protocol_version: '4.0',
      action: 'written-by-a-human-v4',
      nonce: 'nonce123',
      signal_text: canonicalPublicationSignal(publication()),
      signal_hash: hashPublicationSignal(canonicalPublicationSignal(publication())),
      credential_identifier: 'passport',
      credential_identifiers: ['passport'],
      idkit_result: result('0x123') as unknown as JsonValue,
      verify_response: { success: true },
    }

    expect(isLegacyPublication(v2Publication)).toBe(false)
    expect(getCredentialIdentifierForPublication(v2Publication, v4Proof)).toBe('passport')
  })
})

describe('World ID v4 result validation', () => {
  it('accepts v4 document-or-orb results bound to the signal hash', () => {
    const signalHash = hashPublicationSignal(canonicalPublicationSignal(publication()))

    expect(() => validateWorldIdV4Result(result(signalHash), {
      action: 'written-by-a-human-v4',
      nonce: 'nonce123',
      environment: 'production',
      signalHash,
    })).not.toThrow()
  })

  it('rejects legacy v3 results', () => {
    expect(() => validateWorldIdV4Result({
      protocol_version: '3.0',
      nonce: 'nonce123',
      action: 'written-by-a-human-v4',
      environment: 'production',
      responses: [],
    } as IDKitResult, {
      action: 'written-by-a-human-v4',
      nonce: 'nonce123',
      environment: 'production',
      signalHash: '0x123',
    })).toThrow('World ID 4.0 proof is required')
  })

  it('rejects results whose response hash is not the publication signal hash', () => {
    const signalHash = hashPublicationSignal(canonicalPublicationSignal(publication()))

    expect(() => validateWorldIdV4Result(result('0xdeadbeef'), {
      action: 'written-by-a-human-v4',
      nonce: 'nonce123',
      environment: 'production',
      signalHash,
    })).toThrow('World ID signal hash does not match the publication payload')
  })
})
