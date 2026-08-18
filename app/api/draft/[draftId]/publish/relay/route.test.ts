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

const relayMock = vi.hoisted(() => ({
  sendRelayedLibroRegistration: vi.fn(),
  waitForRelayedLibroRegistration: vi.fn(),
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
  getLibroRelayerConfig: () => ({
    privateKey: `0x${'22'.repeat(32)}`,
  }),
}))

vi.mock('@/lib/libro/relay', () => relayMock)

import { PUT } from './route'

const draftId = 'd109b298-4dda-4030-a7ac-9e3481cd840a'
const registrationId = 'fca16bc9-362c-4c58-9083-06a0370f6824'
const transactionHash = `0x${'ab'.repeat(32)}`
const transaction = {
  chainId: 480,
  transactions: [{
    to: '0x1111111111111111111111111111111111111111',
    data: '0x1234',
    value: '0x0',
  }],
}

function request(): NextRequest {
  return {
    json: async () => ({ registrationId }),
  } as unknown as NextRequest
}

function context() {
  return { params: Promise.resolve({ draftId }) }
}

describe('Libro publication relay route', () => {
  beforeEach(() => {
    dbMock.connect.mockReset()
    dbMock.query.mockReset()
    dbMock.release.mockReset()
    authMock.getAuthenticatedUser.mockReset()
    relayMock.sendRelayedLibroRegistration.mockReset()
    relayMock.waitForRelayedLibroRegistration.mockReset()

    dbMock.connect.mockResolvedValue({ query: dbMock.query, release: dbMock.release })
    authMock.getAuthenticatedUser.mockResolvedValue({ id: 7 })
    relayMock.sendRelayedLibroRegistration.mockResolvedValue(transactionHash)
    relayMock.waitForRelayedLibroRegistration.mockResolvedValue(undefined)
    dbMock.query.mockImplementation(async (query: string) => {
      if (query.includes('SELECT transaction')) {
        return {
          rows: [{
            transaction,
            chain_id: 480,
            registry_address: '0x1111111111111111111111111111111111111111',
            transaction_hash: null,
            finalized_at: null,
          }],
        }
      }
      return { rows: [] }
    })
  })

  it('submits the stored registration with the server relayer and waits for confirmation', async () => {
    const response = await PUT(request(), context())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ success: true, transactionHash })
    expect(relayMock.sendRelayedLibroRegistration).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({ chainId: 480 }),
      expect.objectContaining({ privateKey: expect.stringMatching(/^0x/) })
    )
    expect(relayMock.waitForRelayedLibroRegistration).toHaveBeenCalledWith(
      transactionHash,
      expect.objectContaining({ chainId: 480 })
    )
    expect(dbMock.query).toHaveBeenCalledWith(
      expect.stringContaining('SET transaction_hash = $1'),
      [transactionHash, registrationId]
    )
  })

  it('resumes receipt confirmation without sending a duplicate transaction', async () => {
    dbMock.query.mockImplementation(async (query: string) => {
      if (query.includes('SELECT transaction')) {
        return {
          rows: [{
            transaction,
            chain_id: 480,
            registry_address: '0x1111111111111111111111111111111111111111',
            transaction_hash: transactionHash,
            finalized_at: null,
          }],
        }
      }
      return { rows: [] }
    })

    const response = await PUT(request(), context())

    expect(response.status).toBe(200)
    expect(relayMock.sendRelayedLibroRegistration).not.toHaveBeenCalled()
    expect(relayMock.waitForRelayedLibroRegistration).toHaveBeenCalledWith(
      transactionHash,
      expect.anything()
    )
  })

  it('does not relay registrations owned by another user', async () => {
    dbMock.query.mockResolvedValue({ rows: [] })

    const response = await PUT(request(), context())

    expect(response.status).toBe(404)
    expect(relayMock.sendRelayedLibroRegistration).not.toHaveBeenCalled()
  })

  it('returns the original publication when the registration is already finalized', async () => {
    dbMock.query.mockImplementation(async (query: string) => query.includes('SELECT transaction')
      ? { rows: [{
          transaction,
          chain_id: 480,
          registry_address: '0x1111111111111111111111111111111111111111',
          transaction_hash: transactionHash,
          finalized_at: new Date(),
          publicationId: '42',
        }] }
      : { rows: [] })
    const response = await PUT(request(), context())
    expect(await response.json()).toEqual({
      success: true,
      transactionHash,
      publicationId: '42',
    })
    expect(relayMock.waitForRelayedLibroRegistration).not.toHaveBeenCalled()
  })

  it('keeps the registration retryable when the relayer fails', async () => {
    relayMock.sendRelayedLibroRegistration.mockRejectedValueOnce(new Error('RPC unavailable'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const response = await PUT(request(), context())
    consoleError.mockRestore()
    expect(response.status).toBe(500)
    expect(dbMock.query).toHaveBeenCalledWith('ROLLBACK')
    expect(relayMock.waitForRelayedLibroRegistration).not.toHaveBeenCalled()
  })
})
