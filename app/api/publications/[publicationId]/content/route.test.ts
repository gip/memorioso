import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  getCachedPublication: vi.fn(),
  getCachedProof: vi.fn(),
  getCachedPublicationAccess: vi.fn(),
  resolvePublicationAccess: vi.fn(),
  refreshTokenForSettledPayer: vi.fn(),
  reserveAccessGrant: vi.fn(),
  completeAccessGrant: vi.fn(),
  failAccessGrant: vi.fn(),
  verifyPayment: vi.fn(),
  settlePayment: vi.fn(),
  buildLibroEmbedManifest: vi.fn(),
}))

vi.mock('@/lib/db/publication-cache', () => ({
  getCachedPublication: mocks.getCachedPublication,
  getCachedProof: mocks.getCachedProof,
  getCachedPublicationAccess: mocks.getCachedPublicationAccess,
}))

vi.mock('@/lib/access/publication-access', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/access/publication-access')>()),
  resolvePublicationAccess: mocks.resolvePublicationAccess,
}))

vi.mock('@/lib/access/grants', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/access/grants')>()),
  refreshTokenForSettledPayer: mocks.refreshTokenForSettledPayer,
  reserveAccessGrant: mocks.reserveAccessGrant,
  completeAccessGrant: mocks.completeAccessGrant,
  failAccessGrant: mocks.failAccessGrant,
}))

vi.mock('@/lib/x402/verify', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/x402/verify')>()),
  verifyPayment: mocks.verifyPayment,
}))
vi.mock('@/lib/x402/settle', () => ({ settlePayment: mocks.settlePayment }))

vi.mock('@/lib/libro/embed', () => ({
  buildLibroEmbedManifest: mocks.buildLibroEmbedManifest,
  LibroEmbedUnavailableError: class extends Error {},
}))

import { GET } from './route'

const publication = {
  author_id_libro: 'author-1',
  author_handle_libro: 'ada',
  publication_title: 'A gated article',
  publication_subtitle: '',
  publication_content: { html: '<p>The whole body</p>' },
  publication_date: '2026-08-18T00:00:00.000Z',
  version: '3',
}

const context = { params: Promise.resolve({ publicationId: '42' }) }

const request = (headers: Record<string, string> = {}) =>
  new NextRequest('https://memorioso.xyz/api/publications/42/content', { headers })

const paymentHeader = () =>
  Buffer.from(JSON.stringify({
    x402Version: 1,
    scheme: 'exact',
    network: 'eip155:480',
    payload: {
      signature: `0x${'11'.repeat(65)}`,
      authorization: {
        from: '0x3333333333333333333333333333333333333333',
        to: '0x1111111111111111111111111111111111111111',
        value: '50000',
        validAfter: '0',
        validBefore: '99999999999',
        nonce: `0x${'ab'.repeat(32)}`,
      },
    },
  }), 'utf8').toString('base64')

beforeEach(() => {
  process.env.X402_PAY_TO_ADDRESS = '0x1111111111111111111111111111111111111111'
  process.env.X402_ASSET_ADDRESS = '0x79A02482A880bCE3F13e09Da970dC34db4CD24d1'
  process.env.X402_ASSET_NAME = 'USDC'
  process.env.X402_ASSET_VERSION = '2'
  process.env.X402_DEFAULT_PRICE_USD = '0.05'

  Object.values(mocks).forEach((mock) => mock.mockReset())
  mocks.getCachedPublication.mockResolvedValue(publication)
  mocks.getCachedProof.mockResolvedValue({ protocol_version: '4.0' })
  mocks.getCachedPublicationAccess.mockResolvedValue({ access: 'gated', priceUsd: null })
  mocks.buildLibroEmbedManifest.mockReturnValue({ schema: 'libro-embed-v1' })
  mocks.verifyPayment.mockResolvedValue({
    ok: true,
    payer: '0x3333333333333333333333333333333333333333',
    amount: BigInt(50000),
    validBefore: BigInt(99999999999),
  })
  mocks.refreshTokenForSettledPayer.mockResolvedValue(null)
  mocks.reserveAccessGrant.mockResolvedValue({ grantId: 'grant-1', token: 'fresh-token' })
  mocks.settlePayment.mockResolvedValue(`0x${'cd'.repeat(32)}`)
})

