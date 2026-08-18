import { beforeEach, describe, expect, it } from 'vitest'
import { priceToAssetUnits } from '@/lib/access/config'
import { buildPaymentRequirements, encodeSettlementHeader, paymentRequiredBody } from './requirements'

const PAY_TO = '0x1111111111111111111111111111111111111111'
const ASSET = '0x79A02482A880bCE3F13e09Da970dC34db4CD24d1'

beforeEach(() => {
  process.env.X402_PAY_TO_ADDRESS = PAY_TO
  process.env.X402_ASSET_ADDRESS = ASSET
  process.env.X402_ASSET_NAME = 'USDC'
  process.env.X402_ASSET_VERSION = '2'
  process.env.X402_DEFAULT_PRICE_USD = '0.05'
})

describe('priceToAssetUnits', () => {
  it('scales USD to six-decimal units without floating point drift', () => {
    expect(priceToAssetUnits('0.05')).toBe(BigInt(50000))
    expect(priceToAssetUnits('1')).toBe(BigInt(1000000))
    expect(priceToAssetUnits('0.000001')).toBe(BigInt(1))
    expect(priceToAssetUnits('12.345678')).toBe(BigInt(12345678))
  })
})

describe('buildPaymentRequirements', () => {
  it('advertises the verified World Chain USDC domain', () => {
    const requirements = buildPaymentRequirements({
      resource: 'https://memorioso.xyz/api/publications/1/content',
      description: 'Full text',
      priceUsd: '0.05',
    })

    expect(requirements).toMatchObject({
      scheme: 'exact',
      network: 'eip155:480',
      maxAmountRequired: '50000',
      asset: ASSET,
      payTo: PAY_TO,
      maxTimeoutSeconds: 120,
      extra: { name: 'USDC', version: '2' },
    })
  })

  it('throws rather than falling back when configuration is missing', () => {
    delete process.env.X402_PAY_TO_ADDRESS
    expect(() =>
      buildPaymentRequirements({ resource: 'r', description: 'd', priceUsd: '0.05' })
    ).toThrow('X402_PAY_TO_ADDRESS is required')
  })
})

describe('paymentRequiredBody', () => {
  it('wraps requirements in the x402 v1 envelope', () => {
    const requirements = buildPaymentRequirements({
      resource: 'https://memorioso.xyz/api/publications/1/content',
      description: 'Full text',
      priceUsd: '0.05',
    })
    const body = paymentRequiredBody(requirements, 'X-PAYMENT header is required')

    expect(body.x402Version).toBe(1)
    expect(body.error).toBe('X-PAYMENT header is required')
    expect(body.accepts).toEqual([requirements])
  })
})

describe('encodeSettlementHeader', () => {
  it('round-trips through base64', () => {
    const payload = { success: true, transaction: '0xabc', network: 'eip155:480', payer: '0x1' }
    const decoded = JSON.parse(Buffer.from(encodeSettlementHeader(payload), 'base64').toString('utf8'))
    expect(decoded).toEqual(payload)
  })
})
