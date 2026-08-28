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
const ITERATIONS = 600_000

const wrapper = (name: string, overrides: Record<string, unknown> = {}) => ({
  wrapper: name,
  kdfSalt: salt,
  kekFingerprint: fingerprint,
  wrappedDek,
  ...(name === 'passphrase' ? { kdfIterations: ITERATIONS } : {}),
  ...overrides,
})

const storedRow = (name: string, iterations: number | null) => ({
  wrapper: name,
  kdf_salt: Buffer.alloc(16, 1),
  kdf_iterations: iterations,
  kek_fingerprint: fingerprint,
  wrapped_dek: Buffer.alloc(60, 2),
})

function request(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest
}

const inserts = () =>
  dbMock.query.mock.calls.filter(([query]) => String(query).includes('INSERT INTO user_draft_key_wrappers'))

const choiceWrites = () =>
  dbMock.query.mock.calls.filter(([query]) => String(query).includes('SET draft_encryption'))

/** Answers the wrapper lookup with `existing` and everything else with nothing. */
const withExistingWrappers = (existing: Array<{ wrapper: string }>) => {
  dbMock.query.mockImplementation(async (query: string) => (
    String(query).includes('SELECT wrapper') ? { rows: existing } : { rows: [] }
  ))
}

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
    expect((await POST(request({ wrappers: [wrapper('passphrase')] }))).status).toBe(401)
    expect((await POST(request({ encryption: 'none' }))).status).toBe(401)
  })

  it('returns the encryption choice alongside the stored wrappers', async () => {
    dbMock.query.mockImplementation(async (query: string) => (
      String(query).includes('draft_encryption')
        ? { rows: [{ draft_encryption: 'passphrase' }] }
        : { rows: [storedRow('passphrase', ITERATIONS)] }
    ))

    const body = await (await GET()).json()

    expect(body.encryption).toBe('passphrase')
    expect(body.wrappers).toEqual([{
      wrapper: 'passphrase',
      kdfSalt: salt,
      kdfIterations: ITERATIONS,
      kekFingerprint: fingerprint,
      wrappedDek,
    }])
  })

  it('reports an author who has not been asked yet as undecided', async () => {
    const body = await (await GET()).json()

    expect(body.encryption).toBeNull()
    expect(body.wrappers).toEqual([])
  })

  it('stores both wrappers on the first write and records the choice', async () => {
    const response = await POST(request({ wrappers: [wrapper('passphrase'), wrapper('recovery')] }))

    expect(response.status).toBe(200)
    expect(inserts()).toHaveLength(2)
    expect(choiceWrites()).toHaveLength(1)
    expect(dbMock.query).toHaveBeenCalledWith('COMMIT')
  })

  it('refuses a first write that would leave no way back in', async () => {
    const response = await POST(request({ wrappers: [wrapper('passphrase')] }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      message: 'The first draft key must be stored with both wrappers',
    })
    expect(inserts()).toHaveLength(0)
    expect(dbMock.query).toHaveBeenCalledWith('ROLLBACK')
  })

  it('replaces a single wrapper once a key already exists', async () => {
    withExistingWrappers([{ wrapper: 'passphrase' }, { wrapper: 'recovery' }])

    const response = await POST(request({ wrappers: [wrapper('passphrase')] }))

    expect(response.status).toBe(200)
    expect(inserts()).toHaveLength(1)
  })

  it('locks the existing wrappers before deciding', async () => {
    await POST(request({ wrappers: [wrapper('passphrase'), wrapper('recovery')] }))

    expect(dbMock.query).toHaveBeenCalledWith(expect.stringContaining('FOR UPDATE'), [7])
  })

  it('records a decision not to encrypt', async () => {
    const response = await POST(request({ encryption: 'none' }))

    expect(response.status).toBe(200)
    expect(choiceWrites()).toHaveLength(1)
    expect(inserts()).toHaveLength(0)
    expect(dbMock.query).toHaveBeenCalledWith('COMMIT')
  })

  it('refuses to turn encryption off underneath an existing key', async () => {
    withExistingWrappers([{ wrapper: 'passphrase' }, { wrapper: 'recovery' }])

    const response = await POST(request({ encryption: 'none' }))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      message: 'These drafts are already encrypted, so encryption cannot be turned off',
    })
    expect(choiceWrites()).toHaveLength(0)
    expect(dbMock.query).toHaveBeenCalledWith('ROLLBACK')
  })

  it('rejects malformed wrappers', async () => {
    const cases: Array<[unknown, string]> = [
      [[], 'One or two draft key wrappers are required'],
      [
        [wrapper('passphrase'), wrapper('recovery'), wrapper('passphrase')],
        'One or two draft key wrappers are required',
      ],
      [[wrapper('worldid')], 'Unknown draft key wrapper'],
      [[wrapper('passphrase'), wrapper('passphrase')], 'Draft key wrappers must be distinct'],
      [[wrapper('passphrase', { kdfSalt: Buffer.alloc(8).toString('base64url') })], 'Draft key wrapper is malformed'],
      [[wrapper('passphrase', { wrappedDek: Buffer.alloc(59).toString('base64url') })], 'Draft key wrapper is malformed'],
      [[wrapper('passphrase', { kekFingerprint: 'nope' })], 'Draft key fingerprint is malformed'],
    ]

    for (const [wrappers, message] of cases) {
      const response = await POST(request({ wrappers }))
      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toMatchObject({ message })
    }

    expect(inserts()).toHaveLength(0)
  })

  // The client picks the cost, so a client that picks a useless one — or none —
  // must not be able to write a passphrase wrapper that only looks protected.
  it('rejects a passphrase wrapper without a usable KDF cost', async () => {
    const cases: Array<[unknown, string]> = [
      [[wrapper('passphrase', { kdfIterations: undefined })], 'A passphrase wrapper must carry its KDF cost'],
      [[wrapper('passphrase', { kdfIterations: '600000' })], 'A passphrase wrapper must carry its KDF cost'],
      [[wrapper('passphrase', { kdfIterations: 1_000 })], 'Passphrase KDF cost is out of range'],
      [[wrapper('passphrase', { kdfIterations: 100_000_000 })], 'Passphrase KDF cost is out of range'],
      [[wrapper('recovery', { kdfIterations: 600_000 })], 'Only a passphrase wrapper carries a KDF cost'],
    ]

    for (const [wrappers, message] of cases) {
      const response = await POST(request({ wrappers }))
      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toMatchObject({ message })
    }

    expect(inserts()).toHaveLength(0)
  })

  it('rejects an unknown encryption choice', async () => {
    const response = await POST(request({ encryption: 'plaintext' }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ message: 'Unknown draft encryption choice' })
  })

  it('never returns anything that could be unwrapped without the author', async () => {
    dbMock.query.mockImplementation(async (query: string) => (
      String(query).includes('draft_encryption')
        ? { rows: [{ draft_encryption: 'passphrase' }] }
        : { rows: [storedRow('recovery', null)] }
    ))

    const body = await (await GET()).json()

    expect(Object.keys(body.wrappers[0]))
      .toEqual(['wrapper', 'kdfSalt', 'kdfIterations', 'kekFingerprint', 'wrappedDek'])
  })
})