describe('publication content API', () => {
  it('serves a public publication without payment', async () => {
    mocks.getCachedPublicationAccess.mockResolvedValue({ access: 'public', priceUsd: null })
    mocks.resolvePublicationAccess.mockResolvedValue({ allowed: true, reason: 'public' })

    const response = await GET(request(), context)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.publication.publication_content.html).toBe('<p>The whole body</p>')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(mocks.settlePayment).not.toHaveBeenCalled()
  })

  it('serves a gated publication to a signed-in reader', async () => {
    mocks.resolvePublicationAccess.mockResolvedValue({ allowed: true, reason: 'session' })

    const response = await GET(request(), context)
    expect(response.status).toBe(200)
    expect(mocks.settlePayment).not.toHaveBeenCalled()
  })

  it('answers 402 with payment requirements when nothing is presented', async () => {
    mocks.resolvePublicationAccess.mockResolvedValue({ allowed: false, priceUsd: '0.05' })

    const response = await GET(request(), context)
    const body = await response.json()

    expect(response.status).toBe(402)
    expect(body.x402Version).toBe(1)
    expect(body.accepts[0]).toMatchObject({
      scheme: 'exact',
      network: 'eip155:480',
      maxAmountRequired: '50000',
      extra: { name: 'USDC', version: '2' },
    })
    expect(JSON.stringify(body)).not.toContain('The whole body')
  })

  // Without payment env there are no requirements to quote, so a 402 would be a
  // promise the deployment cannot keep.
  it('answers 403 rather than 402 when the deployment takes no payments', async () => {
    delete process.env.X402_PAY_TO_ADDRESS
    mocks.resolvePublicationAccess.mockResolvedValue({ allowed: false, priceUsd: null })

    const response = await GET(request(), context)
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.success).toBe(false)
    expect(JSON.stringify(body)).not.toContain('The whole body')
  })

  it('uses the per-publication price when one is set', async () => {
    mocks.getCachedPublicationAccess.mockResolvedValue({ access: 'gated', priceUsd: '0.25' })
    mocks.resolvePublicationAccess.mockResolvedValue({ allowed: false, priceUsd: '0.25' })

    const body = await (await GET(request(), context)).json()
    expect(body.accepts[0].maxAmountRequired).toBe('250000')
  })

  it('settles a valid payment, records the grant, and hands back an access token', async () => {
    mocks.resolvePublicationAccess.mockResolvedValue({ allowed: false, priceUsd: '0.05' })

    const response = await GET(request({ 'x-payment': paymentHeader() }), context)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(mocks.reserveAccessGrant).toHaveBeenCalledTimes(1)
    expect(mocks.settlePayment).toHaveBeenCalledTimes(1)
    expect(mocks.completeAccessGrant).toHaveBeenCalledWith('grant-1', `0x${'cd'.repeat(32)}`)
    expect(body.access.token).toBe('fresh-token')
    expect(response.cookies.get('memorioso_access_42')?.value).toBe('fresh-token')

    const settlement = JSON.parse(
      Buffer.from(response.headers.get('X-PAYMENT-RESPONSE') || '', 'base64').toString('utf8')
    )
    expect(settlement).toMatchObject({ success: true, network: 'eip155:480' })
  })

  // The nonce is claimed before broadcast, so this is the replay guard.
  it('does not reach the chain when the nonce is already reserved', async () => {
    mocks.resolvePublicationAccess.mockResolvedValue({ allowed: false, priceUsd: '0.05' })
    mocks.reserveAccessGrant.mockResolvedValue(null)

    const response = await GET(request({ 'x-payment': paymentHeader() }), context)
    expect(response.status).toBe(402)
    expect(mocks.settlePayment).not.toHaveBeenCalled()
  })

  it('never charges a payer who already holds a grant', async () => {
    mocks.resolvePublicationAccess.mockResolvedValue({ allowed: false, priceUsd: '0.05' })
    mocks.refreshTokenForSettledPayer.mockResolvedValue('returning-token')

    const response = await GET(request({ 'x-payment': paymentHeader() }), context)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.access.token).toBe('returning-token')
    expect(mocks.reserveAccessGrant).not.toHaveBeenCalled()
    expect(mocks.settlePayment).not.toHaveBeenCalled()
  })

  it('marks the grant failed when settlement reverts', async () => {
    mocks.resolvePublicationAccess.mockResolvedValue({ allowed: false, priceUsd: '0.05' })
    mocks.settlePayment.mockRejectedValue(new Error('x402 settlement transaction reverted'))

    const response = await GET(request({ 'x-payment': paymentHeader() }), context)

    expect(response.status).toBe(402)
    expect(mocks.failAccessGrant).toHaveBeenCalledWith('grant-1')
    expect(mocks.completeAccessGrant).not.toHaveBeenCalled()
  })

  it('rejects a failed verification without touching the chain', async () => {
    mocks.resolvePublicationAccess.mockResolvedValue({ allowed: false, priceUsd: '0.05' })
    mocks.verifyPayment.mockResolvedValue({ ok: false, reason: 'Authorization has expired' })

    const response = await GET(request({ 'x-payment': paymentHeader() }), context)
    const body = await response.json()

    expect(response.status).toBe(402)
    expect(body.error).toBe('Authorization has expired')
    expect(mocks.reserveAccessGrant).not.toHaveBeenCalled()
  })

  it('rejects an oversized payment header', async () => {
    mocks.resolvePublicationAccess.mockResolvedValue({ allowed: false, priceUsd: '0.05' })

    const response = await GET(request({ 'x-payment': 'a'.repeat(8193) }), context)
    const body = await response.json()

    expect(response.status).toBe(402)
    expect(body.error).toBe('X-PAYMENT header is too large')
  })

  it('404s an unknown publication', async () => {
    mocks.getCachedPublication.mockResolvedValue(null)
    const response = await GET(request(), context)
    expect(response.status).toBe(404)
  })
})
