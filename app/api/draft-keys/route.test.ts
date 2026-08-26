import type { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const dbMock = vi.hoisted(() => ({ connect: vi.fn(), query: vi.fn(), release: vi.fn() }))
const authMock = vi.hoisted(() => ({ getAuthenticatedUser: vi.fn() }))

vi.mock('@/lib/db', () => ({ pool: { connect: dbMock.connect } }))
vi.mock('@/lib/auth-user', () => ({ getAuthenticatedUser: authMock.getAuthenticatedUser }))

import { GET, POST } from './route'

const salt = Buffer.alloc(16, 1).toString('base64url')
const wrappedDek = Buffer.alloc(60, 2).toString('base64url')
const fingerprint = 'a'.repeat(64)

const wrapper = (name: string, overrides: Record<string, unknown> = {}) => ({
  wrapper: name,
  kdfSalt: salt,
  kekFingerprint: fingerprint,
  wrappedDek,
  ...overrides,
})

function request(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest
}

const inserts = () =>
  dbMock.query.mock.calls.filter(([query]) => String(query).includes('INSERT INTO user_draft_key_wrappers'))

describe('draft key route', () => {
  beforeEach(() => {
    dbMock.connect.mockReset()
    dbMock.query.mockReset().mockResolvedValue({ rows: [] })
    dbMock.release.mockReset()
    authMock.getAuthenticatedUser.mockReset().mockResolvedValue({ id: 7 })
    dbMock.connect.mockResolvedValue({ query: dbMock.query, release: dbMock.release })
  })

  it('requires authentication', async () => {
    authMock.getAuthenticatedUser.mockResolvedValue(null)

    expect((await GET()).status).toBe(401)
    expect((await POST(request({ wrappers: [wrapper('worldid')] }))).status).toBe(401)
  })

  it('returns stored wrappers as base64url', async () => {
    dbMock.query.mockResolvedValue({
      rows: [{
        wrapper: 'worldid',
        kdf_salt: Buffer.alloc(16, 1),
        kek_fingerprint: fingerprint,
        wrapped_dek: Buffer.alloc(60, 2),
      }],
    })

    const body = await (await GET()).json()

    expect(body.wrappers).toEqual([{
      wrapper: 'worldid',
      kdfSalt: salt,
      kekFingerprint: fingerprint,
      wrappedDek,
    }])
  })

  it('stores both wrappers on the first write', async () => {
    const response = await POST(request({ wrappers: [wrapper('worldid'), wrapper('recovery')] }))

    expect(response.status).toBe(200)
    expect(inserts()).toHaveLength(2)
    expect(dbMock.query).toHaveBeenCalledWith('COMMIT')
  })

  it('refuses a first write that would leave no way back in', async () => {
    const response = await POST(request({ wrappers: [wrapper('worldid')] }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      message: 'The first draft key must be stored with both wrappers',
    })
    expect(inserts()).toHaveLength(0)
    expect(dbMock.query).toHaveBeenCalledWith('ROLLBACK')
  })

  it('replaces a single wrapper once a key already exists', async () => {
    dbMock.query.mockImplementation(async (query: string) => (
      query.includes('SELECT wrapper') ? { rows: [{ wrapper: 'worldid' }, { wrapper: 'recovery' }] } : { rows: [] }
    ))

    const response = await POST(request({ wrappers: [wrapper('recovery')] }))

    expect(response.status).toBe(200)
    expect(inserts()).toHaveLength(1)
  })

  it('locks the existing wrappers before deciding', async () => {
    await POST(request({ wrappers: [wrapper('worldid'), wrapper('recovery')] }))

    expect(dbMock.query).toHaveBeenCalledWith(
      expect.stringContaining('FOR UPDATE'),
      [7]
    )
  })

  it('rejects malformed wrappers', async () => {
    const cases: Array<[unknown, string]> = [
      [[], 'One or two draft key wrappers are required'],
      [[wrapper('worldid'), wrapper('recovery'), wrapper('worldid')], 'One or two draft key wrappers are required'],
      [[wrapper('passphrase')], 'Unknown draft key wrapper'],
      [[wrapper('worldid'), wrapper('worldid')], 'Draft key wrappers must be distinct'],
      [[wrapper('worldid', { kdfSalt: Buffer.alloc(8).toString('base64url') })], 'Draft key wrapper is malformed'],
      [[wrapper('worldid', { wrappedDek: Buffer.alloc(59).toString('base64url') })], 'Draft key wrapper is malformed'],
      [[wrapper('worldid', { kekFingerprint: 'nope' })], 'Draft key fingerprint is malformed'],
    ]

    for (const [wrappers, message] of cases) {
      const response = await POST(request({ wrappers }))
      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toMatchObject({ message })
    }

    expect(inserts()).toHaveLength(0)
  })

  it('never returns anything that could be unwrapped without the author', async () => {
    dbMock.query.mockResolvedValue({
      rows: [{
        wrapper: 'recovery',
        kdf_salt: Buffer.alloc(16, 1),
        kek_fingerprint: fingerprint,
        wrapped_dek: Buffer.alloc(60, 2),
      }],
    })

    const body = await (await GET()).json()

    expect(Object.keys(body.wrappers[0])).toEqual(['wrapper', 'kdfSalt', 'kekFingerprint', 'wrappedDek'])
  })
})
