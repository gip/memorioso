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

import { DELETE, PUT } from './route'

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
    expect(dbMock.query).toHaveBeenCalledWith(expect.stringContaining('WHERE id = $8 AND "userId" = $9 AND status = $10'), [
      draft.title,
      draft.subtitle,
      draft.content,
      null,
      'none',
      draft.history,
      draft.authorId,
      draft.id,
      7,
      'editing',
      null,
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
      null,
      'none',
      { history: null },
      draft.authorId,
      draft.id,
      7,
      'editing',
      null,
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

  it('deletes only an editing draft owned by the authenticated user', async () => {
    dbMock.query.mockResolvedValue({ rows: [{ id: 'draft-1' }] })

    const response = await DELETE({} as NextRequest, context('draft-1'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(dbMock.query).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM drafts'),
      ['draft-1', 7, 'editing']
    )
    expect(body).toEqual({ success: true, draftId: 'draft-1' })
    expect(dbMock.release).toHaveBeenCalled()
  })

  it('does not delete a draft outside the authenticated account', async () => {
    dbMock.query.mockResolvedValue({ rows: [] })

    const response = await DELETE({} as NextRequest, context('other-draft'))

    expect(response.status).toBe(404)
    expect(dbMock.release).toHaveBeenCalled()
  })

  it('replaces the plaintext columns when a draft is saved encrypted', async () => {
    const id = 'd109b298-4dda-4030-a7ac-9e3481cd840a'
    const ciphertext = JSON.stringify({ v: 1, alg: 'A256GCM', iv: 'aaaa', ct: 'bbbb' })
    dbMock.query.mockResolvedValue({ rows: [{ id, status: 'editing' }] })

    const response = await PUT(
      request({ id, encryption: 'v1', ciphertext, authorId: null }),
      context(id)
    )

    expect(response.status).toBe(200)
    const params = dbMock.query.mock.calls
      .find(([query]) => String(query).includes('SET title = $1'))?.[1] as unknown[]
    expect(params.slice(0, 5)).toEqual([null, null, null, ciphertext, 'v1'])
  })

  it('refuses a save that carries both prose and ciphertext', async () => {
    const id = 'd109b298-4dda-4030-a7ac-9e3481cd840a'
    dbMock.query.mockResolvedValue({ rows: [] })

    const response = await PUT(
      request({
        id,
        encryption: 'v1',
        ciphertext: 'envelope',
        title: 'Leaked',
        authorId: null,
      }),
      context(id)
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      message: 'Encrypted drafts must not carry plaintext',
    })
    expect(dbMock.query).not.toHaveBeenCalled()
  })
})
