import type { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WALLET_AUTH_NONCE_COOKIE, WALLET_AUTH_STATEMENT } from '@/lib/wallet-auth'

const dbMock = vi.hoisted(() => ({
  connect: vi.fn(),
  query: vi.fn(),
  release: vi.fn(),
}))

const siweMock = vi.hoisted(() => ({
  verifySiweMessage: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  pool: {
    connect: dbMock.connect,
  },
}))

vi.mock('@worldcoin/minikit-js/siwe', () => ({
  verifySiweMessage: siweMock.verifySiweMessage,
}))

import { POST } from './route'

const walletAddress = '0x1234567890ABCDEF1234567890ABCDEF12345678'
const normalizedWalletAddress = walletAddress.toLowerCase()
const payload = {
  address: walletAddress,
  message: 'siwe-message',
  signature: '0xsignature',
}

function request(body: unknown, cookieNonce: string | undefined): NextRequest {
  return {
    json: async () => body,
    cookies: {
      get: (name: string) => name === WALLET_AUTH_NONCE_COOKIE && cookieNonce
        ? { name, value: cookieNonce }
        : undefined,
    },
  } as unknown as NextRequest
}

describe('wallet auth verify route', () => {
  beforeEach(() => {
    vi.stubEnv('SESSION_SECRET', 'test-session-secret')
    dbMock.connect.mockReset()
    dbMock.query.mockReset()
    dbMock.release.mockReset()
    siweMock.verifySiweMessage.mockReset()
    dbMock.connect.mockResolvedValue({
      query: dbMock.query,
      release: dbMock.release,
    })
  })

  it('rejects nonce mismatches before SIWE verification', async () => {
    const response = await POST(request({
      payload,
      nonce: 'clientnonce',
    }, 'cookienonce'))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toMatchObject({
      success: false,
      message: 'Wallet auth context is invalid',
    })
    expect(siweMock.verifySiweMessage).not.toHaveBeenCalled()
    expect(dbMock.connect).not.toHaveBeenCalled()
  })

  it('rejects invalid SIWE payloads', async () => {
    siweMock.verifySiweMessage.mockResolvedValue({
      isValid: false,
      siweMessageData: {},
    })

    const response = await POST(request({
      payload,
      nonce: 'nonce12345',
    }, 'nonce12345'))

    expect(response.status).toBe(401)
    expect(siweMock.verifySiweMessage).toHaveBeenCalledWith(payload, 'nonce12345', WALLET_AUTH_STATEMENT)
    expect(dbMock.connect).not.toHaveBeenCalled()
  })

  it('upserts a normalized wallet user and returns a wallet-bound session', async () => {
    siweMock.verifySiweMessage.mockResolvedValue({
      isValid: true,
      siweMessageData: {
        address: walletAddress,
      },
    })
    dbMock.query.mockResolvedValue({
      rows: [{
        id: 7,
        name: `wallet:${normalizedWalletAddress}`,
        wallet_address: normalizedWalletAddress,
      }],
    })

    const response = await POST(request({
      payload,
      nonce: 'nonce12345',
    }, 'nonce12345'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(dbMock.query).toHaveBeenCalledWith(expect.stringContaining('ON CONFLICT (wallet_address)'), [
      `wallet:${normalizedWalletAddress}`,
      normalizedWalletAddress,
    ])
    expect(dbMock.release).toHaveBeenCalled()
    expect(body).toMatchObject({
      success: true,
      authenticated: true,
      user: {
        id: 7,
        subject: `wallet:${normalizedWalletAddress}`,
        walletAddress: normalizedWalletAddress,
      },
    })
  })
})
