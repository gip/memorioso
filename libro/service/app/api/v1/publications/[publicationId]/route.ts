import { errorResponse } from '@/lib/errors'
import { getPublication } from '@/lib/publications'

export async function GET(_request: Request, context: { params: Promise<{ publicationId: string }> }): Promise<Response> {
  try {
    const { publicationId } = await context.params
    const publication = await getPublication(publicationId)
    if (!publication) return Response.json({ error: { code: 'NOT_FOUND', message: 'Publication not found', retryable: false } }, { status: 404 })
    return Response.json({ publication }, { headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=60' } })
  } catch (error) {
    return errorResponse(error)
  }
}
