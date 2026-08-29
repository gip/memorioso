import { describe, expect, it } from 'vitest'
import {
  assertLibroManifestLocalIntegrity,
  canonicalPublicationSignal,
  extractReadableText,
  formatLibroTextTag,
  formatLibroPublicationMinute,
  hasMeaningfulPublicationBody,
  hasPublishablePublication,
  hashLibroPublicationContent,
  hashPublicationSignal,
  hashLibroHandle,
  isSimpleTextPublication,
  LIBRO_AGENT_PROTOCOL_VERSION,
  LIBRO_AGENT_PUBLICATION_SCHEMA_V1,
  LIBRO_AGENT_PUBLICATION_SCHEMA_V2,
  LIBRO_EMBED_SCHEMA_V1,
  LIBRO_HUMAN_SIGNED_CLAIM,
  LIBRO_PROTOCOL_VERSION,
  LIBRO_PUBLICATION_SCHEMA_V1,
  LIBRO_PUBLICATION_SCHEMA_V2,
  LIBRO_V1_REGISTRY_ADDRESS,
  libroTextTagHashMatches,
  manifestElementId,
  parseLibroEmbedManifest,
  parseLibroAgentPublicationV2,
  parseLibroPublication,
  parseLibroPublicationV1,
  parseLibroPublicationV2,
  parseLibroTextTags,
  serializeManifestForHtml,
  type LibroAgentPublicationV1Payload,
  type LibroAgentPublicationV2Payload,
  type LibroEmbedManifestV1,
  type LibroPublicationV1Payload,
  type LibroPublicationV2Payload,
} from './index'

const publication: LibroPublicationV1Payload = {
  publication_schema: LIBRO_PUBLICATION_SCHEMA_V1,
  libro_protocol_version: LIBRO_PROTOCOL_VERSION,
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
  publication_content: { html: '<p>Hello <strong>human</strong> world.</p>' },
  publication_subtitle: '',
}

