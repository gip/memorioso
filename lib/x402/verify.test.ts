import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getAddress, verifyTypedData as verifyTypedDataStandalone } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const chainMock = vi.hoisted(() => ({ readContract: vi.fn() }))

vi.mock('@libro/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@libro/core')>()),
  createLibroPublicClient: () => ({
    // Exercise the real signature check; only the chain reads are stubbed.
    verifyTypedData: verifyTypedDataStandalone,
    readContract: chainMock.readContract,
  }),
}))

vi.mock('@/lib/libro/config', () => ({
  getLibroServerConfig: () => ({ rpcUrls: ['https://worldchain.example'] }),
}))

import { buildPaymentRequirements } from './requirements'
import { decodePaymentHeader, verifyPayment } from './verify'
import { TRANSFER_WITH_AUTHORIZATION_TYPES } from './eip3009'
import type { PaymentPayload } from './types'

const PAY_TO = '0x1111111111111111111111111111111111111111'
const ASSET = '0x79A02482A880bCE3F13e09Da970dC34db4CD24d1'
const payer = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d')

const requirements = () =>
  buildPaymentRequirements({
    resource: 'https://memorioso.xyz/api/publications/1/content',
    description: 'Full text',
    priceUsd: '0.05',
  })

async function signedPayload(overrides: Partial<{
  to: string
  value: string
  validAfter: string
  validBefore: string
  network: string
  scheme: string
  from: string
}> = {}): Promise<PaymentPayload> {
  const now = Math.floor(Date.now() / 1000)
  const authorization = {
    from: getAddress(overrides.from || payer.address),
    to: getAddress(overrides.to || PAY_TO),
    value: overrides.value || '50000',
    validAfter: overrides.validAfter || String(now - 60),
    validBefore: overrides.validBefore || String(now + 600),
    nonce: `0x${'ab'.repeat(32)}` as `0x${string}`,
  }

  const signature = await payer.signTypedData({
    domain: { name: 'USDC', version: '2', chainId: 480, verifyingContract: getAddress(ASSET) },
    types: TRANSFER_WITH_AUTHORIZATION_TYPES,
    primaryType: 'TransferWithAuthorization',
    message: {
      from: authorization.from,
      to: authorization.to,
      value: BigInt(authorization.value),
      validAfter: BigInt(authorization.validAfter),
      validBefore: BigInt(authorization.validBefore),
      nonce: authorization.nonce,
    },
  })

  return {
    x402Version: 1,
    scheme: overrides.scheme || 'exact',
    network: overrides.network || 'eip155:480',
    payload: { signature, authorization },
  }
}

beforeEach(() => {
  process.env.X402_PAY_TO_ADDRESS = PAY_TO
  process.env.X402_ASSET_ADDRESS = ASSET
  process.env.X402_ASSET_NAME = 'USDC'
  process.env.X402_ASSET_VERSION = '2'
  process.env.X402_DEFAULT_PRICE_USD = '0.05'
  chainMock.readContract.mockReset()
  chainMock.readContract.mockImplementation(({ functionName }: { functionName: string }) =>
    functionName === 'authorizationState' ? false : BigInt(1000000)
  )
})

describe('decodePaymentHeader', () => {
  it('decodes base64 JSON', () => {
    const header = Buffer.from(JSON.stringify({ x402Version: 1 }), 'utf8').toString('base64')
    expect(decodePaymentHeader(header)).toEqual({ x402Version: 1 })
  })

  it('returns null for junk', () => {
    expect(decodePaymentHeader('not-base64-json')).toBeNull()
    expect(decodePaymentHeader(Buffer.from('"a string"').toString('base64'))).toBeNull()
  })
})

describe('verifyPayment', () => {
  it('accepts a correctly signed authorization', async () => {
    const result = await verifyPayment(await signedPayload(), requirements())
    expect(result).toMatchObject({ ok: true, payer: getAddress(payer.address), amount: BigInt(50000) })
  })

  it('accepts the human-readable network alias too', async () => {
    const result = await verifyPayment(await signedPayload({ network: 'world-chain' }), requirements())
    expect(result.ok).toBe(true)
  })

  it('rejects a payment to the wrong recipient', async () => {
    const result = await verifyPayment(
      await signedPayload({ to: '0x2222222222222222222222222222222222222222' }),
      requirements()
    )
    expect(result).toEqual({ ok: false, reason: 'Authorization pays the wrong recipient' })
  })

  it('rejects an underpayment', async () => {
    const result = await verifyPayment(await signedPayload({ value: '49999' }), requirements())
    expect(result.ok).toBe(false)
  })

  it('rejects an expired authorization', async () => {
    const now = Math.floor(Date.now() / 1000)
    const result = await verifyPayment(
      await signedPayload({ validBefore: String(now - 1) }),
      requirements()
    )
    expect(result).toEqual({ ok: false, reason: 'Authorization has expired' })
  })

  it('rejects an authorization that is not valid yet', async () => {
    const now = Math.floor(Date.now() / 1000)
    const result = await verifyPayment(
      await signedPayload({ validAfter: String(now + 600) }),
      requirements()
    )
    expect(result).toEqual({ ok: false, reason: 'Authorization is not valid yet' })
  })

  it('rejects an unsupported scheme and network', async () => {
    expect((await verifyPayment(await signedPayload({ scheme: 'upto' }), requirements())).ok).toBe(false)
    expect((await verifyPayment(await signedPayload({ network: 'base' }), requirements())).ok).toBe(false)
  })

  // Tampering after signing must not survive, or anyone could redirect a payment.
  it('rejects a tampered authorization', async () => {
    const payload = await signedPayload()
    payload.payload.authorization.value = '5000000'
    const result = await verifyPayment(payload, requirements())
    expect(result).toEqual({ ok: false, reason: 'Authorization signature is invalid' })
  })

  it('rejects a nonce already spent on chain', async () => {
    chainMock.readContract.mockImplementation(({ functionName }: { functionName: string }) =>
      functionName === 'authorizationState' ? true : BigInt(1000000)
    )
    const result = await verifyPayment(await signedPayload(), requirements())
    expect(result).toEqual({ ok: false, reason: 'Authorization nonce has already been used on chain' })
  })

  it('rejects a payer who cannot cover the authorization', async () => {
    chainMock.readContract.mockImplementation(({ functionName }: { functionName: string }) =>
      functionName === 'authorizationState' ? false : BigInt(1)
    )
    const result = await verifyPayment(await signedPayload(), requirements())
    expect(result).toEqual({ ok: false, reason: 'Payer balance is below the authorized amount' })
  })

  it('rejects a malformed nonce', async () => {
    const payload = await signedPayload()
    payload.payload.authorization.nonce = '0xabcd'
    const result = await verifyPayment(payload, requirements())
    expect(result).toEqual({ ok: false, reason: 'Authorization nonce must be a 32-byte hex string' })
  })
})
