import { describe, expect, it } from 'vitest'
import {
  actionHashToHex,
  assertLibroManifestLocalIntegrity,
  canonicalPublicationSignal,
  extractReadableText,
  hasMeaningfulPublicationBody,
  hashPublicationSignal,
  isSimpleTextPublication,
  LIBRO_EMBED_SCHEMA_V1,
  LIBRO_HUMAN_AUTHORSHIP_CLAIM,
  LIBRO_PROTOCOL_VERSION,
  LIBRO_PUBLICATION_SCHEMA_V1,
  LIBRO_V1_REGISTRY_ADDRESS,
  manifestElementId,
  serializeManifestForHtml,
  type LibroEmbedManifestV1,
  type LibroPublicationV1Payload,
} from './index'

const publication: LibroPublicationV1Payload = {
  publication_schema: LIBRO_PUBLICATION_SCHEMA_V1,
  libro_protocol_version: LIBRO_PROTOCOL_VERSION,
  world_id_protocol_version: '4.0',
  world_id_action: 'written-by-a-human-v4-abc',
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

function manifest(): LibroEmbedManifestV1 {
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

  it('recognizes the one-paragraph simple profile', () => {
    expect(isSimpleTextPublication(publication)).toBe(true)
    expect(isSimpleTextPublication({ ...publication, publication_title: 'Title' })).toBe(false)
    expect(isSimpleTextPublication({ ...publication, publication_content: { html: '<p>One</p><p>Two</p>' } })).toBe(false)
  })
})

describe('Libro embed manifests', () => {
  it('validates canonical signal and action hashes', () => {
    expect(assertLibroManifestLocalIntegrity(manifest())).toEqual(manifest())
    expect(manifestElementId(manifest().registration.signal_hash))
      .toBe(`libro-manifest-${manifest().registration.signal_hash}`)
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
