import { errorResponse } from '@/lib/errors'
import { getPublicationBySignal } from '@/lib/publications'

export async function GET(_request: Request, context: { params: Promise<{ signalHash: string }> }): Promise<Response> {
  try {
    const { signalHash } = await context.params
    const publication = await getPublicationBySignal(signalHash)
    if (!publication) return Response.json({ error: { code: 'NOT_FOUND', message: 'Publication not found', retryable: false } }, { status: 404 })
    return Response.json({ publication }, { headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=60' } })
  } catch (error) {
    return errorResponse(error)
  }
}
