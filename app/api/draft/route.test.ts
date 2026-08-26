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

const DRAFT_ID = 'd109b298-4dda-4030-a7ac-9e3481cd840a'
const ENVELOPE = JSON.stringify({ v: 1, alg: 'A256GCM', iv: 'aaaa', ct: 'bbbb' })

function encryptedRequest(overrides: Record<string, unknown> = {}): NextRequest {
  return {
    json: async () => ({
      id: DRAFT_ID,
      encryption: 'v1',
      ciphertext: ENVELOPE,
      history: { history: null },
      authorId: null,
      publicationType: 'article',
      ...overrides,
    }),
  } as unknown as NextRequest
}

const insertParams = () =>
  dbMock.query.mock.calls.find(([query]) => String(query).includes('INSERT INTO drafts'))?.[1] as unknown[]

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

  it('stores an encrypted draft with no plaintext columns', async () => {
    dbMock.query.mockImplementation(async (query: string) => (
      query.includes('INSERT INTO drafts') ? { rows: [{ id: DRAFT_ID, status: 'editing' }] } : { rows: [] }
    ))

    const response = await POST(encryptedRequest())

    expect(response.status).toBe(200)
    const params = insertParams()
    expect(params[0]).toBe(DRAFT_ID)
    // title, subtitle, content, then the envelope and its marker.
    expect(params.slice(4, 9)).toEqual([null, null, null, ENVELOPE, 'v1'])
  })

  it('takes the draft id from the client so the envelope can be sealed against it', async () => {
    const response = await POST(encryptedRequest({ id: undefined }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      message: 'Encrypted drafts require a client-generated draft ID',
    })
  })

  it('rejects a draft id that is not a UUID', async () => {
    const response = await POST(encryptedRequest({ id: 'draft-1' }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ message: 'Draft ID must be a UUID' })
  })

  it('refuses an encrypted draft that also carries prose', async () => {
    const response = await POST(encryptedRequest({ title: 'Leaked' }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      message: 'Encrypted drafts must not carry plaintext',
    })
    expect(dbMock.query).not.toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO drafts'),
      expect.anything()
    )
  })
})
