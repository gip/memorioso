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
  createPublishAction: (challengeId: string, actionPrefix: string) => `${actionPrefix}-${challengeId}`,
  createRpContext: (_config: unknown, action: string) => ({
    rp_id: 'rp_test',
    nonce: `nonce-${action}`,
    created_at: Math.floor(Date.now() / 1000),
    expires_at: Math.floor(Date.now() / 1000) + 300,
    signature: `signature-${action}`,
  }),
}))

vi.mock('@/lib/libro/config', () => ({
  getLibroServerConfig: () => ({
    protocolVersion: 'libro-v1',
    chainId: 480,
    registryAddress: '0x1111111111111111111111111111111111111111',
    rpId: BigInt(1),
    rpcUrl: 'https://worldchain-mainnet.g.alchemy.com/public',
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
      if (query.includes('FROM drafts')) {
        return { rows: [draftRow] }
      }

      return { rows: [] }
    })
    authMock.getAuthenticatedUser.mockResolvedValue({ id: 7 })
  })

  it('creates a unique challenge-suffixed action for each publish attempt', async () => {
    const first = await POST(request({ draftId: draftRow.id }))
    const second = await POST(request({ draftId: draftRow.id }))
    const firstBody = await first.json()
    const secondBody = await second.json()

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(firstBody.action).toBe(`written-by-a-human-v4-${challengeIds.values[0]}`)
    expect(secondBody.action).toBe(`written-by-a-human-v4-${challengeIds.values[1]}`)
    expect(firstBody.action).not.toBe(secondBody.action)

    const insertCalls = dbMock.query.mock.calls.filter(([query]) =>
      String(query).includes('INSERT INTO world_id_publish_challenges')
    )
    const firstParams = insertCalls[0][1] as unknown[]
    const firstPublication = firstParams[7] as { world_id_action: string }

    expect(firstParams[0]).toBe(challengeIds.values[0])
    expect(firstParams[3]).toBe(firstBody.action)
    expect(firstPublication.world_id_action).toBe(firstBody.action)
    expect(firstParams[5]).toContain(`"world_id_action":"${firstBody.action}"`)
  })
})
