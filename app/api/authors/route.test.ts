import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), connect: vi.fn(), query: vi.fn(), release: vi.fn() }))
vi.mock('@/lib/auth-user', () => ({ getAuthenticatedUser: mocks.auth }))
vi.mock('@/lib/db', () => ({ pool: { connect: mocks.connect } }))

import { GET, POST } from './route'
import { reconcileOwnedAuthorId } from '@/lib/authors'

describe('authors route', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset())
    mocks.auth.mockResolvedValue({ id: 7, handle: 'ada' })
    mocks.connect.mockResolvedValue({ query: mocks.query, release: mocks.release })
  })

  it('returns the login owner’s single author', async () => {
    mocks.query.mockResolvedValue({ rows: [{ id: 'author-1', handle: 'ada', isPrimary: true }] })
    const response = await GET(new NextRequest('https://memorioso.xyz/api/authors'))
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    await expect(response.json()).resolves.toMatchObject({ authors: [{ handle: 'ada' }] })
  })

  it('rejects secondary-author creation', async () => {
    const response = await POST(new NextRequest('https://memorioso.xyz/api/authors', {
      method: 'POST', body: JSON.stringify({ handle: 'other' }),
    }))
    expect(response.status).toBe(405)
    await expect(response.json()).resolves.toMatchObject({ message: expect.stringContaining('one handle') })
    expect(mocks.connect).not.toHaveBeenCalled()
  })
})

describe('draft author reconciliation', () => {
  const previousAuthor = '30a0d4e6-3c63-475f-8a37-6a70fb3c49fa'
  const currentAuthor = '8d22d0e5-2a31-42ca-9356-6e2b3c16a4aa'

  it('replaces an author retained from a previous login', () => {
    expect(reconcileOwnedAuthorId(previousAuthor, [{ id: currentAuthor }])).toBe(currentAuthor)
  })

  it('keeps an author that still belongs to the current login', () => {
    expect(reconcileOwnedAuthorId(currentAuthor, [{ id: currentAuthor }])).toBe(currentAuthor)
  })

  it('clears the selection when the current login has no author', () => {
    expect(reconcileOwnedAuthorId(previousAuthor, [])).toBeUndefined()
  })
})
