import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const dbMock = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn(), clientQuery: vi.fn(), release: vi.fn() }))
const proofMock = vi.hoisted(() => ({
  validateWorldIdSessionResult: vi.fn(),
  validateSessionCredentialResponses: vi.fn(),
  verifyWorldIdProof: vi.fn(),
}))

vi.mock('@/lib/db', () => ({ pool: { query: dbMock.query, connect: dbMock.connect } }))
vi.mock('@/lib/world-id/server', () => ({
  getWorldIdServerConfig: () => ({ rpId: 'rp_1234567890abcdef', environment: 'production' }),
  verifyWorldIdProof: proofMock.verifyWorldIdProof,
}))
vi.mock('@/lib/world-id/proof', () => ({
  validateWorldIdSessionResult: proofMock.validateWorldIdSessionResult,
  validateSessionCredentialResponses: proofMock.validateSessionCredentialResponses,
}))

import { hashExtensionToken } from '@/lib/extension-auth'
import { POST } from './route'

function request(body: Record<string, unknown> = {}): NextRequest {
  return new NextRequest('https://memorioso.xyz/api/extension/auth/verify', {
    method: 'POST',
    body: JSON.stringify({ attemptId: 'attempt-1', idkitResult: { proof: true }, ...body }),
  })
}

const validated = {
  protocol_version: '4.0',
  session_id: 'session_matching',
  nonce: 'nonce-1',
  environment: 'production',
  responses: [{ session_nullifier: ['nullifier-1', 'nullifier-2'] }],
}

const loginAttempt = {
  id: 'attempt-1',
  userId: 7,
  intent: 'login',
  nonce: 'nonce-1',
  expires_at: '2099-01-01T00:00:00.000Z',
  consumed_at: null,
  world_id_session_id: 'session_matching',
}

const user = {
  id: 7,
  name: 'world-id-session:matching',
  handle: 'ada',
  world_id_session_id: 'session_matching',
  world_id_credential_identifier: 'proof_of_human',
}

const author = {
  id: 'author-1',
  name: 'Ada Lovelace',
  handle: 'ada',
  bio: 'Writes proofs.',
}

function mockLoginTransaction(): void {
  dbMock.clientQuery.mockImplementation(async (query: string) => {
    if (query.includes('UPDATE libro_extension_auth_attempts')) return { rows: [{ id: 'attempt-1' }] }
    if (query.includes('UPDATE users')) return { rows: [user] }
    if (query.includes('FROM authors')) return { rows: [author] }
    if (query.includes('INSERT INTO libro_extension_sessions')) {
      return { rows: [{ expires_at: '2026-08-21T12:00:00.000Z' }] }
    }
    return { rows: [] }
  })
}

