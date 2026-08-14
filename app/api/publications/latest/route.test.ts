import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const dbMock = vi.hoisted(() => ({ getLatestPublications: vi.fn() }))

vi.mock('@/lib/db/objects', () => ({
  getLatestPublications: dbMock.getLatestPublications,
}))

import { GET } from './route'

describe('latest publications API', () => {
  beforeEach(() => {
    dbMock.getLatestPublications.mockReset()
    dbMock.getLatestPublications.mockResolvedValue([])
  })

  it('defaults to articles and requests one extra pagination row', async () => {
    const response = await GET(new NextRequest('https://memorioso.xyz/api/publications/latest?limit=5&offset=10'))
    expect(response.status).toBe(200)
    expect(dbMock.getLatestPublications).toHaveBeenCalledWith(6, 10, 'article')
  })

  it('supports short and all filters', async () => {
    await GET(new NextRequest('https://memorioso.xyz/api/publications/latest?type=short'))
    await GET(new NextRequest('https://memorioso.xyz/api/publications/latest?type=all'))
    expect(dbMock.getLatestPublications).toHaveBeenNthCalledWith(1, 21, 0, 'short')
    expect(dbMock.getLatestPublications).toHaveBeenNthCalledWith(2, 21, 0, 'all')
  })

  it('rejects unsupported filters', async () => {
    const response = await GET(new NextRequest('https://memorioso.xyz/api/publications/latest?type=notes'))
    expect(response.status).toBe(400)
    expect(dbMock.getLatestPublications).not.toHaveBeenCalled()
  })
})
