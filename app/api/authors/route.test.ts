import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), connect: vi.fn(), query: vi.fn(), release: vi.fn() }))
vi.mock('@/lib/auth-user', () => ({ getAuthenticatedUser: mocks.auth }))
vi.mock('@/lib/db', () => ({ pool: { connect: mocks.connect } }))

import { GET, POST } from './route'

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
