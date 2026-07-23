import { describe, expect, it } from 'vitest'
import {
  actionHashToHex,
  assertLibroManifestLocalIntegrity,
  canonicalPublicationSignal,
  extractReadableText,
  formatLibroTextTag,
  formatLibroPublicationMinute,
  hasMeaningfulPublicationBody,
  hasPublishablePublication,
  hashPublicationSignal,
  isSimpleTextPublication,
  LIBRO_EMBED_SCHEMA_V1,
  LIBRO_HUMAN_SIGNED_CLAIM,
  LIBRO_PROTOCOL_VERSION,
  LIBRO_PUBLICATION_SCHEMA_V1,
  LIBRO_V1_REGISTRY_ADDRESS,
  libroTextTagHashMatches,
  manifestElementId,
  parseLibroEmbedManifest,
  parseLibroPublicationV1,
  parseLibroTextTags,
  serializeManifestForHtml,
  type LibroEmbedManifestV1,
  type LibroPublicationV1Payload,
} from './index'

const publication: LibroPublicationV1Payload = {
  publication_schema: LIBRO_PUBLICATION_SCHEMA_V1,
  libro_protocol_version: LIBRO_PROTOCOL_VERSION,
  world_id_protocol_version: '4.0',
  world_id_action: 'written-by-a-human-v4-abc',
  world_id_credential_policy: 'orb',
  author_id_libro: 'author-1',
  publication_date: '2026-07-21T12:00:00.000Z',
  author_name_libro: 'Ada',
  author_handle_libro: 'ada',
  author_bio_libro: '',
  publication_title: '',
  publication_content: { html: '<p>Hello <strong>human</strong> world.</p>' },
  publication_subtitle: '',
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
  it('validates canonical signal and action hashes', () => {
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
    })).toThrow('human-signing claim')
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

  it('rejects publication and action tampering', () => {
    expect(() => assertLibroManifestLocalIntegrity({
      ...manifest(),
      publication: { ...publication, publication_content: { html: '<p>Changed</p>' } },
    })).toThrow('signal hash')
    expect(() => assertLibroManifestLocalIntegrity({
      ...manifest(),
      registration: { ...manifest().registration, action_hash: `0x${'22'.repeat(32)}` },
    })).toThrow('action hash')
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
