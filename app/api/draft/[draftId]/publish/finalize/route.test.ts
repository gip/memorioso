import type { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const dbMock = vi.hoisted(() => ({
  connect: vi.fn(),
  poolQuery: vi.fn(),
  clientQuery: vi.fn(),
  release: vi.fn(),
}))

const authMock = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
}))

const serverMock = vi.hoisted(() => ({
  verifyLibroSignalRegistered: vi.fn(),
}))

const validationMock = vi.hoisted(() => ({
  assertChallengeCanBeUsed: vi.fn(),
  assertDraftCanBePublished: vi.fn(),
  assertDraftMatchesChallenge: vi.fn(),
  getLockedDraftForPublish: vi.fn(),
  getLockedPublishChallenge: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  pool: { connect: dbMock.connect, query: dbMock.poolQuery },
}))

vi.mock('@/lib/auth-user', () => ({
  getAuthenticatedUser: authMock.getAuthenticatedUser,
}))

vi.mock('@/lib/libro/config', () => ({
  getLibroServerConfig: () => ({
    protocolVersion: 'libro-v1',
    chainId: 480,
    registryAddress: '0x1111111111111111111111111111111111111111',
    rpId: BigInt(1),
    rpcUrls: ['https://worldchain-mainnet.g.alchemy.com/public'],
  }),
}))

vi.mock('@/lib/libro/server', () => serverMock)
vi.mock('@/lib/publish-validation', () => validationMock)

import { PUT } from './route'

const draftId = 'd109b298-4dda-4030-a7ac-9e3481cd840a'
const registrationId = 'fca16bc9-362c-4c58-9083-06a0370f6824'
const challengeId = '03b18435-96c5-46e6-91c5-cd4ac1abb197'
const signalHash = `0x${'11'.repeat(32)}`
const transactionHash = `0x${'ab'.repeat(32)}`
const publicationId = '09c61e45-887d-42e5-81b3-bb545a061e4e'

function request(body: Record<string, unknown>): NextRequest {
  return { json: async () => body } as unknown as NextRequest
}

function context() {
  return { params: Promise.resolve({ draftId }) }
}

function finalizeRequest() {
  return request({
    registrationId,
    submissionMethod: 'memorioso_relayer',
    transactionHash,
  })
}

function pendingRegistration() {
  return {
    signal_hash: signalHash,
    transaction_hash: transactionHash,
    finalized_at: null,
    publicationId: null,
    existing_publication_id: null,
  }
}

function lockedRegistration() {
  return {
    challengeId,
    signal_hash: signalHash,
    action_hash: '12345',
    chain_id: 480,
    registry_address: '0x1111111111111111111111111111111111111111',
    proof: {
      protocol_version: '4.0',
      action: `written-by-a-human-v4-${challengeId}`,
      nonce: '0x123',
      signal_text: '{"publication_title":"A human note"}',
      signal_hash: signalHash,
      credential_identifier: 'proof_of_human',
      credential_identifiers: ['proof_of_human'],
      idkit_result: {},
      verify_response: {},
    },
    finalized_at: null,
  }
}

