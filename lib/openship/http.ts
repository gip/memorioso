// Shared response shape for public, CORS-readable OpenShip endpoints.

import { NextResponse } from 'next/server'

// Current-origin documents are revalidated. Immutable caching is reserved for content-addressed
// snapshots and candidate origins, and is not inferred by a mutable production route.
const REVALIDATE = 'public, max-age=0, must-revalidate'

export const openshipHeaders = (contentType: string): Record<string, string> => ({
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': REVALIDATE,
  'Content-Type': contentType,
})

export const openshipResponse = (body: string | Buffer, contentType: string): NextResponse =>
  new NextResponse(body as unknown as BodyInit, {
    status: 200,
    headers: openshipHeaders(contentType),
  })

export const openshipNotFound = (message: string): NextResponse =>
  NextResponse.json(
    { openship: '1.0', error: 'not_found', message },
    { status: 404, headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' } }
  )

/**
 * The public origin, from NEXT_PUBLIC_APP_URL. Read from env rather than request headers so these
 * handlers stay prerenderable under cacheComponents.
 */
export const openshipOrigin = (request?: Request): string => {
  if (request) {
    try {
      return new URL(request.url).origin
    } catch {
      // Fall through to the configured canonical origin.
    }
  }
  const value = process.env.NEXT_PUBLIC_APP_URL
  if (!value) return ''
  try {
    return new URL(value).toString().replace(/\/$/, '')
  } catch {
    return ''
  }
}

/**
 * Changes responses are dynamic. Submissions, violations, and status are never cached.
 */
export const openshipDynamicJson = (body: unknown, status = 200): NextResponse =>
  NextResponse.json(body, {
    status,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-PAYMENT',
      'Cache-Control': 'no-store',
    },
  })
