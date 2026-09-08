import { errorResponse } from '@/lib/errors'
import { getAuthor } from '@/lib/publications'

export async function GET(_request: Request, context: { params: Promise<{ idOrHandle: string }> }): Promise<Response> {
  try {
    const { idOrHandle } = await context.params
    const author = await getAuthor(idOrHandle)
    if (!author) return Response.json({ error: { code: 'NOT_FOUND', message: 'Author not found', retryable: false } }, { status: 404 })
    return Response.json({ author }, { headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=60' } })
  } catch (error) {
    return errorResponse(error)
  }
}
