import { describe, expect, it } from 'vitest'
import {
  LIBRO_V1_REGISTRY_ADDRESS,
  canonicalPublicationSignal,
  hashPublicationSignal,
  hashLibroHandle,
} from '@libro/core'
import { buildLibroEmbedManifest, buildLibroEmbedSnippet, buildLibroTextSnippet, sanitizeLibroEmbedHtml } from '../embed'
import type {
  LibroAgentProofV1,
  LibroAgentPublicationV1,
  LibroHumanPublication,
  LibroPublicationV1,
  LibroPublicationV2,
  PublicationRecord,
  WorldIdProofV4,
} from '@/types'

const publication: LibroPublicationV1 = {
  publication_schema: 'libro-publication-v1',
  libro_protocol_version: 'libro-v1',
  world_id_protocol_version: '4.0',
  world_id_proof_type: 'session',
  world_id_credential_policy: 'orb',
  author_id_libro: 'author-1',
  publication_date: '2026-07-21T12:00:00.000Z',
  author_name_libro: 'Ada',
  author_handle_libro: 'ada',
  author_handle_hash_libro: hashLibroHandle('ada'),
  author_bio_libro: '',
  publication_title: '',
  publication_content: { html: '<p>Hello <strong>human</strong>.</p>' },
  publication_subtitle: '',
}

const publicationV2: LibroPublicationV2 = {
  publication_schema: 'libro-publication-v2',
  libro_protocol_version: 'libro-v1',
  world_id_protocol_version: '4.0',
  world_id_proof_type: 'session',
  world_id_credential_policy: 'orb',
  author_reference: { namespace: 'https://memorioso.xyz', id: 'author-1' },
  publication_date: publication.publication_date,
  author_name_libro: publication.author_name_libro,
  author_handle_libro: publication.author_handle_libro,
  author_handle_hash_libro: publication.author_handle_hash_libro,
  author_bio_libro: publication.author_bio_libro,
  publication_title: publication.publication_title,
  publication_content: publication.publication_content,
  publication_subtitle: publication.publication_subtitle,
}

function proof(value: LibroHumanPublication = publication): WorldIdProofV4 {
  const signalText = canonicalPublicationSignal(value)
  return {
    protocol_version: '4.0',
    proof_type: 'session',
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
      handle_hash: value.author_handle_hash_libro,
      authorship_class: 'human',
      transaction_hash: `0x${'11'.repeat(32)}`,
      registered_at: '2026-07-21T12:01:00.000Z',
    },
  }
}

const agentPublication: LibroAgentPublicationV1 = {
  publication_schema: 'libro-agent-publication-v1',
  libro_agent_protocol_version: 'libro-agent-v1',
  authorship_claim: 'human_authorized_agent',
  author_id_libro: 'author-1',
  publication_date: '2026-07-21T12:00:00.000Z',
  author_name_libro: 'Ada',
  author_handle_libro: 'ada',
  author_handle_hash_libro: hashLibroHandle('ada'),
  author_bio_libro: '',
  publication_title: '',
  publication_content: { html: '<p>Written by the authorized agent.</p>' },
  publication_subtitle: '',
  agent_address: '0x1111111111111111111111111111111111111111',
  agent_registration_hash: `0x${'22'.repeat(32)}`,
}

function agentProof(): LibroAgentProofV1 {
  const signalText = canonicalPublicationSignal(agentPublication)
  return {
    proof_type: 'human_authorized_agent_signature',
    protocol_version: 'libro-agent-v1',
    agent_registration: {
      proof_type: 'session', signal: 'registration', signal_hash: `0x${'33'.repeat(32)}`,
      registration_hash: agentPublication.agent_registration_hash,
      handle_hash: agentPublication.author_handle_hash_libro,
      payload: {}, credential_identifier: 'proof_of_human', credential_identifiers: ['proof_of_human'],
      idkit_result: {}, chain_id: 480, registry_address: LIBRO_V1_REGISTRY_ADDRESS,
      user_op_hash: `0x${'44'.repeat(32)}`, transaction_hash: `0x${'55'.repeat(32)}`,
      registered_at: '2026-07-21T12:00:00.000Z',
    },
    agent_document_signature: {
      document_signal_text: signalText, document_signal_hash: hashPublicationSignal(signalText),
      document_nonce: `0x${'66'.repeat(32)}`, signed_at: '2026-07-21T12:00:00.000Z',
      agent_address: agentPublication.agent_address, signature_type: 'eip712', signature: `0x${'77'.repeat(65)}`,
      chain_id: 480, registry_address: LIBRO_V1_REGISTRY_ADDRESS,
      user_op_hash: `0x${'88'.repeat(32)}`, transaction_hash: `0x${'99'.repeat(32)}`,
      registered_at: '2026-07-21T12:01:00.000Z',
    },
  }
}

describe('Libro embed generation', () => {
  it('builds a v1 embed envelope around a human publication v2 payload', () => {
    const manifest = buildLibroEmbedManifest(
      { ...publicationV2, version: '3' } as PublicationRecord,
      proof(publicationV2),
      '44'
    )
    expect(manifest.schema).toBe('libro-embed-v1')
    expect(manifest.publication).toEqual(publicationV2)
    expect(manifest.claim).toBe('human-signed')
  })

  it('builds an agent manifest bound to the same handle and unified registry', () => {
    const manifest = buildLibroEmbedManifest(
      { ...agentPublication, version: '3' } as PublicationRecord,
      agentProof(),
      '43'
    )
    expect(manifest.claim).toBe('human-authorized-agent')
    expect(manifest.registration.authorship_class).toBe('agent')
    expect(manifest.registration.handle_hash).toBe(agentPublication.author_handle_hash_libro)
    expect(buildLibroEmbedSnippet(manifest)).toContain('data-libro-claim="human-authorized-agent"')
  })

  it('signs a compact content-hash commitment but keeps the manifest and embed carrying the full article body', () => {
    const signalText = proof().signal_text!
    expect(JSON.parse(signalText).content_hash).toMatch(/^0x[0-9a-f]{64}$/)
    expect(signalText).not.toContain('publication_content')

    const manifest = buildLibroEmbedManifest({ ...publication, version: '3' } as PublicationRecord, proof(), '42')
    expect(manifest.publication.publication_content).toEqual(publication.publication_content)
    expect(buildLibroEmbedSnippet(manifest)).toContain('Hello <strong>human</strong>')
  })

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
      publication_url: 'https://memorioso.xyz/short/42',
      proof_url: 'https://memorioso.xyz/short/42/proof',
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
      { ...proof(), libro_registration: { ...proof().libro_registration!, handle_hash: `0x${'33'.repeat(32)}` } },
      '42'
    )).toThrow('event handle hash')
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
