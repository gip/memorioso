import type { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

function request(body: unknown): NextRequest {
  return {
    json: async () => body,
  } as unknown as NextRequest
}

const draftRow = {
  id: 'd109b298-4dda-4030-a7ac-9e3481cd840a',
  title: 'A human note',
  subtitle: 'On signatures',
  content: { html: '<p>Hello human world.</p>' },
  status: 'editing',
  authorId: '8d22d0e5-2a31-42ca-9356-6e2b3c16a4aa',
  author_name: 'Ada',
  author_handle: 'ada',
  author_bio: 'Writes proofs.',
  publicationType: 'article',
  world_id_session_id: `session_${'11'.repeat(32)}${'22'.repeat(32)}`,
  world_id_session_commitment: `0x${'11'.repeat(32)}`,
}

describe('publish context route', () => {
  beforeEach(() => {
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

  it('creates independent session-bound publication challenges without actions', async () => {
    const first = await POST(request({ draftId: draftRow.id }))
    const second = await POST(request({ draftId: draftRow.id }))
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
      world_id_proof_type: string
      world_id_credential_policy: string
    }

    expect(firstParams[0]).toBe(challengeIds.values[0])
    expect(firstParams[3]).toBe('0x123')
    expect(firstParams[4]).toBe(draftRow.world_id_session_commitment)
    expect(firstPublication.world_id_proof_type).toBe('session')
    expect(firstPublication.world_id_credential_policy).toBe('orb')
    expect(firstParams[5]).not.toContain('world_id_action')
    expect(firstParams[5]).toContain('"world_id_proof_type":"session"')
  })

  it('keeps the signed payload small for a large article body', async () => {
    const largeHtml = `<p>${'word '.repeat(20_000)}</p>`
    dbMock.query.mockImplementation(async (query: string) => {
      if (query.includes('COUNT(*)::int')) return { rows: [{ count: 0 }] }
      if (query.includes('FROM drafts')) return {
        rows: [{ ...draftRow, content: { html: largeHtml } }],
      }
      return { rows: [] }
    })

    const response = await POST(request({ draftId: draftRow.id }))
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
        rows: [{ ...draftRow, publicationType: 'short', title: '', subtitle: '' }],
      }
      return { rows: [] }
    })

    const response = await POST(request({ draftId: draftRow.id }))
    expect(response.status).toBe(200)
    const insert = dbMock.query.mock.calls.find(([query]) => String(query).includes('INSERT INTO world_id_publish_challenges'))
    expect((insert?.[1] as unknown[])[5]).toContain('"publication_title":""')
  })

  it('rejects an article without a readable body', async () => {
    dbMock.query.mockImplementation(async (query: string) => {
      if (query.includes('COUNT(*)::int')) return { rows: [{ count: 0 }] }
      if (query.includes('FROM drafts')) {
        return { rows: [{ ...draftRow, title: 'Title only', content: { html: '<p><br></p>' } }] }
      }
      return { rows: [] }
    })

    const response = await POST(request({ draftId: draftRow.id }))
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ message: 'Article body is required' })
  })

  it('rejects a publication with an empty title and no readable content', async () => {
    dbMock.query.mockImplementation(async (query: string) => {
      if (query.includes('COUNT(*)::int')) return { rows: [{ count: 0 }] }
      if (query.includes('FROM drafts')) return {
        rows: [{ ...draftRow, title: '   ', subtitle: '', content: { html: '<p><br></p>' } }],
      }
      return { rows: [] }
    })

    const response = await POST(request({ draftId: draftRow.id }))
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      message: 'Article title is required',
    })
  })
})
