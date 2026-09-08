import { createHumanChallenge } from '@/lib/human-publications'
import { authenticateBearer } from '@/lib/oauth'
import { errorResponse } from '@/lib/errors'

export async function POST(request: Request): Promise<Response> {
  try {
    const resource = new URL('/api/v1', request.url).toString()
    const principal = await authenticateBearer(request, 'publish', resource)
    const body = await request.json() as { publication?: unknown; clientReference?: string }
    if (!body.publication) return Response.json({ error: { code: 'INVALID_REQUEST', message: 'publication is required', retryable: false } }, { status: 400 })
    return Response.json(await createHumanChallenge({
      principal,
      publication: body.publication,
      clientReference: body.clientReference,
    }), { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return errorResponse(error)
  }
}
