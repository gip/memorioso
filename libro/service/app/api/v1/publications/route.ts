import { errorResponse } from '@/lib/errors'
import { listPublications } from '@/lib/publications'
import { authenticateServiceClient } from '@/lib/service-auth'

function integer(value: string | null, fallback: number, maximum: number): number {
  const parsed = value ? Number(value) : NaN
  return Number.isSafeInteger(parsed) ? Math.min(Math.max(parsed, 0), maximum) : fallback
}

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url)
    const rawKind = url.searchParams.get('kind') || 'all'
    const kind = rawKind === 'article' || rawKind === 'short' ? rawKind : 'all'
    const requestedOrigin = url.searchParams.get('originClientId') || undefined
    const originClientId = requestedOrigin ? await authenticateServiceClient(request) : undefined
    if (requestedOrigin && requestedOrigin !== originClientId) {
      return Response.json({ error: { code: 'ORIGIN_MISMATCH', message: 'Origin filter must match the service client', retryable: false } }, { status: 403 })
    }
    const publications = await listPublications({
      limit: integer(url.searchParams.get('limit'), 20, 100),
      offset: integer(url.searchParams.get('offset'), 0, Number.MAX_SAFE_INTEGER),
      authorId: url.searchParams.get('authorId') || undefined,
      originClientId,
      kind,
    })
    return Response.json({ publications }, { headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=30' } })
  } catch (error) {
    return errorResponse(error)
  }
}
