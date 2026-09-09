import { errorResponse } from '@/lib/errors'
import { importPublication } from '@/lib/imports'
import { authenticateBearer } from '@/lib/oauth'

export async function POST(request: Request): Promise<Response> {
  try {
    const resource = new URL('/api/v1', request.url).toString()
    const principal = await authenticateBearer(request, 'import', resource)
    const body = await request.json() as { manifest?: unknown; clientReference?: unknown }
    if (!body.manifest || (body.clientReference !== undefined && (typeof body.clientReference !== 'string' || body.clientReference.length > 256))) {
      return Response.json({ error: { code: 'INVALID_REQUEST', message: 'A manifest and optional clientReference are required', retryable: false } }, { status: 400 })
    }
    return Response.json(await importPublication({
      principal,
      manifest: body.manifest,
      clientReference: body.clientReference as string | undefined,
    }), { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return errorResponse(error)
  }
}
