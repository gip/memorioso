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

function request(): NextRequest {
  return new NextRequest('https://memorioso.xyz/api/extension/auth/verify', {
    method: 'POST',
    body: JSON.stringify({ attemptId: 'attempt-1', idkitResult: { proof: true } }),
  })
}

const validated = {
  protocol_version: '4.0',
  session_id: 'session_matching',
  nonce: 'nonce-1',
  environment: 'production',
  responses: [{ session_nullifier: ['nullifier-1', 'nullifier-2'] }],
}

describe('extension World ID login verification', () => {
  beforeEach(() => {
    Object.values(dbMock).forEach((mock) => mock.mockReset())
    Object.values(proofMock).forEach((mock) => mock.mockReset())
    dbMock.connect.mockResolvedValue({ query: dbMock.clientQuery, release: dbMock.release })
    dbMock.query.mockResolvedValue({ rows: [{
      id: 'attempt-1',
      userId: 7,
      nonce: 'nonce-1',
      expires_at: '2099-01-01T00:00:00.000Z',
      consumed_at: null,
      world_id_session_id: 'session_matching',
    }] })
    proofMock.validateWorldIdSessionResult.mockReturnValue(validated)
    proofMock.validateSessionCredentialResponses.mockReturnValue(['proof_of_human'])
    proofMock.verifyWorldIdProof.mockResolvedValue({ ok: true })
    dbMock.clientQuery.mockImplementation(async (query: string) => {
      if (query.includes('UPDATE libro_extension_auth_attempts')) return { rows: [{ id: 'attempt-1' }] }
      if (query.includes('UPDATE users')) return { rows: [{
        id: 7,
        name: 'world-id-session:matching',
        handle: 'ada',
        world_id_session_id: 'session_matching',
        world_id_credential_identifier: 'proof_of_human',
      }] }
      if (query.includes('INSERT INTO libro_extension_sessions')) {
        return { rows: [{ expires_at: '2026-08-21T12:00:00.000Z' }] }
      }
      return { rows: [] }
    })
  })

  it('issues a 30-day bearer token while persisting only its hash', async () => {
    const response = await POST(request())
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(Buffer.from(body.token, 'base64url')).toHaveLength(32)
    const insert = dbMock.clientQuery.mock.calls.find(([query]) =>
      String(query).includes('INSERT INTO libro_extension_sessions'))!
    expect(insert[1][1]).toBe(hashExtensionToken(body.token))
    expect(insert[1]).not.toContain(body.token)
  })

  it('rejects an expired or already-consumed attempt before proof verification', async () => {
    dbMock.query.mockResolvedValueOnce({ rows: [{
      id: 'attempt-1',
      userId: 7,
      nonce: 'nonce-1',
      expires_at: '2020-01-01T00:00:00.000Z',
      consumed_at: null,
      world_id_session_id: 'session_matching',
    }] })
    expect((await POST(request())).status).toBe(400)
    expect(proofMock.verifyWorldIdProof).not.toHaveBeenCalled()
  })

  it('rejects a World ID session that does not own the requested handle', async () => {
    proofMock.validateWorldIdSessionResult.mockReturnValue({ ...validated, session_id: 'session_other' })
    const response = await POST(request())
    expect(response.status).toBe(400)
    expect(proofMock.verifyWorldIdProof).not.toHaveBeenCalled()
  })

  it('allows only one request to consume a login attempt', async () => {
    dbMock.clientQuery.mockImplementation(async (query: string) =>
      query.includes('UPDATE libro_extension_auth_attempts') ? { rows: [] } : { rows: [] })
    expect((await POST(request())).status).toBe(409)
    expect(dbMock.clientQuery).toHaveBeenCalledWith('ROLLBACK')
  })
})
