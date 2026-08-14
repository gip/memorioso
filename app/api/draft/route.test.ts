import type { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const dbMock = vi.hoisted(() => ({ connect: vi.fn(), query: vi.fn(), release: vi.fn() }))
const authMock = vi.hoisted(() => ({ getAuthenticatedUser: vi.fn() }))

vi.mock('@/lib/db', () => ({ pool: { connect: dbMock.connect } }))
vi.mock('@/lib/auth-user', () => ({ getAuthenticatedUser: authMock.getAuthenticatedUser }))

import { POST } from './route'

function request(authorId: unknown): NextRequest {
  return {
    json: async () => ({
      title: 'Draft title',
      subtitle: '',
      content: { html: '<p>Hello</p>' },
      history: { history: null },
      authorId,
      publicationType: 'article',
    }),
  } as unknown as NextRequest
}

describe('create draft route', () => {
  beforeEach(() => {
    dbMock.connect.mockReset()
    dbMock.query.mockReset()
    dbMock.release.mockReset()
    authMock.getAuthenticatedUser.mockReset().mockResolvedValue({ id: 7 })
    dbMock.connect.mockResolvedValue({ query: dbMock.query, release: dbMock.release })
  })

  it('creates a draft for an owned author', async () => {
    dbMock.query.mockImplementation(async (query: string) => {
      if (query.includes('FROM authors')) return { rows: [{ id: 'author-1' }] }
      if (query.includes('INSERT INTO drafts')) return { rows: [{ id: 'draft-1', status: 'editing' }] }
      return { rows: [] }
    })

    const response = await POST(request('author-1'))
    expect(response.status).toBe(200)
    expect(dbMock.query).toHaveBeenCalledWith(
      expect.stringContaining('id::text = $1 AND "userId" = $2'),
      ['author-1', 7]
    )
  })

  it('rejects an author outside the authenticated account', async () => {
    dbMock.query.mockResolvedValue({ rows: [] })
    const response = await POST(request('other-author'))
    expect(response.status).toBe(400)
    expect(dbMock.query.mock.calls.some(([query]) => String(query).includes('INSERT INTO drafts'))).toBe(false)
  })

  it('still allows an unassigned draft', async () => {
    dbMock.query.mockImplementation(async (query: string) => (
      query.includes('INSERT INTO drafts') ? { rows: [{ id: 'draft-1', authorId: null }] } : { rows: [] }
    ))
    const response = await POST(request(null))
    expect(response.status).toBe(200)
    expect(dbMock.query.mock.calls.some(([query]) => String(query).includes('FROM authors'))).toBe(false)
  })
})
