import type { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IDKitResult } from '@worldcoin/idkit'

const dbMock = vi.hoisted(() => ({
  connect: vi.fn(),
  query: vi.fn(),
  release: vi.fn(),
}))

const authMock = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
}))

const proofMock = vi.hoisted(() => ({
  prepareLibroRegistration: vi.fn(),
}))

const validationMock = vi.hoisted(() => ({
  challenge: {
    id: '03b18435-96c5-46e6-91c5-cd4ac1abb197',
    userId: 7,
    draftId: 'd109b298-4dda-4030-a7ac-9e3481cd840a',
    action: 'written-by-a-human-v4-03b18435-96c5-46e6-91c5-cd4ac1abb197',
    nonce: '0x123',
    signal_text: '{"publication_title":"A human note"}',
    signal_hash: '0x1111111111111111111111111111111111111111111111111111111111111111',
    publication: {
      publication_schema: 'libro-publication-v1',
      publication_date: new Date().toISOString(),
    },
    expires_at: new Date(Date.now() + 300000),
    consumed_at: null,
  },
  draft: {
    id: 'd109b298-4dda-4030-a7ac-9e3481cd840a',
    title: 'A human note',
    subtitle: 'On signatures',
    content: { html: '<p>Hello human world.</p>' },
    status: 'editing',
    authorId: '8d22d0e5-2a31-42ca-9356-6e2b3c16a4aa',
    author_name: 'Ada',
    author_handle: 'ada',
    author_bio: 'Writes proofs.',
  },
}))

vi.mock('@/lib/db', () => ({
  pool: {
    connect: dbMock.connect,
  },
}))

vi.mock('@/lib/auth-user', () => ({
  getAuthenticatedUser: authMock.getAuthenticatedUser,
}))

vi.mock('@/lib/world-id/server', () => ({
  getWorldIdServerConfig: () => ({
    appId: 'app_424563557eea16567fdb5655c9ee742e',
    rpId: 'rp_test',
    publishActionPrefix: 'written-by-a-human-v4',
    environment: 'production',
    signingKeyHex: '0xabc',
  }),
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

vi.mock('@/lib/libro/proof', () => ({
  prepareLibroRegistration: proofMock.prepareLibroRegistration,
}))

vi.mock('@/lib/publish-validation', () => ({
  assertChallengeCanBeUsed: vi.fn(),
  assertDraftCanBePublished: vi.fn(),
  assertDraftMatchesChallenge: vi.fn(() => ({
    publication_schema: 'libro-publication-v1',
    publication_date: new Date().toISOString(),
    author_id_libro: '8d22d0e5-2a31-42ca-9356-6e2b3c16a4aa',
    publication_title: 'A human note',
    publication_subtitle: 'On signatures',
  })),
  assertPublicationDateIsFresh: vi.fn(),
  getLockedDraftForPublish: vi.fn(() => validationMock.draft),
  getLockedPublishChallenge: vi.fn(() => validationMock.challenge),
}))

import { PUT } from './route'
import { assertChallengeCanBeUsed } from '@/lib/publish-validation'

function request(idkitResult: IDKitResult): NextRequest {
  return {
    json: async () => ({
      challengeId: validationMock.challenge.id,
      idkitResult,
    }),
  } as unknown as NextRequest
}

function context(draftId: string) {
  return {
    params: Promise.resolve({ draftId }),
  }
}

function result(action = validationMock.challenge.action): IDKitResult {
  return {
    protocol_version: '4.0',
    action,
    nonce: validationMock.challenge.nonce,
    environment: 'production',
    responses: [{
      identifier: 'proof_of_human',
      signal_hash: validationMock.challenge.signal_hash,
      proof: ['1', '2', '3', '4', '5'],
      nullifier: '0xabc',
      issuer_schema_id: 9303,
      expires_at_min: 1770000000,
    }],
  } as IDKitResult
}

describe('publish prepare route', () => {
  beforeEach(() => {
    dbMock.connect.mockReset()
    dbMock.query.mockReset()
    dbMock.release.mockReset()
    authMock.getAuthenticatedUser.mockReset()
    proofMock.prepareLibroRegistration.mockReset()

    dbMock.connect.mockResolvedValue({
      query: dbMock.query,
      release: dbMock.release,
    })
    dbMock.query.mockImplementation(async (query: string) => {
      if (query.includes('INSERT INTO libro_publish_registrations')) {
        return { rows: [{
          id: 'fca16bc9-362c-4c58-9083-06a0370f6824',
          signal_hash: validationMock.challenge.signal_hash,
          action_hash: '12345',
          chain_id: 480,
          registry_address: '0x1111111111111111111111111111111111111111',
          transaction: {
            chainId: 480,
            transactions: [{
              to: '0x1111111111111111111111111111111111111111',
              data: '0x1234',
              value: '0x0',
            }],
          },
        }] }
      }

      return { rows: [] }
    })
    authMock.getAuthenticatedUser.mockResolvedValue({ id: 7 })
    proofMock.prepareLibroRegistration.mockReturnValue({
      signalHash: validationMock.challenge.signal_hash,
      signalHashUint256: BigInt(validationMock.challenge.signal_hash).toString(),
      actionHash: '12345',
      proof: {
        nullifier: '2748',
        nonce: '291',
        expiresAtMin: '1770000000',
        issuerSchemaId: '9303',
        credentialGenesisIssuedAtMin: '0',
        zeroKnowledgeProof: ['1', '2', '3', '4', '5'],
      },
      transaction: {
        chainId: 480,
        transactions: [{
          to: '0x1111111111111111111111111111111111111111',
          data: '0x1234',
          value: '0x0',
        }],
      },
    })
  })

  it('accepts the stored challenge action instead of comparing against a global publish action', async () => {
    const response = await PUT(request(result()), context(validationMock.challenge.draftId))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      success: true,
      actionHash: '12345',
    })
    expect(proofMock.prepareLibroRegistration).toHaveBeenCalled()
  })

  it('rejects a proof action that does not match the stored challenge action', async () => {
    const response = await PUT(
      request(result('written-by-a-human-v4-wrong-challenge')),
      context(validationMock.challenge.draftId)
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toMatchObject({
      success: false,
      message: 'World ID proof context does not match this publication',
    })
    expect(proofMock.prepareLibroRegistration).not.toHaveBeenCalled()
  })

  it('returns the original registration on an idempotent retry', async () => {
    dbMock.query.mockImplementation(async (query: string) => {
      if (query.includes('SELECT id, signal_hash')) {
        return { rows: [{
          id: 'registration-existing',
          signal_hash: validationMock.challenge.signal_hash,
          action_hash: '12345',
          chain_id: 480,
          registry_address: '0x1111111111111111111111111111111111111111',
          transaction: { chainId: 480, transactions: [] },
          publicationId: '42',
        }] }
      }
      return { rows: [] }
    })

    const response = await PUT(request(result('wrong-action-is-ignored-after-proof-was-accepted')), context(validationMock.challenge.draftId))
    expect(await response.json()).toMatchObject({
      success: true,
      registrationId: 'registration-existing',
      publicationId: '42',
    })
    expect(proofMock.prepareLibroRegistration).not.toHaveBeenCalled()
  })

  it('rejects a stale publication challenge', async () => {
    vi.mocked(assertChallengeCanBeUsed).mockImplementationOnce(() => {
      throw new Error('Publish challenge has expired')
    })
    const response = await PUT(request(result()), context(validationMock.challenge.draftId))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ message: 'Publish challenge has expired' })
    expect(proofMock.prepareLibroRegistration).not.toHaveBeenCalled()
  })
})
