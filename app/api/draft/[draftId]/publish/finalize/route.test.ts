import type { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const dbMock = vi.hoisted(() => ({
  connect: vi.fn(),
  query: vi.fn(),
  release: vi.fn(),
}))

const authMock = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
}))

const serverMock = vi.hoisted(() => ({
  verifyLibroRegistrationTransaction: vi.fn(),
  LibroRegistrationReceiptMismatchError: class LibroRegistrationReceiptMismatchError extends Error {},
}))

const validationMock = vi.hoisted(() => ({
  assertChallengeCanBeUsed: vi.fn(),
  assertDraftCanBePublished: vi.fn(),
  assertDraftMatchesChallenge: vi.fn(),
  getLockedDraftForPublish: vi.fn(),
  getLockedPublishChallenge: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  pool: { connect: dbMock.connect },
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

function request(body: Record<string, unknown>): NextRequest {
  return { json: async () => body } as unknown as NextRequest
}

function context() {
  return { params: Promise.resolve({ draftId }) }
}

describe('Libro publication finalize route', () => {
  beforeEach(() => {
    dbMock.connect.mockReset()
    dbMock.query.mockReset()
    dbMock.release.mockReset()
    authMock.getAuthenticatedUser.mockReset()
    serverMock.verifyLibroRegistrationTransaction.mockReset()
    Object.values(validationMock).forEach((mock) => mock.mockReset())

    dbMock.connect.mockResolvedValue({ query: dbMock.query, release: dbMock.release })
    authMock.getAuthenticatedUser.mockResolvedValue({ id: 7 })
    serverMock.verifyLibroRegistrationTransaction.mockResolvedValue(true)
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
    dbMock.query.mockImplementation(async (query: string) => {
      if (query.includes('SELECT signal_hash')) {
        return { rows: [{
          signal_hash: signalHash,
          action_hash: '12345',
          chain_id: 480,
          registry_address: '0x1111111111111111111111111111111111111111',
          transaction_hash: transactionHash,
        }] }
      }
      if (query.includes('SELECT *') && query.includes('libro_publish_registrations')) {
        return {
          rows: [{
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
          }],
        }
      }
      if (query.includes('INSERT INTO publications')) {
        return { rows: [{ id: '09c61e45-887d-42e5-81b3-bb545a061e4e' }] }
      }
      return { rows: [] }
    })
  })

  it('finalizes a backend-sponsored registration without a user operation hash', async () => {
    const response = await PUT(request({
      registrationId,
      submissionMethod: 'memorioso_relayer',
      transactionHash,
    }), context())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({
      success: true,
      publicationId: '09c61e45-887d-42e5-81b3-bb545a061e4e',
    })

    const publicationInsert = dbMock.query.mock.calls.find(([query]) =>
      String(query).includes('INSERT INTO publications')
    )
    expect(publicationInsert?.[1][2]).toMatchObject({
      libro_registration: {
        submission_method: 'memorioso_relayer',
        transaction_hash: transactionHash,
      },
    })
    expect(publicationInsert?.[1][2].libro_registration).not.toHaveProperty('user_op_hash')
    expect(serverMock.verifyLibroRegistrationTransaction).toHaveBeenCalledWith({
      transactionHash,
      signalHash,
      actionHash: '12345',
      registryAddress: '0x1111111111111111111111111111111111111111',
    }, expect.objectContaining({ chainId: 480 }))
  })

  it('rejects a sponsored hash that was not stored by the relayer', async () => {
    const response = await PUT(request({
      registrationId,
      submissionMethod: 'memorioso_relayer',
      transactionHash: `0x${'cd'.repeat(32)}`,
    }), context())

    expect(response.status).toBe(400)
    expect(serverMock.verifyLibroRegistrationTransaction).not.toHaveBeenCalled()
  })

  it('still requires a user operation hash for World wallet submission', async () => {
    const response = await PUT(request({
      registrationId,
      submissionMethod: 'world_wallet',
      transactionHash,
    }), context())

    expect(response.status).toBe(400)
    expect(dbMock.connect).not.toHaveBeenCalled()
  })

  it('rejects a wallet transaction that did not emit the exact expected registration', async () => {
    serverMock.verifyLibroRegistrationTransaction.mockResolvedValue(false)
    const response = await PUT(request({
      registrationId,
      submissionMethod: 'world_wallet',
      userOpHash: '0x1234',
      transactionHash,
    }), context())
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ message: expect.stringContaining('does not contain') })
    expect(dbMock.query).not.toHaveBeenCalledWith('BEGIN')
  })

  it('rejects a mismatched receipt without persisting a publication', async () => {
    serverMock.verifyLibroRegistrationTransaction.mockRejectedValue(
      new serverMock.LibroRegistrationReceiptMismatchError('Registration event does not match the manifest')
    )
    const response = await PUT(request({
      registrationId,
      submissionMethod: 'world_wallet',
      userOpHash: '0x1234',
      transactionHash,
    }), context())
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ message: expect.stringContaining('does not match') })
    expect(dbMock.query.mock.calls.some(([query]) => String(query).includes('INSERT INTO publications'))).toBe(false)
  })

  it('returns the original publication when finalization is retried', async () => {
    dbMock.query.mockImplementation(async (query: string) => query.includes('SELECT signal_hash')
      ? { rows: [{
          signal_hash: signalHash,
          action_hash: '12345',
          chain_id: 480,
          registry_address: '0x1111111111111111111111111111111111111111',
          transaction_hash: transactionHash,
          finalized_at: new Date(),
          publicationId: '42',
        }] }
      : { rows: [] })
    const response = await PUT(request({
      registrationId,
      submissionMethod: 'memorioso_relayer',
      transactionHash,
    }), context())
    expect(await response.json()).toEqual({ success: true, publicationId: '42' })
    expect(serverMock.verifyLibroRegistrationTransaction).not.toHaveBeenCalled()
  })
})
