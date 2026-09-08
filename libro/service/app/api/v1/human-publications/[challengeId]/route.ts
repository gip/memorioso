import { publicationStatus } from '@/lib/human-publications'
import { authenticateBearer } from '@/lib/oauth'
import { errorResponse } from '@/lib/errors'

export async function GET(request: Request, context: { params: Promise<{ challengeId: string }> }): Promise<Response> {
  try {
    const { challengeId } = await context.params
    const resource = new URL('/api/v1', request.url).toString()
    const principal = await authenticateBearer(request, undefined, resource)
    return Response.json(await publicationStatus({ principal, challengeId }), { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return errorResponse(error)
  }
}
