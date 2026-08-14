import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { canonicalPublicationSignal } from '@/lib/world-id/publication'

const dbMock = vi.hoisted(() => ({ connect: vi.fn(), query: vi.fn(), release: vi.fn() }))
const authMock = vi.hoisted(() => ({
  getExtensionSession: vi.fn(),
  cleanupExpiredExtensionData: vi.fn(),
  enforceExtensionSignatureRateLimit: vi.fn(),
}))

vi.mock('@/lib/db', () => ({ pool: { connect: dbMock.connect } }))
vi.mock('@/lib/extension-auth', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/extension-auth')>(),
  getExtensionSession: authMock.getExtensionSession,
  cleanupExpiredExtensionData: authMock.cleanupExpiredExtensionData,
  enforceExtensionSignatureRateLimit: authMock.enforceExtensionSignatureRateLimit,
}))
vi.mock('@/lib/world-id/server', () => ({
  getWorldIdServerConfig: () => ({
    appId: 'app_424563557eea16567fdb5655c9ee742e',
    rpId: 'rp_1234567890abcdef',
    publishActionPrefix: 'written-by-a-human-v4',
    environment: 'production',
    signingKeyHex: '0xabc',
  }),
  createPublishAction: (id: string, prefix: string) => `${prefix}-${id}`,
  createRpContext: () => ({
    rp_id: 'rp_1234567890abcdef',
    nonce: 'nonce-1',
    created_at: 1_775_000_000,
    expires_at: 1_775_000_300,
    signature: '0xsigned',
  }),
}))
vi.mock('@/lib/libro/config', () => ({ getLibroServerConfig: () => ({ chainId: 480 }) }))

import { POST } from './route'
import { ExtensionRateLimitError } from '@/lib/extension-auth'

function request(text: unknown, authorId?: unknown): NextRequest {
  return new NextRequest('https://memorioso.xyz/api/extension/signatures', {
    method: 'POST',
    headers: { Authorization: 'Bearer test_token_with_enough_characters' },
    body: JSON.stringify({ text, ...(authorId === undefined ? {} : { authorId }) }),
  })
}

describe('inline signature creation', () => {
  beforeEach(() => {
    dbMock.connect.mockReset()
    dbMock.query.mockReset()
    dbMock.release.mockReset()
    authMock.getExtensionSession.mockReset()
    authMock.cleanupExpiredExtensionData.mockReset().mockResolvedValue(undefined)
    authMock.enforceExtensionSignatureRateLimit.mockReset().mockResolvedValue(undefined)
    authMock.getExtensionSession.mockResolvedValue({ user: { id: 7, handle: 'ada' } })
    dbMock.connect.mockResolvedValue({ query: dbMock.query, release: dbMock.release })
    dbMock.query.mockImplementation(async (query: string) => {
      if (query.includes('FROM authors')) {
        return { rows: [{
          id: 'author-1', name: 'Ada', handle: 'ada', bio: 'Writes.',
          world_id_session_id: `session_${'11'.repeat(32)}${'22'.repeat(32)}`,
          world_id_session_commitment: `0x${'11'.repeat(32)}`,
        }] }
      }
      if (query.includes('INSERT INTO drafts')) return { rows: [{ id: 'draft-1' }] }
      return { rows: [] }
    })
  })

  it('atomically creates the same canonical publication payload used by the website', async () => {
    const response = await POST(request('  Café & <human>\nsecond line  '))
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      success: true,
      draftId: 'draft-1',
      normalizedText: 'Café & <human> second line',
      author: { handle: 'ada' },
      credentialPolicy: 'orb',
      allowedCredentials: ['proof_of_human'],
      existingSessionId: `session_${'11'.repeat(32)}${'22'.repeat(32)}`,
    })

    const draftInsert = dbMock.query.mock.calls.find(([query]) => String(query).includes('INSERT INTO drafts'))!
    expect(draftInsert[1][1]).toEqual({ html: '<p>Café &amp; &lt;human&gt;<br>second line</p>' })
    const challengeInsert = dbMock.query.mock.calls.find(([query]) => String(query).includes('INSERT INTO world_id_publish_challenges'))!
    const signalText = challengeInsert[1][5]
    const publication = challengeInsert[1][7]
    expect(signalText).toBe(canonicalPublicationSignal(publication))
    expect(publication).toMatchObject({
      publication_schema: 'libro-publication-v1',
      world_id_proof_type: 'session',
      world_id_credential_policy: 'orb',
      author_id_libro: 'author-1',
      author_handle_libro: 'ada',
      publication_title: '',
      publication_subtitle: '',
      publication_content: draftInsert[1][1],
    })
    expect(publication).not.toHaveProperty('world_id_action')
    expect(dbMock.query.mock.calls.map(([query]) => String(query).trim())).toEqual(expect.arrayContaining([
      'BEGIN',
      'COMMIT',
    ]))
  })

  it('rejects empty and over-limit normalized text before opening a transaction', async () => {
    expect((await POST(request(' \n\t '))).status).toBe(400)
    expect((await POST(request('x'.repeat(501)))).status).toBe(400)
    expect(dbMock.connect).not.toHaveBeenCalled()
  })

  it('requires a valid extension session', async () => {
    authMock.getExtensionSession.mockResolvedValue(null)
    expect((await POST(request('Human text'))).status).toBe(401)
    expect(dbMock.connect).not.toHaveBeenCalled()
  })

  it('requires an existing Memorioso author', async () => {
    dbMock.query.mockImplementation(async (query: string) =>
      query.includes('FROM authors') ? { rows: [] } : { rows: [] })
    const response = await POST(request('Human text'))
    expect(response.status).toBe(409)
    expect(dbMock.query).toHaveBeenCalledWith('ROLLBACK')
  })

  it('rate-limits excessive signing requests before opening a transaction', async () => {
    authMock.enforceExtensionSignatureRateLimit.mockRejectedValueOnce(
      new ExtensionRateLimitError('Too many signing requests')
    )
    const response = await POST(request('Human text'))
    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('600')
    expect(dbMock.connect).not.toHaveBeenCalled()
  })
})
