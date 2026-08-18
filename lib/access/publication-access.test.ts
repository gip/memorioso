import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  getCachedPublicationAccess: vi.fn(),
  getAuthenticatedUser: vi.fn(),
  findSettledGrantByToken: vi.fn(),
  cookies: vi.fn(),
  headers: vi.fn(),
}))

vi.mock('@/lib/db/publication-cache', () => ({
  getCachedPublicationAccess: mocks.getCachedPublicationAccess,
}))
vi.mock('@/lib/auth-user', () => ({ getAuthenticatedUser: mocks.getAuthenticatedUser }))
vi.mock('@/lib/access/grants', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/access/grants')>()),
  findSettledGrantByToken: mocks.findSettledGrantByToken,
}))
vi.mock('next/headers', () => ({ cookies: mocks.cookies, headers: mocks.headers }))

import { effectivePriceUsd, resolvePublicationAccess } from './publication-access'

const request = (headers: Record<string, string> = {}) =>
  new NextRequest('https://memorioso.xyz/article/42', { headers })

beforeEach(() => {
  process.env.X402_PAY_TO_ADDRESS = '0x1111111111111111111111111111111111111111'
  process.env.X402_ASSET_ADDRESS = '0x79A02482A880bCE3F13e09Da970dC34db4CD24d1'
  process.env.X402_ASSET_NAME = 'USDC'
  process.env.X402_ASSET_VERSION = '2'
  process.env.X402_DEFAULT_PRICE_USD = '0.05'

  Object.values(mocks).forEach((mock) => mock.mockReset())
  mocks.getCachedPublicationAccess.mockResolvedValue({ access: 'gated', priceUsd: null })
  mocks.getAuthenticatedUser.mockResolvedValue(null)
  mocks.findSettledGrantByToken.mockResolvedValue(null)
  mocks.cookies.mockResolvedValue({ get: () => undefined })
  mocks.headers.mockResolvedValue({ get: () => null })
})

describe('resolvePublicationAccess', () => {
  it('grants a public publication without looking at the caller', async () => {
    mocks.getCachedPublicationAccess.mockResolvedValue({ access: 'public', priceUsd: null })

    expect(await resolvePublicationAccess('42', request())).toEqual({ allowed: true, reason: 'public' })
    expect(mocks.getAuthenticatedUser).not.toHaveBeenCalled()
  })

  it('treats a missing publication as public rather than gating it', async () => {
    mocks.getCachedPublicationAccess.mockResolvedValue(null)
    expect(await resolvePublicationAccess('42', request())).toEqual({ allowed: true, reason: 'public' })
  })

  // Every Memorioso account is bound to a verified World ID session.
  it('grants a gated publication to any signed-in reader', async () => {
    mocks.getAuthenticatedUser.mockResolvedValue({ id: 7, handle: 'ada' })
    expect(await resolvePublicationAccess('42', request())).toEqual({ allowed: true, reason: 'session' })
  })

  it('grants on a settled access token presented as a header', async () => {
    mocks.findSettledGrantByToken.mockResolvedValue({ id: 'grant-1', payerAddress: '0x3', transactionHash: '0xcd' })

    const decision = await resolvePublicationAccess('42', request({ 'x-memorioso-access-token': 'tok' }))

    expect(decision).toEqual({ allowed: true, reason: 'payment' })
    expect(mocks.findSettledGrantByToken).toHaveBeenCalledWith('42', 'tok')
  })

  it('denies when the token has no settled grant for this publication', async () => {
    const decision = await resolvePublicationAccess('42', request({ 'x-memorioso-access-token': 'tok' }))
    expect(decision).toEqual({ allowed: false, priceUsd: '0.05' })
  })

  it('denies an anonymous reader at the per-publication price', async () => {
    mocks.getCachedPublicationAccess.mockResolvedValue({ access: 'gated', priceUsd: '0.25' })
    expect(await resolvePublicationAccess('42', request())).toEqual({ allowed: false, priceUsd: '0.25' })
  })

  it('falls back to next/headers when no request is passed', async () => {
    mocks.headers.mockResolvedValue({ get: () => null })
    mocks.cookies.mockResolvedValue({ get: (name: string) => name === 'memorioso_access_42' ? { value: 'tok' } : undefined })
    mocks.findSettledGrantByToken.mockResolvedValue({ id: 'grant-1', payerAddress: '0x3', transactionHash: '0xcd' })

    expect(await resolvePublicationAccess('42')).toEqual({ allowed: true, reason: 'payment' })
  })
})

describe('effectivePriceUsd', () => {
  it('prefers the per-publication price and falls back to the configured default', () => {
    expect(effectivePriceUsd('0.25')).toBe('0.25')
    expect(effectivePriceUsd(null)).toBe('0.05')
  })
})
