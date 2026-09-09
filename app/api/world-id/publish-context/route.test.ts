import type { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const dbMock = vi.hoisted(() => ({
  connect: vi.fn(),
  query: vi.fn(),
  release: vi.fn(),
}))

const authMock = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
}))

const challengeIds = vi.hoisted(() => ({
  values: [
    '03b18435-96c5-46e6-91c5-cd4ac1abb197',
    'eeb2277b-b648-4afb-8c38-5fc936e41afa',
  ],
  index: 0,
}))

vi.mock('@/lib/db', () => ({
  pool: {
    connect: dbMock.connect,
  },
}))

vi.mock('@/lib/auth-user', () => ({
  getAuthenticatedUser: authMock.getAuthenticatedUser,
}))

vi.mock('@/lib/libro-service/token-store', () => ({ getLibroAccessToken: async () => 'test-token' }))

vi.mock('@/lib/world-id/server', () => ({
  getWorldIdServerConfig: () => ({
    appId: 'app_424563557eea16567fdb5655c9ee742e',
    rpId: 'rp_test',
    publishActionPrefix: 'written-by-a-human-v4',
    environment: 'production',
    signingKeyHex: '0xabc',
  }),
  createRpContext: () => ({
    rp_id: 'rp_test',
    nonce: '0x123',
    created_at: Math.floor(Date.now() / 1000),
    expires_at: Math.floor(Date.now() / 1000) + 300,
    signature: 'signature-session',
  }),
}))

vi.mock('@/lib/libro/config', () => ({
  getLibroServerConfig: () => ({
    protocolVersion: 'libro-v1',
    chainId: 480,
    registryAddress: '0x1111111111111111111111111111111111111111',
    rpId: BigInt(1),
    rpcUrls: ['https://worldchain-mainnet.g.alchemy.com/public'],
  }),
}))

import { POST } from './route'
import { PUBLICATION_SUBTITLE_MAX_LENGTH } from '@/lib/publication-limits'

function request(body: unknown): NextRequest {
  return {
    json: async () => body,
  } as unknown as NextRequest
}

// The draft row is encrypted, so the route reads only metadata from it. The
// prose arrives in the request body from the browser that just decrypted it.
const draftRow = {
  id: 'd109b298-4dda-4030-a7ac-9e3481cd840a',
  status: 'editing',
  authorId: '8d22d0e5-2a31-42ca-9356-6e2b3c16a4aa',
  author_name: 'Ada',
  author_handle: 'ada',
  author_bio: 'Writes proofs.',
  publicationType: 'article',
  world_id_session_id: `session_${'11'.repeat(32)}${'22'.repeat(32)}`,
  world_id_session_commitment: `0x${'11'.repeat(32)}`,
}

const prose = {
  title: 'A human note',
  subtitle: 'On signatures',
  content: { html: '<p>Hello human world.</p>' },
}

const publish = (overrides: Record<string, unknown> = {}) =>
  POST(request({ draftId: draftRow.id, ...prose, ...overrides }))