describe('extension World ID auth verification', () => {
  beforeEach(() => {
    Object.values(dbMock).forEach((mock) => mock.mockReset())
    Object.values(proofMock).forEach((mock) => mock.mockReset())
    dbMock.connect.mockResolvedValue({ query: dbMock.clientQuery, release: dbMock.release })
    dbMock.query.mockResolvedValue({ rows: [loginAttempt] })
    proofMock.validateWorldIdSessionResult.mockReturnValue(validated)
    proofMock.validateSessionCredentialResponses.mockReturnValue(['proof_of_human'])
    proofMock.verifyWorldIdProof.mockResolvedValue({ ok: true })
    mockLoginTransaction()
  })

  it('issues a hashed 30-day bearer token for an existing author', async () => {
    const response = await POST(request())
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body).toMatchObject({ created: false, user: { handle: 'ada' }, author })
    expect(Buffer.from(body.token, 'base64url')).toHaveLength(32)
    const insert = dbMock.clientQuery.mock.calls.find(([query]) =>
      String(query).includes('INSERT INTO libro_extension_sessions'))!
    expect(insert[1][1]).toBe(hashExtensionToken(body.token))
    expect(insert[1]).not.toContain(body.token)
  })

  it('creates a normalized first author and session in one transaction', async () => {
    dbMock.query.mockResolvedValue({ rows: [{
      ...loginAttempt,
      userId: null,
      intent: 'signup',
      world_id_session_id: null,
    }] })
    proofMock.validateWorldIdSessionResult.mockReturnValue({
      ...validated,
      session_id: 'session_new',
    })
    const newUser = {
      ...user,
      id: 9,
      handle: 'new_writer',
      world_id_session_id: 'session_new',
    }
    const newAuthor = {
      id: 'author-9',
      name: 'New Writer',
      handle: 'new_writer',
      bio: null,
    }
    dbMock.clientQuery.mockImplementation(async (query: string) => {
      if (query.includes('UPDATE libro_extension_auth_attempts')) return { rows: [{ id: 'attempt-1' }] }
      if (query.includes('FROM users') && query.includes('FOR UPDATE')) return { rows: [] }
      if (query.includes('INSERT INTO users')) return { rows: [newUser] }
      if (query.includes('INSERT INTO authors')) return { rows: [newAuthor] }
      if (query.includes('INSERT INTO libro_extension_sessions')) {
        return { rows: [{ expires_at: '2026-08-21T12:00:00.000Z' }] }
      }
      return { rows: [] }
    })

    const response = await POST(request({
      profile: { handle: ' New_Writer ', name: '  New Writer  ', bio: '   ' },
    }))
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body).toMatchObject({ created: true, user: { handle: 'new_writer' }, author: newAuthor })

    const userInsert = dbMock.clientQuery.mock.calls.find(([query]) => String(query).includes('INSERT INTO users'))!
    expect(userInsert[1]).toEqual([
      'world-id-session:session_new',
      'new_writer',
      'session_new',
      'nullifier-1',
      'proof_of_human',
    ])
    const authorInsert = dbMock.clientQuery.mock.calls.find(([query]) => String(query).includes('INSERT INTO authors'))!
    expect(authorInsert[1]).toEqual([9, 'New Writer', 'new_writer', null])
    expect(dbMock.clientQuery.mock.calls.map(([query]) => query)).toEqual(expect.arrayContaining(['BEGIN', 'COMMIT']))
  })

  it('connects an existing World ID author without overwriting its profile', async () => {
    dbMock.query.mockResolvedValue({ rows: [{
      ...loginAttempt,
      userId: null,
      intent: 'signup',
      world_id_session_id: null,
    }] })
    dbMock.clientQuery.mockImplementation(async (query: string) => {
      if (query.includes('UPDATE libro_extension_auth_attempts')) return { rows: [{ id: 'attempt-1' }] }
      if (query.includes('FROM users') && query.includes('FOR UPDATE')) return { rows: [user] }
      if (query.includes('FROM authors') && query.includes('FOR UPDATE')) return { rows: [author] }
      if (query.includes('UPDATE users')) return { rows: [user] }
      if (query.includes('INSERT INTO libro_extension_sessions')) {
        return { rows: [{ expires_at: '2026-08-21T12:00:00.000Z' }] }
      }
      return { rows: [] }
    })

    const response = await POST(request({
      profile: { handle: 'other-handle', name: 'Different Name', bio: 'Different bio' },
    }))
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body).toMatchObject({ created: false, user: { handle: 'ada' }, author })
    expect(dbMock.clientQuery.mock.calls.some(([query]) => String(query).includes('INSERT INTO authors'))).toBe(false)
  })

  it('rejects invalid signup profile data before proof verification', async () => {
    dbMock.query.mockResolvedValue({ rows: [{
      ...loginAttempt,
      userId: null,
      intent: 'signup',
      world_id_session_id: null,
    }] })
    const response = await POST(request({
      profile: { handle: 'bad handle', name: 'No', bio: '' },
    }))
    expect(response.status).toBe(400)
    expect(proofMock.validateWorldIdSessionResult).not.toHaveBeenCalled()
    expect(proofMock.verifyWorldIdProof).not.toHaveBeenCalled()
  })

  it('rolls back a handle race and does not issue a session', async () => {
    dbMock.query.mockResolvedValue({ rows: [{
      ...loginAttempt,
      userId: null,
      intent: 'signup',
      world_id_session_id: null,
    }] })
    dbMock.clientQuery.mockImplementation(async (query: string) => {
      if (query === 'BEGIN') return { rows: [] }
      if (query.includes('UPDATE libro_extension_auth_attempts')) return { rows: [{ id: 'attempt-1' }] }
      if (query.includes('FROM users') && query.includes('FOR UPDATE')) return { rows: [] }
      if (query.includes('INSERT INTO users')) {
        throw Object.assign(new Error('duplicate'), { code: '23505' })
      }
      return { rows: [] }
    })

    const response = await POST(request({
      profile: { handle: 'new-writer', name: 'New Writer', bio: '' },
    }))
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ message: expect.stringContaining('just taken') })
    expect(dbMock.clientQuery).toHaveBeenCalledWith('ROLLBACK')
    expect(dbMock.clientQuery.mock.calls.some(([query]) => String(query).includes('INSERT INTO libro_extension_sessions'))).toBe(false)
  })

  it('rejects an expired or already-consumed attempt before proof verification', async () => {
    dbMock.query.mockResolvedValueOnce({ rows: [{
      ...loginAttempt,
      expires_at: '2020-01-01T00:00:00.000Z',
    }] })
    expect((await POST(request())).status).toBe(400)
    expect(proofMock.verifyWorldIdProof).not.toHaveBeenCalled()
  })

  it('rejects a World ID session that does not own the requested login handle', async () => {
    proofMock.validateWorldIdSessionResult.mockReturnValue({ ...validated, session_id: 'session_other' })
    const response = await POST(request())
    expect(response.status).toBe(400)
    expect(proofMock.verifyWorldIdProof).not.toHaveBeenCalled()
  })

  it('allows only one request to consume an auth attempt', async () => {
    dbMock.clientQuery.mockImplementation(async (query: string) =>
      query.includes('UPDATE libro_extension_auth_attempts') ? { rows: [] } : { rows: [] })
    expect((await POST(request())).status).toBe(409)
    expect(dbMock.clientQuery).toHaveBeenCalledWith('ROLLBACK')
  })
})