const publicationV2: LibroPublicationV2Payload = {
  publication_schema: LIBRO_PUBLICATION_SCHEMA_V2,
  libro_protocol_version: LIBRO_PROTOCOL_VERSION,
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

function manifest(): LibroEmbedManifestV1 {
  return {
    schema: LIBRO_EMBED_SCHEMA_V1,
    claim: LIBRO_HUMAN_SIGNED_CLAIM,
    publication,
    registration: {
      chain_id: 480,
      registry_address: LIBRO_V1_REGISTRY_ADDRESS,
      signal_hash: hashPublicationSignal(canonicalPublicationSignal(publication)),
      handle_hash: publication.author_handle_hash_libro,
      authorship_class: 'human',
      transaction_hash: `0x${'11'.repeat(32)}`,
    },
    source: {
      publication_url: 'https://memorioso.xyz/short/42',
      proof_url: 'https://memorioso.xyz/short/42/proof',
      manifest_url: 'https://memorioso.xyz/api/publications/42/libro-manifest',
    },
  }
}

describe('Libro readable text', () => {
  it('normalizes formatting while preserving readable words', () => {
    expect(extractReadableText('<p>Hello <strong>human</strong></p><p>world.</p>')).toBe('Hello human world.')
    expect(extractReadableText('<p>Cafe\u0301&nbsp;notes</p>')).toBe('Café notes')
  })

  it.each([
    '',
    '   ',
    '<p><br></p>',
    '<p>&nbsp;</p>',
    '<script>words</script>',
    '<style>.words { color: red }</style>',
    '<img alt="words" src="data:image/png;base64,AA==">',
  ])('rejects a body with no readable text: %s', (html) => {
    expect(hasMeaningfulPublicationBody({ html })).toBe(false)
  })

  it('requires either a normalized title or readable body content', () => {
    expect(hasPublishablePublication('A title', { html: '<p><br></p>' })).toBe(true)
    expect(hasPublishablePublication('', { html: '<p>Readable body</p>' })).toBe(true)
    expect(hasPublishablePublication('   ', { html: '<p><br></p>' })).toBe(false)
  })

  it('recognizes the one-paragraph simple profile', () => {
    expect(isSimpleTextPublication(publication)).toBe(true)
    expect(isSimpleTextPublication({ ...publication, publication_title: 'Title' })).toBe(false)
    expect(isSimpleTextPublication({ ...publication, publication_content: { html: '<p>One</p><p>Two</p>' } })).toBe(false)
  })
})

describe('Libro plain-text tags', () => {
  it('formats the canonical portable tag with the full signal hash and manifest URL', () => {
    const tag = formatLibroTextTag(manifest())
    expect(tag).toBe([
      `=== Libro · Signed by a human · @ada · 2026-07-21T12:00Z · ${manifest().registration.signal_hash} · https://memorioso.xyz/api/publications/42/libro-manifest ===`,
      'Hello human world.',
      '=== End Libro ===',
    ].join('\n'))
    expect(parseLibroTextTags(tag)).toHaveLength(1)
  })

  it('parses a full verifiable tag', () => {
    const signalHash = manifest().registration.signal_hash
    const text = [
      `=== Libro · Signed by a human · @ada · 2026-07-21T12:00Z · ${signalHash} · https://memorioso.xyz/api/publications/42/libro-manifest ===`,
      'Hello human world.',
      '=== End Libro ===',
    ].join('\n')

    expect(parseLibroTextTags(text)).toEqual([{
      authorHandle: 'ada',
      publicationDate: '2026-07-21T12:00Z',
      signalHash,
      manifestUrl: 'https://memorioso.xyz/api/publications/42/libro-manifest',
      bodyText: 'Hello human world.',
    }])
  })

  it('detects legacy shortened hashes without treating them as a different signal', () => {
    const signalHash = manifest().registration.signal_hash
    const shortHash = `${signalHash.slice(0, 8)}…${signalHash.slice(-4)}`
    const text = `=== Libro · Signed by a human · @ada · 2026-07-21T12:00Z · ${shortHash} ===\nHello\n=== End Libro ===`
    expect(parseLibroTextTags(text)[0]).toMatchObject({ signalHash: shortHash, manifestUrl: null })
    expect(libroTextTagHashMatches(shortHash, signalHash)).toBe(true)
  })

  it('normalizes signed publication timestamps to UTC minute precision', () => {
    expect(formatLibroPublicationMinute('2026-07-21T05:34:59-07:00')).toBe('2026-07-21T12:34Z')
    expect(() => formatLibroPublicationMinute('2026-07-21T12:34')).toThrow('timezone')
    expect(() => formatLibroPublicationMinute('not-a-dateZ')).toThrow('valid timestamp')
  })

  it('does not parse legacy date-only boundaries', () => {
    const signalHash = manifest().registration.signal_hash
    const text = `=== Libro · Signed by a human · @ada · 2026-07-21 · ${signalHash} ===\nHello\n=== End Libro ===`
    expect(parseLibroTextTags(text)).toEqual([])
  })
})

describe('Libro embed manifests', () => {
  it('validates canonical signal and handle hashes', () => {
    expect(assertLibroManifestLocalIntegrity(manifest())).toEqual(manifest())
    expect(manifestElementId(manifest().registration.signal_hash))
      .toBe(`libro-manifest-${manifest().registration.signal_hash}`)
  })

  it('requires the orb policy and human-signed claim', () => {
    expect(() => parseLibroPublicationV1({
      ...publication,
      world_id_credential_policy: 'document_or_orb',
    })).toThrow('credential policy')
    expect(() => parseLibroEmbedManifest({
      ...manifest(),
      claim: 'human-authored',
    })).toThrow('signing claim')
  })

  it('accepts title-only publications but rejects an empty title and body', () => {
    expect(parseLibroPublicationV1({
      ...publication,
      publication_title: 'Title only',
      publication_content: { html: '<p><br></p>' },
    }).publication_title).toBe('Title only')
    expect(() => parseLibroPublicationV1({
      ...publication,
      publication_title: '   ',
      publication_content: { html: '<p><br></p>' },
    })).toThrow('title or readable content')
  })

  it('accepts human and agent v2 publications in the v1 embed envelope', () => {
    const humanManifest = manifest()
    humanManifest.publication = publicationV2
    humanManifest.registration.signal_hash = hashPublicationSignal(canonicalPublicationSignal(publicationV2))
    expect(assertLibroManifestLocalIntegrity(humanManifest).publication).toEqual(publicationV2)

    const agentPublication: LibroAgentPublicationV2Payload = {
      publication_schema: LIBRO_AGENT_PUBLICATION_SCHEMA_V2,
      libro_agent_protocol_version: LIBRO_AGENT_PROTOCOL_VERSION,
      authorship_claim: 'human_authorized_agent',
      author_reference: { namespace: 'https://memorioso.xyz', id: 'author-1' },
      publication_date: publication.publication_date,
      author_name_libro: publication.author_name_libro,
      author_handle_libro: publication.author_handle_libro,
      author_handle_hash_libro: publication.author_handle_hash_libro,
      author_bio_libro: publication.author_bio_libro,
      publication_title: publication.publication_title,
      publication_content: publication.publication_content,
      publication_subtitle: publication.publication_subtitle,
      agent_address: `0x${'33'.repeat(20)}`,
      agent_registration_hash: `0x${'44'.repeat(32)}`,
    }
    const agentManifest: LibroEmbedManifestV1 = {
      ...manifest(),
      claim: 'human-authorized-agent',
      publication: agentPublication,
      registration: {
        ...manifest().registration,
        signal_hash: hashPublicationSignal(canonicalPublicationSignal(agentPublication)),
        authorship_class: 'agent',
      },
    }
    expect(assertLibroManifestLocalIntegrity(agentManifest).publication).toEqual(agentPublication)
  })

  it('rejects publication and handle tampering', () => {
    expect(() => assertLibroManifestLocalIntegrity({
      ...manifest(),
      publication: { ...publication, publication_content: { html: '<p>Changed</p>' } },
    })).toThrow('signal hash')
    expect(() => assertLibroManifestLocalIntegrity({
      ...manifest(),
      registration: { ...manifest().registration, handle_hash: `0x${'22'.repeat(32)}` },
    })).toThrow('handle hash')
  })

  it('escapes HTML script terminators in the data block', () => {
    const unsafe = manifest()
    unsafe.publication = {
      ...unsafe.publication,
      publication_content: { html: '<p></script><script>alert(1)</script>Readable</p>' },
    }
    unsafe.registration.signal_hash = hashPublicationSignal(canonicalPublicationSignal(unsafe.publication))
    const serialized = serializeManifestForHtml(unsafe)
    expect(serialized).not.toContain('</script>')
    expect(JSON.parse(serialized).publication.publication_content.html).toContain('</script>')
  })
})

describe('Compact publication signal', () => {
  it('pins the Libro v1 canonical signal for permanent compatibility', () => {
    expect(canonicalPublicationSignal(publication)).toBe(
      '{"author_bio_libro":"","author_handle_hash_libro":"0x24594aaefd000e9143d29865ad2d4b1f7dd92f11bfe9f1700101dc459f655501","author_handle_libro":"ada","author_id_libro":"author-1","author_name_libro":"Ada","content_hash":"0x65d868d411cf4e386d96b7c3c4d38800c4659c00fdb28fa230cffe863bd1b1e6","libro_protocol_version":"libro-v1","publication_date":"2026-07-21T12:00:00.000Z","publication_schema":"libro-publication-v1","publication_subtitle":"","publication_title":"","world_id_credential_policy":"orb","world_id_proof_type":"session","world_id_protocol_version":"4.0"}'
    )
  })

  it('signs a content hash instead of the full article body', () => {
    const signalText = canonicalPublicationSignal(publication)
    const signalJson = JSON.parse(signalText)
    expect(signalJson.content_hash).toBe(hashLibroPublicationContent(publication.publication_content))
    expect(signalJson.publication_content).toBeUndefined()
    expect(signalText).not.toContain('Hello')
    expect(signalText).not.toContain('publication_content')
  })

  it('keeps the signed signal small no matter how large the article body is', () => {
    const largeContent = { html: `<p>${'word '.repeat(20_000)}</p>` }
    expect(largeContent.html.length).toBeGreaterThan(100_000)
    const largePublication: LibroPublicationV1Payload = { ...publication, publication_content: largeContent }
    const signalText = canonicalPublicationSignal(largePublication)
    expect(signalText.length).toBeLessThan(2_000)
    expect(signalText).not.toContain('word')
  })

  it('still binds the proof to the exact article body via the content hash', () => {
    const signalHash = hashPublicationSignal(canonicalPublicationSignal(publication))
    const swapped = { ...publication, publication_content: { html: '<p>Swapped body</p>' } }
    expect(hashPublicationSignal(canonicalPublicationSignal(swapped))).not.toBe(signalHash)
  })

  it('signs the scoped author reference in a compact Libro v2 signal', () => {
    const signalText = canonicalPublicationSignal(publicationV2)
    const signalJson = JSON.parse(signalText)
    expect(signalJson.author_reference).toEqual(publicationV2.author_reference)
    expect(signalJson.author_id_libro).toBeUndefined()
    expect(signalJson.content_hash).toBe(hashLibroPublicationContent(publicationV2.publication_content))
    expect(signalJson.publication_content).toBeUndefined()
  })

  it('leaves non-Libro-V1 publication signals as full canonical JSON', () => {
    const agentPublication: LibroAgentPublicationV1Payload = {
      publication_schema: LIBRO_AGENT_PUBLICATION_SCHEMA_V1,
      libro_agent_protocol_version: LIBRO_AGENT_PROTOCOL_VERSION,
      authorship_claim: 'human_authorized_agent',
      author_id_libro: 'author-1',
      publication_date: '2026-07-21T12:00:00.000Z',
      author_name_libro: 'Ada',
      author_handle_libro: 'ada',
      author_handle_hash_libro: hashLibroHandle('ada'),
      author_bio_libro: '',
      publication_title: '',
      publication_content: { html: '<p>Agent-authored text.</p>' },
      publication_subtitle: '',
      agent_address: `0x${'33'.repeat(20)}`,
      agent_registration_hash: `0x${'44'.repeat(32)}`,
    }
    expect(canonicalPublicationSignal(agentPublication)).toContain('Agent-authored text.')
  })
})

describe('Libro v2 publication parsing', () => {
  it('accepts an optional strict author reference', () => {
    expect(parseLibroPublicationV2(publicationV2)).toEqual(publicationV2)
    const { author_reference: _reference, ...withoutReference } = publicationV2
    expect(parseLibroPublication(withoutReference)).toEqual(withoutReference)
  })

  it.each([
    { namespace: 'http://memorioso.xyz', id: 'author-1' },
    { namespace: 'https://memorioso.xyz/', id: 'author-1' },
    { namespace: 'https://memorioso.xyz/path', id: 'author-1' },
    { namespace: 'https://memorioso.xyz', id: '' },
    { namespace: 'https://memorioso.xyz', id: ' author-1' },
    { namespace: 'https://memorioso.xyz', id: 'x'.repeat(257) },
    { namespace: 'https://memorioso.xyz', id: 'author-1', label: 'Ada' },
  ])('rejects an invalid author reference: $namespace / $id', (author_reference) => {
    expect(() => parseLibroPublicationV2({ ...publicationV2, author_reference })).toThrow('author_reference')
  })

  it('allows canonical localhost HTTP origins', () => {
    expect(parseLibroPublicationV2({
      ...publicationV2,
      author_reference: { namespace: 'http://localhost:3000', id: 'author-1' },
    }).author_reference?.namespace).toBe('http://localhost:3000')
  })

  it('rejects the legacy unscoped author id in both v2 schemas', () => {
    expect(() => parseLibroPublicationV2({ ...publicationV2, author_id_libro: 'author-1' }))
      .toThrow('author_id_libro')

    const agentPublication: LibroAgentPublicationV2Payload = {
      publication_schema: LIBRO_AGENT_PUBLICATION_SCHEMA_V2,
      libro_agent_protocol_version: LIBRO_AGENT_PROTOCOL_VERSION,
      authorship_claim: 'human_authorized_agent',
      publication_date: publication.publication_date,
      author_name_libro: publication.author_name_libro,
      author_handle_libro: publication.author_handle_libro,
      author_handle_hash_libro: publication.author_handle_hash_libro,
      author_bio_libro: publication.author_bio_libro,
      publication_title: publication.publication_title,
      publication_content: publication.publication_content,
      publication_subtitle: publication.publication_subtitle,
      agent_address: `0x${'33'.repeat(20)}`,
      agent_registration_hash: `0x${'44'.repeat(32)}`,
    }
    expect(() => parseLibroAgentPublicationV2({ ...agentPublication, author_id_libro: 'author-1' }))
      .toThrow('author_id_libro')
  })
})
