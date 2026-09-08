import { errorResponse } from '@/lib/errors'
import { signingContext } from '@/lib/human-signing'

export async function POST(request: Request, context: { params: Promise<{ capability: string }> }): Promise<Response> {
  try {
    const { capability } = await context.params
    return Response.json(await signingContext(request, capability), { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return errorResponse(error)
  }
}
