import { describe, expect, it } from 'vitest'
import {
  LibroNotRegisteredError,
  LibroRegistrationMismatchError,
  actionHashToHex,
  canonicalPublicationSignal,
  hashPublicationSignal,
  manifestElementId,
  LIBRO_EMBED_SCHEMA_V1,
  LIBRO_HUMAN_AUTHORSHIP_CLAIM,
  LIBRO_PROTOCOL_VERSION,
  LIBRO_PUBLICATION_SCHEMA_V1,
  LIBRO_V1_REGISTRY_ADDRESS,
  type LibroEmbedManifestV1,
} from '@libro/core'
import { verifyCandidate } from './verifier'
import type { LibroCandidate } from './shared'

function manifest(): LibroEmbedManifestV1 {
  const publication = {
    publication_schema: LIBRO_PUBLICATION_SCHEMA_V1,
    libro_protocol_version: LIBRO_PROTOCOL_VERSION,
    world_id_protocol_version: '4.0' as const,
    world_id_action: 'written-by-a-human-v4-extension-test',
    world_id_credential_policy: 'document_or_orb',
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
    claim: LIBRO_HUMAN_AUTHORSHIP_CLAIM,
    publication,
    registration: {
      chain_id: 480,
      registry_address: LIBRO_V1_REGISTRY_ADDRESS,
      signal_hash: hashPublicationSignal(canonicalPublicationSignal(publication)),
      action_hash: actionHashToHex(publication.world_id_action),
      transaction_hash: `0x${'11'.repeat(32)}`,
    },
    source: {
      publication_url: 'https://memorioso.xyz/p/42',
      proof_url: 'https://memorioso.xyz/p/42/proof',
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
    declaredPublicationDate: '2026-07-21',
  }
}

describe('extension candidate verification', () => {
  it('accepts equivalent readable text with different markup', async () => {
    const value = manifest()
    await expect(verifyCandidate(candidate(value), async () => value)).resolves.toMatchObject({
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
    await expect(verifyCandidate(textCandidate(value), async () => value)).resolves.toMatchObject({ status: 'verified' })
    await expect(verifyCandidate({ ...textCandidate(value), declaredAuthorHandle: 'grace' }, async () => value))
      .resolves.toMatchObject({ status: 'invalid_manifest' })
    await expect(verifyCandidate({ ...textCandidate(value), readableText: 'Changed' }, async () => value))
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
  })

  it('distinguishes absent registrations, receipt mismatches, and network failures', async () => {
    await expect(verifyCandidate(candidate(), async () => { throw new LibroNotRegisteredError('missing') }))
      .resolves.toMatchObject({ status: 'not_registered' })
    await expect(verifyCandidate(candidate(), async () => { throw new LibroRegistrationMismatchError('wrong receipt') }))
      .resolves.toMatchObject({ status: 'invalid_manifest' })
    await expect(verifyCandidate(candidate(), async () => { throw new Error('offline') }))
      .resolves.toMatchObject({ status: 'network_unavailable' })
  })
})
