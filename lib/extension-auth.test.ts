import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const dbMock = vi.hoisted(() => ({ query: vi.fn() }))

vi.mock('@/lib/db', () => ({ pool: dbMock }))

import {
  createExtensionToken,
  getBearerToken,
  getExtensionSession,
  hashExtensionToken,
  revokeExtensionSession,
} from './extension-auth'

function request(token?: string): NextRequest {
  return new NextRequest('https://memorioso.xyz/api/extension/auth/session', {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
}

describe('extension bearer sessions', () => {
  beforeEach(() => dbMock.query.mockReset())

  it('creates random 256-bit bearer credentials and stores only their SHA-256 hash', async () => {
    const first = createExtensionToken()
    const second = createExtensionToken()
    expect(first).not.toBe(second)
    expect(Buffer.from(first, 'base64url')).toHaveLength(32)
    expect(hashExtensionToken(first)).toMatch(/^[0-9a-f]{64}$/)

    dbMock.query.mockResolvedValue({ rows: [] })
    await getExtensionSession(request(first))
    expect(dbMock.query.mock.calls[0][1]).toEqual([hashExtensionToken(first)])
    expect(dbMock.query.mock.calls[0][1]).not.toContain(first)
  })

  it('restores an unexpired, unrevoked token and rejects absent or unknown tokens', async () => {
    const token = createExtensionToken()
    dbMock.query.mockResolvedValueOnce({ rows: [{
      id: 'session-1',
      expires_at: '2026-08-21T12:00:00.000Z',
      user_id: 7,
      name: 'world-id-session:1',
      handle: 'ada',
      world_id_session_id: 'session_abc',
      world_id_credential_identifier: 'proof_of_human',
    }] })
    await expect(getExtensionSession(request(token))).resolves.toMatchObject({
      id: 'session-1',
      user: { id: 7, handle: 'ada' },
    })

    expect(getBearerToken(request())).toBeNull()
    await expect(getExtensionSession(request())).resolves.toBeNull()
    dbMock.query.mockResolvedValueOnce({ rows: [] })
    await expect(getExtensionSession(request(createExtensionToken()))).resolves.toBeNull()
  })

  it('revokes only the hashed bearer token', async () => {
    const token = createExtensionToken()
    dbMock.query.mockResolvedValue({ rowCount: 1 })
    await expect(revokeExtensionSession(request(token))).resolves.toBe(true)
    expect(dbMock.query.mock.calls[0][1]).toEqual([hashExtensionToken(token)])
  })
})
