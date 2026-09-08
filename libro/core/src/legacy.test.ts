import { describe, expect, it } from 'vitest'
import { isLegacyPublicationProof, parseLegacyPublication, parseLibroPublication } from './index'

const legacy = { author_id_libro: 'historical-author', author_name_libro: 'Name', author_bio_libro: '',
  publication_title: 'Title', publication_subtitle: '', publication_date: '2024-01-01T12:00:00.000Z',
  publication_content: { html: '<p>Original</p>' } }

describe('legacy read compatibility', () => {
  it('preserves the exact object without adding a schema or handle', () => {
    expect(parseLegacyPublication(legacy)).toBe(legacy)
    expect(() => parseLibroPublication(legacy)).toThrow()
  })
  it('refuses malformed or modern-shaped publications and proofs', () => {
    expect(() => parseLegacyPublication({ ...legacy, publication_schema: 'libro-publication-v1' })).toThrow()
    expect(() => parseLegacyPublication({ ...legacy, unexpected: 'value' })).toThrow()
    expect(() => parseLegacyPublication({ ...legacy, publication_date: 'invalid' })).toThrow()
    const proof = { proof: '0x12', merkle_root: '0x34', nullifier_hash: '0x56', verification_level: 'orb' }
    expect(isLegacyPublicationProof(proof)).toBe(true)
    expect(isLegacyPublicationProof({ ...proof, protocol_version: '4.0' })).toBe(false)
    expect(isLegacyPublicationProof({ ...proof, proof: 'not-a-proof' })).toBe(false)
  })
})
