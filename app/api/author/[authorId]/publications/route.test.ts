import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ cached: vi.fn(), uncached: vi.fn() }))
vi.mock('@/lib/db/objects', () => ({ getPublicationsByAuthor: mocks.uncached }))
vi.mock('@/lib/db/publication-cache', () => ({ getCachedPublicationsByAuthor: mocks.cached }))
import { GET } from './route'

const context = { params: Promise.resolve({ authorId: 'author' }) }

describe('cached public author feed', () => {
  beforeEach(() => { mocks.cached.mockReset().mockResolvedValue([]); mocks.uncached.mockReset().mockResolvedValue([]) })

  it('preserves filters, gated excerpts, and pagination', async () => {
    const publication = { id: '42', access: 'gated', publication_excerpt: 'Teaser only' }
    mocks.cached.mockResolvedValue([publication, { id: '43' }])
    const response = await GET(new NextRequest('https://memorioso.test/feed?limit=1&type=short'), context)
    expect(await response.json()).toEqual({ success: true, publications: [publication], hasMore: true })
    expect(mocks.cached).toHaveBeenCalledWith('author', 2, 0, 'short')
    expect(mocks.uncached).not.toHaveBeenCalled()
  })

  it('keeps deep pages uncached and rejects invalid filters', async () => {
    await GET(new NextRequest('https://memorioso.test/feed?offset=201'), context)
    expect(mocks.uncached).toHaveBeenCalledWith('author', 11, 201, 'article')
    expect(mocks.cached).not.toHaveBeenCalled()
    expect((await GET(new NextRequest('https://memorioso.test/feed?type=notes'), context)).status).toBe(400)
    expect(mocks.uncached).toHaveBeenCalledOnce()
  })
})
