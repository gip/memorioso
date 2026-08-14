import type { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const dbMock = vi.hoisted(() => ({ connect: vi.fn(), query: vi.fn(), release: vi.fn() }))
const authMock = vi.hoisted(() => ({ getAuthenticatedUser: vi.fn() }))

vi.mock('@/lib/db', () => ({ pool: { connect: dbMock.connect } }))
vi.mock('@/lib/auth-user', () => ({ getAuthenticatedUser: authMock.getAuthenticatedUser }))

import { GET, POST } from './route'

function request(body?: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest
}

describe('authors route', () => {
  beforeEach(() => {
    dbMock.connect.mockReset()
    dbMock.query.mockReset()
    dbMock.release.mockReset()
    authMock.getAuthenticatedUser.mockReset().mockResolvedValue({ id: 7, handle: 'ada' })
    dbMock.connect.mockResolvedValue({ query: dbMock.query, release: dbMock.release })
  })

  it('returns primary-first authors with explicit primary metadata', async () => {
    const authors = [
      { id: 'primary', name: 'Ada', handle: 'ada', bio: null, isPrimary: true },
      { id: 'secondary', name: 'A. Byron', handle: 'byron', bio: null, isPrimary: false },
    ]
    dbMock.query.mockResolvedValue({ rows: authors })

    const response = await GET(request())
    await expect(response.json()).resolves.toMatchObject({ success: true, authors })
    expect(dbMock.query).toHaveBeenCalledWith(expect.stringContaining('ORDER BY (a.handle = u.handle) DESC'), [7])
  })

  it('creates a normalized secondary author while holding the account lock', async () => {
    dbMock.query.mockImplementation(async (query: string) => {
      if (query.includes('SELECT id FROM users')) return { rows: [{ id: 7 }] }
      if (query.includes('COUNT(*)')) return { rows: [{ count: 1 }] }
      if (query.includes('INSERT INTO authors')) {
        return { rows: [{ id: 'secondary', name: 'A. Byron', handle: 'byron', bio: null, isPrimary: false }] }
      }
      return { rows: [] }
    })

    const response = await POST(request({ handle: ' Byron ', name: ' A. Byron ', bio: ' ' }))
    expect(response.status).toBe(201)
    expect(dbMock.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO authors'), [7, 'A. Byron', 'byron', null])
    expect(dbMock.query.mock.calls.map(([query]) => query)).toEqual(expect.arrayContaining(['BEGIN', 'COMMIT']))
  })

  it('rejects a sixth author before inserting', async () => {
    dbMock.query.mockImplementation(async (query: string) => {
      if (query.includes('SELECT id FROM users')) return { rows: [{ id: 7 }] }
      if (query.includes('COUNT(*)')) return { rows: [{ count: 5 }] }
      return { rows: [] }
    })

    const response = await POST(request({ handle: 'sixth', name: 'Sixth Author', bio: '' }))
    expect(response.status).toBe(409)
    expect(dbMock.query).toHaveBeenCalledWith('ROLLBACK')
    expect(dbMock.query.mock.calls.some(([query]) => String(query).includes('INSERT INTO authors'))).toBe(false)
  })

  it('maps a global handle conflict to a conflict response', async () => {
    dbMock.query.mockImplementation(async (query: string) => {
      if (query.includes('SELECT id FROM users')) return { rows: [{ id: 7 }] }
      if (query.includes('COUNT(*)')) return { rows: [{ count: 1 }] }
      if (query.includes('INSERT INTO authors')) throw Object.assign(new Error('duplicate'), { code: '23505' })
      return { rows: [] }
    })

    const response = await POST(request({ handle: 'taken', name: 'Taken Author', bio: '' }))
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({ message: 'That handle is already taken' })
  })
})
