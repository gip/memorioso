import type { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const dbMock = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  connect: vi.fn(),
  clientQuery: vi.fn(),
  release: vi.fn(),
}))

const serverMock = vi.hoisted(() => ({
  verifyLibroAgentDocumentRegistered: vi.fn(),
}))

const cacheMock = vi.hoisted(() => ({
  revalidateTag: vi.fn(),
}))

vi.mock('next/cache', () => ({
  revalidateTag: cacheMock.revalidateTag,
}))

vi.mock('@/lib/db/publication-cache', () => ({
  publicationCacheTag: (id: string) => `publication:${id}`,
  publicationHashCacheTag: (hash: string) => `publication-hash:${hash}`,
  authorPublicationCountsCacheTag: (authorId: string) => `author-publication-counts:${authorId}`,
}))

vi.mock('@/lib/db', () => ({
  pool: { query: dbMock.poolQuery, connect: dbMock.connect },
}))

vi.mock('@/lib/db/resilience', () => ({
  configureLibroWriteTransaction: vi.fn(),
  describeDatabaseFailure: (error: unknown) => ({
    code: null,
    message: error instanceof Error ? error.message : String(error),
    retryable: false,
  }),
  rollbackAndRelease: vi.fn().mockResolvedValue(true),
}))

vi.mock('@/lib/libro/config', () => ({
  getLibroAgentServerConfig: () => ({ chainId: 480 }),
}))

vi.mock('@/lib/libro/server', () => serverMock)

import { PUT } from './route'

const documentRegistrationId = 'a33e71eb-0d0e-4706-8c14-04418b186a3c'
const publicationId = '52'
const documentSignalHash = `0x${'11'.repeat(32)}`

function request(): NextRequest {
  return {
    json: async () => ({
      documentRegistrationId,
      userOpHash: '0x1234',
      transactionHash: '0xabcd',
    }),
  } as unknown as NextRequest
}

function lockedDocument() {
  return {
    userId: 7,
    authorId: 'b2a1e9b0-6125-4dfa-b772-6e989eb93f05',
    revoked_at: null,
    expires_at: '2027-01-01T00:00:00.000Z',
    signed_at: '2026-01-01T00:00:00.000Z',
    finalized_at: null,
    publicationId: null,
    publication: {
      publication_title: 'Agent-assisted article',
      publication_subtitle: '',
      publication_date: '2026-08-14T12:00:00.000Z',
      publication_content: { html: '<p>Human-authorized agent text.</p>' },
    },
    proof: {
      proof_type: 'human_authorized_agent_signature',
      agent_document_signature: {},
    },
  }
}

describe('Libro agent document finalize route', () => {
  beforeEach(() => {
    dbMock.poolQuery.mockReset()
    dbMock.connect.mockReset()
    dbMock.clientQuery.mockReset()
    dbMock.release.mockReset()
    serverMock.verifyLibroAgentDocumentRegistered.mockReset()
    cacheMock.revalidateTag.mockReset()

    dbMock.poolQuery.mockResolvedValue({
      rows: [{ document_signal_hash: documentSignalHash, finalized_at: null }],
    })
    dbMock.connect.mockResolvedValue({ query: dbMock.clientQuery, release: dbMock.release })
    dbMock.clientQuery.mockImplementation(async (query: string) => {
      if (query.includes('SELECT d.*, r."userId"')) return { rows: [lockedDocument()] }
      if (query.includes('INSERT INTO publications')) return { rows: [{ id: publicationId }] }
      return { rows: [] }
    })
    serverMock.verifyLibroAgentDocumentRegistered.mockResolvedValue(true)
  })

  it('invalidates the publication cache after committing a new publication', async () => {
    const response = await PUT(request())

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      success: true,
      publicationId,
      publicationType: 'article',
    })
    expect(cacheMock.revalidateTag).toHaveBeenCalledWith(
      `publication:${publicationId}`,
      { expire: 0 }
    )
    expect(cacheMock.revalidateTag).toHaveBeenCalledWith(
      `publication-hash:${documentSignalHash}`,
      { expire: 0 }
    )
    expect(cacheMock.revalidateTag).toHaveBeenCalledWith(
      'author-publication-counts:b2a1e9b0-6125-4dfa-b772-6e989eb93f05',
      { expire: 0 }
    )
    const commitCall = dbMock.clientQuery.mock.invocationCallOrder[
      dbMock.clientQuery.mock.calls.findIndex(([query]) => query === 'COMMIT')
    ]
    expect(commitCall).toBeLessThan(cacheMock.revalidateTag.mock.invocationCallOrder[0])
  })

  it('does not invalidate when the document is not registered on-chain', async () => {
    serverMock.verifyLibroAgentDocumentRegistered.mockResolvedValue(false)

    const response = await PUT(request())

    expect(response.status).toBe(400)
    expect(cacheMock.revalidateTag).not.toHaveBeenCalled()
    expect(dbMock.connect).not.toHaveBeenCalled()
  })
})
