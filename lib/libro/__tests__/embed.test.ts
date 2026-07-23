import { describe, expect, it } from 'vitest'
import {
  LIBRO_V1_REGISTRY_ADDRESS,
  actionHashToHex,
  canonicalPublicationSignal,
  hashPublicationSignal,
} from '@libro/core'
import { buildLibroEmbedManifest, buildLibroEmbedSnippet, buildLibroTextSnippet, sanitizeLibroEmbedHtml } from '../embed'
import type { LibroPublicationV1, PublicationRecord, WorldIdProofV4 } from '@/types'

const publication: LibroPublicationV1 = {
  publication_schema: 'libro-publication-v1',
  libro_protocol_version: 'libro-v1',
  world_id_protocol_version: '4.0',
  world_id_action: 'written-by-a-human-v4-challenge',
  world_id_credential_policy: 'orb',
  author_id_libro: 'author-1',
  publication_date: '2026-07-21T12:00:00.000Z',
  author_name_libro: 'Ada',
  author_handle_libro: 'ada',
  author_bio_libro: '',
  publication_title: '',
  publication_content: { html: '<p>Hello <strong>human</strong>.</p>' },
  publication_subtitle: '',
}

function proof(): WorldIdProofV4 {
  const signalText = canonicalPublicationSignal(publication)
  return {
    protocol_version: '4.0',
    action: publication.world_id_action,
    nonce: '0x1',
    signal_text: signalText,
    signal_hash: hashPublicationSignal(signalText),
    credential_identifier: 'proof_of_human',
    credential_identifiers: ['proof_of_human'],
    idkit_result: {},
    verify_response: {},
    libro_registration: {
      protocol_version: 'libro-v1',
      chain_id: 480,
      registry_address: LIBRO_V1_REGISTRY_ADDRESS,
      signal_hash: hashPublicationSignal(signalText),
      action_hash: BigInt(actionHashToHex(publication.world_id_action)).toString(),
      transaction_hash: `0x${'11'.repeat(32)}`,
      registered_at: '2026-07-21T12:01:00.000Z',
    },
  }
}

describe('Libro embed generation', () => {
  it('builds a self-contained simple text embed', () => {
    const manifest = buildLibroEmbedManifest({ ...publication, version: '3' } as PublicationRecord, proof(), '42')
    const snippet = buildLibroEmbedSnippet(manifest)
    expect(manifest.claim).toBe('human-signed')
    expect(snippet).toContain('class="libro-human-signed"')
    expect(snippet).toContain('data-libro-claim="human-signed"')
    expect(snippet).toContain('=== Libro · Signed by a human · @ada · 2026-07-21T12:00Z')
    expect(snippet).toContain(manifest.registration.signal_hash)
    expect(snippet).toContain('type="application/libro+json"')
    expect(snippet).toContain(`data-libro-manifest="libro-manifest-${manifest.registration.signal_hash}"`)
    expect(snippet).toContain(`id="libro-manifest-${manifest.registration.signal_hash}"`)
  })

  it('builds a resolvable plain-text tag', () => {
    const manifest = buildLibroEmbedManifest({ ...publication, version: '3' } as PublicationRecord, proof(), '42')
    manifest.source = {
      publication_url: 'https://memorioso.xyz/p/42',
      proof_url: 'https://memorioso.xyz/p/42/proof',
      manifest_url: 'https://memorioso.xyz/api/publications/42/libro-manifest',
    }
    expect(buildLibroTextSnippet(manifest)).toBe([
      `=== Libro · Signed by a human · @ada · 2026-07-21T12:00Z · ${manifest.registration.signal_hash} · https://memorioso.xyz/api/publications/42/libro-manifest ===`,
      'Hello human.',
      '=== End Libro ===',
    ].join('\n'))
  })

  it('rejects stored publication tampering', () => {
    expect(() => buildLibroEmbedManifest({
      ...publication,
      publication_content: { html: '<p>Changed</p>' },
      version: '3',
    } as PublicationRecord, proof(), '42')).toThrow('does not match')
  })

  it('rejects proof metadata that disagrees with the signed signal', () => {
    expect(() => buildLibroEmbedManifest(
      { ...publication, version: '3' } as PublicationRecord,
      { ...proof(), signal_hash: `0x${'22'.repeat(32)}` },
      '42'
    )).toThrow('proof signal hash')
    expect(() => buildLibroEmbedManifest(
      { ...publication, version: '3' } as PublicationRecord,
      { ...proof(), action: 'written-by-a-human-v4-other' },
      '42'
    )).toThrow('proof action')
  })

  it('reports the publication and approved registries being compared', () => {
    const unsupportedRegistry = '0x1111111111111111111111111111111111111111'
    const unsupportedProof = proof()
    unsupportedProof.libro_registration = {
      ...unsupportedProof.libro_registration!,
      registry_address: unsupportedRegistry,
    }

    expect(() => buildLibroEmbedManifest(
      { ...publication, version: '3' } as PublicationRecord,
      unsupportedProof,
      '42'
    )).toThrow(
      `Publication uses an unsupported Libro registry: ` +
      `publication registry (chain_id=480, registry_address=${unsupportedRegistry}) does not match ` +
      `approved registry (chain_id=480, registry_address=${LIBRO_V1_REGISTRY_ADDRESS})`
    )
  })

  it('sanitizes executable presentation markup', () => {
    const sanitized = sanitizeLibroEmbedHtml('<p onclick="evil()">Safe</p><script>evil()</script><a href="javascript:evil()">link</a>')
    expect(sanitized).toBe('<p>Safe</p><a>link</a>')
  })

  it('falls back to escaped text if sanitization would change the signed words', () => {
    const sanitized = sanitizeLibroEmbedHtml('<p>Safe</p><iframe>unsigned fallback</iframe>')
    expect(sanitized).toBe('<p>Safe</p>')
  })
})
