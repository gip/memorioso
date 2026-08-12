import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const dbMock = vi.hoisted(() => ({ query: vi.fn() }))

vi.mock('@/lib/db', () => ({ pool: dbMock }))
vi.mock('@/lib/world-id/server', () => ({
  getWorldIdServerConfig: () => ({
    appId: 'app_424563557eea16567fdb5655c9ee742e',
    environment: 'production',
  }),
  createRpContext: () => ({
    rp_id: 'rp_1234567890abcdef',
    nonce: 'nonce-1',
    created_at: 1_775_000_000,
    expires_at: 1_775_000_300,
    signature: '0xsigned',
  }),
}))

import { POST } from './route'

function request(handle: string, intent?: 'login' | 'signup'): NextRequest {
  return new NextRequest('https://memorioso.xyz/api/extension/auth/context', {
    method: 'POST',
    body: JSON.stringify({ handle, intent }),
  })
}

describe('extension login context', () => {
  beforeEach(() => dbMock.query.mockReset())

  function allowAbuseControls(): void {
    dbMock.query
      .mockResolvedValueOnce({ rows: [{ attempts: 0, sessions: 0, drafts: 0 }] })
      .mockResolvedValueOnce({ rows: [{ handle_count: 0, ip_count: 0 }] })
  }

  it('rejects unknown authors without creating an attempt', async () => {
    allowAbuseControls()
    dbMock.query.mockResolvedValueOnce({ rows: [] })
    const response = await POST(request('unknown'))
    expect(response.status).toBe(404)
    expect(dbMock.query).toHaveBeenCalledTimes(3)
  })

  it('creates a short-lived attempt for an existing author', async () => {
    const sessionId = `session_${'a'.repeat(128)}`
    allowAbuseControls()
    dbMock.query
      .mockResolvedValueOnce({ rows: [{ id: 7, world_id_session_id: sessionId }] })
      .mockResolvedValueOnce({ rows: [] })
    const response = await POST(request('ADA'))
    expect(await response.json()).toMatchObject({
      success: true,
      existingSessionId: sessionId,
      rpContext: { nonce: 'nonce-1' },
    })
    expect(dbMock.query.mock.calls[2][1]).toEqual(['ada'])
    expect(dbMock.query.mock.calls[3][0]).toContain('INSERT INTO libro_extension_auth_attempts')
    expect(dbMock.query.mock.calls[3][1].slice(1, 4)).toEqual([7, 'login', 'ada'])
  })

  it('creates a signup attempt without a user for an available normalized handle', async () => {
    allowAbuseControls()
    dbMock.query
      .mockResolvedValueOnce({ rows: [{ taken: false }] })
      .mockResolvedValueOnce({ rows: [] })

    const response = await POST(request(' New_Writer ', 'signup'))
    expect(await response.json()).toMatchObject({
      success: true,
      intent: 'signup',
      existingSessionId: null,
      rpContext: { nonce: 'nonce-1' },
    })
    expect(dbMock.query.mock.calls[2][1]).toEqual(['new_writer'])
    expect(dbMock.query.mock.calls[3][1].slice(1, 4)).toEqual([null, 'signup', 'new_writer'])
  })

  it('rejects a taken handle without creating a signup attempt', async () => {
    allowAbuseControls()
    dbMock.query.mockResolvedValueOnce({ rows: [{ taken: true }] })
    const response = await POST(request('ada', 'signup'))
    expect(response.status).toBe(409)
    expect(dbMock.query).toHaveBeenCalledTimes(3)
  })

  it('rate-limits repeated attempts for a handle before account lookup', async () => {
    dbMock.query
      .mockResolvedValueOnce({ rows: [{ attempts: 0, sessions: 0, drafts: 0 }] })
      .mockResolvedValueOnce({ rows: [{ handle_count: 8, ip_count: 0 }] })
    const response = await POST(request('ada'))
    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('600')
    expect(dbMock.query).toHaveBeenCalledTimes(2)
  })
})
