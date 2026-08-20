import { cookies, headers } from 'next/headers'
import type { NextRequest } from 'next/server'
import { getAuthenticatedUser } from '@/lib/auth-user'
import { getCachedPublicationAccess } from '@/lib/db/publication-cache'
import { tryGetPublicationAccessConfig } from '@/lib/access/config'
import {
  ACCESS_TOKEN_HEADER,
  accessCookieName,
  findSettledGrantByToken,
} from '@/lib/access/grants'

export type AccessReason = 'public' | 'session' | 'payment'

export type AccessDecision =
  | { allowed: true; reason: AccessReason }
  /** `priceUsd` is null when this deployment cannot take payments: sign-in only. */
  | { allowed: false; priceUsd: string | null }

export type GatedPricing = { priceUsd: string | null }

async function readAccessToken(
  publicationId: string,
  request?: NextRequest
): Promise<string | null> {
  if (request) {
    return request.headers.get(ACCESS_TOKEN_HEADER)
      || request.cookies.get(accessCookieName(publicationId))?.value
      || null
  }

  const [headerStore, cookieStore] = await Promise.all([headers(), cookies()])
  return headerStore.get(ACCESS_TOKEN_HEADER)
    || cookieStore.get(accessCookieName(publicationId))?.value
    || null
}

/**
 * Reads cookies and headers, so callers must keep it inside a dynamic Suspense
 * boundary — never inside a `'use cache'` scope.
 */
export async function resolvePublicationAccess(
  publicationId: string,
  request?: NextRequest
): Promise<AccessDecision> {
  const record = await getCachedPublicationAccess(publicationId)
  if (!record || record.access !== 'gated') {
    return { allowed: true, reason: 'public' }
  }

  // Every Memorioso account is bound to a verified World ID session, so being
  // signed in already carries proof of personhood.
  const user = await getAuthenticatedUser(request)
  if (user) {
    return { allowed: true, reason: 'session' }
  }

  const token = await readAccessToken(publicationId, request)
  if (token && await findSettledGrantByToken(publicationId, token)) {
    return { allowed: true, reason: 'payment' }
  }

  return { allowed: false, priceUsd: effectivePriceUsd(record.priceUsd) }
}

/**
 * The advertised price, or null when x402 is not configured here. A per-publication
 * price is still meaningless without the payTo/asset env, so an unconfigured
 * deployment advertises no price at all rather than one nobody can pay.
 */
export function effectivePriceUsd(priceUsd: string | null | undefined): string | null {
  const config = tryGetPublicationAccessConfig()
  if (!config) return null
  return priceUsd || config.defaultPriceUsd
}
