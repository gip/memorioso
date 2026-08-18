import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const dbMock = vi.hoisted(() => ({
  query: vi.fn(),
  connect: vi.fn(),
  clientQuery: vi.fn(),
  release: vi.fn(),
}))

vi.mock('@/lib/db', () => ({ pool: dbMock }))

import {
  createExtensionToken,
  cleanupExpiredExtensionData,
  enforceExtensionAuthContextRateLimit,
  enforceExtensionSignatureRateLimit,
  ExtensionRateLimitError,
  getBearerToken,
  getExtensionRequestIpHash,
  getExtensionSession,
  hashExtensionToken,
  revokeExtensionSession,
  revokeExtensionSessionAndCancelDrafts,
} from './extension-auth'

function request(token?: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('https://memorioso.xyz/api/extension/auth/session', {
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
  })
}

describe('extension bearer sessions', () => {
  const originalSecret = process.env.SESSION_SECRET

  beforeEach(() => {
    Object.values(dbMock).forEach((mock) => mock.mockReset())
    dbMock.connect.mockResolvedValue({ query: dbMock.clientQuery, release: dbMock.release })
  })

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.SESSION_SECRET
    else process.env.SESSION_SECRET = originalSecret
  })

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

  it('hashes client addresses with the server secret instead of storing raw IPs', () => {
    process.env.SESSION_SECRET = 'test-session-secret'
    const first = getExtensionRequestIpHash(request(undefined, { 'x-forwarded-for': '203.0.113.4, 10.0.0.1' }))
    const second = getExtensionRequestIpHash(request(undefined, { 'x-real-ip': '203.0.113.4' }))
    expect(first).toBe(second)
    expect(first).toMatch(/^[0-9a-f]{64}$/)
    expect(first).not.toContain('203.0.113.4')
  })

  it('enforces auth and signing creation limits', async () => {
    dbMock.query.mockResolvedValueOnce({ rows: [{ handle_count: 8, ip_count: 0 }] })
    await expect(enforceExtensionAuthContextRateLimit('ada', null))
      .rejects.toBeInstanceOf(ExtensionRateLimitError)

    dbMock.query.mockResolvedValueOnce({ rows: [{ recent_count: 20, daily_count: 20 }] })
    await expect(enforceExtensionSignatureRateLimit(7))
      .rejects.toBeInstanceOf(ExtensionRateLimitError)
  })

  it('removes expired auth data and abandoned proofless extension drafts', async () => {
    dbMock.query.mockResolvedValue({ rows: [{ attempts: 1, sessions: 2, drafts: 3 }] })
    await cleanupExpiredExtensionData()
    const sql = String(dbMock.query.mock.calls[0][0])
    expect(sql).toContain('DELETE FROM libro_extension_auth_attempts')
    expect(sql).toContain('DELETE FROM libro_extension_sessions')
    expect(sql).toContain("history->>'source' = 'chrome_extension'")
    expect(sql).toContain('NOT EXISTS')
  })

  it('revokes the bearer session and cancels its proofless extension drafts atomically', async () => {
    const token = createExtensionToken()
    dbMock.clientQuery.mockImplementation(async (query: string) => {
      if (query.includes('UPDATE libro_extension_sessions')) return { rows: [{ userId: 7 }] }
      if (query.includes('DELETE FROM drafts')) return { rows: [{ id: 'draft-1' }, { id: 'draft-2' }] }
      return { rows: [] }
    })

    await expect(revokeExtensionSessionAndCancelDrafts(request(token))).resolves.toEqual({
      revoked: true,
      cancelledDrafts: 2,
    })
    expect(dbMock.clientQuery).toHaveBeenCalledWith('BEGIN')
    expect(dbMock.clientQuery).toHaveBeenCalledWith('COMMIT')
    const deletion = dbMock.clientQuery.mock.calls.find(([query]) => String(query).includes('DELETE FROM drafts'))!
    expect(deletion[1]).toEqual([7])
    expect(String(deletion[0])).toContain("history->>'source' = 'chrome_extension'")
  })
})
