// Shared response shape for the Openship endpoints. Mirrors the public, CORS-open, immutable
// contract already used by app/api/publications/[publicationId]/libro-manifest/route.ts, minus its
// OPTIONS handler: these are simple GETs that never trigger a CORS preflight, and exporting a
// second method would opt every Openship route out of static prerendering.

import { NextResponse } from 'next/server'

// The payload is fixed at build time, so every response for a given deployment is immutable.
const IMMUTABLE = 'public, max-age=31536000, immutable'

export const openshipHeaders = (contentType: string): Record<string, string> => ({
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': IMMUTABLE,
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
export const openshipOrigin = (): string => {
  const value = process.env.NEXT_PUBLIC_APP_URL
  if (!value) return ''
  try {
    return new URL(value).toString().replace(/\/$/, '')
  } catch {
    return ''
  }
}
