import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hashLibroHandle, LIBRO_PROTOCOL_VERSION, LIBRO_PUBLICATION_SCHEMA_V1, LIBRO_PUBLICATION_SCHEMA_V2 } from '@libro/core'
import type { OAuthPrincipal } from './oauth'

const query = vi.hoisted(() => vi.fn())
vi.mock('./db', () => ({ pool: { query } }))
import { createHumanChallenge, humanPublicationAuthorReference } from './human-publications'

const principal: OAuthPrincipal = {
  identityId: 'identity', authorId: 'author', handle: 'ada', name: 'Ada', bio: '',
  sessionCommitment: `0x${'1'.repeat(64)}`, clientId: 'client', resource: 'https://libro.test/mcp',
  scope: ['publish'], authorNamespace: null, verifiedAt: new Date().toISOString(),
}
function publication() {
  return {
    publication_schema: LIBRO_PUBLICATION_SCHEMA_V2, libro_protocol_version: LIBRO_PROTOCOL_VERSION,
    world_id_protocol_version: '4.0', world_id_proof_type: 'session', world_id_credential_policy: 'orb',
    author_name_libro: 'Ada', author_handle_libro: 'ada', author_handle_hash_libro: hashLibroHandle('ada'),
    author_bio_libro: '', publication_date: new Date().toISOString(), publication_title: 'A title',
    publication_subtitle: '', publication_content: { html: '<p>Human writing.</p>' },
  }
}

describe('human publication author references', () => {
  beforeEach(() => {
    vi.stubEnv('LIBRO_SERVICE_WRITES_ENABLED', '1')
    vi.stubEnv('LIBRO_SERVICE_URL', 'https://libro.test')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://memorioso.test')
    vi.stubEnv('LIBRO_SIGNING_CAPABILITY_SECRET', 'test-signing-secret-at-least-thirty-two-bytes')
    query.mockReset().mockResolvedValue({ rows: [{ id: 'challenge' }] })
  })
  afterEach(() => vi.unstubAllEnvs())

  it.each([null, 'https://memorioso.test'])('accepts an omitted v2 reference for namespace %s without changing the signed payload', async (authorNamespace) => {
    const value = publication()
    await createHumanChallenge({ principal: { ...principal, authorNamespace }, publication: value })
    expect(query.mock.calls[0][1][9]).toEqual(value)
    expect(query.mock.calls[0][1][9]).not.toHaveProperty('author_reference')
  })

  it.each([null, 'https://memorioso.test'])('accepts the reference advertised for namespace %s', async (authorNamespace) => {
    const identity = { ...principal, authorNamespace }
    const reference = humanPublicationAuthorReference(identity)
    expect(reference).toEqual({ namespace: authorNamespace || 'https://libro.test', id: 'author' })
    await createHumanChallenge({ principal: identity, publication: { ...publication(), author_reference: reference } })
    expect(query).toHaveBeenCalledOnce()
  })

  it.each([
    { namespace: 'https://memorioso.test', id: 'author' },
    { namespace: 'https://libro.test', id: 'another-author' },
  ])('rejects a supplied reference outside the OAuth authority: %j', async (author_reference) => {
    await expect(createHumanChallenge({ principal, publication: { ...publication(), author_reference } }))
      .rejects.toMatchObject({ code: 'NAMESPACE_MISMATCH', status: 403 })
    expect(query).not.toHaveBeenCalled()
  })

  it('still binds reference-free publications to the authenticated handle and name', async () => {
    await expect(createHumanChallenge({ principal, publication: { ...publication(), author_name_libro: 'Someone else' } }))
      .rejects.toMatchObject({ code: 'AUTHOR_MISMATCH' })
    expect(query).not.toHaveBeenCalled()
  })

  it('still rejects a legacy author ID mismatch', async () => {
    await expect(createHumanChallenge({ principal, publication: {
      ...publication(), publication_schema: LIBRO_PUBLICATION_SCHEMA_V1, author_id_libro: 'another-author',
    } })).rejects.toMatchObject({ code: 'AUTHOR_MISMATCH' })
    expect(query).not.toHaveBeenCalled()
  })
})
