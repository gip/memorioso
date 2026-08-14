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

vi.mock('@/lib/db', () => ({
  pool: {
    connect: dbMock.connect,
  },
}))

vi.mock('@/lib/auth-user', () => ({
  getAuthenticatedUser: authMock.getAuthenticatedUser,
}))

import { PUT } from './route'

function request(body: unknown): NextRequest {
  return {
    json: async () => body,
  } as unknown as NextRequest
}

function context(draftId: string) {
  return {
    params: Promise.resolve({ draftId }),
  }
}

describe('draft route', () => {
  beforeEach(() => {
    dbMock.connect.mockReset()
    dbMock.query.mockReset()
    dbMock.release.mockReset()
    authMock.getAuthenticatedUser.mockReset()
    dbMock.connect.mockResolvedValue({
      query: dbMock.query,
      release: dbMock.release,
    })
    authMock.getAuthenticatedUser.mockResolvedValue({ id: 7 })
  })

  it('updates an editing draft without requiring the client to send status', async () => {
    const draft = {
      id: 'd109b298-4dda-4030-a7ac-9e3481cd840a',
      title: 'Draft title',
      subtitle: 'Draft subtitle',
      content: { html: '<p>Hello</p>' },
      history: { history: null },
      authorId: '30a0d4e6-3c63-475f-8a37-6a70fb3c49fa',
    }
    dbMock.query.mockResolvedValue({
      rows: [{ ...draft, status: 'editing' }],
    })

    const response = await PUT(request(draft), context(draft.id))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(dbMock.query).toHaveBeenCalledWith(expect.stringContaining('WHERE id = $6 AND "userId" = $7 AND status = $8'), [
      draft.title,
      draft.subtitle,
      draft.content,
      draft.history,
      draft.authorId,
      draft.id,
      7,
      'editing',
    ])
    expect(dbMock.release).toHaveBeenCalled()
    expect(body).toMatchObject({
      success: true,
      draft: {
        id: draft.id,
        status: 'editing',
      },
    })
  })

  it('defaults missing history on update', async () => {
    const draft = {
      id: 'd109b298-4dda-4030-a7ac-9e3481cd840a',
      title: 'Draft title',
      subtitle: 'Draft subtitle',
      content: { html: '<p>Hello</p>' },
      authorId: '30a0d4e6-3c63-475f-8a37-6a70fb3c49fa',
    }
    dbMock.query.mockResolvedValue({
      rows: [{ ...draft, history: { history: null }, status: 'editing' }],
    })

    const response = await PUT(request(draft), context(draft.id))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(dbMock.query).toHaveBeenCalledWith(expect.stringContaining('SET title = $1'), [
      draft.title,
      draft.subtitle,
      draft.content,
      { history: null },
      draft.authorId,
      draft.id,
      7,
      'editing',
    ])
    expect(body).toMatchObject({ success: true })
  })

  it('rejects an author that is not owned by the authenticated user', async () => {
    const draft = {
      id: 'd109b298-4dda-4030-a7ac-9e3481cd840a',
      title: 'Draft title',
      subtitle: '',
      content: { html: '<p>Hello</p>' },
      authorId: '30a0d4e6-3c63-475f-8a37-6a70fb3c49fa',
    }
    dbMock.query.mockResolvedValue({ rows: [] })

    const response = await PUT(request(draft), context(draft.id))
    expect(response.status).toBe(400)
    expect(dbMock.query).toHaveBeenCalledWith(
      expect.stringContaining('FROM authors WHERE id::text = $1 AND "userId" = $2'),
      [draft.authorId, 7]
    )
    expect(dbMock.query.mock.calls.some(([query]) => String(query).includes('UPDATE drafts'))).toBe(false)
  })
})
