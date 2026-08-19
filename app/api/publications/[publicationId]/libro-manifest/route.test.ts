import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  getCachedPublication: vi.fn(),
  getCachedProof: vi.fn(),
  getCachedPublicationAccess: vi.fn(),
  resolvePublicationAccess: vi.fn(),
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

vi.mock('@/lib/libro/embed', () => ({
  buildLibroEmbedManifest: mocks.buildLibroEmbedManifest,
  LibroEmbedUnavailableError: class extends Error {},
}))

import { GET } from './route'

const context = { params: Promise.resolve({ publicationId: '42' }) }
const request = () => new NextRequest('https://memorioso.xyz/api/publications/42/libro-manifest')

beforeEach(() => {
  process.env.X402_PAY_TO_ADDRESS = '0x1111111111111111111111111111111111111111'
  process.env.X402_ASSET_ADDRESS = '0x79A02482A880bCE3F13e09Da970dC34db4CD24d1'
  process.env.X402_ASSET_NAME = 'USDC'
  process.env.X402_ASSET_VERSION = '2'
  process.env.X402_DEFAULT_PRICE_USD = '0.05'

  Object.values(mocks).forEach((mock) => mock.mockReset())
  mocks.getCachedPublication.mockResolvedValue({ publication_title: 'A gated article' })
  mocks.getCachedProof.mockResolvedValue({ protocol_version: '4.0' })
  mocks.buildLibroEmbedManifest.mockReturnValue({
    schema: 'libro-embed-v1',
    publication: { publication_content: { html: '<p>The whole body</p>' } },
  })
})

describe('libro manifest API', () => {
  it('serves a public manifest with a long-lived shared cache', async () => {
    mocks.getCachedPublicationAccess.mockResolvedValue({ access: 'public', priceUsd: null })

    const response = await GET(request(), context)
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable')
    expect(mocks.resolvePublicationAccess).not.toHaveBeenCalled()
  })

  // A manifest carries the whole signed publication, so a gated one must not be
  // stored by a shared cache and must not reach a caller without access.
  it('answers 402 for a gated manifest without access, leaking nothing', async () => {
    mocks.getCachedPublicationAccess.mockResolvedValue({ access: 'gated', priceUsd: null })
    mocks.resolvePublicationAccess.mockResolvedValue({ allowed: false, priceUsd: '0.05' })

    const response = await GET(request(), context)
    const body = await response.json()

    expect(response.status).toBe(402)
    expect(body.accepts[0].maxAmountRequired).toBe('50000')
    expect(JSON.stringify(body)).not.toContain('The whole body')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })

  it('answers 403 for a gated manifest when the deployment takes no payments', async () => {
    delete process.env.X402_PAY_TO_ADDRESS
    mocks.getCachedPublicationAccess.mockResolvedValue({ access: 'gated', priceUsd: null })
    mocks.resolvePublicationAccess.mockResolvedValue({ allowed: false, priceUsd: null })

    const response = await GET(request(), context)
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(JSON.stringify(body)).not.toContain('The whole body')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })

  it('serves a gated manifest to a reader with access, but never publicly cacheable', async () => {
    mocks.getCachedPublicationAccess.mockResolvedValue({ access: 'gated', priceUsd: null })
    mocks.resolvePublicationAccess.mockResolvedValue({ allowed: true, reason: 'payment' })

    const response = await GET(request(), context)
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  })

  it('404s an unknown publication', async () => {
    mocks.getCachedPublication.mockResolvedValue(null)
    mocks.getCachedPublicationAccess.mockResolvedValue(null)
    expect((await GET(request(), context)).status).toBe(404)
  })
})
