import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ user: vi.fn(), query: vi.fn(), connect: vi.fn(), status: vi.fn(), revalidate: vi.fn() }))
vi.mock('@/lib/auth-user', () => ({ getAuthenticatedUser: mocks.user }))
vi.mock('@/lib/db', () => ({ pool: { query: mocks.query, connect: mocks.connect } }))
vi.mock('@/lib/libro-service/client', () => ({ getServiceHumanPublicationStatus: mocks.status }))
vi.mock('next/cache', () => ({ revalidateTag: mocks.revalidate }))
vi.mock('@/lib/db/publication-cache', () => ({
  authorPublicationCountsCacheTag: (id: string) => `author-publication-counts:${id}`,
  publicationCacheTag: (id: string) => `publication:${id}`,
  publicationHashCacheTag: (hash: string) => `publication-hash:${hash}`,
  latestPublicationsCacheTag: 'latest-publications',
}))
import { GET } from './route'

const request = () => new NextRequest('https://memorioso.test/api/draft/draft/publish/status')
const context = { params: Promise.resolve({ draftId: 'draft' }) }
const pending = { service_challenge_id: 'challenge', authorId: 'author', signal_hash: 'hash', publication_type: 'article', access: 'gated', access_price_usd: '0.10' }

describe('local-first publication status', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.user.mockResolvedValue({ id: 7 })
    mocks.query.mockResolvedValue({ rows: [pending] })
  })

  it('returns acknowledged local completion without calling Libro or writing again', async () => {
    mocks.query.mockResolvedValue({ rows: [{ ...pending, local_publication_id: '42' }] })
    const response = await GET(request(), context)
    expect(await response.json()).toEqual({ success: true, state: 'finalized', publicationId: '42', publicationType: 'article' })
    expect(mocks.status).not.toHaveBeenCalled()
    expect(mocks.connect).not.toHaveBeenCalled()
    expect(mocks.revalidate).not.toHaveBeenCalled()
    expect(mocks.query.mock.calls[0][0]).toContain('policy.signal_hash = LOWER(p.signal_hash)')
    expect(mocks.query.mock.calls[0][0]).toContain('p.acknowledged_at IS NOT NULL')
    expect(mocks.query.mock.calls[0][1].slice(0, 2)).toEqual(['draft', 7])
  })

  it('preserves upstream status until local completion is acknowledged', async () => {
    mocks.status.mockResolvedValue({ state: 'prepared', signalHash: 'hash', publicationId: null, transactionHash: 'tx' })
    expect(await (await GET(request(), context)).json()).toMatchObject({ state: 'prepared', transactionHash: 'tx' })
    expect(mocks.status).toHaveBeenCalledWith({ userId: 7, challengeId: 'challenge' })
  })

  it('still reconciles finalization when the webhook is missing and invalidates the feeds after commit', async () => {
    mocks.status.mockResolvedValue({ state: 'finalized', signalHash: 'hash', publicationId: '42' })
    const query = vi.fn().mockResolvedValue({ rows: [] })
    const release = vi.fn()
    mocks.connect.mockResolvedValue({ query, release })
    expect(await (await GET(request(), context)).json()).toMatchObject({ state: 'finalized', publicationId: '42' })
    expect(query.mock.calls[1][1].slice(-2)).toEqual(['gated', '0.10'])
    expect(query.mock.calls.at(-1)?.[0]).toBe('COMMIT')
    expect(mocks.revalidate).toHaveBeenCalledWith('latest-publications', { expire: 0 })
    expect(query.mock.invocationCallOrder.at(-1)).toBeLessThan(mocks.revalidate.mock.invocationCallOrder[0])
    expect(release).toHaveBeenCalledOnce()
  })

  it('requires authentication and ownership even for completed drafts', async () => {
    mocks.user.mockResolvedValue(null)
    expect((await GET(request(), context)).status).toBe(401)
    expect(mocks.query).not.toHaveBeenCalled()
    mocks.user.mockResolvedValue({ id: 8 })
    mocks.query.mockResolvedValue({ rows: [] })
    expect((await GET(request(), context)).status).toBe(404)
    expect(mocks.status).not.toHaveBeenCalled()
  })

  it('preserves upstream failures for an unacknowledged draft', async () => {
    mocks.status.mockRejectedValue(new Error('Libro unavailable'))
    expect((await GET(request(), context)).status).toBe(502)
  })
})