describe('publish context route', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })
  beforeEach(() => {
    vi.stubEnv('LIBRO_SERVICE_WRITES_ENABLED', '0')
    dbMock.connect.mockReset()
    dbMock.query.mockReset()
    dbMock.release.mockReset()
    authMock.getAuthenticatedUser.mockReset()
    challengeIds.index = 0

    vi.stubGlobal('crypto', {
      randomUUID: () => challengeIds.values[challengeIds.index++],
    })

    dbMock.connect.mockResolvedValue({
      query: dbMock.query,
      release: dbMock.release,
    })
    dbMock.query.mockImplementation(async (query: string) => {
      if (query.includes('COUNT(*)::int')) return { rows: [{ count: 0 }] }
      if (query.includes('FROM drafts')) {
        return { rows: [draftRow] }
      }

      return { rows: [] }
    })
    authMock.getAuthenticatedUser.mockResolvedValue({ id: 7 })
  })

  function serviceMode() {
    vi.stubEnv('LIBRO_SERVICE_WRITES_ENABLED', '1')
    vi.stubEnv('LIBRO_SERVICE_URL', 'https://libro.test')
    vi.stubEnv('LIBRO_OAUTH_CLIENT_ID', 'memorioso')
    vi.stubEnv('LIBRO_OAUTH_CLIENT_SECRET', 'test-secret')
  }

  it('preserves a Libro namespace rejection as JSON with HTTP 403', async () => {
    serviceMode()
    const message = 'Publication author reference does not match the client namespace'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({
      error: { code: 'NAMESPACE_MISMATCH', message, retryable: false },
    }, { status: 403 })))
    const response = await publish()
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ success: false, message, code: 'NAMESPACE_MISMATCH' })
    expect(dbMock.release).toHaveBeenCalledOnce()
    expect(dbMock.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO pending_libro_publications'))).toBe(false)
  })

  it.each([200, 502])('returns JSON when Libro sends an empty HTTP %s response', async (status) => {
    serviceMode()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status })))
    const response = await publish()
    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toMatchObject({ success: false, message: 'Libro publication challenge failed' })
    expect(dbMock.release).toHaveBeenCalledOnce()
  })

  it('returns JSON with HTTP 502 when Libro cannot be reached', async () => {
    serviceMode()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))
    const response = await publish()
    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toMatchObject({ success: false, message: 'Libro service could not be reached' })
    expect(dbMock.release).toHaveBeenCalledOnce()
  })

  it('returns a generic JSON 500 for unexpected server failures', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    dbMock.connect.mockRejectedValue(new Error('private database details'))
    const response = await publish()
    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ success: false, message: 'Failed to start publication signing' })
  })

  it('returns JSON with HTTP 400 for malformed request JSON', async () => {
    const response = await POST({ json: async () => { throw new SyntaxError('Unexpected end of JSON input') } } as unknown as NextRequest)
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ success: false })
    expect(dbMock.connect).not.toHaveBeenCalled()
  })

  it('creates independent session-bound publication challenges without actions', async () => {
    const first = await publish()
    const second = await publish()
    const firstBody = await first.json()
    const secondBody = await second.json()

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(firstBody).not.toHaveProperty('action')
    expect(secondBody).not.toHaveProperty('action')
    expect(firstBody.existingSessionId).toBe(draftRow.world_id_session_id)
    expect(firstBody.credentialPolicy).toBe('orb')
    expect(firstBody.allowedCredentials).toEqual(['proof_of_human'])

    const insertCalls = dbMock.query.mock.calls.filter(([query]) =>
      String(query).includes('INSERT INTO world_id_publish_challenges')
    )
    const firstParams = insertCalls[0][1] as unknown[]
    const firstPublication = firstParams[7] as {
      publication_schema: string
      author_reference?: { namespace: string; id: string }
      world_id_proof_type: string
      world_id_credential_policy: string
    }

    expect(firstParams[0]).toBe(challengeIds.values[0])
    expect(firstParams[3]).toBe('0x123')
    expect(firstParams[4]).toBe(draftRow.world_id_session_commitment)
    expect(firstPublication.publication_schema).toBe('libro-publication-v2')
    expect(firstPublication.author_reference).toEqual({
      namespace: 'https://memorioso.xyz',
      id: draftRow.authorId,
    })
    expect(firstPublication).not.toHaveProperty('author_id_libro')
    expect(firstPublication.world_id_proof_type).toBe('session')
    expect(firstPublication.world_id_credential_policy).toBe('orb')
    expect(firstParams[5]).not.toContain('world_id_action')
    expect(firstParams[5]).toContain('"world_id_proof_type":"session"')
  })

  it('keeps the signed payload small for a large article body', async () => {
    const largeHtml = `<p>${'word '.repeat(20_000)}</p>`

    const response = await publish({ content: { html: largeHtml } })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(largeHtml.length).toBeGreaterThan(100_000)
    expect(body.signalText.length).toBeLessThan(2_000)
    expect(body.signalText).not.toContain('word')
    expect(JSON.parse(body.signalText).content_hash).toMatch(/^0x[0-9a-f]{64}$/)
  })

  it('accepts an empty title while keeping it in the signed payload', async () => {
    dbMock.query.mockImplementation(async (query: string) => {
      if (query.includes('COUNT(*)::int')) return { rows: [{ count: 0 }] }
      if (query.includes('FROM drafts')) return {
        rows: [{ ...draftRow, publicationType: 'short' }],
      }
      return { rows: [] }
    })

    const response = await publish({ title: '', subtitle: '' })
    expect(response.status).toBe(200)
    const insert = dbMock.query.mock.calls.find(([query]) => String(query).includes('INSERT INTO world_id_publish_challenges'))
    expect((insert?.[1] as unknown[])[5]).toContain('"publication_title":""')
  })

  it('rejects an article without a readable body', async () => {
    const response = await publish({ title: 'Title only', content: { html: '<p><br></p>' } })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ message: 'Article body is required' })
  })

  it('rejects a publication with an empty title and no readable content', async () => {
    const response = await publish({ title: '   ', subtitle: '', content: { html: '<p><br></p>' } })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      message: 'Article title is required',
    })
  })

  it('never reads prose from the draft row', async () => {
    await publish()

    const draftSelect = dbMock.query.mock.calls
      .map(([query]) => String(query))
      .find((query) => query.includes('FROM drafts'))

    expect(draftSelect).toBeDefined()
    expect(draftSelect).not.toMatch(/d\.title|d\.subtitle|d\.content/)
  })

  it('rejects a request that omits the decrypted prose', async () => {
    const response = await POST(request({ draftId: draftRow.id }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      message: 'Publication title and subtitle must be text',
    })
  })

  it('rejects content that is not a publication body', async () => {
    const response = await publish({ content: { html: 42 } })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      message: 'Publication content is required',
    })
  })

  it('accepts a subtitle at the maximum length and rejects longer subtitles', async () => {
    const accepted = await publish({ subtitle: 'x'.repeat(PUBLICATION_SUBTITLE_MAX_LENGTH) })
    expect(accepted.status).toBe(200)

    const rejected = await publish({ subtitle: 'x'.repeat(PUBLICATION_SUBTITLE_MAX_LENGTH + 1) })
    expect(rejected.status).toBe(400)
    await expect(rejected.json()).resolves.toMatchObject({
      message: `Article subtitles are limited to ${PUBLICATION_SUBTITLE_MAX_LENGTH} characters`,
    })
  })

  it('signs the prose from the request, not from the database', async () => {
    await publish({ title: 'Sent by the browser' })

    const insert = dbMock.query.mock.calls.find(([query]) =>
      String(query).includes('INSERT INTO world_id_publish_challenges')
    )
    const publication = (insert?.[1] as unknown[])[7] as { publication_title: string }

    expect(publication.publication_title).toBe('Sent by the browser')
  })
})
