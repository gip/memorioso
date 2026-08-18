import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const authMock = vi.hoisted(() => ({ getAuthenticatedUser: vi.fn() }))
const dbMock = vi.hoisted(() => ({ getPublicationsByUser: vi.fn() }))

vi.mock('@/lib/auth-user', () => ({
  getAuthenticatedUser: authMock.getAuthenticatedUser,
}))
vi.mock('@/lib/db/objects', () => ({
  getPublicationsByUser: dbMock.getPublicationsByUser,
}))

import { GET } from './route'

describe('activity publications API', () => {
  beforeEach(() => {
    authMock.getAuthenticatedUser.mockReset().mockResolvedValue({ id: 7 })
    dbMock.getPublicationsByUser.mockReset().mockResolvedValue([])
  })

  it('requires authentication', async () => {
    authMock.getAuthenticatedUser.mockResolvedValue(null)

    const response = await GET(new NextRequest('https://memorioso.xyz/api/activity/publications'))

    expect(response.status).toBe(401)
    expect(dbMock.getPublicationsByUser).not.toHaveBeenCalled()
  })

  it('scopes publications to the user and requests one extra pagination row', async () => {
    const response = await GET(
      new NextRequest('https://memorioso.xyz/api/activity/publications?limit=5&offset=10')
    )

    expect(response.status).toBe(200)
    expect(dbMock.getPublicationsByUser).toHaveBeenCalledWith(7, 6, 10)
  })

  it('returns only the requested page and reports whether more work exists', async () => {
    dbMock.getPublicationsByUser.mockResolvedValue(
      Array.from({ length: 6 }, (_, index) => ({ id: String(index + 1) }))
    )

    const response = await GET(
      new NextRequest('https://memorioso.xyz/api/activity/publications?limit=5')
    )
    const body = await response.json()

    expect(body.publications).toHaveLength(5)
    expect(body.hasMore).toBe(true)
  })
})
