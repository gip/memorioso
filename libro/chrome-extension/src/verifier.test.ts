import { describe, expect, it } from 'vitest'
import {
  LibroNotRegisteredError,
  LibroRegistrationMismatchError,
  LibroRegistrationPendingFinalityError,
  LibroRegistrationUnconfirmedError,
  actionHashToHex,
  canonicalPublicationSignal,
  hashPublicationSignal,
  manifestElementId,
  LIBRO_EMBED_SCHEMA_V1,
  LIBRO_HUMAN_SIGNED_CLAIM,
  LIBRO_PROTOCOL_VERSION,
  LIBRO_PUBLICATION_SCHEMA_V1,
  LIBRO_V1_REGISTRY_ADDRESS,
  type LibroEmbedManifestV1,
} from '@libro/core'
import { verifyCandidate } from './verifier'
import type { LibroCandidate } from './shared'

/** Stub for one endpoint confirming the registration. */
function confirmed(value: LibroEmbedManifestV1, label = 'worldchain-mainnet.gateway.tenderly.co') {
  return async () => ({
    manifest: value,
    outcomes: [{ rpcUrl: `https://${label}`, label, status: 'verified' as const, detail: 'Registered in block 1' }],
    verifiedBy: [label],
  })
}

function manifest(): LibroEmbedManifestV1 {
  const publication = {
    publication_schema: LIBRO_PUBLICATION_SCHEMA_V1,
    libro_protocol_version: LIBRO_PROTOCOL_VERSION,
    world_id_protocol_version: '4.0' as const,
    world_id_action: 'written-by-a-human-v4-extension-test',
    world_id_credential_policy: 'orb' as const,
    author_id_libro: 'author-1',
    publication_date: '2026-07-21T12:00:00.000Z',
    author_name_libro: 'Ada',
    author_handle_libro: 'ada',
    author_bio_libro: '',
    publication_title: '',
    publication_content: { html: '<p>Hello <strong>human</strong> world.</p>' },
    publication_subtitle: '',
  }
  return {
    schema: LIBRO_EMBED_SCHEMA_V1,
    claim: LIBRO_HUMAN_SIGNED_CLAIM,
    publication,
    registration: {
      chain_id: 480,
      registry_address: LIBRO_V1_REGISTRY_ADDRESS,
      signal_hash: hashPublicationSignal(canonicalPublicationSignal(publication)),
      action_hash: actionHashToHex(publication.world_id_action),
      transaction_hash: `0x${'11'.repeat(32)}`,
    },
    source: {
      publication_url: 'https://memorioso.xyz/short/42',
      proof_url: 'https://memorioso.xyz/short/42/proof',
      manifest_url: 'https://memorioso.xyz/api/publications/42/libro-manifest',
    },
  }
}

function candidate(value = manifest()): LibroCandidate {
  return {
    blockId: 'block-1',
    kind: 'embed',
    innerHtml: '<div>Hello human</div><div>world.</div>',
    snapshotHtml: '<div>Hello human</div><div>world.</div>',
    declaredHash: value.registration.signal_hash,
    manifestId: manifestElementId(value.registration.signal_hash),
    manifestText: JSON.stringify(value),
  }
}

function textCandidate(value = manifest()): LibroCandidate {
  return {
    blockId: 'text-1',
    kind: 'text',
    innerHtml: 'Hello human world.',
    readableText: 'Hello human world.',
    snapshotHtml: 'Hello human world.',
    declaredHash: value.registration.signal_hash,
    manifestId: null,
    manifestText: JSON.stringify(value),
    manifestUrl: value.source?.manifest_url,
    declaredAuthorHandle: 'ada',
    declaredPublicationDate: '2026-07-21T12:00Z',
  }
}

