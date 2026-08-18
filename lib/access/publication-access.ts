import { cookies, headers } from 'next/headers'
import type { NextRequest } from 'next/server'
import { getAuthenticatedUser } from '@/lib/auth-user'
import { getCachedPublicationAccess } from '@/lib/db/publication-cache'
import { getPublicationAccessConfig } from '@/lib/access/config'
import {
  ACCESS_TOKEN_HEADER,
  accessCookieName,
  findSettledGrantByToken,
} from '@/lib/access/grants'

export type AccessReason = 'public' | 'session' | 'payment'

export type AccessDecision =
  | { allowed: true; reason: AccessReason }
  | { allowed: false; priceUsd: string }

export type GatedPricing = { priceUsd: string }

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

export function effectivePriceUsd(priceUsd: string | null | undefined): string {
  return priceUsd || getPublicationAccessConfig().defaultPriceUsd
}
