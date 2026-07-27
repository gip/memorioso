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

  it('rejects unknown authors without creating an attempt', async () => {
    dbMock.query.mockResolvedValue({ rows: [] })
    const response = await POST(request('unknown'))
    expect(response.status).toBe(404)
    expect(dbMock.query).toHaveBeenCalledOnce()
  })

  it('creates a short-lived attempt for an existing author', async () => {
    const sessionId = `session_${'a'.repeat(128)}`
    dbMock.query
      .mockResolvedValueOnce({ rows: [{ id: 7, world_id_session_id: sessionId }] })
      .mockResolvedValueOnce({ rows: [] })
    const response = await POST(request('ADA'))
    expect(await response.json()).toMatchObject({
      success: true,
      existingSessionId: sessionId,
      rpContext: { nonce: 'nonce-1' },
    })
    expect(dbMock.query.mock.calls[0][1]).toEqual(['ada'])
    expect(dbMock.query.mock.calls[1][0]).toContain('INSERT INTO libro_extension_auth_attempts')
    expect(dbMock.query.mock.calls[1][1].slice(1, 3)).toEqual([7, 'login'])
  })

  it('creates a signup attempt without a user for an available normalized handle', async () => {
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
    expect(dbMock.query.mock.calls[0][1]).toEqual(['new_writer'])
    expect(dbMock.query.mock.calls[1][1].slice(1, 3)).toEqual([null, 'signup'])
  })

  it('rejects a taken handle without creating a signup attempt', async () => {
    dbMock.query.mockResolvedValueOnce({ rows: [{ taken: true }] })
    const response = await POST(request('ada', 'signup'))
    expect(response.status).toBe(409)
    expect(dbMock.query).toHaveBeenCalledOnce()
  })
})