describe('extension candidate verification', () => {
  it('accepts equivalent readable text with different markup', async () => {
    const value = manifest()
    await expect(verifyCandidate(candidate(value), confirmed(value))).resolves.toMatchObject({
      status: 'verified',
      authorHandle: 'ada',
    })
  })

  it('detects changed text and wrapper hashes', async () => {
    await expect(verifyCandidate({ ...candidate(), innerHtml: '<p>Changed</p>' })).resolves.toMatchObject({ status: 'text_mismatch' })
    await expect(verifyCandidate({ ...candidate(), declaredHash: `0x${'22'.repeat(32)}` })).resolves.toMatchObject({ status: 'invalid_manifest' })
    await expect(verifyCandidate({ ...candidate(), manifestId: 'libro-manifest-wrong' })).resolves.toMatchObject({ status: 'invalid_manifest' })
  })

  it('verifies a resolved plain-text tag and its declared metadata', async () => {
    const value = manifest()
    await expect(verifyCandidate(textCandidate(value), confirmed(value))).resolves.toMatchObject({ status: 'verified' })
    await expect(verifyCandidate({ ...textCandidate(value), declaredAuthorHandle: 'grace' }, confirmed(value)))
      .resolves.toMatchObject({ status: 'invalid_manifest' })
    await expect(verifyCandidate({ ...textCandidate(value), declaredPublicationDate: '2026-07-21T12:01Z' }, confirmed(value)))
      .resolves.toMatchObject({ status: 'invalid_manifest' })
    await expect(verifyCandidate({ ...textCandidate(value), readableText: 'Changed' }, confirmed(value)))
      .resolves.toMatchObject({ status: 'text_mismatch' })
  })

  it('detects a plain-text tag whose manifest cannot be resolved', async () => {
    await expect(verifyCandidate({ ...textCandidate(), manifestText: null }))
      .resolves.toMatchObject({ status: 'manifest_missing' })
  })

  it('rejects malformed and unsupported manifests locally', async () => {
    await expect(verifyCandidate({ ...candidate(), manifestText: '{' })).resolves.toMatchObject({ status: 'invalid_manifest' })
    const value = manifest()
    value.registration.registry_address = '0x1111111111111111111111111111111111111111'
    await expect(verifyCandidate(candidate(value))).resolves.toMatchObject({ status: 'unsupported_registry' })
    await expect(verifyCandidate({
      ...candidate(),
      manifestText: JSON.stringify({ ...manifest(), claim: 'human-authored' }),
    })).resolves.toMatchObject({ status: 'invalid_manifest' })
  })

  it('distinguishes absent registrations, receipt mismatches, and network failures', async () => {
    await expect(verifyCandidate(candidate(), async () => { throw new LibroNotRegisteredError('missing') }))
      .resolves.toMatchObject({ status: 'not_registered' })
    await expect(verifyCandidate(candidate(), async () => { throw new LibroRegistrationMismatchError('wrong receipt') }))
      .resolves.toMatchObject({ status: 'invalid_manifest' })
    await expect(verifyCandidate(candidate(), async () => { throw new LibroRegistrationPendingFinalityError('unsafe block') }))
      .resolves.toMatchObject({ status: 'pending_finality', label: 'Verified · Pending Finality' })
    await expect(verifyCandidate(candidate(), async () => { throw new LibroRegistrationUnconfirmedError('no receipt') }))
      .resolves.toMatchObject({ status: 'registration_unconfirmed' })
    await expect(verifyCandidate(candidate(), async () => { throw new Error('offline') }))
      .resolves.toMatchObject({ status: 'network_unavailable' })
  })

  it('names the endpoints that confirmed a registration', async () => {
    const value = manifest()
    const result = await verifyCandidate(candidate(value), async () => ({
      manifest: value,
      outcomes: [
        { rpcUrl: 'https://a.example', label: 'a.example', status: 'verified' as const, detail: 'Registered in block 7' },
        { rpcUrl: 'https://b.example', label: 'b.example', status: 'unconfirmed' as const, detail: 'Registration transaction was not found on chain' },
      ],
      verifiedBy: ['a.example'],
    }))
    expect(result.status).toBe('verified')
    expect(result.verifiedBy).toEqual(['a.example'])
    expect(result.detail).toContain('confirmed by a.example')
    // The endpoint that could not answer is still reported rather than hidden behind the verdict.
    expect(result.sources).toHaveLength(2)
  })

  it('shows which endpoints failed when none could confirm', async () => {
    const outcomes = [
      { rpcUrl: 'https://a.example', label: 'a.example', status: 'unconfirmed' as const, detail: 'Registration transaction was not found on chain' },
      { rpcUrl: 'https://b.example', label: 'b.example', status: 'unavailable' as const, detail: 'HTTP request failed' },
    ]
    const result = await verifyCandidate(candidate(), async () => {
      throw new LibroRegistrationUnconfirmedError('no receipt', outcomes)
    })
    expect(result.status).toBe('registration_unconfirmed')
    expect(result.detail).toContain('unconfirmed: a.example')
    expect(result.detail).toContain('unavailable: b.example')
    expect(result.verifiedBy).toBeUndefined()
  })

  it('reports the underlying cause instead of swallowing unclassified failures', async () => {
    const result = await verifyCandidate(candidate(), async () => {
      throw new Error('HTTP request failed: 429 Too Many Requests\nDocs: https://viem.sh\nVersion: viem@2')
    })
    expect(result.status).toBe('network_unavailable')
    expect(result.detail).toContain('429 Too Many Requests')
    expect(result.detail).not.toContain('Docs:')
  })
})