describe('Libro publication finalize route', () => {
  beforeEach(() => {
    dbMock.connect.mockReset()
    dbMock.poolQuery.mockReset()
    dbMock.clientQuery.mockReset()
    dbMock.release.mockReset()
    authMock.getAuthenticatedUser.mockReset()
    serverMock.verifyLibroSignalRegistered.mockReset()
    Object.values(validationMock).forEach((mock) => mock.mockReset())

    dbMock.connect.mockResolvedValue({ query: dbMock.clientQuery, release: dbMock.release })
    dbMock.poolQuery.mockResolvedValue({ rows: [pendingRegistration()] })
    authMock.getAuthenticatedUser.mockResolvedValue({ id: 7 })
    serverMock.verifyLibroSignalRegistered.mockResolvedValue(true)
    validationMock.getLockedPublishChallenge.mockResolvedValue({
      id: challengeId,
      signal_hash: signalHash,
      consumed_at: null,
    })
    validationMock.getLockedDraftForPublish.mockResolvedValue({
      id: draftId,
      status: 'editing',
      content: { html: '<p>Hello human world.</p>' },
    })
    validationMock.assertDraftMatchesChallenge.mockReturnValue({
      author_id_libro: '8d22d0e5-2a31-42ca-9356-6e2b3c16a4aa',
      publication_title: 'A human note',
      publication_subtitle: 'On signatures',
      publication_date: '2026-07-21T12:00:00.000Z',
    })
    dbMock.clientQuery.mockImplementation(async (query: string) => {
      if (query.includes('SELECT *') && query.includes('libro_publish_registrations')) {
        return { rows: [lockedRegistration()] }
      }
      if (query.includes('INSERT INTO publications')) {
        return { rows: [{ id: publicationId }] }
      }
      return { rows: [] }
    })
  })

  it('releases the lookup connection before chain verification and finalizes successfully', async () => {
    serverMock.verifyLibroSignalRegistered.mockImplementation(async () => {
      expect(dbMock.poolQuery).toHaveBeenCalledTimes(1)
      expect(dbMock.connect).not.toHaveBeenCalled()
      return true
    })

    const response = await PUT(finalizeRequest(), context())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ success: true, publicationId })
    expect(dbMock.clientQuery).toHaveBeenCalledWith(expect.stringContaining("SET LOCAL lock_timeout = '3s'"))

    const publicationInsert = dbMock.clientQuery.mock.calls.find(([query]) =>
      String(query).includes('INSERT INTO publications')
    )
    expect(publicationInsert?.[1][2]).toMatchObject({
      libro_registration: {
        submission_method: 'memorioso_relayer',
        transaction_hash: transactionHash,
      },
    })
    expect(publicationInsert?.[1][2].libro_registration).not.toHaveProperty('user_op_hash')
  })

  it('rejects a sponsored hash that was not stored by the relayer', async () => {
    const response = await PUT(request({
      registrationId,
      submissionMethod: 'memorioso_relayer',
      transactionHash: `0x${'cd'.repeat(32)}`,
    }), context())

    expect(response.status).toBe(400)
    expect(serverMock.verifyLibroSignalRegistered).not.toHaveBeenCalled()
  })

  it('still requires a user operation hash for World wallet submission', async () => {
    const response = await PUT(request({
      registrationId,
      submissionMethod: 'world_wallet',
      transactionHash,
    }), context())

    expect(response.status).toBe(400)
    expect(dbMock.poolQuery).not.toHaveBeenCalled()
  })

  it('returns the original publication when the same registration is retried', async () => {
    dbMock.poolQuery.mockResolvedValue({
      rows: [{ ...pendingRegistration(), finalized_at: new Date(), publicationId: '42' }],
    })

    const response = await PUT(finalizeRequest(), context())

    expect(await response.json()).toEqual({ success: true, publicationId: '42' })
    expect(serverMock.verifyLibroSignalRegistered).not.toHaveBeenCalled()
  })

  it('converges when a different registration already finalized the draft', async () => {
    dbMock.poolQuery.mockResolvedValue({
      rows: [{ ...pendingRegistration(), existing_publication_id: '43' }],
    })

    const response = await PUT(finalizeRequest(), context())

    expect(await response.json()).toEqual({ success: true, publicationId: '43' })
    expect(serverMock.verifyLibroSignalRegistered).not.toHaveBeenCalled()
    expect(dbMock.connect).not.toHaveBeenCalled()
  })

  it('returns a retryable 503 for a bounded lock timeout and safely rolls back', async () => {
    dbMock.clientQuery.mockImplementation(async (query: string) => {
      if (query.includes('SELECT *') && query.includes('libro_publish_registrations')) {
        throw Object.assign(new Error('canceling statement due to lock timeout'), { code: '55P03' })
      }
      return { rows: [] }
    })

    const response = await PUT(finalizeRequest(), context())
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(response.headers.get('Retry-After')).toBe('1')
    expect(body).toEqual({
      success: false,
      code: 'FINALIZE_RETRYABLE',
      retryable: true,
      message: 'Publication finalization is temporarily busy. Please retry.',
    })
    expect(dbMock.clientQuery).toHaveBeenCalledWith('ROLLBACK')
    expect(dbMock.release).toHaveBeenCalledTimes(1)
  })

  it('returns a retryable 503 when the initial pool query times out', async () => {
    dbMock.poolQuery.mockRejectedValue(
      Object.assign(new Error('Query read timeout'), { code: '57014' })
    )

    const response = await PUT(finalizeRequest(), context())

    expect(response.status).toBe(503)
    expect(dbMock.connect).not.toHaveBeenCalled()
    expect(serverMock.verifyLibroSignalRegistered).not.toHaveBeenCalled()
  })

  it('returns a retryable 503 when authentication cannot reach Postgres', async () => {
    authMock.getAuthenticatedUser.mockRejectedValue(
      Object.assign(new Error('getaddrinfo ENOTFOUND db'), { code: 'ENOTFOUND' })
    )

    const response = await PUT(finalizeRequest(), context())

    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({
      code: 'FINALIZE_RETRYABLE',
      retryable: true,
    })
    expect(dbMock.poolQuery).not.toHaveBeenCalled()
  })
})
