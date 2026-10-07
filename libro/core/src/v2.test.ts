import { readFileSync } from 'node:fs'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { canonicalPublicationSignal, hashPublicationSignal, parseLibroPublication, parseLibroPublicationV3, v2PublicationCommitment, canonicalV2PublicationSignal, registryProtocolVersion, requireV2Registry, type LibroPublicationV3Payload } from './index'
const vectors = JSON.parse(readFileSync(new URL('../fixtures/publication-v2-vectors.json', import.meta.url), 'utf8'))
afterEach(() => vi.unstubAllEnvs())
describe('Libro v2 commitments', () => {
  it('matches shared Solidity golden vectors for original, v1 update and agent update', () => {
    for (const vector of vectors) {
      const publication = parseLibroPublicationV3(vector.publication)
      expect(v2PublicationCommitment(publication).payloadHash).toBe(vector.payloadHash)
      expect(canonicalPublicationSignal(publication)).toBe(vector.signal)
      expect(hashPublicationSignal(vector.signal)).toBe(vector.signalHash)
    }
  })
  it('binds content, predecessor, handle, class and contract', () => {
    const original = vectors[1].publication as LibroPublicationV3Payload
    const hash = canonicalV2PublicationSignal(original)
    const variants = [
      {...original, publication_content: {html:'<p>Tampered</p>'}},
      {...original, previous_publication: {...original.previous_publication!, signal_hash: `0x${'ab'.repeat(32)}`}},
      {...original, author_handle_hash_libro:`0x${'cd'.repeat(32)}`},
      {...original, publication_registry:`0x${'ef'.repeat(20)}`},
      vectors[2].publication,
    ]
    for (const variant of variants) expect(canonicalV2PublicationSignal(variant)).not.toBe(hash)
  })
  it('rejects inconsistent revision metadata and unsupported World ID versions', () => {
    for (const delta of [{revision_number:2},{initially_published_at:'2026-07-20T12:00:00.000Z'},{world_id_protocol_version:'3.0'}]) {
      expect(() => parseLibroPublication({...vectors[0].publication,...delta})).toThrow()
    }
    expect(() => parseLibroPublication({...vectors[1].publication, previous_publication:{...vectors[1].publication.previous_publication,chain_id:1}})).toThrow()
  })
  it('requires explicit distinct trusted v1 and v2 deployments', () => {
    vi.stubEnv('NEXT_PUBLIC_LIBRO_V1_REGISTRY_ADDRESS','0x1111111111111111111111111111111111111111')
    vi.stubEnv('NEXT_PUBLIC_LIBRO_V2_REGISTRY_ADDRESS','0x2222222222222222222222222222222222222222')
    expect(requireV2Registry()).toBe(vectors[0].publication.publication_registry)
    expect(registryProtocolVersion(requireV2Registry())).toBe('libro-v2')
    expect(registryProtocolVersion('0x3333333333333333333333333333333333333333')).toBeNull()
    vi.stubEnv('NEXT_PUBLIC_LIBRO_V2_REGISTRY_ADDRESS','')
    expect(requireV2Registry).toThrow()
  })
})
